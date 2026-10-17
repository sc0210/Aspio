"""A wallet transfer is not a month of heavy spending.

/transactions/monthly-summary buckets a year into housing / eat / investment /
others, and a transfer leg fell through to "others" — so a top-up between the
user's own wallets read as ordinary spending on the chart, and its matching inflow
spiked the income line by the same amount. It gets its own bucket now, the way
investment purchases already do: shown and labelled, neither hidden nor dropped.
"""

import json
import uuid as uuid_module
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.router import get_monthly_summary

YEAR = 2026
MONTH = 8


def _category(name, kind=CategoryType.EXPENSE):
    return TransactionCategory(id=uuid_module.uuid4(), name=name, type=kind)


def _txn(user_id, amount, category, kind=TransactionType.EXPENSE, transfer_group_id=None):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category.id,
        type=kind,
        status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)),
        currency="TWD",
        description="test",
        transaction_date=datetime(YEAR, MONTH, 10, tzinfo=timezone.utc),
        wallet_type=TransactionWalletType.LIFE,
        transfer_group_id=transfer_group_id,
        is_deleted=False,
    )


async def _august(session, rows):
    await session.commit()
    # Force the endpoint to load these rows from the database rather than reading
    # them out of the identity map: that difference is exactly what hid a lazy load
    # of `category_obj` on the income query, which raises MissingGreenlet in the
    # async session and answered the page with a 500.
    session.expunge_all()
    response = await get_monthly_summary(
        transaction_service=MagicMock(),
        db=session,
        current_user=SimpleNamespace(id=rows),
        year=YEAR,
    )
    months = json.loads(response.body)["data"]
    return next(m for m in months if m["month"] == f"{YEAR}-{MONTH:02d}")


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_transfer_gets_its_own_bucket_not_others(async_session):
    user_id = uuid_module.uuid4()
    groceries = _category("Groceries")
    transfer = _category("Transfer")
    group = uuid_module.uuid4()
    async_session.add_all([groceries, transfer])
    async_session.add_all([
        _txn(user_id, 42_000, groceries),
        _txn(user_id, 190_000, transfer, transfer_group_id=group),
        _txn(user_id, 190_000, transfer, kind=TransactionType.INCOME, transfer_group_id=group),
    ])

    august = await _august(async_session, user_id)

    assert august["transfer"] == 190_000
    assert august["eat"] == 42_000  # groceries bucket, untouched
    assert august["others"] == 0
    # The inflow is the user's own money arriving, not earnings.
    assert august["income"] == 0


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_leg_with_no_group_id_is_still_recognised(async_session):
    user_id = uuid_module.uuid4()
    transfer = _category("Transfer")
    async_session.add(transfer)
    async_session.add(_txn(user_id, 992_250, transfer))

    august = await _august(async_session, user_id)

    assert august["transfer"] == 992_250
    assert august["others"] == 0


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_transfer_fee_is_real_spending(async_session):
    user_id = uuid_module.uuid4()
    fee = _category("轉帳手續費")
    salary = _category("Salary", CategoryType.INCOME)
    async_session.add_all([fee, salary])
    async_session.add_all([
        _txn(user_id, 15, fee),
        _txn(user_id, 85_000, salary, kind=TransactionType.INCOME),
    ])

    august = await _august(async_session, user_id)

    assert august["transfer"] == 0
    assert august["others"] == 15
    assert august["income"] == 85_000


@pytest.mark.asyncio
async def test_the_demo_path_follows_the_same_rule():
    """Demo mode builds this summary from fixtures, by its own code path."""
    from app.modules.transactions.demo_service import DemoTransactionService

    service = DemoTransactionService()
    category_id = service.demo_categories[0]["id"]
    transfer_category = {"id": "cat-transfer", "name": "Transfer", "type": "expense"}
    service.demo_categories = [*service.demo_categories, transfer_category]

    when = datetime(YEAR, MONTH, 10)
    service.demo_transactions = [
        {
            "id": "t1", "transaction_date": when, "amount": 42_000,
            "type": TransactionType.EXPENSE, "category_id": category_id,
            "transfer_group_id": None,
        },
        {
            "id": "t2", "transaction_date": when, "amount": 190_000,
            "type": TransactionType.EXPENSE, "category_id": "cat-transfer",
            "transfer_group_id": "grp-1",
        },
        {
            "id": "t3", "transaction_date": when, "amount": 190_000,
            "type": TransactionType.INCOME, "category_id": "cat-transfer",
            "transfer_group_id": "grp-1",
        },
    ]

    months = await service.get_monthly_summary(YEAR)
    august = next(m for m in months if m["month"] == f"{YEAR}-{MONTH:02d}")

    assert august["transfer"] == 190_000
    assert august["income"] == 0
