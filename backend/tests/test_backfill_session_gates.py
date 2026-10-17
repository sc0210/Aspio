"""The backfill scripts store a bar only once its session has closed — the same
rule the regular sync applies. Each script runs against fakes with a pinned clock;
the session logic itself is the real `session_closed`."""

import importlib.util
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from functools import partial
from pathlib import Path

import pytest

from app.utils.market_sessions import session_closed

pytestmark = pytest.mark.unit

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeRepo:
    written: list = []

    def __init__(self, session):
        pass

    async def get_price_history(self, symbol, start, end):
        return []

    async def bulk_upsert_prices(self, rows):
        FakeRepo.written.extend(rows)
        return len(rows)


@asynccontextmanager
async def fake_session():
    yield object()


def bar(d: date, close=100.0):
    return {"date": d.isoformat(), "close": close}


@pytest.fixture(autouse=True)
def _clear():
    FakeRepo.written = []


@pytest.mark.asyncio
async def test_fx_backfill_skips_a_bar_whose_london_day_is_not_over(monkeypatch):
    mod = load("backfill_fx_history")
    now = datetime(2026, 10, 8, 14, 0, tzinfo=timezone.utc)  # 15:00 London on the 8th

    class Svc:
        async def get_historical_data(self, symbol, market, days):
            return [bar(date(2026, 10, 7)), bar(date(2026, 10, 8))]

    monkeypatch.setattr(mod, "get_market_data_service", lambda: Svc())
    monkeypatch.setattr(mod, "async_session", fake_session)
    monkeypatch.setattr(mod, "HistoricalPriceRepository", FakeRepo)
    monkeypatch.setattr(mod, "session_closed", partial(session_closed, now=now))

    await mod.run(5, dry_run=False)
    assert [r["date"] for r in FakeRepo.written] == [date(2026, 10, 7)]


@pytest.mark.asyncio
async def test_price_gap_backfill_skips_an_unfinished_session_and_counts_it_missing(monkeypatch):
    mod = load("backfill_price_gaps")
    now = datetime(2026, 10, 8, 3, 0, tzinfo=timezone.utc)  # 11:00 Taipei: TW still trading

    async def symbols(session, only, include_closed=False):
        return {"0050": "TW"}

    async def window(service, symbol, market, days):
        return [bar(date(2026, 10, 7)), bar(date(2026, 10, 8))]

    class FrozenDate(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 8)

    monkeypatch.setattr(mod, "get_market_data_service", lambda: object())
    monkeypatch.setattr(mod, "async_session", fake_session)
    monkeypatch.setattr(mod, "HistoricalPriceRepository", FakeRepo)
    monkeypatch.setattr(mod, "_load_symbols", symbols)
    monkeypatch.setattr(mod, "_fetch_window", window)
    monkeypatch.setattr(mod, "session_closed", partial(session_closed, now=now))
    monkeypatch.setattr(mod, "date", FrozenDate)

    stats = await mod.backfill(3, dry_run=False, only=[])
    assert [r["date"] for r in FakeRepo.written] == [date(2026, 10, 7)]
    assert stats["still_missing"] >= 1  # today's gap stays reported, not filled with a provisional bar
