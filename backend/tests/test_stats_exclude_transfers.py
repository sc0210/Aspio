"""The transactions page can be asked to leave wallet transfers out of its totals.

A transfer is one move stored as two rows — an expense leaving Life and an income
arriving in Emergency — and the page lists every wallet, so a 50萬 top-up added 50萬
to total income AND 50萬 to total spending. The net stayed right, which is why it
went unquestioned, while both headline figures were inflated by money that never
entered or left.

Counting them is still the default: the cards summarise the rows listed beneath
them, and those rows show both legs.
"""

import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository
from app.modules.transactions.schemas import TransactionFilter


def _category(name, kind=CategoryType.EXPENSE):
    return TransactionCategory(id=uuid_module.uuid4(), name=name, type=kind)


def _txn(user_id, amount, category, kind, *, wallet=TransactionWalletType.LIFE, group=None):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category.id,
        type=kind,
        status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)),
        currency="TWD",
        description="test",
        transaction_date=datetime(2026, 9, 21, tzinfo=timezone.utc),
        wallet_type=wallet,
        transfer_group_id=group,
        is_deleted=False,
    )


@pytest_asyncio.fixture
async def september(async_session):
    user_id = uuid_module.uuid4()
    salary = _category("Salary", CategoryType.INCOME)
    dining = _category("Dining")
    transfer = _category("Transfer")
    group = uuid_module.uuid4()
    async_session.add_all([salary, dining, transfer])
    async_session.add_all([
        _txn(user_id, 85_000, salary, TransactionType.INCOME),
        _txn(user_id, 6_000, dining, TransactionType.EXPENSE),
        # One 500k move between the user's own wallets.
        _txn(user_id, 500_000, transfer, TransactionType.EXPENSE, group=group),
        _txn(
            user_id, 500_000, transfer, TransactionType.INCOME,
            wallet=TransactionWalletType.EMERGENCY, group=group,
        ),
    ])
    await async_session.commit()
    return user_id


async def _totals(session, user_id, *, exclude_transfers):
    rows = await TransactionRepository(session).get_filtered_summary(
        user_id, TransactionFilter(exclude_transfers=exclude_transfers)
    )
    twd = next(r for r in rows if r["currency"] == "TWD")
    return twd["income"], twd["expenses"]


@pytest.mark.asyncio
@pytest.mark.database
async def test_both_legs_count_by_default(async_session, september):
    income, expenses = await _totals(async_session, september, exclude_transfers=False)
    assert income == Decimal("585000")
    assert expenses == Decimal("506000")


@pytest.mark.asyncio
@pytest.mark.database
async def test_asking_to_exclude_removes_both_legs_not_one(async_session, september):
    income, expenses = await _totals(async_session, september, exclude_transfers=True)
    assert income == Decimal("85000")
    assert expenses == Decimal("6000")


@pytest.mark.asyncio
@pytest.mark.database
async def test_the_net_is_the_same_either_way(async_session, september):
    with_transfers = await _totals(async_session, september, exclude_transfers=False)
    without = await _totals(async_session, september, exclude_transfers=True)
    assert with_transfers[0] - with_transfers[1] == without[0] - without[1]


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_legacy_leg_is_recognised_by_the_spellings_people_import(async_session):
    """No group id, so the category is all there is to go on."""
    user_id = uuid_module.uuid4()
    spellings = ["Transfer", "轉帳支出", "Bank Transfer", "轉入"]
    categories = [_category(name) for name in spellings]
    dining = _category("Dining")
    async_session.add_all([*categories, dining])
    async_session.add_all(
        [_txn(user_id, 10_000, c, TransactionType.EXPENSE) for c in categories]
        + [_txn(user_id, 6_000, dining, TransactionType.EXPENSE)]
    )
    await async_session.commit()

    _, expenses = await _totals(async_session, user_id, exclude_transfers=True)
    assert expenses == Decimal("6000"), "every transfer spelling should have gone"


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_category_that_merely_mentions_a_transfer_is_still_spending(async_session):
    user_id = uuid_module.uuid4()
    fee = _category("轉帳手續費")
    salary_by_transfer = _category("薪資轉帳", CategoryType.INCOME)
    async_session.add_all([fee, salary_by_transfer])
    async_session.add_all([
        _txn(user_id, 15, fee, TransactionType.EXPENSE),
        _txn(user_id, 85_000, salary_by_transfer, TransactionType.INCOME),
    ])
    await async_session.commit()

    income, expenses = await _totals(async_session, user_id, exclude_transfers=True)
    assert expenses == Decimal("15")
    assert income == Decimal("85000")


@pytest.mark.asyncio
@pytest.mark.database
async def test_hiding_transfers_from_the_totals_keeps_them_in_the_category_dropdown(
    async_session, september
):
    """The dropdown lists what you can filter BY, so the chip has to stay.

    It is built from the same request; inheriting the flag took the Transfer chip
    off the panel, and with that chip already selected every card read NT$0 with no
    way to unselect it there.
    """
    from app.modules.transactions.repositories import (
        RecurringTransactionRepository,
        TransactionCategoryRepository,
    )
    from app.modules.transactions.services import TransactionService

    service = TransactionService(
        TransactionRepository(async_session),
        TransactionCategoryRepository(async_session),
        RecurringTransactionRepository(async_session),
    )
    stats = await service.get_page_stats(
        september, TransactionFilter(exclude_transfers=True)
    )

    categories = {row["category"] for row in stats["category_breakdown"]}
    assert "Transfer" in categories
    assert stats["stats"]["total_income"] == 85_000  # totals still exclude it


@pytest.mark.asyncio
@pytest.mark.database
async def test_filtering_by_transfer_finds_legacy_legs_and_skips_lookalikes(async_session):
    """type=transfer uses the same rule as exclusion: a group id, or a category that
    IS a transfer. A legacy leg has only the name; a fee only mentions one."""
    user_id = uuid_module.uuid4()
    legacy = _category("轉帳支出")
    fee = _category("轉帳手續費")
    dining = _category("Dining")
    async_session.add_all([legacy, fee, dining])
    legacy_leg = _txn(user_id, 10_000, legacy, TransactionType.EXPENSE)
    async_session.add_all([
        legacy_leg,
        _txn(user_id, 15, fee, TransactionType.EXPENSE),
        _txn(user_id, 6_000, dining, TransactionType.EXPENSE),
    ])
    await async_session.commit()

    rows, total = await TransactionRepository(async_session).get_all(
        user_id, TransactionFilter(type=TransactionType.TRANSFER)
    )
    assert total == 1
    assert [r.id for r in rows] == [legacy_leg.id]


def test_demo_service_filters_transfer_legs_by_the_same_rule():
    """Signed-out requests go through the demo service's own filter."""
    from app.modules.transactions.demo_service import DemoTransactionService

    service = DemoTransactionService()
    service.demo_categories = [
        {"id": "c-transfer", "name": "Transfer"},
        {"id": "c-fee", "name": "轉帳手續費"},
    ]
    rows = [
        {"id": "grouped", "type": TransactionType.EXPENSE, "category_id": "c-fee", "transfer_group_id": "g"},
        {"id": "legacy", "type": TransactionType.INCOME, "category_id": "c-transfer", "transfer_group_id": None},
        {"id": "fee", "type": TransactionType.EXPENSE, "category_id": "c-fee", "transfer_group_id": None},
    ]
    kept = service._apply_filters(rows, TransactionFilter(type=TransactionType.TRANSFER))
    assert [r["id"] for r in kept] == ["grouped", "legacy"]
