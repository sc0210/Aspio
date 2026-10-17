"""The analytics queries report in TWD, the unit of the summary beside them.

Top merchants, payment methods and the monthly series summed amount_usd while
get_summary summed TWD, the category breakdown defaulted to USD, and the
currency breakdown was one row labelled USD holding the TWD total.
"""

import inspect
import uuid as uuid_module
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.transactions.models import (
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository

RATES = {"USD": Decimal("31.5")}
RATE_LOOKUP = "app.modules.transactions.repositories.twd_rates_for"
METHOD = list(PaymentMethod)[0]


def _txn(user_id, amount, currency, *, merchant=None, method=None,
         kind=TransactionType.EXPENSE, status=TransactionStatus.COMPLETED):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=uuid_module.uuid4(),
        type=kind,
        status=status,
        amount=Decimal(str(amount)),
        currency=currency,
        description="test",
        transaction_date=datetime(2026, 8, 10, tzinfo=timezone.utc),
        wallet_type=TransactionWalletType.LIFE,
        is_deleted=False,
        merchant_name=merchant,
        payment_method=method,
    )


@pytest.mark.asyncio
@pytest.mark.database
async def test_top_merchants_are_ranked_and_totalled_in_twd(async_session):
    user_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 100, "USD", merchant="Amazon"),      # NT$3,150: more, despite the smaller number
        _txn(user_id, 2_000, "TWD", merchant="7-Eleven"),
        _txn(user_id, 999, "USD", merchant="Amazon", status=TransactionStatus.CANCELLED),
    ])
    await async_session.commit()

    with patch(RATE_LOOKUP, AsyncMock(return_value=RATES)):
        merchants = await TransactionRepository(async_session).get_top_merchants(user_id)

    assert [m["merchant_name"] for m in merchants] == ["Amazon", "7-Eleven"]
    assert float(merchants[0]["total_spent"]) == pytest.approx(3_150)
    assert float(merchants[1]["total_spent"]) == pytest.approx(2_000)


@pytest.mark.asyncio
@pytest.mark.database
async def test_payment_methods_are_totalled_in_twd(async_session):
    user_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 100, "USD", method=METHOD),
        _txn(user_id, 850, "TWD", method=METHOD),
    ])
    await async_session.commit()

    with patch(RATE_LOOKUP, AsyncMock(return_value=RATES)):
        methods = await TransactionRepository(async_session).get_payment_method_breakdown(user_id)

    assert len(methods) == 1
    assert float(methods[0]["amount"]) == pytest.approx(4_000)
    assert float(methods[0]["percentage"]) == pytest.approx(100)


@pytest.mark.asyncio
@pytest.mark.database
async def test_the_currency_breakdown_is_per_currency_native_and_in_twd(async_session):
    user_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 100, "USD"),
        _txn(user_id, 50, "usd", kind=TransactionType.INCOME),
        _txn(user_id, 1_000, "TWD"),
    ])
    await async_session.commit()

    with patch(RATE_LOOKUP, AsyncMock(return_value=RATES)):
        breakdown = await TransactionRepository(async_session).get_currency_breakdown(user_id)

    assert [row["currency"] for row in breakdown] == ["USD", "TWD"]
    usd, twd = breakdown
    assert (float(usd["amount"]), float(usd["amount_twd"]), usd["transaction_count"]) == pytest.approx((150, 4_725, 2))
    assert (float(twd["amount"]), float(twd["amount_twd"]), twd["transaction_count"]) == pytest.approx((1_000, 1_000, 1))


def test_the_category_breakdown_defaults_to_twd():
    parameters = inspect.signature(TransactionRepository.get_category_breakdown).parameters
    assert parameters["amount_field"].default == "amount"


@pytest.mark.asyncio
async def test_the_monthly_series_is_converted_in_the_query():
    # date_trunc is Postgres-only, so this reads the statement, not a result.
    statements = []
    currencies = MagicMock()
    currencies.all.return_value = [("USD",)]
    series = MagicMock()
    series.fetchall.return_value = []

    async def execute(stmt, *args, **kwargs):
        statements.append(stmt)
        return currencies if len(statements) == 1 else series

    db = MagicMock()
    db.execute = execute
    with patch(RATE_LOOKUP, AsyncMock(return_value=RATES)):
        await TransactionRepository(db).get_monthly_trends(str(uuid_module.uuid4()), 3)

    sql = str(statements[-1]).lower()
    assert "upper(transactions.currency)" in sql
    assert "amount_usd" not in sql
    assert "transactions.status" in sql
