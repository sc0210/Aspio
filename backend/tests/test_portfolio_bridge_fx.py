"""
PortfolioService._to_twd — the one rate source behind the buy/sell cash bridge.

A buy debits the Life Wallet and a sale credits it, both in TWD. If the bridge
and the valuation used different rates, every USD trade would book a fake gain
or loss by itself (the old seeded 31.25 TWD/USD did exactly that). These pin
which rate a trade gets and what happens when there is none.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.portfolio.models import HistoricalPrice
from app.modules.portfolio.services import PortfolioService
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.database]
RATE_SERVICE = "app.utils.exchange_rate_service.get_exchange_rate_service"


def _live_rate(rate):
    service = MagicMock()
    service.get_exchange_rate = AsyncMock(return_value=rate)
    return patch(RATE_SERVICE, return_value=service), service


async def _fx_close(session, day, close):
    session.add(HistoricalPrice(symbol="TWD=X", market="FX", date=day, close=Decimal(close),
                                source="test", currency="TWD"))
    await session.commit()


async def test_twd_passes_through_untouched(async_session):
    amount, cur = await PortfolioService(async_session)._to_twd(Decimal("1234.5"), "TWD")
    assert (amount, cur) == (Decimal("1234.5"), "TWD")


async def test_a_dated_trade_uses_that_days_stored_fx_close(async_session):
    day = business_today() - timedelta(days=3)
    await _fx_close(async_session, day, "32.10")
    live, service = _live_rate(Decimal("30.00"))
    with live:
        amount, cur = await PortfolioService(async_session)._to_twd(Decimal("100"), "USD", on_day=day)

    assert cur == "TWD"
    assert amount == Decimal("3210.00")
    service.get_exchange_rate.assert_not_called()


async def test_a_close_older_than_a_week_is_not_used(async_session):
    day = business_today() - timedelta(days=3)
    await _fx_close(async_session, day - timedelta(days=10), "99.00")
    live, _ = _live_rate(Decimal("31.00"))
    with live:
        amount, cur = await PortfolioService(async_session)._to_twd(Decimal("100"), "USD", on_day=day)

    assert (amount, cur) == (Decimal("3100.00"), "TWD")


async def test_a_trade_dated_today_uses_the_live_rate(async_session):
    await _fx_close(async_session, business_today(), "50.00")
    live, _ = _live_rate(Decimal("31.50"))
    with live:
        amount, cur = await PortfolioService(async_session)._to_twd(
            Decimal("10"), "usd", on_day=business_today())

    assert (amount, cur) == (Decimal("315.00"), "TWD")


async def test_with_no_rate_at_all_the_amount_keeps_its_own_currency(async_session):
    """Never a USD number labelled TWD: the bridge books it as USD, so the wallet
    totals (cash_balances_twd) still know to convert it."""
    live, _ = _live_rate(None)
    with live:
        amount, cur = await PortfolioService(async_session)._to_twd(Decimal("100"), "USD")

    assert (amount, cur) == (Decimal("100"), "USD")


async def test_a_failing_rate_service_falls_back_the_same_way(async_session):
    service = MagicMock()
    service.get_exchange_rate = AsyncMock(side_effect=RuntimeError("provider down"))
    with patch(RATE_SERVICE, return_value=service):
        amount, cur = await PortfolioService(async_session)._to_twd(Decimal("7"), "JPY")

    assert (amount, cur) == (Decimal("7"), "JPY")
