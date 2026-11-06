"""
The in-process scheduler's job list, and the recurring-transaction job.

Recurring rules used to materialise only when an admin hit
POST /transactions/recurring/process-due; no job ran them, so a user's rule
never produced a transaction on its own.
"""

from contextlib import asynccontextmanager
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core import scheduler as scheduler_module
from app.modules.transactions.models import (
    RecurringFrequency, RecurringTransaction, Transaction, TransactionCategory, TransactionType,
)
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.asyncio

EXPECTED_JOBS = {
    "tw_market_price_update", "us_market_price_update", "crypto_price_update",
    "daily_historical_sync", "daily_payment_due_reminders", "daily_spending_alerts",
    "daily_recurring_transactions",
}


async def test_init_scheduler_registers_every_job(monkeypatch):
    monkeypatch.setattr(scheduler_module, "scheduler", None)
    sched = scheduler_module.init_scheduler()
    try:
        assert {job.id for job in sched.get_jobs()} == EXPECTED_JOBS
        recurring = sched.get_job("daily_recurring_transactions")
        assert "hour='16'" in str(recurring.trigger) and "minute='10'" in str(recurring.trigger)
    finally:
        monkeypatch.setattr(scheduler_module, "scheduler", None)


def _use_session(monkeypatch, session):
    @asynccontextmanager
    async def factory():
        yield session

    monkeypatch.setattr(scheduler_module, "async_session", factory)


async def _rule(async_session, user, category, **overrides):
    today = business_today()
    fields = dict(
        id=uuid4(), user_id=user.id, type=TransactionType.EXPENSE, amount=Decimal("1200"),
        currency="TWD", category_id=category.id, description="Gym membership",
        frequency=RecurringFrequency.MONTHLY, interval=1, start_date=today,
        next_occurrence=today, occurrence_count=0, is_active=True, is_paused=False, auto_create=True,
    )
    fields.update(overrides)
    rule = RecurringTransaction(**fields)
    async_session.add(rule)
    await async_session.commit()
    return rule


async def _expense_category(async_session, seed_categories):
    return (await async_session.execute(
        select(TransactionCategory).where(TransactionCategory.type == TransactionType.EXPENSE)
    )).scalars().first()


async def test_a_due_rule_creates_its_transaction_once(monkeypatch, async_session, test_user, seed_categories):
    category = await _expense_category(async_session, seed_categories)
    rule = await _rule(async_session, test_user, category)
    _use_session(monkeypatch, async_session)

    first = await scheduler_module.process_recurring_transactions()
    assert (first["processed"], first["created"], first["failed"]) == (1, 1, 0)

    rows = (await async_session.execute(
        select(Transaction).where(Transaction.user_id == test_user.id))).scalars().all()
    assert [(r.description, r.amount, r.transaction_date) for r in rows] == [
        ("Gym membership", Decimal("1200.00"), business_today())]

    await async_session.refresh(rule)
    assert rule.next_occurrence > business_today()

    # Idempotent within the day: the rule has moved on, so a rerun does nothing.
    second = await scheduler_module.process_recurring_transactions()
    assert (second["processed"], second["created"]) == (0, 0)


async def test_paused_future_and_manual_rules_create_nothing(monkeypatch, async_session, test_user, seed_categories):
    category = await _expense_category(async_session, seed_categories)
    await _rule(async_session, test_user, category, is_paused=True)
    await _rule(async_session, test_user, category, next_occurrence=business_today() + timedelta(days=3))
    manual = await _rule(async_session, test_user, category, auto_create=False)
    _use_session(monkeypatch, async_session)

    result = await scheduler_module.process_recurring_transactions()
    assert result["created"] == 0
    assert (await _posted(async_session, test_user)) == []
    # A manual rule waits for the user: advancing it used up its occurrences
    # with nothing ever posted.
    await async_session.refresh(manual)
    assert manual.next_occurrence == business_today()
    assert manual.occurrence_count == 0


async def _posted(async_session, user_or_id):
    user_id = getattr(user_or_id, "id", user_or_id)
    rows = (await async_session.execute(
        select(Transaction).where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date))).scalars().all()
    return [r.transaction_date for r in rows]


async def test_a_rule_started_in_the_past_posts_its_missed_occurrences(
        monkeypatch, async_session, test_user, seed_categories):
    """Skipping past-due occurrences lost every rule's first one (it starts at
    start_date, already past by the next run) and anything due while the host
    was down."""
    category = await _expense_category(async_session, seed_categories)
    today = business_today()
    start = today - timedelta(days=2)
    await _rule(async_session, test_user, category, frequency=RecurringFrequency.DAILY,
                start_date=start, next_occurrence=start)
    _use_session(monkeypatch, async_session)

    result = await scheduler_module.process_recurring_transactions()
    assert result["created"] == 3
    assert await _posted(async_session, test_user) == [start, start + timedelta(days=1), today]


async def test_a_second_run_never_double_posts(monkeypatch, async_session, test_user, seed_categories):
    """Even if the rule didn't advance (a crash between posting and advancing),
    an occurrence that already has its transaction is not posted again."""
    category = await _expense_category(async_session, seed_categories)
    rule = await _rule(async_session, test_user, category)
    _use_session(monkeypatch, async_session)

    await scheduler_module.process_recurring_transactions()
    rule.next_occurrence = business_today()  # as if the advance never committed
    await async_session.commit()
    again = await scheduler_module.process_recurring_transactions()

    assert again["created"] == 0
    assert await _posted(async_session, test_user) == [business_today()]


async def test_one_failing_rule_does_not_stop_the_others(monkeypatch, async_session, test_user, seed_categories):
    from app.modules.transactions.services import TransactionService

    category = await _expense_category(async_session, seed_categories)
    user_id = test_user.id  # the job's rollback expires the fixture's loaded rows
    bad = await _rule(async_session, test_user, category, description="breaks")
    await _rule(async_session, test_user, category, description="fine")
    _use_session(monkeypatch, async_session)

    real_create = TransactionService.create_transaction

    async def create(self, data, user_id):
        if data.description == "breaks":
            raise RuntimeError("simulated failure")
        return await real_create(self, data, user_id)

    monkeypatch.setattr(TransactionService, "create_transaction", create)
    result = await scheduler_module.process_recurring_transactions()

    assert (result["created"], result["failed"]) == (1, 1)
    assert await _posted(async_session, user_id) == [business_today()]
    await async_session.refresh(bad)
    assert bad.next_occurrence == business_today()  # retried on the next run


async def test_end_date_and_max_occurrences_stop_the_catch_up(
        monkeypatch, async_session, test_user, seed_categories):
    category = await _expense_category(async_session, seed_categories)
    start = business_today() - timedelta(days=5)
    await _rule(async_session, test_user, category, frequency=RecurringFrequency.DAILY,
                start_date=start, next_occurrence=start, end_date=start + timedelta(days=1))
    await _rule(async_session, test_user, category, frequency=RecurringFrequency.DAILY,
                start_date=start, next_occurrence=start, max_occurrences=2, description="capped")
    _use_session(monkeypatch, async_session)

    result = await scheduler_module.process_recurring_transactions()
    assert result["created"] == 4
    rules = (await async_session.execute(select(RecurringTransaction))).scalars().all()
    for rule in rules:
        await async_session.refresh(rule)
    # Both reached their end, so neither is loaded again tomorrow.
    assert [r.is_active for r in rules] == [False, False]


async def test_a_failure_mid_catch_up_keeps_what_was_posted(
        monkeypatch, async_session, test_user, seed_categories):
    from app.modules.transactions.services import TransactionService

    category = await _expense_category(async_session, seed_categories)
    user_id = test_user.id
    start = business_today() - timedelta(days=2)
    rule = await _rule(async_session, test_user, category, frequency=RecurringFrequency.DAILY,
                       start_date=start, next_occurrence=start)
    _use_session(monkeypatch, async_session)

    real_create = TransactionService.create_transaction
    calls = {"n": 0}

    async def create(self, data, uid):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("simulated failure on the second occurrence")
        return await real_create(self, data, uid)

    monkeypatch.setattr(TransactionService, "create_transaction", create)
    result = await scheduler_module.process_recurring_transactions()

    assert result["failed"] == 1
    assert await _posted(async_session, user_id) == [start]
    await async_session.refresh(rule)
    assert rule.next_occurrence == start + timedelta(days=1)  # resumes there next run


async def test_catch_up_is_capped_per_run_and_resumes(monkeypatch, async_session, test_user, seed_categories):
    from app.modules.transactions.services import RecurringTransactionService

    category = await _expense_category(async_session, seed_categories)
    cap = RecurringTransactionService.MAX_CATCH_UP
    start = business_today() - timedelta(days=cap + 4)
    await _rule(async_session, test_user, category, frequency=RecurringFrequency.DAILY,
                start_date=start, next_occurrence=start)
    _use_session(monkeypatch, async_session)

    first = await scheduler_module.process_recurring_transactions()
    second = await scheduler_module.process_recurring_transactions()

    assert (first["created"], second["created"]) == (cap, 5)
    assert len(await _posted(async_session, test_user)) == cap + 5
