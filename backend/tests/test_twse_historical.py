"""The TWSE STOCK_DAY fallback: which months it asks for, how it merges and
trims them, and how the one-month fetch fails. The exchange is never called —
_fetch_twse_month is stubbed for the walk, and urlopen for the fetch itself.
Row parsing has its own tests in test_market_data_service.py.
"""

import io
import json
from datetime import date, timedelta

import pytest

from app.modules.portfolio import market_data_service as mds
from app.modules.portfolio.market_data_service import MarketDataService

pytestmark = [pytest.mark.asyncio, pytest.mark.unit]


def roc(d: date) -> str:
    return f"{d.year - 1911}/{d.month:02d}/{d.day:02d}"


def bar(d: date, close: str) -> list:
    return [roc(d), "1,000", "100", close, close, close, close, "0", "10"]


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    mds._symbol_cache.clear()
    monkeypatch.setattr(mds, "business_today", lambda: date(2026, 10, 15))
    yield
    mds._symbol_cache.clear()


@pytest.fixture
def svc():
    return MarketDataService(enable_finlab=False, enable_tradingview=False, enable_yahoo=False)


async def test_walks_each_month_and_keeps_only_the_window(svc, monkeypatch):
    asked = []

    async def month_rows(self, stock_no, month):
        asked.append((stock_no, month))
        if month == date(2026, 9, 1):
            return [bar(date(2026, 9, 1), "90"), bar(date(2026, 9, 30), "95"), ["junk"]]
        return [bar(date(2026, 10, 1), "100"), bar(date(2026, 10, 1), "101")]  # later row wins

    monkeypatch.setattr(MarketDataService, "_fetch_twse_month", month_rows)
    rows = await svc._get_twse_historical("0050.TW", days=30)  # window opens 2026-09-15

    assert asked == [("0050", date(2026, 9, 1)), ("0050", date(2026, 10, 1))]
    assert [(r["date"], r["close"]) for r in rows] == [("2026-09-30", 95.0), ("2026-10-01", 101.0)]

    # Served from cache the second time.
    asked.clear()
    assert await svc._get_twse_historical("0050.TW", days=30) == rows
    assert asked == []


async def test_spans_a_year_boundary(svc, monkeypatch):
    months = []

    async def month_rows(self, stock_no, month):
        months.append(month)
        return []

    monkeypatch.setattr(MarketDataService, "_fetch_twse_month", month_rows)
    monkeypatch.setattr(mds, "business_today", lambda: date(2027, 1, 10))
    assert await svc._get_twse_historical("2330", days=45) == []
    assert months == [date(2026, 11, 1), date(2026, 12, 1), date(2027, 1, 1)]
    # Nothing found is not cached, so the next backfill tries again.
    assert not any(k.startswith("twse_hist:") for k in mds._symbol_cache)


async def test_non_numeric_codes_are_not_listed_securities(svc, monkeypatch):
    async def never(*a, **k):
        raise AssertionError("must not fetch")

    monkeypatch.setattr(MarketDataService, "_fetch_twse_month", never)
    assert await svc._get_twse_historical("AAPL", days=30) == []


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def no_pause(monkeypatch):
    async def instant(_seconds):
        return None

    monkeypatch.setattr(mds.asyncio, "sleep", instant)


async def test_fetch_month_returns_rows_on_ok(svc, monkeypatch, no_pause):
    seen = {}

    def urlopen(req, timeout):
        seen["url"] = req.full_url
        seen["ua"] = req.get_header("User-agent")
        return _Resp(json.dumps({"stat": "OK", "data": [bar(date(2026, 10, 1), "100")]}).encode())

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    rows = await svc._fetch_twse_month("0050", date(2026, 10, 1))

    assert len(rows) == 1
    assert "date=20261001&stockNo=0050" in seen["url"]
    assert seen["ua"] == mds.TWSE_USER_AGENT


@pytest.mark.parametrize(
    "behaviour",
    [
        lambda req, timeout: _Resp(json.dumps({"stat": "很抱歉，沒有符合條件的資料!"}).encode()),
        lambda req, timeout: _Resp(json.dumps({"stat": "OK"}).encode()),
        lambda req, timeout: (_ for _ in ()).throw(OSError("connection reset")),
        lambda req, timeout: _Resp(b"<html>throttled</html>"),
    ],
    ids=["not-ok", "no-data", "network", "not-json"],
)
async def test_fetch_month_returns_nothing_on_failure(svc, monkeypatch, no_pause, behaviour):
    monkeypatch.setattr("urllib.request.urlopen", behaviour)
    assert await svc._fetch_twse_month("0050", date(2026, 10, 1)) == []
