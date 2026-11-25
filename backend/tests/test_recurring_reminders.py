"""
Reminders: recurring rules the user records by hand (no auto_create). Nothing
posts them; each occurrence is recorded, with the amount adjusted, or skipped.
Also pass-through money (Transaction.pass_through), which moves the wallet but
stays out of the spending figures.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.modules.transactions.models import (
    CategoryType, RecurringFrequency, RecurringTransaction, Transaction, TransactionCategory,
    TransactionStatus, TransactionType, TransactionWalletType,
)
from app.modules.transactions.repositories import (
    RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
)
from app.modules.transactions.services import (
    RecurringTransactionService, ReminderConflict, TransactionService,
)
from app.utils.datetime_helpers import business_today
from test_peer_splits import _user

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


@pytest_asyncio.fixture
async def world(async_session):
    me = _user("me")
    shopping = TransactionCategory(id=uuid.uuid4(), name="Shopping", type=CategoryType.EXPENSE,
                                   icon="🛍️", color="#ff0000", is_active=True)
    dining = TransactionCategory(id=uuid.uuid4(), name="Dining", type=CategoryType.EXPENSE,
                                 icon="🍽️", color="#00ff00", is_active=True)
    async_session.add_all([me, shopping, dining])
    await async_session.commit()
    repo = RecurringTransactionRepository(async_session)
    svc = RecurringTransactionService(repo, TransactionService(
        TransactionRepository(async_session), TransactionCategoryRepository(async_session), repo))
    return dict(me=me, user_id=str(me.id), shopping=shopping, dining=dining, svc=svc, session=async_session)


async def _reminder(w, *, start, amount="526", **kw):
    data = dict(type=TransactionType.EXPENSE, amount=Decimal(amount), currency="TWD",
                category_id=str(w["shopping"].id), description="AI工具-Claude",
                subcategory="Subscriptions", frequency=RecurringFrequency.MONTHLY,
                interval=1, start_date=start, auto_create=False)
    data.update(kw)
    return await w["svc"].create_recurring_transaction(data, w["user_id"])


async def _rows(w):
    return (await w["session"].execute(select(Transaction).where(
        Transaction.user_id == w["me"].id).order_by(Transaction.transaction_date))).scalars().all()


async def test_a_reminder_is_never_posted_by_the_daily_run(world):
    await _reminder(world, start=date(2026, 10, 5))
    result = await world["svc"].process_due_transactions(max_date=date(2026, 11, 30))
    assert result["created"] == 0
    assert await _rows(world) == []


async def test_due_lists_reminders_up_to_the_date(world):
    await _reminder(world, start=date(2026, 11, 5))
    await _reminder(world, start=date(2026, 12, 5), description="新竹瓦斯")
    due = await world["svc"].due_reminders(world["user_id"], date(2026, 11, 30))
    assert [r.description for r in due] == ["AI工具-Claude"]


async def test_confirm_records_with_the_detail_and_moves_on(world):
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)
    await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))

    [row] = await _rows(world)
    assert (row.amount, row.subcategory, row.transaction_date, str(row.recurring_transaction_id)) == (
        Decimal("526"), "Subscriptions", date(2026, 11, 5), rule_id)
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert (rule.next_occurrence, rule.occurrence_count) == (date(2026, 12, 5), 1)


async def test_a_changed_amount_is_remembered_for_next_time(world):
    rule = await _reminder(world, start=date(2026, 11, 20), amount="210", description="新竹瓦斯",
                           subcategory=None)
    rule_id = str(rule.id)
    await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 20),
                                        amount=Decimal("238"), transaction_date=date(2026, 11, 22))
    [row] = await _rows(world)
    assert (row.amount, row.transaction_date) == (Decimal("238"), date(2026, 11, 22))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.amount == Decimal("238")


async def test_a_second_tap_on_the_same_occurrence_is_refused(world):
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)
    await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    with pytest.raises(ReminderConflict):
        await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    assert len(await _rows(world)) == 1


async def test_a_bill_paused_elsewhere_after_the_read_is_not_recorded(world, monkeypatch):
    """Device A reads the rule, device B pauses it, then A's claim must fail:
    the guard is in the UPDATE, not only in the read before it."""
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)
    repo = world["svc"].recurring_repo
    read = repo.get_by_id

    async def read_then_pause(rid, uid):
        loaded = await read(rid, uid)
        # The other device's write: straight to the row, leaving this read as it was.
        await repo.db.execute(
            update(RecurringTransaction).where(RecurringTransaction.id == loaded.id)
            .values(is_paused=True).execution_options(synchronize_session=False)
        )
        await repo.db.commit()
        return loaded

    monkeypatch.setattr(repo, "get_by_id", read_then_pause)
    with pytest.raises(ReminderConflict):
        await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    assert await _rows(world) == []


async def test_skip_moves_on_without_recording(world):
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)
    assert await world["svc"].skip_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    assert await _rows(world) == []
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.next_occurrence == date(2026, 12, 5)


async def test_the_last_occurrence_retires_the_rule(world):
    rule = await _reminder(world, start=date(2026, 11, 5), max_occurrences=1)
    rule_id = str(rule.id)
    await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.is_active is False


async def test_someone_elses_reminder_is_not_found(world):
    rule = await _reminder(world, start=date(2026, 11, 5))
    assert await world["svc"].confirm_reminder(str(rule.id), str(uuid.uuid4()), date(2026, 11, 5)) is None


async def test_a_detail_from_another_category_is_dropped(world):
    rule = await _reminder(world, start=date(2026, 11, 5), subcategory="Fuel")
    assert rule.subcategory is None


def _expense(w, description, amount, on, category_id=None, **kw):
    return Transaction(
        id=uuid.uuid4(), user_id=w["me"].id, category_id=category_id or w["shopping"].id,
        type=TransactionType.EXPENSE, status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)), currency="TWD", description=description,
        transaction_date=on, wallet_type=TransactionWalletType.LIFE, is_deleted=False, **kw,
    )


def _months_ago(n, day):
    today = business_today().replace(day=1)
    year, month = today.year, today.month - n
    while month < 1:
        month += 12
        year -= 1
    return date(year, month, day)


async def test_suggestions_pick_monthly_bills_not_frequent_spending(world):
    s = world["session"]
    for n in range(4):  # once a month: a bill
        s.add(_expense(world, "AI工具-Claude", 526, _months_ago(n, 3)))
    for n in range(4):  # several times a month: spending
        for day in (2, 12, 22):
            s.add(_expense(world, "中油加油", 120, _months_ago(n, day)))
    for n in range(2, 6):  # stopped two months ago
        s.add(_expense(world, "舊健身房", 999, _months_ago(n, 8)))
    for n in range(4):  # a monthly restaurant is a habit, not a bill
        s.add(_expense(world, "晚餐-八方雲集", 195, _months_ago(n, 5), category_id=world["dining"].id))
    await s.commit()

    suggestions = await world["svc"].suggestions(world["user_id"])
    assert [(x["description"], x["day_of_month"], x["months_seen"]) for x in suggestions] == [
        ("AI工具-Claude", 3, 4)]


async def test_a_bill_with_a_rule_is_not_suggested_again(world):
    s = world["session"]
    for n in range(4):
        s.add(_expense(world, "AI工具-Claude", 526, _months_ago(n, 3)))
    await s.commit()
    await _reminder(world, start=business_today() + timedelta(days=3))
    assert await world["svc"].suggestions(world["user_id"]) == []


async def test_pass_through_money_is_not_living_expenses(world):
    s = world["session"]
    s.add_all([
        _expense(world, "房租", 30000, date(2026, 8, 10)),
        _expense(world, "紐約押金", 40000, date(2026, 8, 10), pass_through=True),
    ])
    await s.commit()
    summary = await TransactionRepository(s).get_summary(
        user_id=world["user_id"], date_from=date(2026, 8, 1), date_to=date(2026, 8, 31))
    # The wallet still paid both; only one was spending.
    assert summary["total_expenses"] == Decimal("70000")
    assert summary["living_expenses"] == Decimal("30000")


async def test_only_my_own_money_leaves_pass_through_out(world):
    from app.modules.transactions.schemas import TransactionFilter
    s = world["session"]
    s.add_all([
        _expense(world, "房租", 30000, date(2026, 8, 10)),
        _expense(world, "紐約押金", 40000, date(2026, 8, 10), pass_through=True),
    ])
    await s.commit()

    async def expenses(exclude):
        rows = await TransactionRepository(s).get_filtered_summary(
            world["user_id"], TransactionFilter(exclude_transfers=exclude))
        return next(r for r in rows if r["currency"] == "TWD")["expenses"]

    assert await expenses(False) == Decimal("70000")
    assert await expenses(True) == Decimal("30000")


async def test_a_new_day_moves_a_bill_even_after_it_was_recorded(world):
    from app.modules.transactions.schemas import RecurringTransactionUpdate
    rule = await _reminder(world, start=date(2026, 10, 5))
    rule_id = str(rule.id)
    await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 10, 5))
    await world["svc"].update_recurring_transaction(rule_id, world["user_id"], RecurringTransactionUpdate(
        start_date=date(2026, 11, 20), next_occurrence=date(2026, 11, 20)))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.next_occurrence == date(2026, 11, 20)


async def test_a_month_skipped_by_mistake_can_be_brought_back(world):
    from app.modules.transactions.schemas import RecurringTransactionUpdate
    rule = await _reminder(world, start=date(2026, 11, 3))
    rule_id = str(rule.id)
    await world["svc"].skip_reminder(rule_id, world["user_id"], date(2026, 11, 3))
    await world["svc"].update_recurring_transaction(rule_id, world["user_id"], RecurringTransactionUpdate(
        start_date=date(2026, 11, 3), next_occurrence=date(2026, 11, 3)))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.next_occurrence == date(2026, 11, 3)


async def test_a_self_posting_rule_cannot_move_its_next_date(world):
    from app.modules.transactions.schemas import RecurringTransactionUpdate
    rule = await _reminder(world, start=date(2026, 10, 5), auto_create=True)
    with pytest.raises(ValueError):
        await world["svc"].update_recurring_transaction(str(rule.id), world["user_id"],
            RecurringTransactionUpdate(next_occurrence=date(2026, 1, 5)))


async def test_a_removed_bill_is_not_suggested_again(world):
    s = world["session"]
    for n in range(4):
        s.add(_expense(world, "AI工具-Claude", 526, _months_ago(n, 3)))
    await s.commit()
    rule = await _reminder(world, start=business_today() + timedelta(days=3))
    await world["svc"].recurring_repo.deactivate(rule.id)
    assert await world["svc"].suggestions(world["user_id"]) == []


async def test_a_self_posting_rule_with_history_does_not_rewind(world):
    """It would backfill every month back to the new date as real rows."""
    from app.modules.transactions.schemas import RecurringTransactionUpdate
    rule = await _reminder(world, start=date(2026, 10, 5), auto_create=True)
    rule_id = str(rule.id)
    await world["svc"].process_due_transactions(max_date=date(2026, 10, 5))
    await world["svc"].update_recurring_transaction(
        rule_id, world["user_id"], RecurringTransactionUpdate(start_date=date(2026, 1, 5)))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.next_occurrence == date(2026, 11, 5)


async def test_resending_the_same_start_date_does_not_bring_back_paid_months(world):
    from app.modules.transactions.schemas import RecurringTransactionUpdate
    rule = await _reminder(world, start=date(2026, 10, 5))
    rule_id = str(rule.id)
    await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 10, 5))
    await world["svc"].update_recurring_transaction(
        rule_id, world["user_id"],
        RecurringTransactionUpdate(start_date=date(2026, 10, 5), amount=Decimal("600")))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert rule.next_occurrence == date(2026, 11, 5)


async def test_a_saved_bill_stays_saved_when_the_rule_update_fails(world, monkeypatch):
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)

    async def broken(*a, **k):
        raise RuntimeError("db hiccup")
    monkeypatch.setattr(world["svc"].recurring_repo, "update", broken)

    transaction_id = await world["svc"].confirm_reminder(
        rule_id, world["user_id"], date(2026, 11, 5), amount=Decimal("600"))
    [row] = await _rows(world)
    assert transaction_id == str(row.id)
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert (rule.next_occurrence, rule.amount) == (date(2026, 12, 5), Decimal("526"))


async def test_a_bill_cannot_move_past_its_end(world):
    from app.modules.transactions.schemas import RecurringTransactionUpdate
    rule = await _reminder(world, start=date(2026, 11, 5), end_date=date(2026, 12, 31))
    with pytest.raises(ValueError):
        await world["svc"].update_recurring_transaction(str(rule.id), world["user_id"],
            RecurringTransactionUpdate(next_occurrence=date(2027, 1, 5)))


async def test_a_failed_record_puts_the_bill_back(world, monkeypatch):
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)

    async def fails(*a, **k):
        raise RuntimeError("could not record")

    monkeypatch.setattr(world["svc"].transaction_service, "create_transaction", fails)
    with pytest.raises(RuntimeError):
        await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    rule = await world["svc"].recurring_repo.get_by_id(rule_id, world["user_id"])
    assert (rule.next_occurrence, rule.occurrence_count) == (date(2026, 11, 5), 0)


async def test_putting_a_bill_back_keeps_an_edit_made_meanwhile(world, monkeypatch):
    """The undo is compare-and-set: a next date set on another device while the
    record was failing is kept, not overwritten with the claimed one."""
    rule = await _reminder(world, start=date(2026, 11, 5))
    rule_id = str(rule.id)
    repo = world["svc"].recurring_repo

    async def edited_then_fails(*a, **k):
        await repo.db.execute(
            update(RecurringTransaction).where(RecurringTransaction.id == rule.id)
            .values(next_occurrence=date(2026, 12, 20)).execution_options(synchronize_session=False)
        )
        await repo.db.commit()
        raise RuntimeError("could not record")

    monkeypatch.setattr(world["svc"].transaction_service, "create_transaction", edited_then_fails)
    with pytest.raises(RuntimeError):
        await world["svc"].confirm_reminder(rule_id, world["user_id"], date(2026, 11, 5))
    repo.db.expire_all()
    rule = await repo.get_by_id(rule_id, world["user_id"])
    # The edit stays, and the count still drops: nothing was recorded.
    assert (rule.next_occurrence, rule.occurrence_count) == (date(2026, 12, 20), 0)
