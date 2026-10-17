"""An emergency fund is measured against living costs, not against investing.

Buying a holding debits the Life wallet as an expense — that bridge is what
stops the three wallets double-counting — but counting it as spending made the
emergency-fund figure collapse in any month with a lump-sum purchase. On the
account this was found on, NT$1.95M of NT$2.28M of August "expenses" were
holdings, and the dashboard reported 0.2 months of cover where living costs
alone gave 1.7.
"""

import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.modules.transactions.models import (
    Transaction,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository


def _txn(user_id, amount, *, category_id, holding_id=None, txn_type=TransactionType.EXPENSE):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category_id,
        type=txn_type,
        status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)),
        currency="TWD",
        description="test",
        transaction_date=datetime(2026, 8, 10, tzinfo=timezone.utc),
        wallet_type=TransactionWalletType.LIFE,
        holding_id=holding_id,
        is_deleted=False,
    )


@pytest.mark.asyncio
@pytest.mark.database
async def test_living_expenses_excludes_investment_purchases(async_session):
    user_id = uuid_module.uuid4()
    holding_id = uuid_module.uuid4()
    category_id = uuid_module.uuid4()

    async_session.add_all([
        _txn(user_id, 30_000, category_id=category_id),                            # rent
        _txn(user_id, 12_000, category_id=category_id),                            # groceries
        _txn(user_id, 1_950_000, category_id=category_id, holding_id=holding_id),  # bought a holding
        _txn(user_id, 80_000, category_id=category_id, txn_type=TransactionType.INCOME),
    ])
    await async_session.commit()

    summary = await TransactionRepository(async_session).get_summary(
        user_id=str(user_id),
        date_from=date(2026, 8, 1),
        date_to=date(2026, 8, 31),
    )

    # Everything that left the wallet is still an expense — the savings rate and
    # the cash-flow tiles mean exactly that, and are unchanged.
    assert summary["total_expenses"] == Decimal("1992000")

    # But only the money that was actually spent counts as living costs.
    assert summary["living_expenses"] == Decimal("42000")


@pytest.mark.asyncio
@pytest.mark.database
async def test_the_two_figures_agree_when_nothing_was_invested(async_session):
    user_id = uuid_module.uuid4()
    category_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 30_000, category_id=category_id),
        _txn(user_id, 12_000, category_id=category_id),
    ])
    await async_session.commit()

    summary = await TransactionRepository(async_session).get_summary(
        user_id=str(user_id),
        date_from=date(2026, 8, 1),
        date_to=date(2026, 8, 31),
    )
    assert summary["living_expenses"] == summary["total_expenses"] == Decimal("42000")
