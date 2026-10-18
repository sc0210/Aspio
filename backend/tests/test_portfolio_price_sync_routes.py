"""Price-sync routes that called repository/service methods which never existed."""

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

BASE = "/api/v1/portfolio"


def lot(pf, user, symbol, market="TW", active=True):
    return PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=user.id, symbol=symbol, name=symbol, type="etf",
        exchange="TWSE", currency="TWD", market=market, wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal("1"), average_cost=Decimal("1"), current_price=Decimal("1"),
        total_cost=Decimal("1"), total_value=Decimal("1"), gain_loss=Decimal("0"),
        gain_loss_percentage=Decimal("0"), is_active=active, purchase_date=datetime(2026, 1, 2, tzinfo=timezone.utc))


@pytest_asyncio.fixture
async def portfolios(async_session, test_user):
    main = Portfolio(id=uuid4(), user_id=test_user.id, name="Main", currency="TWD", is_active=True, is_default=True)
    stranger = Portfolio(id=uuid4(), user_id=uuid4(), name="Not mine", currency="TWD", is_active=True, is_default=True)
    async_session.add_all([main, stranger])
    await async_session.flush()
    async_session.add_all([
        lot(main, test_user, "0050"), lot(main, test_user, "0050"), lot(main, test_user, "2330"),
        lot(main, test_user, "OLD", active=False), lot(main, test_user, "VT", market="US"),
    ])
    await async_session.commit()
    return {"main": main, "stranger": stranger}


@pytest.fixture
def fetcher():
    svc = MagicMock()
    svc.update_holdings_historical_data = AsyncMock(side_effect=lambda symbols, markets, days: {
        "total_symbols": len(symbols), "symbols": symbols, "markets": markets, "days": days})
    with patch("app.modules.portfolio.routers.historical_prices.get_historical_price_service", return_value=svc):
        yield svc


async def test_fetch_all_uses_the_default_portfolios_active_symbols(authenticated_client, portfolios, fetcher):
    r = authenticated_client.post(f"{BASE}/historical-prices/fetch-all")
    assert r.status_code == 200, r.text[:300]
    d = r.json()["data"]
    assert sorted(d["symbols"]) == ["0050", "2330", "VT"]
    assert d["markets"] == {"0050": "TW", "2330": "TW", "VT": "US"}


async def test_fetch_all_for_a_named_portfolio(authenticated_client, portfolios, fetcher):
    r = authenticated_client.post(f"{BASE}/historical-prices/fetch-all",
                                  params={"portfolio_id": str(portfolios["main"].id), "days": 30})
    assert r.status_code == 200, r.text[:300]
    assert sorted(r.json()["data"]["symbols"]) == ["0050", "2330", "VT"] and r.json()["data"]["days"] == 30


async def test_fetch_all_never_reads_another_users_portfolio(authenticated_client, portfolios, fetcher):
    r = authenticated_client.post(f"{BASE}/historical-prices/fetch-all",
                                  params={"portfolio_id": str(portfolios["stranger"].id)})
    assert r.status_code == 200 and r.json()["data"] == {"message": "No holdings found"}
    fetcher.update_holdings_historical_data.assert_not_awaited()


async def test_fetch_all_without_holdings(authenticated_client, fetcher):
    r = authenticated_client.post(f"{BASE}/historical-prices/fetch-all")
    assert r.status_code == 200 and r.json()["data"] == {"message": "No holdings found"}


async def test_sync_prices_route_is_gone(authenticated_client):
    # It called PortfolioService.sync_portfolio_prices, which never existed; /refresh-prices does the job.
    assert authenticated_client.post(f"{BASE}/sync-prices").status_code in (404, 405)
