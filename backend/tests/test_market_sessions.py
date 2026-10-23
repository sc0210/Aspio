"""A price fetched while the market is open is not that day's close.

Asking a provider for a range that includes today returns a bar for the day in
progress, whose "close" is just the last trade so far. Stored as the closing price
it stood as fact until some later fetch overwrote it — a US holding sat in the
history at a price from 90 minutes into the session, and every figure built on that
day moved overnight with nothing having happened.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.utils.market_sessions import session_closed

# 2026-09-21 was a Monday. 15:08 UTC is 11:08 in New York (open) and 23:08 in
# Taipei (long shut) — the exact moment the real regression was written.
MID_US_SESSION = datetime(2026, 9, 21, 15, 8, tzinfo=timezone.utc)
AFTER_US_CLOSE = datetime(2026, 9, 21, 21, 0, tzinfo=timezone.utc)
MONDAY = date(2026, 9, 21)
FRIDAY_BEFORE = date(2026, 9, 18)


class TestUSMarket:
    def test_today_is_not_closed_while_the_session_runs(self):
        assert session_closed("US", MONDAY, MID_US_SESSION) is False

    def test_today_is_closed_after_the_bell(self):
        assert session_closed("US", MONDAY, AFTER_US_CLOSE) is True

    def test_an_earlier_date_is_always_closed(self):
        assert session_closed("US", FRIDAY_BEFORE, MID_US_SESSION) is True

    def test_a_future_date_never_is(self):
        assert session_closed("US", date(2026, 9, 22), AFTER_US_CLOSE) is False

    def test_the_grace_period_waits_for_the_official_print(self):
        just_after_bell = datetime(2026, 9, 21, 20, 5, tzinfo=timezone.utc)  # 16:05 ET
        assert session_closed("US", MONDAY, just_after_bell) is False


class TestTaiwanMarket:
    def test_closed_by_the_time_the_us_opens(self):
        # 15:08 UTC is 23:08 in Taipei: that Monday finished nine hours earlier.
        assert session_closed("TW", MONDAY, MID_US_SESSION) is True

    def test_still_open_mid_morning(self):
        mid_morning = datetime(2026, 9, 21, 2, 0, tzinfo=timezone.utc)  # 10:00 TST
        assert session_closed("TW", MONDAY, mid_morning) is False


class TestEverythingElse:
    @pytest.mark.parametrize("market", ["CRYPTO", "crypto", "", None, "LSE"])
    def test_markets_without_a_session_are_never_withheld(self, market):
        """Crypto never closes, and an unmodelled market must not lose its prices."""
        assert session_closed(market, MONDAY, MID_US_SESSION) is True


@pytest.mark.asyncio
async def test_the_write_path_drops_a_bar_for_an_open_session(monkeypatch):
    """The provider's last bar is the day in progress; it must not be stored."""
    from unittest.mock import AsyncMock, MagicMock

    from app.modules.portfolio import historical_price_service as svc

    market_data = MagicMock()
    market_data.get_historical_data = AsyncMock(
        return_value=[
            {"date": "2026-09-18", "open": 1, "high": 1, "low": 1, "close": 158.55, "volume": 1},
            {"date": "2026-09-21", "open": 1, "high": 1, "low": 1, "close": 160.375, "volume": 1},
        ]
    )
    service = svc.HistoricalPriceService(MagicMock(), market_data_service=market_data)

    stored: list = []

    class _Repo:
        def __init__(self, *_args, **_kwargs):
            pass

        async def bulk_upsert_prices(self, records):
            stored.extend(records)
            return len(records)

    monkeypatch.setattr(svc, "HistoricalPriceRepository", _Repo)
    # Monday's session is still running; Friday's finished.
    monkeypatch.setattr(svc, "session_closed", lambda market, d: d != MONDAY)

    async def _one_session():
        yield MagicMock()

    monkeypatch.setattr(svc, "get_db", _one_session)

    result = await service.fetch_and_store_historical_data(
        "VT", "US", date(2026, 9, 14), MONDAY, force_refresh=True
    )

    assert [r["date"] for r in stored] == [date(2026, 9, 18)], (
        f"Monday's in-progress bar should not be stored as a close (result={result})"
    )


@pytest.mark.asyncio
@pytest.mark.database
async def test_the_series_marks_a_day_it_had_to_price_from_a_live_quote(
    async_session, monkeypatch
):
    """A day with no published close yet is flagged, so the UI can say so.

    The clock is frozen to a known WEDNESDAY. This test used to read the real one and
    was therefore red every Saturday and Sunday: the series only appends days where
    `current_day.weekday() < 5` (performance_history.py, in the real path — the
    `weekday() >= 5` skips are the demo and fallback branches), so on a Saturday "today"
    is not in the series at all and the lookup raised KeyError. Nor can it just assert
    on the last point instead — on a Saturday that is Friday, whose close IS published,
    so it is settled and not provisional. The premise only exists on a trading day, so
    the day is pinned rather than discovered.
    """
    import uuid as uuid_module
    from decimal import Decimal
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from fastapi import BackgroundTasks

    from app.modules.portfolio.models import HistoricalPrice, Portfolio, PortfolioHolding
    from app.modules.portfolio.routers.performance_history import get_daily_performance

    user_id = uuid_module.uuid4()
    portfolio = Portfolio(
        id=uuid_module.uuid4(), user_id=user_id, name="P", is_default=True,
        currency="TWD",
    )
    async_session.add(portfolio)
    await async_session.flush()
    async_session.add(
        PortfolioHolding(
            id=uuid_module.uuid4(), portfolio_id=portfolio.id, user_id=user_id,
            symbol="0050", name="Yuanta 50", quantity=Decimal("100"),
            average_cost=Decimal("100"), current_price=Decimal("111"),
            currency="TWD", market="TW", type="stock", exchange="TWSE",
            total_cost=Decimal("10000"), total_value=Decimal("11100"),
            purchase_date=date(2026, 9, 1), is_active=True,
        )
    )
    # Yesterday has a published close; today does not yet — which is the whole point.
    #
    # Frozen, and to a Wednesday: both the day under test and the day before it have to
    # be trading days. The endpoint reads the business day through business_today() in
    # its own module namespace, so that is what gets patched — the host's clock and
    # zone then do not enter into it at all.
    import app.modules.portfolio.routers.performance_history as ph

    frozen = datetime(2026, 9, 23, 11, 0, tzinfo=ZoneInfo("Asia/Taipei"))
    assert frozen.weekday() == 2, "the fixed day must be a Wednesday"
    monkeypatch.setattr(ph, "business_today", lambda: frozen.date())

    today = frozen.date()
    yesterday = today - timedelta(days=1)
    async_session.add(
        HistoricalPrice(
            id=uuid_module.uuid4(), symbol="0050", market="TW", date=yesterday,
            close=Decimal("110"), source="test", currency="TWD",
        )
    )
    await async_session.commit()

    response = await get_daily_performance(
        background_tasks=BackgroundTasks(), days=5,
        current_user=SimpleNamespace(id=user_id), session=async_session,
    )
    points = response.data

    # Only yesterday has a stored close, so today has to fall back to a live price —
    # and it is the fallback, not the calendar, that makes a day provisional.
    assert points, "expected a series"
    by_date = {p["date"][:10]: p for p in points}

    # Today is priced from the live quote: still moving, and flagged.
    assert by_date[today.strftime("%Y-%m-%d")]["provisional"] is True
    # Yesterday's close is published, so its figure is settled. Unconditional: the day
    # is pinned to a Wednesday, so yesterday is always a Tuesday.
    assert by_date[yesterday.strftime("%Y-%m-%d")]["provisional"] is False


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_weekend_series_ends_on_friday_and_claims_nothing_about_saturday(
    async_session, monkeypatch
):
    """The weekend path, which the test above used to reach only by accident.

    That test read the real clock, so it exercised this on Saturdays and Sundays — by
    failing. Freezing it to a Wednesday fixed the failure and left this uncovered, so
    it is pinned deliberately here: on a Saturday the series ends on FRIDAY, and no
    point is emitted for the weekend at all.

    Note what that means for the flag: `provisional` is computed for Saturday and then
    dropped with it, so no emitted point can carry it — the flag is not what shows
    Friday to be settled. What shows that is its price, which comes from the stored
    close. A user opening the page on a Saturday sees a series whose last day is Friday
    and which claims nothing about today, and that is right, because no market moved.

    Still unpinned: a weekend where Friday's close has not synced yet. Friday is then
    carried forward, or priced from current_price, and `provisional` stays False because
    Friday is not end_date. Whether that should be flagged is a product question.
    """
    import uuid as uuid_module
    from decimal import Decimal
    from types import SimpleNamespace
    from fastapi import BackgroundTasks

    from app.modules.portfolio.models import HistoricalPrice, Portfolio, PortfolioHolding
    from app.modules.portfolio.routers.performance_history import get_daily_performance
    import app.modules.portfolio.routers.performance_history as ph

    saturday = datetime(2026, 9, 26, 11, 0, tzinfo=ZoneInfo("Asia/Taipei"))
    assert saturday.weekday() == 5, "the fixed day must be a Saturday"
    friday = saturday.date() - timedelta(days=1)
    monkeypatch.setattr(ph, "business_today", lambda: saturday.date())

    user_id = uuid_module.uuid4()
    portfolio = Portfolio(
        id=uuid_module.uuid4(), user_id=user_id, name="P", is_default=True,
        currency="TWD",
    )
    async_session.add(portfolio)
    await async_session.flush()
    async_session.add(
        PortfolioHolding(
            id=uuid_module.uuid4(), portfolio_id=portfolio.id, user_id=user_id,
            symbol="2330", name="TSMC", quantity=Decimal("100"),
            average_cost=Decimal("100"), current_price=Decimal("111"),
            currency="TWD", market="TW", type="stock", exchange="TWSE",
            total_cost=Decimal("10000"), total_value=Decimal("11100"),
            purchase_date=date(2026, 9, 1), is_active=True,
        )
    )
    async_session.add(
        HistoricalPrice(
            id=uuid_module.uuid4(), symbol="2330", market="TW", date=friday,
            close=Decimal("110"), source="test", currency="TWD",
        )
    )
    await async_session.commit()

    response = await get_daily_performance(
        background_tasks=BackgroundTasks(), days=5,
        current_user=SimpleNamespace(id=user_id), session=async_session,
    )
    points = response.data

    assert points, "expected a series"
    days_in_series = [p["date"][:10] for p in points]
    assert saturday.strftime("%Y-%m-%d") not in days_in_series
    assert days_in_series[-1] == friday.strftime("%Y-%m-%d")
    # Friday is priced from its STORED close (110 × 100 shares), not the live 111
    # quote — the assertion with something to catch.
    assert points[-1]["value"] == 11000.0
    # And the docstring's claim, made testable: only `current_day == end_date` can set
    # the flag, and the Saturday end_date points at is never emitted, so nothing in a
    # weekend series carries it.
    assert not any(p["provisional"] for p in points)
