"""Which close a holding's day change is measured against (portfolio/day_change.py)."""

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.modules.portfolio import day_change
from app.modules.portfolio.day_change import (
    choose_previous_close,
    freshest_series,
    is_price_stale,
    previous_session,
    resolve_day_change,
    session_before,
)


def bars(*pairs):
    return [{"date": d, "close": c} for d, c in pairs]


def days(*isos):
    return {date.fromisoformat(d) for d in isos}


TODAY = date(2026, 11, 13)  # a Friday
TW_DAYS = days("2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13")


@pytest.mark.unit
class TestChoosePreviousClose:
    def test_official_bar_beats_the_stored_quote(self):
        """2026-11-13: Yahoo's previous close for 0050 read 100.85; TWSE closed
        it at 100.95. The page used one and the P&L calendar the other."""
        series = bars(("2026-11-11", 103.20), ("2026-11-12", 100.95), ("2026-11-13", 102.50))
        assert choose_previous_close(
            Decimal("100.85"), series, date(2026, 11, 13), TODAY, market_days=TW_DAYS
        ) == Decimal("100.95")

    def test_base_is_the_session_before_the_prices_own(self):
        """A US price fetched before New York opens is the previous session's
        close, so its base is the session before that, not the bar before today."""
        series = bars(("2026-11-11", 156.71), ("2026-11-12", 155.75))
        assert choose_previous_close(
            Decimal("156.01"), series, date(2026, 11, 12), TODAY
        ) == Decimal("156.71")

    def test_a_gap_in_the_series_falls_back_to_the_stored_quote(self):
        """2026-08-14: the sync lacked 0050's 08-13 bar while the market traded
        (other symbols have it), so the last bar was two sessions old."""
        series = bars(("2026-08-11", 104.0), ("2026-08-12", 105.20))
        market = days("2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14")
        assert choose_previous_close(
            Decimal("106.65"), series, date(2026, 8, 14), date(2026, 8, 14), market_days=market
        ) == Decimal("106.65")

    def test_a_gap_with_no_stored_quote_is_no_day_change_not_a_two_day_one(self):
        series = bars(("2026-11-10", 99.70))  # 11-11 and 11-12 missing for this symbol
        assert choose_previous_close(
            None, series, date(2026, 11, 13), TODAY, market_days=TW_DAYS
        ) is None

    def test_the_day_after_a_holiday_uses_the_last_real_session(self):
        """TW shut on Friday 10-10: Monday's base is Thursday's bar, not the
        unreliable stored quote the weekday arithmetic used to fall back to."""
        series = bars(("2026-10-08", 98.0), ("2026-10-09", 99.0))
        market = days("2026-10-08", "2026-10-09", "2026-10-13")
        assert choose_previous_close(
            Decimal("98.5"), series, date(2026, 10, 13), date(2026, 10, 13), market_days=market
        ) == Decimal("99.0")

    def test_monday_uses_fridays_bar(self):
        series = bars(("2026-11-13", 102.50))
        assert choose_previous_close(
            Decimal("1"), series, date(2026, 11, 16), date(2026, 11, 16)
        ) == Decimal("102.50")

    def test_without_the_calendar_the_last_recent_bar_is_used(self):
        series = bars(("2026-11-10", 99.70))
        assert choose_previous_close(None, series, date(2026, 11, 13), TODAY) == Decimal("99.70")

    def test_a_stale_price_is_never_measured_against_a_newer_close(self):
        """scd***'s BTC-USD was priced 2025-10-21 with no stored close; the bar
        before today was last week's 75,053, so it read -30.72% "today"."""
        series = bars(("2026-11-11", 75053.42), ("2026-11-12", 75100.0))
        assert choose_previous_close(None, series, date(2025, 10, 21), TODAY) is None

    def test_a_bar_older_than_a_week_is_not_called_the_previous_session(self):
        series = bars(("2026-10-30", 90.0))
        assert choose_previous_close(None, series, None, TODAY) is None

    @pytest.mark.parametrize("stored", [None, Decimal("0"), Decimal("-1")])
    def test_an_unusable_stored_quote_does_not_mask_the_fallback(self, stored):
        series = bars(("2026-11-12", 100.95))
        assert choose_previous_close(stored, series, None, TODAY) == Decimal("100.95")

    def test_a_hand_priced_holding_has_no_previous_close(self):
        """The demo BTC-USD (crypto is hand-priced) showed -9.40% "today": its
        typed price against the market's last close."""
        series = bars(("2026-11-12", 75053.42))
        assert choose_previous_close(
            Decimal("75000"), series, None, TODAY, manually_priced=True
        ) is None

    def test_nothing_to_go_on(self):
        assert choose_previous_close(None, [], date(2026, 11, 13), TODAY) is None


@pytest.mark.unit
class TestPriceStale:
    def test_two_sessions_behind_is_stale(self):
        # scd***'s prices stuck at Tuesday 11-10 while the market traded on.
        assert is_price_stale(date(2026, 11, 10), TODAY, False, TW_DAYS)

    def test_one_session_behind_is_normal(self):
        assert not is_price_stale(date(2026, 11, 12), TODAY, False, TW_DAYS)

    def test_a_holiday_week_is_not_staleness(self):
        """Lunar New Year: the market itself has no sessions since the price."""
        new_year = days("2026-02-11", "2026-02-12")
        assert not is_price_stale(date(2026, 2, 12), date(2026, 2, 20), False, new_year)

    def test_a_dead_history_still_shows_staleness_after_two_weeks(self):
        assert is_price_stale(date(2026, 10, 20), TODAY, False, days("2026-10-20"))

    def test_hand_priced_and_unknown_are_never_stale(self):
        assert not is_price_stale(date(2025, 1, 1), TODAY, True, TW_DAYS)
        assert not is_price_stale(None, TODAY, False, TW_DAYS)


@pytest.mark.unit
def test_session_helpers():
    assert session_before(date(2026, 11, 16)) == date(2026, 11, 13)
    assert previous_session(date(2026, 10, 13), days("2026-10-08", "2026-10-09")) == date(2026, 10, 9)
    assert previous_session(date(2026, 11, 13), None) == date(2026, 11, 12)


@pytest.mark.unit
def test_freshest_series_ignores_a_dead_key():
    prices = {
        "0050.TW": bars(("2026-07-24", 90.0)),
        "0050": bars(("2026-11-12", 100.95)),
    }
    assert freshest_series(prices, ["0050.TW", "0050"])[-1]["close"] == 100.95


class FakeRepo:
    calls: list = []
    fail = False

    def __init__(self, session):
        pass

    async def get_batch_price_history(self, symbols, start, end):
        FakeRepo.calls.append(symbols)
        if FakeRepo.fail:
            raise RuntimeError("statement timeout")
        return {
            "0050": bars(("2026-11-12", 100.95)),
            "0050.TW": [],
            "VT": bars(("2026-11-11", 156.71), ("2026-11-12", 155.75)),
        }

    async def get_market_days(self, start, end):
        return {"TW": set(TW_DAYS), "US": days("2026-11-10", "2026-11-11", "2026-11-12")}


HOLDINGS = [
    SimpleNamespace(  # TW price stamped after the 11-13 close
        symbol="0050", market="TW", type="etf", previous_close=Decimal("100.85"),
        last_price_update_at=datetime(2026, 11, 13, 14, 12, tzinfo=timezone.utc),
    ),
    {  # a dict, as the router passes them; 09:12 New York = the 11-12 session
        "symbol": "VT", "market": "US", "type": "etf", "previous_close": Decimal("156.01"),
        "last_price_update_at": datetime(2026, 11, 13, 14, 12, tzinfo=timezone.utc),
    },
]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_day_change_batches_and_applies_the_rule():
    FakeRepo.calls, FakeRepo.fail = [], False
    with patch.object(day_change, "HistoricalPriceRepository", FakeRepo):
        result = await resolve_day_change(None, HOLDINGS, TODAY)

    assert [b.previous_close for b in result] == [Decimal("100.95"), Decimal("156.71")]
    assert [b.price_stale for b in result] == [False, False]
    assert len(FakeRepo.calls) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_a_failed_history_read_falls_back_to_the_stored_quotes():
    """The dashboard summary dropped to NT$0 when this query raised."""
    FakeRepo.calls, FakeRepo.fail = [], True
    with patch.object(day_change, "HistoricalPriceRepository", FakeRepo):
        result = await resolve_day_change(None, HOLDINGS, TODAY)

    assert [b.previous_close for b in result] == [Decimal("100.85"), Decimal("156.01")]



PG_URL = __import__("os").environ.get("ASPIRO_PG_LOCK_TEST_URL", "")


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.skipif(not PG_URL.startswith("postgresql"), reason="needs ASPIRO_PG_LOCK_TEST_URL")
async def test_a_failed_read_leaves_the_callers_session_usable_on_postgres():
    """Postgres aborts the whole transaction on a failed statement; without a
    savepoint the dashboard's next query failed too. SQLite cannot show this.

        ASPIRO_PG_LOCK_TEST_URL=postgresql+asyncpg://user:pass@host:5432/db \\
            python -m pytest tests/test_day_change.py -m integration -o "addopts="
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    engine = create_async_engine(PG_URL, connect_args={"statement_cache_size": 0})

    class BrokenRepo(FakeRepo):
        def __init__(self, session):
            self.session = session

        async def get_batch_price_history(self, symbols, start, end):
            await self.session.execute(text("SELECT * FROM no_such_table_for_day_change"))

    try:
        async with AsyncSession(engine) as session:
            await session.execute(text("SELECT 1"))  # the caller's transaction is open
            with patch.object(day_change, "HistoricalPriceRepository", BrokenRepo):
                result = await resolve_day_change(session, HOLDINGS, TODAY)
            assert [b.previous_close for b in result] == [Decimal("100.85"), Decimal("156.01")]
            assert (await session.execute(text("SELECT 1"))).scalar() == 1
    finally:
        await engine.dispose()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_both_history_reads_run_in_a_savepoint():
    """The Postgres test above shows why; this one runs in CI and fails if a
    read loses its savepoint."""
    import contextlib

    opened = []

    class Session:
        def begin_nested(self):
            opened.append(1)
            return contextlib.nullcontext()

    FakeRepo.calls, FakeRepo.fail = [], False
    with patch.object(day_change, "HistoricalPriceRepository", FakeRepo):
        await resolve_day_change(Session(), HOLDINGS, TODAY)
    assert len(opened) == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_the_dashboard_leaves_a_stale_price_out_of_todays_change():
    from unittest.mock import AsyncMock, Mock

    from app.modules.dashboard.services import DashboardService
    from app.modules.portfolio.day_change import DayChangeBase

    db = AsyncMock()
    result = Mock()
    result.scalars.return_value.all.return_value = [Mock()]  # one active portfolio
    db.execute = AsyncMock(return_value=result)

    def lot(symbol, price):
        return SimpleNamespace(
            symbol=symbol, name=symbol, currency="TWD", quantity=Decimal("10"),
            current_price=Decimal(price), total_value=Decimal(price) * 10, total_cost=Decimal("1000"),
        )

    bases = [DayChangeBase(Decimal("100"), False), DayChangeBase(Decimal("2000"), True)]
    with patch.object(day_change, "resolve_day_change", AsyncMock(return_value=bases)):
        summary = await DashboardService(db)._get_portfolio_summary(
            "11111111-1111-1111-1111-111111111111",
            holdings=[lot("0050", "102.5"), lot("2330", "2285")],
        )

    assert summary["day_change"] == Decimal("25")  # (102.5 - 100) × 10; 2330's old move left out
    assert summary["day_change_percentage"] == 2.5
