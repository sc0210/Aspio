"""/portfolio/analytics and /portfolio/benchmark against seeded rows.

The benchmark's Yahoo fallback is stubbed at MarketDataService, so nothing
here reaches the network.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.market_data_service import MarketDataService
from app.modules.portfolio.models import (
    HistoricalPrice,
    HoldingWalletType,
    Portfolio,
    PortfolioHolding,
)
from app.modules.portfolio.routers import allocation_analytics
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.api]
BASE = "/api/v1/portfolio"


def _holding(portfolio, user, symbol, kind, market, sector, region, value, gain_pct):
    return PortfolioHolding(
        id=uuid4(), portfolio_id=portfolio.id, user_id=user.id, symbol=symbol,
        name=symbol, type=kind, exchange="X", currency="TWD", market=market,
        sector=sector, region=region, wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal("1"), average_cost=Decimal(value), current_price=Decimal(value),
        total_cost=Decimal(value), total_value=Decimal(value), gain_loss=Decimal("0"),
        gain_loss_percentage=Decimal(gain_pct), is_active=True,
        purchase_date=datetime.now(timezone.utc) - timedelta(days=30),
    )


@pytest_asyncio.fixture
async def holdings(async_session, test_user):
    pf = Portfolio(
        id=uuid4(), user_id=test_user.id, name="P", currency="TWD",
        is_active=True, is_default=True,
    )
    async_session.add(pf)
    await async_session.flush()
    async_session.add_all(
        [
            _holding(pf, test_user, "0050", "etf", "TW", "Broad", "Asia", "1500", "50"),
            _holding(pf, test_user, "AAPL", "stock", "US", "Tech", "Americas", "500", "-10"),
        ]
    )
    await async_session.commit()


class TestAnalytics:
    async def test_signed_out_gets_demo(self, client):
        data = client.get(f"{BASE}/analytics").json()["data"]
        assert data["diversificationScore"] == 75

    async def test_user_without_portfolio_gets_demo(self, authenticated_client):
        data = authenticated_client.get(f"{BASE}/analytics").json()["data"]
        assert data["diversificationScore"] == 75

    async def test_allocation_and_scores_from_holdings(self, authenticated_client, holdings):
        data = authenticated_client.get(f"{BASE}/analytics").json()["data"]

        by_type = {s["type"]: s["percentage"] for s in data["allocation"]["byType"]}
        assert by_type == {"Etf": pytest.approx(75.0), "Stock": pytest.approx(25.0)}
        assert {s["sector"] for s in data["allocation"]["bySector"]} == {"Broad", "Tech"}
        assert {s["region"] for s in data["allocation"]["byRegion"]} == {"Asia", "Americas"}

        assert [h["symbol"] for h in data["topPerformers"]] == ["0050", "AAPL"]
        assert data["worstPerformers"][-1]["symbol"] == "AAPL"
        # 2 types × 20 + 2 sectors × 10 + 2 markets × 15
        assert data["diversificationScore"] == 90
        # Largest type weight + 20
        assert data["riskScore"] == pytest.approx(95.0)
        # Served by /portfolio/risk-metrics; kept null here for the fallback read.
        assert data["sharpeRatio"] is None
        assert data["beta"] is None


def _seed_closes(session, symbol, closes):
    start = business_today() - timedelta(days=len(closes))
    session.add_all(
        HistoricalPrice(
            symbol=symbol, market="US", date=start + timedelta(days=i),
            close=Decimal(str(c)), source="yahoo", currency="USD",
        )
        for i, c in enumerate(closes)
    )


class TestBenchmark:
    async def test_signed_out_gets_deterministic_synthetic_series(self, client):
        a = client.get(f"{BASE}/benchmark", params={"symbol": "qqq", "days": 30}).json()
        b = client.get(f"{BASE}/benchmark", params={"symbol": "qqq", "days": 30}).json()
        assert a == b
        assert a["data"]["name"] == "NASDAQ-100 ETF"
        assert a["data"]["points"][0]["returnPct"] == 0

    async def test_invalid_symbol_is_400(self, authenticated_client):
        r = authenticated_client.get(f"{BASE}/benchmark", params={"symbol": "X" * 21})
        assert r.status_code == 400

    async def test_reads_cached_prices_as_period_return(
        self, authenticated_client, async_session, monkeypatch
    ):
        _seed_closes(async_session, "SPY", [100, 110, 0.0001, 90])
        await async_session.commit()

        async def no_network(*_a, **_kw):
            raise AssertionError("cache hit must not call the provider")

        monkeypatch.setattr(MarketDataService, "get_historical_data", no_network)
        data = authenticated_client.get(
            f"{BASE}/benchmark", params={"symbol": "spy", "days": 30}
        ).json()["data"]

        assert data["name"] == "S&P 500 ETF"
        assert [p["returnPct"] for p in data["points"]][:2] == [0.0, 10.0]
        assert data["points"][-1]["returnPct"] == -10.0

    async def test_falls_back_to_provider_and_stores_in_background(
        self, authenticated_client, monkeypatch
    ):
        async def fake_history(self, symbol, market, days):
            assert (symbol, market) == ("2330.TW", "TW")
            return [
                {"date": "2026-10-02", "close": 200},
                {"date": "2026-10-01", "close": 100},
                {"date": "2026-10-03", "close": None},
            ]

        stored = []

        async def fake_store(yahoo_symbol, market, raw):
            stored.append((yahoo_symbol, market, len(raw)))

        monkeypatch.setattr(MarketDataService, "get_historical_data", fake_history)
        monkeypatch.setattr(allocation_analytics, "_store_benchmark_background", fake_store)

        body = authenticated_client.get(
            f"{BASE}/benchmark", params={"symbol": "2330.TW", "days": 30}
        ).json()

        assert body["success"] is True
        # Custom ticker: grey, named after itself, sorted by date.
        assert body["data"]["color"] == "#6b7280"
        assert [p["returnPct"] for p in body["data"]["points"]] == [0.0, 100.0]
        assert stored == [("2330.TW", "TW", 3)]

    async def test_no_data_anywhere(self, authenticated_client, monkeypatch):
        async def empty(*_a, **_kw):
            return []

        monkeypatch.setattr(MarketDataService, "get_historical_data", empty)
        body = authenticated_client.get(f"{BASE}/benchmark", params={"symbol": "VTI"}).json()
        assert body["success"] is False
        assert "VTI" in body["message"]


class TestStoreBenchmarkBackground:
    async def test_converts_rows_and_skips_unusable_ones(self, monkeypatch):
        written = []

        class FakeRepo:
            def __init__(self, session):
                pass

            async def bulk_upsert_prices(self, records):
                written.extend(records)
                return len(records)

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def commit(self):
                pass

        import app.core.database as database
        from app.modules.portfolio import historical_price_repository

        monkeypatch.setattr(database, "async_session", FakeSession)
        monkeypatch.setattr(historical_price_repository, "HistoricalPriceRepository", FakeRepo)

        await allocation_analytics._store_benchmark_background(
            "0050.tw",
            "TW",
            [
                {"date": "2026-10-01T00:00:00Z", "close": 150, "volume": 5},
                {"date": "2026-10-02", "close": 0},
                {"date": "not-a-date", "close": 1},
            ],
        )

        assert len(written) == 1
        assert written[0]["symbol"] == "0050.TW"
        assert written[0]["currency"] == "TWD"
        assert written[0]["date"].isoformat() == "2026-10-01"

    async def test_failure_is_swallowed(self, monkeypatch):
        import app.core.database as database

        def broken():
            raise RuntimeError("no db")

        monkeypatch.setattr(database, "async_session", broken)
        await allocation_analytics._store_benchmark_background(
            "SPY", "US", [{"date": "2026-10-01", "close": 1}]
        )
