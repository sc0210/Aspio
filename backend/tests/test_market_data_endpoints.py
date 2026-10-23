"""Portfolio market-data endpoints: bulk prices, quotes, refreshes.

Every provider (quotes, FX, the price sync) is stubbed, so nothing here
reaches the network. Bulk prices read real HistoricalPrice rows.
"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio

from app.modules.portfolio import market_data_service, price_update_service
from app.modules.portfolio.models import HistoricalPrice
from app.modules.portfolio.repositories import CurrencyRepository
from app.modules.portfolio.routers import market_data
from app.modules.portfolio.routers._shared import _price_cache
from app.utils import exchange_rate_service

pytestmark = [pytest.mark.asyncio, pytest.mark.api]
BASE = "/api/v1/portfolio"


@pytest.fixture(autouse=True)
def _clear_price_cache():
    _price_cache.clear()
    yield
    _price_cache.clear()


@pytest_asyncio.fixture
async def prices(async_session):
    async_session.add_all(
        [
            HistoricalPrice(symbol="AAPL", market="US", date=date(2026, 10, 8), close=Decimal("100"),
                            open=Decimal("99"), source="yahoo", currency="USD"),
            HistoricalPrice(symbol="AAPL", market="US", date=date(2026, 10, 9), close=Decimal("104"),
                            source="yahoo", currency="USD"),
        ]
    )
    await async_session.commit()


class TestBulkPrices:
    async def test_requires_sign_in(self, client):
        assert client.get(f"{BASE}/prices/bulk", params={"symbols": "AAPL"}).status_code == 401

    async def test_blank_symbols(self, authenticated_client):
        data = authenticated_client.get(f"{BASE}/prices/bulk", params={"symbols": " , "}).json()["data"]
        assert data == {"prices": {}, "missing": []}

    async def test_more_than_fifty_symbols_is_422(self, authenticated_client):
        many = ",".join(f"S{i}" for i in range(51))
        assert authenticated_client.get(f"{BASE}/prices/bulk", params={"symbols": many}).status_code == 422

    async def test_latest_then_served_from_cache(self, authenticated_client, prices):
        first = authenticated_client.get(f"{BASE}/prices/bulk", params={"symbols": "aapl,msft"}).json()["data"]
        assert first["cached"] is False
        assert first["prices"]["AAPL"]["close"] == 104.0
        assert first["prices"]["MSFT"] is None

        # A symbol with no rows caches as None, which reads back as a miss, so
        # any request naming one goes to the DB again.
        again = authenticated_client.get(f"{BASE}/prices/bulk", params={"symbols": "AAPL,MSFT"}).json()["data"]
        assert again["cached"] is False

        cached = authenticated_client.get(f"{BASE}/prices/bulk", params={"symbols": "AAPL"}).json()["data"]
        assert cached["cached"] is True
        assert cached["prices"]["AAPL"]["date"] == "2026-10-09"

    async def test_on_date_uses_previous_close_and_reports_missing(self, authenticated_client, prices):
        data = authenticated_client.get(
            f"{BASE}/prices/bulk", params={"symbols": "AAPL,MSFT", "target_date": "2026-10-08"}
        ).json()["data"]
        assert data["prices"]["AAPL"]["close"] == 100.0
        assert data["prices"]["AAPL"]["open"] == 99.0
        assert data["missing"] == ["MSFT"]


class TestDemoCatalogues:
    async def test_market_data_filters_by_symbol(self, client):
        rows = client.get(f"{BASE}/market-data", params={"symbols": "aapl, btc-usd"}).json()
        assert [r["symbol"] for r in rows] == ["AAPL", "BTC-USD"]
        assert len(client.get(f"{BASE}/market-data").json()) == 3

    async def test_search_matches_symbol_or_name(self, client):
        data = client.get(f"{BASE}/search", params={"q": "bitcoin"}).json()["data"]
        assert [r["symbol"] for r in data] == ["BTC-USD"]
        assert len(client.get(f"{BASE}/search", params={"q": "o", "limit": 2}).json()["data"]) == 2

    @pytest.mark.parametrize("market,expected", [("TW", {"0050"}), ("CRYPTO", {"BTC-USD"}), ("US", {"VOO"})])
    async def test_popular_symbols_by_market(self, client, market, expected):
        r = client.get(f"{BASE}/symbol/popular", params={"market": market})
        assert r.status_code == 200
        payload = r.json()["data"]
        rows = payload if isinstance(payload, list) else [s for v in payload.values() for s in v]
        assert expected <= {s["symbol"] for s in rows}
        assert {s["market"] for s in rows} == {market}


class _FakeQuotes:
    def __init__(self, price):
        self.price = price
        self.calls = []

    async def get_current_price(self, symbol, market):
        self.calls.append((symbol, market))
        return self.price


class TestSymbolQuote:
    @pytest.mark.parametrize(
        "symbol,market,asked,exchange",
        [
            ("2330.TW", "TW", "2330", "TWSE"),
            ("0050", "TW", "0050", "TWSE"),
            ("BTC-USD", "CRYPTO", "BTC-USD", "Crypto"),
            ("AAPL", "US", "AAPL", "NASDAQ/NYSE"),
        ],
    )
    async def test_detects_market_from_symbol(self, client, monkeypatch, symbol, market, asked, exchange):
        quotes = _FakeQuotes(Decimal("12.5"))
        monkeypatch.setattr(market_data_service, "get_market_data_service", lambda: quotes)
        monkeypatch.setattr(price_update_service.MarketHoursManager, "is_market_open", classmethod(lambda cls, m: False))

        data = client.get(f"{BASE}/symbol/quote/{symbol}").json()["data"]

        assert quotes.calls == [(asked, market)]
        assert data["market"] == market
        assert data["exchange"] == exchange
        assert data["current_price"] == 12.5
        assert data["status"] == "success"

    async def test_no_price_is_reported_not_raised(self, client, monkeypatch):
        monkeypatch.setattr(market_data_service, "get_market_data_service", lambda: _FakeQuotes(None))
        data = client.get(f"{BASE}/symbol/quote/XYZ", params={"market": "US"}).json()["data"]
        assert data["current_price"] is None
        assert data["status"] == "no_data"


class _FakeFx:
    def __init__(self, rates):
        self.rates = rates

    async def _fetch_rates(self, base):
        return self.rates

    async def get_exchange_rate(self, from_currency, to_currency):
        return self.rates.get(from_currency.upper())


class TestExchangeRates:
    async def test_refresh_stores_known_currencies(self, authenticated_client, monkeypatch):
        stored = []

        async def fake_upsert(self, rate_data):
            stored.append(rate_data)
            return SimpleNamespace(rate=rate_data["rate"])

        monkeypatch.setattr(
            exchange_rate_service, "get_exchange_rate_service",
            lambda *a, **kw: _FakeFx({"TWD": 31.5, "JPY": 150, "XXX": 9}),
        )
        monkeypatch.setattr(CurrencyRepository, "create_or_update_rate", fake_upsert)

        data = authenticated_client.post(f"{BASE}/exchange-rates/refresh").json()["data"]

        assert data["rates_updated"] == 2
        assert {(r["to"], r["rate"]) for r in data["rates"]} == {("TWD", 31.5), ("JPY", 150.0)}
        assert {s["source"] for s in stored} == {exchange_rate_service.LIVE_SOURCE}

    async def test_refresh_without_rates_is_503(self, authenticated_client, monkeypatch):
        monkeypatch.setattr(exchange_rate_service, "get_exchange_rate_service", lambda *a, **kw: _FakeFx({}))
        assert authenticated_client.post(f"{BASE}/exchange-rates/refresh").status_code == 503

    async def test_pair_lookup(self, client, monkeypatch):
        monkeypatch.setattr(exchange_rate_service, "get_exchange_rate_service", lambda *a, **kw: _FakeFx({"USD": 31.5}))
        ok = client.get(f"{BASE}/exchange-rates/usd/twd").json()["data"]
        assert (ok["from_currency"], ok["to_currency"], ok["rate"]) == ("USD", "TWD", 31.5)
        assert client.get(f"{BASE}/exchange-rates/EUR/TWD").status_code == 404


class _FakePriceSync:
    def __init__(self, fail=False):
        self.fail = fail

    async def update_portfolio_prices(self, user_id, portfolio_id, force):
        if self.fail:
            raise RuntimeError("provider down")
        return {"updated": 2, "cached": 1, "force": force}


class TestRefreshPrices:
    async def test_requires_sign_in(self, client):
        assert client.post(f"{BASE}/refresh-prices").status_code == 401

    async def test_returns_sync_stats_even_without_a_portfolio(self, authenticated_client, monkeypatch):
        monkeypatch.setattr(market_data, "get_price_update_service", lambda s: _FakePriceSync())
        body = authenticated_client.post(f"{BASE}/refresh-prices", params={"force": True}).json()
        assert body["data"] == {"updated": 2, "cached": 1, "force": True}
        assert "2 updated, 1 cached" in body["message"]

    async def test_sync_failure_is_500(self, authenticated_client, monkeypatch):
        monkeypatch.setattr(market_data, "get_price_update_service", lambda s: _FakePriceSync(fail=True))
        assert authenticated_client.post(f"{BASE}/refresh-prices").status_code == 500
