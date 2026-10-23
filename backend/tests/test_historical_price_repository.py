"""
HistoricalPriceRepository against the in-memory SQLite fixture.

The reads run for real. bulk_upsert_prices emits a PostgreSQL-only
ON CONFLICT statement, so its tests use a session stand-in that records the
statement and compile it with the PostgreSQL dialect to read the bound rows.
"""

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.dialects import postgresql

from app.modules.portfolio import historical_price_repository as repo_module
from app.modules.portfolio.historical_price_repository import (
    HistoricalPriceRepository,
    _hcache_get,
    _hcache_set,
    _hist_cache,
)
from app.modules.portfolio.models import HistoricalPrice


@pytest.fixture(autouse=True)
def _clear_cache():
    _hist_cache.clear()
    yield
    _hist_cache.clear()


def _price(symbol: str, day: date, close: str, **kw) -> HistoricalPrice:
    return HistoricalPrice(
        symbol=symbol,
        market=kw.pop("market", "US"),
        date=day,
        close=Decimal(close),
        source="yahoo",
        currency="USD",
        **kw,
    )


@pytest_asyncio.fixture
async def seeded(async_session):
    async_session.add_all(
        [
            # Mon 2026-10-05 .. Fri 2026-10-09, with Wed missing
            _price("AAPL", date(2026, 10, 5), "100", open=Decimal("99"), volume=10),
            _price("AAPL", date(2026, 10, 6), "101"),
            _price("AAPL", date(2026, 10, 8), "103"),
            _price("AAPL", date(2026, 10, 9), "104", exchange="NASDAQ"),
            _price("MSFT", date(2026, 10, 6), "300"),
        ]
    )
    await async_session.commit()
    return HistoricalPriceRepository(async_session)


@pytest.mark.unit
@pytest.mark.asyncio
class TestReads:
    async def test_price_history_is_ranged_ordered_and_case_insensitive(self, seeded):
        rows = await seeded.get_price_history(
            "aapl", date(2026, 10, 6), date(2026, 10, 8)
        )
        assert [r.date for r in rows] == [date(2026, 10, 6), date(2026, 10, 8)]

    async def test_price_history_respects_limit(self, seeded):
        rows = await seeded.get_price_history(
            "AAPL", date(2026, 10, 1), date(2026, 10, 31), limit=2
        )
        assert len(rows) == 2

    async def test_batch_groups_by_symbol_and_keeps_empty_symbols(self, seeded):
        out = await seeded.get_batch_price_history(
            ["aapl", "msft", "nvda"], date(2026, 10, 1), date(2026, 10, 31)
        )
        assert [p["close"] for p in out["AAPL"]] == [100.0, 101.0, 103.0, 104.0]
        assert out["AAPL"][0]["open"] == 99.0
        assert out["AAPL"][1]["open"] is None
        assert out["MSFT"][0]["date"] == "2026-10-06"
        assert out["NVDA"] == []

    async def test_batch_empty_symbols_short_circuits(self, seeded):
        assert await seeded.get_batch_price_history([], date(2026, 10, 1)) == {}

    async def test_batch_is_served_from_cache_on_repeat(self, seeded, async_session):
        args = (["AAPL"], date(2026, 10, 1), date(2026, 10, 31))
        first = await seeded.get_batch_price_history(*args)
        async_session.add(_price("AAPL", date(2026, 10, 12), "999"))
        await async_session.commit()
        second = await seeded.get_batch_price_history(*args)
        assert second is first
        assert len(second["AAPL"]) == 4

    async def test_price_on_date_exact_match(self, seeded):
        row = await seeded.get_price_on_date("AAPL", date(2026, 10, 8))
        assert row.close == Decimal("103")

    async def test_price_on_date_falls_back_to_previous_close(self, seeded):
        row = await seeded.get_price_on_date("AAPL", date(2026, 10, 7))
        assert row.date == date(2026, 10, 6)

    async def test_price_on_date_before_any_data_is_none(self, seeded):
        assert await seeded.get_price_on_date("AAPL", date(2026, 1, 1)) is None

    async def test_latest_price(self, seeded):
        row = await seeded.get_latest_price("aapl")
        assert row.date == date(2026, 10, 9)
        assert await seeded.get_latest_price("NVDA") is None

    async def test_latest_prices_for_symbols(self, seeded):
        out = await seeded.get_latest_prices_for_symbols(["aapl", "MSFT", "nvda"])
        assert out["AAPL"]["date"] == "2026-10-09"
        assert out["AAPL"]["close"] == 104.0
        assert out["AAPL"]["exchange"] == "NASDAQ"
        assert out["AAPL"]["open"] is None
        assert out["MSFT"]["close"] == 300.0
        assert out["NVDA"] is None
        assert await seeded.get_latest_prices_for_symbols([]) == {}

    async def test_missing_ranges_skip_weekends_and_group_gaps(self, seeded):
        # Mon 10-05 .. Tue 10-13; Wed 10-07 missing, then Mon-Tue 10-12/13.
        ranges = await seeded.get_missing_date_ranges(
            "AAPL", date(2026, 10, 5), date(2026, 10, 13)
        )
        assert ranges == [
            (date(2026, 10, 7), date(2026, 10, 7)),
            (date(2026, 10, 12), date(2026, 10, 13)),
        ]

    async def test_missing_ranges_empty_when_complete(self, seeded):
        assert (
            await seeded.get_missing_date_ranges(
                "AAPL", date(2026, 10, 8), date(2026, 10, 9)
            )
            == []
        )

    async def test_coverage_stats(self, seeded):
        stats = await seeded.get_data_coverage_stats("AAPL")
        assert stats["min_date"] == "2026-10-05"
        assert stats["max_date"] == "2026-10-09"
        assert stats["total_days"] == 5
        assert stats["data_points"] == 4
        assert stats["coverage_percentage"] == 80.0

    async def test_coverage_stats_without_data(self, seeded):
        stats = await seeded.get_data_coverage_stats("NVDA")
        assert stats["data_points"] == 0
        assert stats["min_date"] is None


class _RecordingSession:
    """Just the AsyncSession surface bulk_upsert_prices touches."""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.statements = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, stmt):
        if self.fail:
            raise RuntimeError("db down")
        self.statements.append(stmt)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def _bound_rows(stmt) -> list[dict]:
    params = stmt.compile(dialect=postgresql.dialect()).params
    rows: dict[int, dict] = {}
    for key, value in params.items():
        name, _, idx = key.rpartition("_m")
        if name and idx.isdigit():
            rows.setdefault(int(idx), {})[name] = value
    return [rows[i] for i in sorted(rows)]


def _item(symbol: str, close, **kw) -> dict:
    return {"symbol": symbol, "market": "US", "date": date(2026, 10, 9), "close": close, **kw}


@pytest.mark.unit
@pytest.mark.asyncio
class TestBulkUpsert:
    async def test_empty_input_writes_nothing(self):
        session = _RecordingSession()
        assert await HistoricalPriceRepository(session).bulk_upsert_prices([]) == 0
        assert session.statements == []

    async def test_skips_non_finite_and_non_positive_closes(self):
        session = _RecordingSession()
        written = await HistoricalPriceRepository(session).bulk_upsert_prices(
            [
                _item("AAPL", 104.5, open="NaN", high=None, volume=7),
                _item("MSFT", float("nan")),
                _item("NVDA", 0),
            ]
        )
        assert written == 1
        assert session.commits == 1
        rows = _bound_rows(session.statements[0])
        assert len(rows) == 1
        assert rows[0]["close"] == Decimal("104.5")
        assert rows[0]["open"] is None  # non-finite optional field dropped
        assert rows[0]["volume"] == 7
        assert rows[0]["source"] == "finlab"

    async def test_symbol_is_canonicalised_on_write(self):
        session = _RecordingSession()
        await HistoricalPriceRepository(session).bulk_upsert_prices(
            [_item("0050.TW", 150, market="TW")]
        )
        assert _bound_rows(session.statements[0])[0]["symbol"] == "0050"

    async def test_invalidates_cached_entries_for_written_symbols(self):
        _hcache_set("historical_prices:batch:AAPL:x:y", {"AAPL": []}, 60)
        _hcache_set("historical_prices:batch:MSFT:x:y", {"MSFT": []}, 60)
        await HistoricalPriceRepository(_RecordingSession()).bulk_upsert_prices(
            [_item("AAPL", 1)]
        )
        assert _hcache_get("historical_prices:batch:AAPL:x:y") is None
        assert _hcache_get("historical_prices:batch:MSFT:x:y") == {"MSFT": []}

    async def test_rolls_back_and_reraises_on_db_error(self):
        session = _RecordingSession(fail=True)
        with pytest.raises(RuntimeError):
            await HistoricalPriceRepository(session).bulk_upsert_prices(
                [_item("AAPL", 1)]
            )
        assert session.rollbacks == 1
        assert session.commits == 0


@pytest.mark.unit
def test_expired_cache_entry_is_evicted(monkeypatch):
    _hcache_set("k", "v", ttl=10)
    now = repo_module._time.time()
    monkeypatch.setattr(repo_module._time, "time", lambda: now + 11)
    assert _hcache_get("k") is None
    assert "k" not in _hist_cache
