"""/portfolio/daily-performance end to end on seeded rows.

test_daily_performance_correctness.py checks replicas of the algorithm; this
drives the real endpoint. Three portfolio holdings:

- 0050: 10 units, TWD, a close of 100 every day          → NT$1,000
- AAPL: 2 units, USD, no price history, current price 50 → NT$3,000 at 30
- 2330: 1 unit bought on day D, close 600 from D on      → NT$600 from D

plus an Emergency-wallet holding, which must not count. The background price
refresh and FX are stubbed.
"""

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.historical_price_repository import _hist_cache
from app.modules.portfolio.models import (
    HistoricalPrice,
    HoldingWalletType,
    Portfolio,
    PortfolioHolding,
)
from app.modules.portfolio.routers import performance_history
from app.utils.datetime_helpers import business_today
from app.utils.exchange_rate_service import ExchangeRateService

pytestmark = [pytest.mark.asyncio, pytest.mark.api]
DAYS = 10


def _last_weekday_before(day):
    day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    async def no_refresh(user_id):
        return None

    async def rate(self, from_currency, to_currency):
        return Decimal("30") if from_currency == "USD" else Decimal("1")

    monkeypatch.setattr(performance_history, "_refresh_prices_background", no_refresh)
    monkeypatch.setattr(ExchangeRateService, "get_exchange_rate", rate)
    # Batch price reads are cached module-wide; a stale entry from another
    # test would answer for this one.
    _hist_cache.clear()
    yield
    _hist_cache.clear()


@pytest_asyncio.fixture
async def portfolio(async_session, test_user):
    today = business_today()
    bought = _last_weekday_before(today)
    pf = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(pf)
    await async_session.flush()

    def holding(symbol, qty, avg, price, currency, market, purchased, wallet=HoldingWalletType.PORTFOLIO):
        value = Decimal(qty) * Decimal(price)
        return PortfolioHolding(
            id=uuid4(), portfolio_id=pf.id, user_id=test_user.id, symbol=symbol, name=f"{symbol} name",
            type="stock", exchange="X", currency=currency, market=market, wallet_type=wallet,
            quantity=Decimal(qty), average_cost=Decimal(avg), current_price=Decimal(price),
            total_cost=Decimal(qty) * Decimal(avg), total_value=value, gain_loss=Decimal("0"),
            gain_loss_percentage=Decimal("0"), is_active=True,
            purchase_date=datetime.combine(purchased, time.min, tzinfo=timezone.utc),
        )

    long_ago = today - timedelta(days=60)
    async_session.add_all(
        [
            holding("0050", "10", "80", "100", "TWD", "TW", long_ago),
            holding("AAPL", "2", "40", "50", "USD", "US", long_ago),
            holding("2330", "1", "500", "600", "TWD", "TW", bought),
            holding("00878", "100", "20", "20", "TWD", "TW", long_ago, wallet=HoldingWalletType.EMERGENCY),
        ]
    )
    day = today - timedelta(days=DAYS + 15)
    while day <= today:
        async_session.add(HistoricalPrice(symbol="0050", market="TW", date=day, close=Decimal("100"), source="t", currency="TWD"))
        if day >= bought:
            async_session.add(HistoricalPrice(symbol="2330", market="TW", date=day, close=Decimal("600"), source="t", currency="TWD"))
        day += timedelta(days=1)
    await async_session.commit()
    return bought.isoformat()


def _series(client):
    r = client.get("/api/v1/portfolio/daily-performance", params={"days": DAYS})
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_values_cost_basis_and_capital_added(authenticated_client, portfolio):
    bought = portfolio
    points = {p["date"]: p for p in _series(authenticated_client)}
    assert points, "expected weekday points in the window"

    for day, p in points.items():
        held_2330 = day >= bought
        # 1,000 + 3,000 (+ 600 once bought); Emergency holding never counts.
        assert p["value"] == pytest.approx(4000 + (600 if held_2330 else 0)), day
        # 800 + 2,400 (+ 500 once bought)
        assert p["costBasis"] == pytest.approx(3200 + (500 if held_2330 else 0)), day
        assert {h["symbol"] for h in p["topHoldings"]} <= {"0050", "AAPL", "2330"}

    buy_day = points[bought]
    # Money put in is not a gain: the day's change excludes the new lot.
    assert buy_day["change"] == pytest.approx(0)
    assert buy_day["capitalAdded"] == pytest.approx(500)
    assert buy_day["purchases"] == [{"symbol": "2330", "name": "2330 name", "cost": 500.0}]
    assert all(p["capitalAdded"] == 0 for d, p in points.items() if d != bought)


async def test_only_today_priced_from_a_live_quote_is_provisional(authenticated_client, portfolio):
    today = business_today().isoformat()
    for p in _series(authenticated_client):
        # AAPL has no close on any day; only on today does that come from the
        # live quote branch. Earlier days use the no-history fallback.
        assert p["provisional"] is (p["date"] == today)


async def test_weekends_are_left_out(authenticated_client, portfolio):
    from datetime import date

    assert all(date.fromisoformat(p["date"]).weekday() < 5 for p in _series(authenticated_client))


async def test_no_price_history_returns_empty(authenticated_client, async_session, portfolio):
    from sqlalchemy import delete

    await async_session.execute(delete(HistoricalPrice))
    await async_session.commit()
    body = authenticated_client.get("/api/v1/portfolio/daily-performance", params={"days": DAYS}).json()
    assert body["data"] == []
    assert "Sync Historical Data" in body["message"]


async def test_without_holdings_returns_empty(authenticated_client):
    assert _series(authenticated_client) == []
