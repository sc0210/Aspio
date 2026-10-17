"""get_summary converts each row to TWD inside the query, run against a real database.

The conversion lives in SQL (`amount * CASE upper(currency) WHEN ... END`), and
until this test it was only checked by compiling statements and inspecting
their text or parameters. None of that would notice a CASE that compiles but
multiplies by the wrong thing, which is the path by which a US$9,062 row could
go back to counting as NT$9,062.
"""

import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.transactions.models import (
    Transaction,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository


def _txn(user_id, category_id, amount, currency, *, status=TransactionStatus.COMPLETED):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category_id,
        type=TransactionType.EXPENSE,
        status=status,
        amount=Decimal(str(amount)),
        currency=currency,
        description="test",
        transaction_date=datetime(2026, 8, 10, tzinfo=timezone.utc),
        wallet_type=TransactionWalletType.LIFE,
        is_deleted=False,
    )


async def _summary(session, user_id):
    return await TransactionRepository(session).get_summary(
        user_id=str(user_id), date_from=date(2026, 8, 1), date_to=date(2026, 8, 31)
    )


@pytest.mark.asyncio
@pytest.mark.database
async def test_foreign_rows_are_converted_in_sql_whatever_their_case(async_session):
    user_id, category_id = uuid_module.uuid4(), uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, category_id, 1000, "TWD"),
        _txn(user_id, category_id, 10, "USD"),
        _txn(user_id, category_id, 5, "usd"),  # stored lower-case: still US dollars
    ])
    await async_session.commit()

    rates = AsyncMock(return_value={"USD": Decimal("31.5")})
    with patch("app.modules.transactions.repositories.twd_rates_for", rates):
        summary = await _summary(async_session, user_id)

    # 1000 + 10 × 31.5 + 5 × 31.5
    assert float(summary["total_expenses"]) == pytest.approx(1472.5)
    assert summary["currency"] == "TWD"


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_twd_only_account_sums_exactly_as_before(async_session):
    user_id, category_id = uuid_module.uuid4(), uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, category_id, 1000, "TWD"),
        _txn(user_id, category_id, 234, "TWD"),
    ])
    await async_session.commit()

    summary = await _summary(async_session, user_id)

    assert float(summary["total_expenses"]) == pytest.approx(1234)


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_cancelled_foreign_row_counts_for_nothing(async_session):
    user_id, category_id = uuid_module.uuid4(), uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, category_id, 1000, "TWD"),
        _txn(user_id, category_id, 10, "USD", status=TransactionStatus.CANCELLED),
    ])
    await async_session.commit()

    rates = AsyncMock(return_value={"USD": Decimal("31.5")})
    with patch("app.modules.transactions.repositories.twd_rates_for", rates):
        summary = await _summary(async_session, user_id)

    assert float(summary["total_expenses"]) == pytest.approx(1000)
