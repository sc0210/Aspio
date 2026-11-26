"""/portfolio/performance/time-weighted-return on seeded lots and prices."""

from datetime import date, datetime, time, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio import historical_price_repository
from app.modules.portfolio.models import (
    HistoricalPrice, HoldingWalletType, Portfolio, PortfolioHolding, PortfolioTransaction,
)

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


async def test_user_without_a_portfolio_gets_404(authenticated_client):
    r = authenticated_client.get(f"{BASE}/time-weighted-return")
    assert r.status_code == 404, r.text[:200]
