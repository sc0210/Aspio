"""/portfolio/rebalancing/* and /portfolio/allocation against a seeded portfolio."""

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

BASE = "/api/v1/portfolio"


@pytest.fixture(autouse=True)
def offline_fx():
    fake = MagicMock()
    fake.get_exchange_rate = AsyncMock(return_value=Decimal("32"))
    fake.get_usd_to_twd_rate = AsyncMock(return_value=Decimal("32"))
    with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fake), \
         patch("app.modules.portfolio.performance_tracker.get_exchange_rate_service", return_value=fake):
        yield fake


def holding(pf, user, symbol, value, currency="TWD", type_="etf"):
    return PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=user.id, symbol=symbol, name=symbol,
        type=type_, exchange="TWSE", currency=currency, market="TW",
        wallet_type=HoldingWalletType.PORTFOLIO, quantity=Decimal("1"),
        average_cost=Decimal(value), current_price=Decimal(value), total_cost=Decimal(value),
        total_value=Decimal(value), gain_loss=Decimal("0"), gain_loss_percentage=Decimal("0"),
        is_active=True, purchase_date=datetime(2026, 1, 2, tzinfo=timezone.utc))


@pytest_asyncio.fixture
async def seeded(async_session, test_user):
    pf = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(pf)
    await async_session.flush()
    async_session.add_all([
        holding(pf, test_user, "0050", "8000"),
        holding(pf, test_user, "VT", "100", currency="USD"),
        holding(pf, test_user, "BTC-USD", "500", type_="crypto"),
    ])
    await async_session.commit()
    return pf


async def get(client, path):
    r = client.get(f"{BASE}{path}")
    assert r.status_code == 200, (path, r.status_code, r.text[:300])
    body = r.json()
    assert body["success"] is True
    return body["data"]


async def test_allocation_breakdown(authenticated_client, seeded):
    data = await get(authenticated_client, "/allocation")
    assert data["by_type"]


async def test_rebalancing_allocation_flags_overweight_0050(authenticated_client, seeded):
    data = await get(authenticated_client, "/rebalancing/allocation")
    rows = {a["asset_symbol"]: a for a in data["allocations"]}
    assert rows["0050"]["action"] == "sell"
    assert data["requires_rebalancing"] is True


@pytest.mark.xfail(strict=True, reason="rebalancing sums holding.total_value in native currency: "
                   "the USD holding (100 USD) is counted as 100 TWD, not 3,200")
async def test_rebalancing_total_converts_usd_holdings(authenticated_client, seeded):
    data = await get(authenticated_client, "/rebalancing/allocation")
    assert float(data["total_portfolio_value"]) == 8000 + 100 * 32 + 500


async def test_rebalancing_plan_has_sells_and_buys(authenticated_client, seeded):
    data = await get(authenticated_client, "/rebalancing/plan")
    assert {t["action"] for t in data["transactions"]} == {"sell", "buy"}
    assert float(data["total_sell_amount"]) > 0


async def test_fx_accumulation_uses_the_rate(authenticated_client, seeded):
    (fx,) = await get(authenticated_client, "/rebalancing/fx-accumulation")
    assert fx["currency"] == "USD" and float(fx["current_fx_rate"]) == 32.0
    assert fx["ready_to_convert"] is True


async def test_alerts_include_rebalance_required(authenticated_client, seeded):
    data = await get(authenticated_client, "/rebalancing/alerts")
    assert "rebalance_required" in {a["alert_type"] for a in data["alerts"]}


async def test_dashboard_bundle(authenticated_client, seeded):
    data = await get(authenticated_client, "/rebalancing/dashboard")
    assert {"metrics", "allocation_summary", "fx_accumulation", "alerts"} <= set(data)
    assert data["rebalancing_plan"] is not None


@pytest.mark.xfail(strict=True, reason="router's blanket except turns NotFoundException into a 500")
async def test_unknown_portfolio_id_is_a_404(authenticated_client, seeded):
    r = authenticated_client.get(f"{BASE}/rebalancing/allocation", params={"portfolio_id": str(uuid4())})
    assert r.status_code == 404


async def test_analytics_endpoint(authenticated_client, seeded):
    r = authenticated_client.get(f"{BASE}/analytics")
    assert r.status_code == 200
    assert r.json()["success"] is True and r.json()["data"]


class TestTargetAllocations:
    def put(self, client, targets):
        return client.put(f"{BASE}/rebalancing/target-allocations", json={"targets": targets})

    @pytest.mark.xfail(strict=True, reason="Portfolio.metadata is SQLAlchemy's declarative MetaData, not a "
                       "column (the column is item_metadata): saving targets raises TypeError -> 500")
    async def test_saved_targets_drive_the_next_allocation(self, authenticated_client, seeded):
        r = self.put(authenticated_client, [
            {"asset": "0050", "targetPct": 0.8, "assetName": "Taiwan 50", "assetType": "etf"},
            {"asset": "CASH", "targetPct": 0.2, "assetType": "cash"},
        ])
        assert r.status_code == 200, r.text
        data = await get(authenticated_client, "/rebalancing/allocation")
        assert {a["asset_symbol"] for a in data["allocations"]} == {"0050", "CASH"}

    async def test_empty_is_400(self, authenticated_client, seeded):
        assert self.put(authenticated_client, []).status_code == 400

    async def test_must_total_100_percent(self, authenticated_client, seeded):
        r = self.put(authenticated_client, [{"asset": "0050", "targetPct": 0.5}])
        assert r.status_code == 400 and "100%" in r.text

    async def test_no_portfolio_is_404(self, authenticated_client, test_user):
        r = self.put(authenticated_client, [{"asset": "0050", "targetPct": 1.0}])
        assert r.status_code == 404
