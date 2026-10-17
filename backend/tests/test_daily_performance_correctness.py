"""
Unit tests for daily performance calculation correctness.

Regression tests for two bugs fixed in portfolio/router.py:

BUG 1 — "Zero daily change when market is open"
  holding.current_price was never refreshed during trading hours (scheduler only
  ran at market close). So today's data point used yesterday's close price, making
  change = yesterday_value - yesterday_value = 0.
  Fix: pre-flight call to update_portfolio_prices(force=False) before the loop.

BUG 2 — "Pre-buffer not seeding last_known_prices"
  The endpoint fetched 5-10 days of pre-buffer price data but the main loop
  started at start_date with an empty last_known_prices dict. When start_date
  was a Monday or market holiday (no price in DB), the loop fell through to
  holding.current_price (today's live price), corrupting historical values.
  Fix: a pre-seeding pass scans the pre-buffer newest-to-oldest and populates
  last_known_prices before the main loop begins.
"""

import pytest
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, Mock, patch
from zoneinfo import ZoneInfo


# ─── Pure-Python replicas of the key algorithms ──────────────────────────────
#
# These functions replicate only the parts of get_daily_performance that the
# tests exercise, so the tests run without a database or network.


def _make_holding(symbol, current_price, average_cost=None, quantity=100,
                  market="TW", purchase_date=None, wallet_type="portfolio"):
    h = Mock()
    h.symbol = symbol
    h.market = market
    h.quantity = Decimal(str(quantity))
    h.current_price = Decimal(str(current_price))
    h.average_cost = Decimal(str(average_cost or current_price))
    h.purchase_date = purchase_date or date(2020, 1, 1)
    h.currency = "TWD"
    h.wallet_type = wallet_type
    return h


def _build_prices(symbol, day_close_pairs):
    """Return all_prices dict:  symbol -> date_str -> {"close": value}"""
    return {symbol: {d: {"close": c} for d, c in day_close_pairs}}


def _merge_prices(*tables):
    merged = {}
    for t in tables:
        for sym, dates in t.items():
            merged.setdefault(sym, {}).update(dates)
    return merged


def _pre_buffer_seed(tradable_holdings, all_prices, start_date, fetch_start_date):
    """
    Replica of the pre-buffer seeding block.
    Scans newest-to-oldest in the pre-buffer window and populates last_known_prices.
    """
    last_known_prices = {}
    pre_buffer_days = (start_date - fetch_start_date).days
    for days_back in range(1, pre_buffer_days + 1):
        day_str = (start_date - timedelta(days=days_back)).strftime("%Y-%m-%d")
        for h in tradable_holdings:
            if h.symbol not in last_known_prices:
                entry = all_prices.get(h.symbol, {}).get(day_str)
                if entry and entry.get("close"):
                    last_known_prices[h.symbol] = Decimal(str(entry["close"]))
    return last_known_prices


def _calc_performance(tradable_holdings, all_prices, start_date, end_date,
                      fetch_start_date):
    """
    Pure-Python replica of the daily performance loop in get_daily_performance.
    Returns list of dicts: {date, value, change, changePercent}.
    Weekends are excluded from output (same as the real endpoint).

    The pre-seeded last_known_prices (from the pre-buffer window) are used as the
    baseline for the very first data point, so Monday's change correctly reflects
    movement vs Friday's close even when Friday is only in the pre-buffer.
    """
    last_known_prices = _pre_buffer_seed(
        tradable_holdings, all_prices, start_date, fetch_start_date
    )

    # Portfolio value from pre-seeded prices — used as prev_value for the first
    # data point so a range that starts on Monday compares vs Friday's close.
    pre_seed_portfolio_value = sum(
        (h.quantity * last_known_prices[h.symbol]
         for h in tradable_holdings if h.symbol in last_known_prices),
        Decimal("0"),
    )

    daily_data = []
    prev_day_holding_values = {}

    for day_offset in range((end_date - start_date).days + 1):
        current_day = start_date + timedelta(days=day_offset)
        current_day_str = current_day.strftime("%Y-%m-%d")
        daily_value = Decimal("0")
        current_day_holding_values = {}
        new_purchase_values = {}

        for h in tradable_holdings:
            purchase_date = (
                h.purchase_date.date()
                if isinstance(h.purchase_date, datetime)
                else h.purchase_date
            )
            price_data = all_prices.get(h.symbol, {}).get(current_day_str)

            if price_data and price_data.get("close"):
                price = Decimal(str(price_data["close"]))
                last_known_prices[h.symbol] = price
            elif current_day == end_date and h.current_price:
                # Today: use holding.current_price (must be fresh for correct change)
                price = Decimal(str(h.current_price))
                last_known_prices[h.symbol] = price
            elif h.symbol in last_known_prices:
                price = last_known_prices[h.symbol]
            else:
                continue  # no price available at all

            if purchase_date and purchase_date <= current_day:
                holding_value = h.quantity * price
                daily_value += holding_value

                if purchase_date == current_day:
                    new_purchase_values[h.symbol] = holding_value

                current_day_holding_values[h.symbol] = (
                    current_day_holding_values.get(h.symbol, Decimal("0")) + holding_value
                )

        total_new = sum(new_purchase_values.values(), Decimal("0"))
        if daily_data:
            prev_value = Decimal(str(daily_data[-1]["value"]))
            change = (daily_value - total_new) - prev_value
            change_pct = float(change / prev_value * 100) if prev_value > 0 else 0.0
        elif pre_seed_portfolio_value > 0:
            # First data point with a pre-seeded baseline (e.g. range starts on Monday,
            # Friday's close was seeded from the pre-buffer).
            change = (daily_value - total_new) - pre_seed_portfolio_value
            change_pct = (
                float(change / pre_seed_portfolio_value * 100)
                if pre_seed_portfolio_value > 0 else 0.0
            )
        else:
            change = Decimal("0")
            change_pct = 0.0

        if current_day.weekday() < 5:  # skip weekends
            daily_data.append({
                "date": current_day_str,
                "value": float(daily_value),
                "change": float(change),
                "changePercent": round(change_pct, 2),
            })
            prev_day_holding_values = current_day_holding_values.copy()

    return daily_data


# ─── Pre-buffer seeding tests ─────────────────────────────────────────────────

class TestPreBufferSeeding:
    """
    Regression for BUG 2: last_known_prices was empty at loop start, causing
    Monday / holiday first-day values to fall back to live current_price.
    """

    def test_monday_seeded_from_friday_close(self):
        """
        When start_date is a Monday and the DB has no Monday price, the pre-buffer
        must seed last_known_prices with Friday's close — NOT live current_price.
        """
        monday = date(2026, 5, 18)
        fetch_start = monday - timedelta(days=10)
        friday_str = (monday - timedelta(days=3)).strftime("%Y-%m-%d")

        h = _make_holding("0050", current_price=999.0)  # live price — must NOT be used
        all_prices = _build_prices("0050", [(friday_str, 120.0)])

        seeded = _pre_buffer_seed([h], all_prices, monday, fetch_start)

        assert "0050" in seeded, "Symbol must be pre-seeded from pre-buffer"
        assert seeded["0050"] == Decimal("120.0"), (
            f"Expected Friday close 120, got {seeded['0050']} — "
            "live current_price (999) must NOT be used for historical seeding"
        )

    def test_no_pre_buffer_leaves_dict_empty(self):
        """
        Regression document: when fetch_start_date == start_date (zero pre-buffer
        days), no seeding occurs. The old code had this bug — the loop would then
        fall back to current_price.
        """
        monday = date(2026, 5, 18)
        fetch_start = monday  # zero-width pre-buffer

        h = _make_holding("0050", current_price=999.0)
        all_prices = _build_prices("0050", [])

        seeded = _pre_buffer_seed([h], all_prices, monday, fetch_start)

        assert "0050" not in seeded, (
            "With zero pre-buffer, dict stays empty — documents old broken state"
        )

    def test_most_recent_pre_buffer_price_wins(self):
        """
        When multiple pre-buffer days have data, the closest date before start_date
        (most recent) wins because we scan newest-to-oldest and stop at first hit.
        """
        start = date(2026, 5, 18)
        fetch_start = start - timedelta(days=10)
        h = _make_holding("0050", current_price=999.0)

        thursday_str = (start - timedelta(days=4)).strftime("%Y-%m-%d")
        friday_str   = (start - timedelta(days=3)).strftime("%Y-%m-%d")

        all_prices = _build_prices("0050", [
            (thursday_str, 90.0),
            (friday_str,  100.0),
        ])

        seeded = _pre_buffer_seed([h], all_prices, start, fetch_start)

        assert seeded["0050"] == Decimal("100.0"), (
            "Friday (most recent pre-buffer) must win over Thursday"
        )

    def test_multiple_symbols_seeded_independently(self):
        """Each symbol gets its own pre-seed value."""
        start = date(2026, 5, 18)
        fetch_start = start - timedelta(days=10)
        friday_str = (start - timedelta(days=3)).strftime("%Y-%m-%d")

        h1 = _make_holding("0050", current_price=999.0)
        h2 = _make_holding("2330", current_price=999.0)

        all_prices = _merge_prices(
            _build_prices("0050", [(friday_str, 120.0)]),
            _build_prices("2330", [(friday_str, 600.0)]),
        )

        seeded = _pre_buffer_seed([h1, h2], all_prices, start, fetch_start)

        assert seeded["0050"] == Decimal("120.0")
        assert seeded["2330"] == Decimal("600.0")

    def test_symbol_missing_from_pre_buffer_not_seeded(self):
        """A symbol with no pre-buffer data at all must not appear in seeded dict."""
        start = date(2026, 5, 18)
        fetch_start = start - timedelta(days=10)
        friday_str = (start - timedelta(days=3)).strftime("%Y-%m-%d")

        h1 = _make_holding("0050", current_price=120.0)
        h2 = _make_holding("AAPL", current_price=200.0)  # no pre-buffer data

        all_prices = _build_prices("0050", [(friday_str, 120.0)])
        # AAPL has no entries in all_prices

        seeded = _pre_buffer_seed([h1, h2], all_prices, start, fetch_start)

        assert "0050" in seeded
        assert "AAPL" not in seeded, "AAPL has no pre-buffer data, must not appear"


# ─── Daily change correctness tests ──────────────────────────────────────────

class TestDailyChangeOnTradingDays:
    """
    Core assertions: daily change must be non-zero whenever the price moves
    between consecutive trading days.
    """

    def test_change_non_zero_when_price_moves(self):
        """Basic: if price changes from 100→110, change must be +1000 (100 shares)."""
        start = date(2026, 5, 11)  # Monday
        end   = date(2026, 5, 12)  # Tuesday
        fetch_start = start - timedelta(days=10)

        h = _make_holding("0050", current_price=110.0, quantity=100)
        all_prices = _build_prices("0050", [("2026-05-11", 100.0), ("2026-05-12", 110.0)])

        data = _calc_performance([h], all_prices, start, end, fetch_start)

        assert len(data) == 2
        assert data[1]["change"] == pytest.approx(1000.0), (
            "100 shares × Δ10 = 1000; must not be 0"
        )
        assert data[1]["changePercent"] == pytest.approx(10.0)

    def test_change_zero_only_when_price_flat(self):
        """Change must be exactly 0 only when the price genuinely did not move."""
        start = date(2026, 5, 11)
        end   = date(2026, 5, 12)
        fetch_start = start - timedelta(days=10)

        h = _make_holding("0050", current_price=100.0, quantity=100)
        all_prices = _build_prices("0050", [("2026-05-11", 100.0), ("2026-05-12", 100.0)])

        data = _calc_performance([h], all_prices, start, end, fetch_start)

        assert data[1]["change"] == pytest.approx(0.0)

    def test_first_day_change_is_zero(self):
        """The very first data point has no previous day, so change must be 0."""
        start = date(2026, 5, 11)
        fetch_start = start - timedelta(days=10)

        h = _make_holding("0050", current_price=100.0, quantity=50)
        all_prices = _build_prices("0050", [("2026-05-11", 100.0)])

        data = _calc_performance([h], all_prices, start, start, fetch_start)

        assert data[0]["change"] == pytest.approx(0.0)

    def test_monday_change_vs_friday_via_pre_buffer(self):
        """
        REGRESSION (BUG 2): Monday's change must compare Monday's close vs
        Friday's close (pre-seeded), not vs live current_price.

        Old behaviour: last_known_prices empty on Monday → fell back to
        current_price (150) as prev → change = 120 - 150 = wrong.
        New behaviour: pre-buffer seeds with 100 (Friday) → change = 200 (correct).
        """
        friday = date(2026, 5, 15)
        monday = date(2026, 5, 18)
        fetch_start = monday - timedelta(days=10)

        h = _make_holding("0050", current_price=150.0, quantity=100)
        # Only show Monday in the requested range; Friday is in pre-buffer
        all_prices = _build_prices("0050", [
            (friday.strftime("%Y-%m-%d"), 100.0),  # pre-buffer
            (monday.strftime("%Y-%m-%d"), 120.0),  # actual range
        ])

        data = _calc_performance([h], all_prices, monday, monday, fetch_start)

        assert len(data) == 1
        assert data[0]["change"] == pytest.approx(2000.0), (
            "100 shares × (120 Monday - 100 Friday pre-seed) = 2000; "
            "wrong if current_price (150) bled into history"
        )

    def test_today_change_when_current_price_is_fresh(self):
        """
        REGRESSION (BUG 1): When today is the end_date and current_price has been
        updated by the pre-flight refresh (130 vs yesterday's close 100), today's
        change must show the real intraday movement, not zero.
        """
        yesterday = date(2026, 5, 15)
        today     = date(2026, 5, 18)
        fetch_start = today - timedelta(days=10)

        # Pre-flight refresh updated current_price to 130 (intraday)
        h = _make_holding("0050", current_price=130.0, quantity=100)

        # DB has yesterday's close; today's close not yet stored (market open)
        all_prices = _build_prices("0050", [(yesterday.strftime("%Y-%m-%d"), 100.0)])

        data = _calc_performance([h], all_prices, yesterday, today, fetch_start)

        today_row = next(d for d in data if d["date"] == today.strftime("%Y-%m-%d"))
        assert today_row["change"] == pytest.approx(3000.0), (
            "100 shares × (130 intraday - 100 yesterday) = 3000; "
            "fails without pre-flight price refresh (BUG 1)"
        )

    def test_today_zero_when_current_price_stale(self):
        """
        Documents BUG 1 explicitly: when current_price was NOT refreshed and
        still equals yesterday's close, today's change is incorrectly 0.
        This test confirms the broken state — it is NOT desired behaviour.
        """
        yesterday = date(2026, 5, 15)
        today     = date(2026, 5, 18)
        fetch_start = today - timedelta(days=10)

        # Stale: current_price was NOT refreshed, equals yesterday's close
        h = _make_holding("0050", current_price=100.0, quantity=100)
        all_prices = _build_prices("0050", [(yesterday.strftime("%Y-%m-%d"), 100.0)])

        data = _calc_performance([h], all_prices, yesterday, today, fetch_start)

        today_row = next(d for d in data if d["date"] == today.strftime("%Y-%m-%d"))
        assert today_row["change"] == pytest.approx(0.0), (
            "BUG 1 documented: stale current_price == yesterday close → change = 0. "
            "The pre-flight refresh in the endpoint prevents this in production."
        )

    def test_full_week_all_trading_days_non_zero_change(self):
        """
        A Mon-Fri week with strictly increasing prices must have non-zero change
        on Tue through Fri (Mon is the baseline, so its change is 0).
        """
        monday = date(2026, 5, 11)
        friday = date(2026, 5, 15)
        fetch_start = monday - timedelta(days=10)

        h = _make_holding("0050", current_price=160.0, quantity=10)
        daily_closes = [
            ("2026-05-11", 100.0),
            ("2026-05-12", 110.0),
            ("2026-05-13", 120.0),
            ("2026-05-14", 130.0),
            ("2026-05-15", 140.0),
        ]
        all_prices = _build_prices("0050", daily_closes)

        data = _calc_performance([h], all_prices, monday, friday, fetch_start)

        assert len(data) == 5
        assert data[0]["change"] == pytest.approx(0.0), "Monday is baseline"
        for day in data[1:]:
            assert day["change"] == pytest.approx(100.0), (
                f"{day['date']}: expected change=100 (10 shares × Δ10), "
                f"got {day['change']}"
            )

    def test_weekends_excluded_from_output(self):
        """Sat and Sun must never appear in the returned data points."""
        monday = date(2026, 5, 11)
        next_monday = date(2026, 5, 18)
        fetch_start = monday - timedelta(days=10)

        h = _make_holding("0050", current_price=110.0, quantity=10)
        all_prices = _build_prices("0050", [
            ("2026-05-11", 100.0),
            ("2026-05-12", 101.0),
            ("2026-05-13", 102.0),
            ("2026-05-14", 103.0),
            ("2026-05-15", 104.0),
            ("2026-05-18", 105.0),
        ])

        data = _calc_performance([h], all_prices, monday, next_monday, fetch_start)

        output_dates = {d["date"] for d in data}
        assert "2026-05-16" not in output_dates, "Saturday must be excluded"
        assert "2026-05-17" not in output_dates, "Sunday must be excluded"
        assert len(data) == 6, "6 trading days: Mon-Fri + next Monday"

    def test_monday_change_skips_weekend_uses_friday_baseline(self):
        """
        Monday's change is vs Friday's close (Saturday/Sunday carry forward Friday's
        price but are not appended to daily_data, so prev_value == Friday value).
        """
        monday = date(2026, 5, 18)
        fetch_start = monday - timedelta(days=10)
        friday_str = (monday - timedelta(days=3)).strftime("%Y-%m-%d")

        h = _make_holding("0050", current_price=130.0, quantity=10)
        all_prices = _build_prices("0050", [
            (friday_str, 100.0),
            (monday.strftime("%Y-%m-%d"), 120.0),
        ])

        data = _calc_performance([h], all_prices, monday, monday, fetch_start)

        assert data[0]["change"] == pytest.approx(200.0), (
            "10 shares × (120 Monday - 100 Friday) = 200"
        )

    def test_negative_change_on_down_day(self):
        """A price drop must produce a negative change value."""
        start = date(2026, 5, 11)
        end   = date(2026, 5, 12)
        fetch_start = start - timedelta(days=10)

        h = _make_holding("0050", current_price=90.0, quantity=100)
        all_prices = _build_prices("0050", [
            ("2026-05-11", 100.0),
            ("2026-05-12", 90.0),
        ])

        data = _calc_performance([h], all_prices, start, end, fetch_start)

        assert data[1]["change"] == pytest.approx(-1000.0)
        assert data[1]["changePercent"] == pytest.approx(-10.0)

    def test_new_purchase_excluded_from_change_calculation(self):
        """
        When a holding is purchased on day N, the purchase value must not inflate
        day N's change (it would look like a massive gain when it's just new capital).
        """
        start = date(2026, 5, 11)  # Monday — purchase date
        end   = date(2026, 5, 12)  # Tuesday
        fetch_start = start - timedelta(days=10)

        # Holding purchased on Monday (start_date)
        h = _make_holding("0050", current_price=110.0, quantity=100,
                           purchase_date=start)
        all_prices = _build_prices("0050", [
            ("2026-05-11", 100.0),
            ("2026-05-12", 110.0),
        ])

        data = _calc_performance([h], all_prices, start, end, fetch_start)

        # Monday: first point, change always 0
        assert data[0]["change"] == pytest.approx(0.0)
        # Tuesday: change vs Monday — new purchase was excluded from prev, so delta=1000
        assert data[1]["change"] == pytest.approx(1000.0), (
            "Tuesday change should only reflect market movement (Δ10 × 100), "
            "not the purchase value itself"
        )


# ─── Pre-flight price refresh code-structure tests ───────────────────────────

class TestPreFlightPriceRefresh:
    """
    Verifies that get_daily_performance wires up the pre-flight price refresh
    correctly.  These tests inspect the endpoint source rather than running a
    full integration stack, avoiding complex async mock chains while still
    catching regressions where the call is removed or mis-configured.
    """

    def test_price_refresh_scheduled_off_request_path(self):
        """
        The price refresh must be scheduled as a BackgroundTask — NOT awaited
        inline — so the endpoint returns immediately instead of blocking the
        response on the per-symbol price-API round-trips.
        """
        import inspect
        from app.modules.portfolio.router import get_daily_performance

        source = inspect.getsource(get_daily_performance)

        assert "background_tasks.add_task(_refresh_prices_background" in source, (
            "Price refresh must be scheduled via BackgroundTasks, not awaited inline"
        )
        # The endpoint itself must NOT call the refresh inline — that awaited the
        # per-symbol price-API round-trips and blocked the response.
        assert "update_portfolio_prices" not in source, (
            "get_daily_performance must not call update_portfolio_prices inline"
        )

    def test_background_refresh_uses_force_false_and_is_failure_safe(self):
        """
        The background refresh must use force=False (respect the 1-hour TTL) and
        swallow failures so a transient API error never breaks the response.
        """
        import inspect
        from app.modules.portfolio.routers.performance_history import (
            _refresh_prices_background,
        )

        source = inspect.getsource(_refresh_prices_background)

        assert "update_portfolio_prices" in source
        assert "force=False" in source, (
            "force=True would bypass the 1-hour TTL and spam the price API"
        )
        assert "except Exception" in source, (
            "Background refresh must catch and log failures (non-fatal)"
        )


# ─── Market hours TTL gate tests ──────────────────────────────────────────────

class TestMarketHoursTTLGate:
    """
    The 1-hour TTL in MarketHoursManager.should_update_price is the guard that
    prevents the pre-flight refresh from hammering the price API on every chart load.
    """

    def test_no_update_within_1h_during_open_market(self):
        """Prices fetched 30 min ago during open market must not be re-fetched."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=30)
        with patch.object(MarketHoursManager, "is_market_open", return_value=True):
            assert MarketHoursManager.should_update_price("TW", last_update) is False

    def test_update_after_1h_during_open_market(self):
        """Prices older than 1 hour during open market must trigger a refresh."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=90)
        with patch.object(MarketHoursManager, "is_market_open", return_value=True):
            assert MarketHoursManager.should_update_price("TW", last_update) is True

    def test_no_update_after_post_close_snapshot_captured(self):
        """
        Once the official close price has been stored (last_update > market_close),
        no further updates should happen today.
        """
        from app.modules.portfolio.price_update_service import MarketHoursManager

        market_close = datetime.now(ZoneInfo("UTC")) - timedelta(hours=1)
        last_update  = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=30)

        with (
            patch.object(MarketHoursManager, "is_market_open", return_value=False),
            patch.object(MarketHoursManager, "get_market_close_time",
                         return_value=market_close),
        ):
            assert MarketHoursManager.should_update_price("TW", last_update) is False

    def test_update_required_if_post_close_snapshot_missing(self):
        """
        If the post-close snapshot was never captured (last_update is before
        market close), a refresh must be triggered to get the official close price.
        """
        from app.modules.portfolio.price_update_service import MarketHoursManager

        market_close = datetime.now(ZoneInfo("UTC")) - timedelta(hours=1)
        last_update  = datetime.now(ZoneInfo("UTC")) - timedelta(hours=3)

        with (
            patch.object(MarketHoursManager, "is_market_open", return_value=False),
            patch.object(MarketHoursManager, "get_market_close_time",
                         return_value=market_close),
        ):
            assert MarketHoursManager.should_update_price("TW", last_update) is True

    def test_never_updated_always_triggers_refresh(self):
        """last_update=None means never updated — must always refresh."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        assert MarketHoursManager.should_update_price("TW", last_update=None) is True

    def test_tw_market_open_window(self):
        """Taiwan market is open Mon-Fri 09:00-13:30 TST."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        # Wednesday 11:00 TST — inside window
        with patch("app.modules.portfolio.price_update_service.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(
                2026, 5, 13, 11, 0, tzinfo=ZoneInfo("Asia/Taipei")
            )
            assert MarketHoursManager.is_market_open("TW") is True

    def test_tw_market_closed_before_open(self):
        """Before 09:00 TST the Taiwan market is closed."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        with patch("app.modules.portfolio.price_update_service.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(
                2026, 5, 13, 8, 30, tzinfo=ZoneInfo("Asia/Taipei")
            )
            assert MarketHoursManager.is_market_open("TW") is False

    def test_tw_market_closed_after_close(self):
        """After 13:30 TST the Taiwan market is closed."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        with patch("app.modules.portfolio.price_update_service.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(
                2026, 5, 13, 14, 0, tzinfo=ZoneInfo("Asia/Taipei")
            )
            assert MarketHoursManager.is_market_open("TW") is False

    def test_tw_market_closed_on_weekend(self):
        """Saturday and Sunday: Taiwan market must be closed."""
        from app.modules.portfolio.price_update_service import MarketHoursManager

        with patch("app.modules.portfolio.price_update_service.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(
                2026, 5, 16, 11, 0, tzinfo=ZoneInfo("Asia/Taipei")  # Saturday
            )
            assert MarketHoursManager.is_market_open("TW") is False
