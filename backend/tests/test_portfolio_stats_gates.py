"""Gates on the portfolio stats strip: when the annual return and beta are shown."""

from datetime import date

import pytest

from app.modules.portfolio.services import (
    MAX_PLAUSIBLE_BETA,
    TWR_MIN_REAL_PRICE_SHARE,
    annual_return_from_twr,
    plausible_beta,
)

pytestmark = pytest.mark.unit


def twr(ann, share):
    return {"annualized_return": ann, "data_quality": {"real_price_share": share}}


def test_annual_return_needs_real_prices():
    assert annual_return_from_twr(twr(0.404, TWR_MIN_REAL_PRICE_SHARE)) == pytest.approx(0.404)
    assert annual_return_from_twr(twr(0.376, 0.868)) is None  # the pre-backfill main account


def test_annual_return_needs_a_year_and_a_result():
    assert annual_return_from_twr(twr(None, 1.0)) is None
    assert annual_return_from_twr(None) is None
    assert annual_return_from_twr({"annualized_return": 0.1}) is None  # no quality block


def test_beta_needs_a_fresh_benchmark_and_a_plausible_value():
    today = date(2026, 10, 8)
    assert plausible_beta(0.95, date(2026, 10, 7), today) == 0.95
    assert plausible_beta(0.95, date(2026, 3, 13), today) is None  # SPY last refreshed in March
    assert plausible_beta(30.289, date(2026, 10, 7), today) is None  # the value that shipped
    assert plausible_beta(-MAX_PLAUSIBLE_BETA, date(2026, 10, 8), today) == -MAX_PLAUSIBLE_BETA
    assert plausible_beta(None, date(2026, 10, 8), today) is None
    assert plausible_beta(1.0, None, today) is None


def test_the_daily_sync_refreshes_the_benchmarks_nobody_holds():
    import inspect
    from app.core import scheduler

    src = inspect.getsource(scheduler.sync_historical_data_for_all_users)
    assert 'symbol_markets.setdefault("SPY", "US")' in src
    assert 'symbol_markets.setdefault("^TWII", "TW-INDEX")' in src
    assert 'symbol_markets.setdefault("VT", "US")' in src
    assert "FX_SERIES" in src


def test_a_taiex_bar_from_the_running_session_is_not_a_close():
    from datetime import datetime, timezone
    from app.utils.market_sessions import session_closed

    d = date(2026, 10, 8)
    # 12:00 Taipei (04:00 UTC): TAIEX still trading — the bar is provisional.
    assert session_closed("TW-INDEX", d, datetime(2026, 10, 8, 4, 0, tzinfo=timezone.utc)) is False
    # 14:30 Taipei: closed, past the grace period.
    assert session_closed("TW-INDEX", d, datetime(2026, 10, 8, 6, 30, tzinfo=timezone.utc)) is True


@pytest.mark.asyncio
async def test_the_taiex_is_fetched_from_yahoo_with_its_symbol_unchanged():
    from unittest.mock import AsyncMock, patch
    from app.modules.portfolio.market_data_service import get_market_data_service

    svc = get_market_data_service()
    with patch.object(svc, "_get_yahoo_historical", new=AsyncMock(return_value=[{"date": "2026-10-08", "close": 1}])) as yahoo, \
         patch.object(svc, "enable_yahoo", True):
        bars = await svc.get_historical_data("^TWII", "TW-INDEX", 30)
    yahoo.assert_awaited_once_with("^TWII", 30)  # not "^TWII.TW", not FinLab
    assert bars


def test_a_usd_twd_bar_is_final_only_once_its_london_day_is_over():
    from datetime import datetime, timezone
    from app.utils.market_sessions import session_closed

    d = date(2026, 10, 8)  # Yahoo dates TWD=X at London midnight
    assert session_closed("FX", d, datetime(2026, 10, 8, 14, 58, tzinfo=timezone.utc)) is False  # 22:58 Taipei, London afternoon
    assert session_closed("FX", d, datetime(2026, 10, 8, 22, 30, tzinfo=timezone.utc)) is False  # 23:30 London, still the 8th
    assert session_closed("FX", d, datetime(2026, 10, 8, 23, 10, tzinfo=timezone.utc)) is True   # 00:10 London on the 9th: day over


def test_the_fx_day_boundary_follows_london_in_winter_too():
    from datetime import datetime, timezone
    from app.utils.market_sessions import session_closed

    d = date(2026, 12, 8)  # GMT, +00:00
    assert session_closed("FX", d, datetime(2026, 12, 8, 23, 30, tzinfo=timezone.utc)) is False
    assert session_closed("FX", d, datetime(2026, 12, 9, 0, 10, tzinfo=timezone.utc)) is True


@pytest.mark.asyncio
async def test_usd_twd_is_fetched_from_yahoo_with_its_symbol_unchanged():
    from unittest.mock import AsyncMock, patch
    from app.modules.portfolio.market_data_service import get_market_data_service

    svc = get_market_data_service()
    with patch.object(svc, "_get_yahoo_historical", new=AsyncMock(return_value=[])) as yahoo, \
         patch.object(svc, "enable_yahoo", True):
        await svc.get_historical_data("TWD=X", "FX", 30)
    yahoo.assert_awaited_once_with("TWD=X", 30)


def test_the_fx_day_is_25_hours_on_the_october_clock_change():
    from datetime import datetime, timezone
    from app.utils.market_sessions import session_closed

    d = date(2026, 10, 25)  # BST ends 01:00 UTC; the London day of the 25th runs to 00:00 GMT = 00:00 UTC on the 26th
    assert session_closed("FX", d, datetime(2026, 10, 25, 23, 30, tzinfo=timezone.utc)) is False  # 23:30 GMT, still the 25th
    assert session_closed("FX", d, datetime(2026, 10, 26, 0, 10, tzinfo=timezone.utc)) is True   # 00:10 GMT on the 26th
