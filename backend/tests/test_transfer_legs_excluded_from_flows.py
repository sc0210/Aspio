"""Moving money between your own wallets is not living cost.

A transfer is stored as a matching income and expense row sharing a
`transfer_group_id`. `living_expenses` answers "how long could I live on my
reserves", and counting the expense leg invented spending of the same size: a
NT$290k Life → Emergency top-up read as NT$290k of consumption.

`total_income` and `total_expenses` deliberately still count both legs — /review
reads wallet balances beside those figures and the two have to explain each other
(tests/test_reports_counts_every_row.py pins it). So do the wallet balances
themselves: moving the money is the entire point of a transfer.
"""

import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.modules.transactions.models import (
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository


def _txn(
    user_id,
    amount,
    *,
    category_id,
    txn_type=TransactionType.EXPENSE,
    transfer_group_id=None,
    wallet=TransactionWalletType.LIFE,
    when=datetime(2026, 8, 10, tzinfo=timezone.utc),
):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category_id,
        type=txn_type,
        status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)),
        currency="TWD",
        description="test",
        transaction_date=when,
        wallet_type=wallet,
        transfer_group_id=transfer_group_id,
        is_deleted=False,
    )


async def _category(session, name):
    category = TransactionCategory(id=uuid_module.uuid4(), name=name, type="expense")
    session.add(category)
    await session.flush()
    return category.id


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_transfer_is_not_living_cost(async_session):
    user_id = uuid_module.uuid4()
    spending = await _category(async_session, "Groceries")
    transfer = await _category(async_session, "Transfer")
    group = uuid_module.uuid4()

    async_session.add_all([
        _txn(user_id, 42_000, category_id=spending),
        _txn(user_id, 85_000, category_id=spending, txn_type=TransactionType.INCOME),
        # One top-up, both legs.
        _txn(user_id, 290_000, category_id=transfer, transfer_group_id=group),
        _txn(
            user_id,
            290_000,
            category_id=transfer,
            txn_type=TransactionType.INCOME,
            transfer_group_id=group,
            wallet=TransactionWalletType.EMERGENCY,
        ),
    ])
    await async_session.commit()

    summary = await TransactionRepository(async_session).get_summary(
        user_id=str(user_id),
        date_from=date(2026, 8, 1),
        date_to=date(2026, 8, 31),
    )

    # The wallets really did move, so the flow figures still say so.
    assert summary["total_expenses"] == Decimal("332000")
    assert summary["total_income"] == Decimal("375000")
    assert summary["net_amount"] == Decimal("43000")

    # What the user actually spent on living is the 42k.
    assert summary["living_expenses"] == Decimal("42000")


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_leg_written_before_transfer_group_id_is_still_excluded(async_session):
    """The four-wallet migration left transfer rows with no group id."""
    user_id = uuid_module.uuid4()
    spending = await _category(async_session, "Groceries")
    transfer = await _category(async_session, "Transfer")

    async_session.add_all([
        _txn(user_id, 42_000, category_id=spending),
        _txn(user_id, 992_250, category_id=transfer),
    ])
    await async_session.commit()

    summary = await TransactionRepository(async_session).get_summary(
        user_id=str(user_id),
        date_from=date(2026, 8, 1),
        date_to=date(2026, 8, 31),
    )

    assert summary["living_expenses"] == Decimal("42000")
    assert summary["total_expenses"] == Decimal("1034250")


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_category_that_merely_mentions_a_transfer_still_counts(async_session):
    """薪資轉帳 is salary that arrived by bank transfer — earned, and real."""
    user_id = uuid_module.uuid4()
    salary_by_transfer = await _category(async_session, "薪資轉帳")
    fee = await _category(async_session, "轉帳手續費")

    async_session.add_all([
        _txn(user_id, 85_000, category_id=salary_by_transfer, txn_type=TransactionType.INCOME),
        _txn(user_id, 15, category_id=fee),
    ])
    await async_session.commit()

    summary = await TransactionRepository(async_session).get_summary(
        user_id=str(user_id),
        date_from=date(2026, 8, 1),
        date_to=date(2026, 8, 31),
    )

    assert summary["total_income"] == Decimal("85000")
    assert summary["living_expenses"] == Decimal("15")


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_transfer_still_moves_both_wallet_balances(async_session):
    """The flows drop it; the balances must not."""
    user_id = uuid_module.uuid4()
    spending = await _category(async_session, "Groceries")
    transfer = await _category(async_session, "Transfer")
    group = uuid_module.uuid4()

    async_session.add_all([
        _txn(user_id, 500_000, category_id=spending, txn_type=TransactionType.INCOME),
        _txn(user_id, 290_000, category_id=transfer, transfer_group_id=group),
        _txn(
            user_id,
            290_000,
            category_id=transfer,
            txn_type=TransactionType.INCOME,
            transfer_group_id=group,
            wallet=TransactionWalletType.EMERGENCY,
        ),
    ])
    await async_session.commit()

    balances = await TransactionRepository(async_session).cash_balances_twd(user_id)

    assert balances[TransactionWalletType.LIFE] == Decimal("210000")
    assert balances[TransactionWalletType.EMERGENCY] == Decimal("290000")
