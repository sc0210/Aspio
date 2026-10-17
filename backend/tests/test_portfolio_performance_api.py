"""/portfolio/performance/{time-weighted-return,historical,holding-periods} on seeded lots and prices."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio import historical_price_repository
from app.modules.portfolio.models import (
    HistoricalPrice, HoldingWalletType, Portfolio, PortfolioHolding, PortfolioTransaction,
)
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

BASE = "/api/v1/portfolio/performance"


@pytest.fixture(autouse=True)
def fresh_price_cache():
    historical_price_repository._hist_cache.clear()
    yield
    historical_price_repository._hist_cache.clear()


@pytest.fixture(autouse=True)
def offline_fx():
    fake = MagicMock()
    fake.get_exchange_rate = AsyncMock(return_value=Decimal("30"))
    with patch("app.modules.portfolio.performance_tracker.get_exchange_rate_service", return_value=fake):
        yield fake


def noon(d: date) -> datetime:
    return datetime.combine(d, time(4, 0), tzinfo=timezone.utc)  # noon in Taipei


def lot(pf, user, symbol, qty, cost, bought: date, price=None, currency="TWD",
        wallet=HoldingWalletType.PORTFOLIO, type_="etf"):
    qty, cost = Decimal(qty), Decimal(cost)
    price = Decimal(price) if price is not None else cost
    return PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=user.id, symbol=symbol, name=symbol, type=type_,
        exchange="TWSE", currency=currency, market="TW", wallet_type=wallet, quantity=qty,
        average_cost=cost, current_price=price, total_cost=qty * cost, total_value=qty * price,
        gain_loss=qty * (price - cost), gain_loss_percentage=Decimal("0"), is_active=True,
        purchase_date=noon(bought))


def buy(h):
    return PortfolioTransaction(
        id=uuid4(), portfolio_id=h.portfolio_id, holding_id=h.id, user_id=h.user_id, type="buy",
        symbol=h.symbol, quantity=h.quantity, price=h.average_cost, total_amount=h.total_cost,
        currency=h.currency, transaction_date=h.purchase_date)


def close(symbol, d: date, value, currency="TWD"):
    return HistoricalPrice(id=uuid4(), symbol=symbol, market="TW", date=d, close=Decimal(value),
                           currency=currency, source="yahoo")


@pytest_asyncio.fixture
async def pf(async_session, test_user):
    p = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(p)
    await async_session.flush()
    return p


def data_of(r):
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["success"] is True
    return body["data"]


class TestTimeWeightedReturn:
    D0, D1 = date(2026, 1, 5), date(2026, 2, 2)

    async def test_single_lot_return_follows_the_closes(self, authenticated_client, async_session, pf, test_user):
        h = lot(pf, test_user, "0050", "10", "100", self.D0)
        async_session.add_all([h, buy(h), close("0050", self.D0, "100"), close("0050", self.D1, "110")])
        await async_session.commit()

        d = data_of(authenticated_client.get(
            f"{BASE}/time-weighted-return", params={"start_date": "2026-01-05", "end_date": "2026-02-02"}))
        assert d["twr"] == pytest.approx(0.10)
        assert d["total_return_percentage"] == pytest.approx(10.0)
        assert d["currency"] == "TWD" and d["total_days"] == 29
        assert (d["start_date"], d["end_date"]) == ("2026-01-05", "2026-02-02")
        assert d["data_quality"]["symbols_without_prices"] == []
        assert d["valuation_series"][-1]["value"] == pytest.approx(1100)

    async def test_emergency_and_manually_priced_lots_are_left_out(
            self, authenticated_client, async_session, pf, test_user):
        kept = lot(pf, test_user, "0050", "10", "100", self.D0)
        reserve = lot(pf, test_user, "00878", "10", "20", self.D0, wallet=HoldingWalletType.EMERGENCY)
        async_session.add_all([kept, buy(kept), reserve, buy(reserve),
                               close("0050", self.D0, "100"), close("0050", self.D1, "90")])
        await async_session.commit()

        d = data_of(authenticated_client.get(
            f"{BASE}/time-weighted-return", params={"start_date": "2026-01-05", "end_date": "2026-02-02"}))
        assert d["twr"] == pytest.approx(-0.10)
        assert d["data_quality"]["excluded_lots"] == 1

    async def test_usd_lot_without_fx_history_uses_the_live_rate(
            self, authenticated_client, async_session, pf, test_user, offline_fx):
        h = lot(pf, test_user, "VT", "1", "100", self.D0, currency="USD")
        async_session.add_all([h, buy(h), close("VT", self.D0, "100", "USD"), close("VT", self.D1, "120", "USD")])
        await async_session.commit()

        d = data_of(authenticated_client.get(
            f"{BASE}/time-weighted-return", params={"start_date": "2026-01-05", "end_date": "2026-02-02"}))
        assert d["twr"] == pytest.approx(0.20)
        assert d["valuation_series"][-1]["value"] == pytest.approx(120 * 30)
        assert d["data_quality"]["fx_fallback_valuations"] > 0
        offline_fx.get_exchange_rate.assert_awaited_with("USD", "TWD")

    async def test_start_after_end_collapses_to_the_end_day(self, authenticated_client, async_session, pf, test_user):
        h = lot(pf, test_user, "0050", "10", "100", self.D0)
        async_session.add_all([h, buy(h), close("0050", self.D0, "100")])
        await async_session.commit()

        d = data_of(authenticated_client.get(
            f"{BASE}/time-weighted-return", params={"start_date": "2026-03-01", "end_date": "2026-02-02"}))
        assert d["start_date"] == d["end_date"] == "2026-02-02" and d["total_days"] == 1

    async def test_no_lots_is_a_zero_return(self, authenticated_client, pf):
        d = data_of(authenticated_client.get(f"{BASE}/time-weighted-return"))
        assert d["twr"] == 0.0 and d["annualized_return"] is None and d["message"] == "No holdings found"

    async def test_demo_caller_gets_sample_data(self, client):
        d = data_of(client.get(f"{BASE}/time-weighted-return"))
        assert "twr" in d


class TestHistorical:
    async def test_points_value_each_lot_from_its_purchase_day(
            self, authenticated_client, async_session, pf, test_user):
        today = business_today()
        d0 = today - timedelta(days=61)
        a = lot(pf, test_user, "0050", "10", "100", d0, price="150")
        b = lot(pf, test_user, "2330", "1", "500", d0 + timedelta(days=45), price="600")
        async_session.add_all([a, b, close("0050", d0 + timedelta(days=30), "120")])
        await async_session.commit()

        pts = data_of(authenticated_client.get(f"{BASE}/historical", params={"interval": "monthly"}))
        assert [p["date"] for p in pts] == [
            (d0 + timedelta(days=n)).isoformat() for n in (0, 30, 60)] + [today.isoformat()]
        # Before the first stored close, the lot's current price stands in.
        assert (pts[0]["value"], pts[0]["cost"]) == (1500, 1000)
        assert pts[0]["gain_loss"] == 500 and pts[0]["gain_loss_percentage"] == pytest.approx(50)
        assert pts[1]["value"] == 1200 and pts[1]["topHoldings"][0]["closePrice"] == 120
        # The second lot joins once bought, valued at its current price (no history).
        assert (pts[2]["value"], pts[2]["cost"]) == (1200 + 600, 1500)
        assert [h["symbol"] for h in pts[2]["topHoldings"]] == ["0050", "2330"]

    @pytest.mark.parametrize("interval,step", [("daily", 1), ("weekly", 7), ("yearly", 365), ("bogus", 30)])
    async def test_interval_spacing(self, authenticated_client, async_session, pf, test_user, interval, step):
        today = business_today()
        async_session.add(lot(pf, test_user, "0050", "1", "1", today - timedelta(days=20)))
        await async_session.commit()

        pts = data_of(authenticated_client.get(f"{BASE}/historical", params={"interval": interval}))
        dates = [date.fromisoformat(p["date"]) for p in pts]
        assert dates[0] == today - timedelta(days=20) and dates[-1] == today
        if len(dates) > 2:
            assert dates[1] - dates[0] == timedelta(days=step)

    async def test_no_holdings_is_an_empty_series(self, authenticated_client, pf):
        assert data_of(authenticated_client.get(f"{BASE}/historical")) == []

    async def test_demo_caller_gets_twelve_points(self, client):
        assert len(data_of(client.get(f"{BASE}/historical"))) == 12


class TestHoldingPeriods:
    async def test_buckets_by_years_held(self, authenticated_client, async_session, pf, test_user):
        today = business_today()
        async_session.add_all([
            lot(pf, test_user, "A", "2", "10", today - timedelta(days=100), price="15"),
            lot(pf, test_user, "B", "1", "10", today - timedelta(days=800)),
            lot(pf, test_user, "C", "1", "10", today - timedelta(days=1500)),
        ])
        await async_session.commit()

        d = data_of(authenticated_client.get(f"{BASE}/holding-periods"))
        assert d["total_holdings"] == 3
        assert (d["short_term_count"], d["medium_term_count"], d["long_term_count"]) == (1, 1, 1)
        assert d["average_holding_period_days"] == pytest.approx(800)
        assert d["average_holding_period_years"] == pytest.approx(round(800 / 365.25, 2))
        assert d["categorization"]["short_term_pct"] == pytest.approx(33.33)
        short = d["short_term_holdings"][0]
        assert (short["symbol"], short["days_held"], short["cost"], short["value"]) == ("A", 100, 20, 30)

    async def test_no_holdings(self, authenticated_client, pf):
        d = data_of(authenticated_client.get(f"{BASE}/holding-periods"))
        assert d["total_holdings"] == 0 and d["average_holding_period_days"] == 0
        assert d["categorization"] == {"short_term_pct": 0, "medium_term_pct": 0, "long_term_pct": 0}


@pytest.mark.parametrize("path", ["time-weighted-return", "historical", "holding-periods"])
async def test_user_without_a_portfolio_gets_404(authenticated_client, path):
    r = authenticated_client.get(f"{BASE}/{path}")
    assert r.status_code == 404, r.text[:200]
