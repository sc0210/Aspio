"""Risk metrics from time-weighted daily returns, against hand-checkable cases."""

import math
import random
from datetime import date, timedelta

import pytest

from app.modules.portfolio.metrics_calculator import MIN_BETA_PAIRS, risk_from_twr_returns

pytestmark = pytest.mark.unit

TODAY = date(2026, 10, 8)


def weekdays(n_days_back=364):
    d = TODAY - timedelta(days=n_days_back)
    out = []
    while d <= TODAY:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def spy_from_returns(days, rets, start_close=500.0):
    closes = [(days[0] - timedelta(days=1), start_close)]
    c = start_close
    for d, r in zip(days, rets):
        c *= 1 + r
        closes.append((d, c))
    return closes


def test_beta_of_a_levered_copy_is_the_leverage():
    rnd = random.Random(7)
    days = weekdays()
    spy = [rnd.gauss(0.0005, 0.01) for _ in days]
    port = [(d, 1.2 * r) for d, r in zip(days, spy)]
    out = risk_from_twr_returns(port, spy_from_returns(days, spy), TODAY)
    assert out["beta"] == pytest.approx(1.2, abs=1e-9)  # b0 = 1.2, b1 = 0 exactly


def test_tracking_the_benchmark_exactly_has_zero_alpha():
    rnd = random.Random(3)
    days = weekdays()
    spy = [rnd.gauss(0.0004, 0.008) for _ in days]
    out = risk_from_twr_returns(list(zip(days, spy)), spy_from_returns(days, spy), TODAY)
    assert out["beta"] == pytest.approx(1.0, abs=1e-9)
    assert out["alpha"] == pytest.approx(0.0, abs=1e-9)


def test_drawdown_is_on_the_growth_index():
    days = weekdays(30)
    rets = [0.0] * len(days)
    rets[2], rets[3] = 0.10, -0.20  # up 10%, then down 20% from the peak
    out = risk_from_twr_returns(list(zip(days, rets)), [], TODAY)
    assert out["max_drawdown"] == pytest.approx(-0.20)
    assert out["return_1y"] == pytest.approx(1.1 * 0.8 - 1)
    assert out["beta"] is None and out["alpha"] is None  # no benchmark


def test_weekends_are_dropped_and_volatility_annualised_on_trading_days():
    days = weekdays(60)
    rets = [0.01 if i % 2 else -0.01 for i in range(len(days))]
    weekend = [(d + timedelta(days=1), 0.0) for d in days if d.weekday() == 4]  # Saturdays
    out = risk_from_twr_returns(list(zip(days, rets)) + weekend, [], TODAY)
    assert out["data_days"] == len(days)
    sd = math.sqrt(sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / (len(rets) - 1))
    assert out["volatility"] == pytest.approx(sd * math.sqrt(252))
    assert out["win_rate"] == pytest.approx(out["up_days"] / (out["up_days"] + out["down_days"]))


def test_no_beta_without_enough_paired_days_and_no_alpha_on_a_short_benchmark():
    rnd = random.Random(1)
    days = weekdays()
    spy = [rnd.gauss(0, 0.01) for _ in days]
    port = list(zip(days, spy))
    few = spy_from_returns(days[-(MIN_BETA_PAIRS - 10):], spy[-(MIN_BETA_PAIRS - 10):])
    assert risk_from_twr_returns(port, few, TODAY)["beta"] is None
    # Enough pairs for beta, but SPY starts mid-window: no alpha.
    half = spy_from_returns(days[100:], spy[100:])
    out = risk_from_twr_returns(port, half, TODAY)
    assert out["beta"] is not None and out["alpha"] is None


def test_too_little_history_returns_nothing():
    out = risk_from_twr_returns([(TODAY, 0.01)], [], TODAY)
    assert out["volatility"] is None and out["data_days"] == 1


def test_a_weekend_move_is_compounded_into_monday_not_lost():
    # Crypto moves on a Saturday; stocks don't. Friday 0, Saturday +10%, Monday +5%.
    fri = date(2026, 10, 2)
    rows = [(fri - timedelta(days=7 * k + i), 0.0) for k in range(3) for i in range(5)]  # earlier weekdays
    rows += [(fri, 0.0), (fri + timedelta(days=1), 0.10), (fri + timedelta(days=3), 0.05)]
    out = risk_from_twr_returns(rows, [], TODAY)
    assert out["return_1y"] == pytest.approx(1.10 * 1.05 - 1)
    assert out["best_day"] == pytest.approx(1.10 * 1.05 - 1)  # Monday carries the weekend


def test_no_alpha_when_the_portfolio_starts_mid_window():
    rnd = random.Random(5)
    days = weekdays()
    spy = [rnd.gauss(0.0004, 0.01) for _ in days]
    port = list(zip(days[120:], spy[120:]))  # first return ~6 months in
    out = risk_from_twr_returns(port, spy_from_returns(days, spy), TODAY)
    assert out["beta"] is not None and out["alpha"] is None


def test_no_sharpe_on_a_few_weeks_of_history():
    days = weekdays(40)
    rets = [0.01 if i % 2 else -0.005 for i in range(len(days))]
    out = risk_from_twr_returns(list(zip(days, rets)), [], TODAY)
    assert out["volatility"] is not None and out["sharpe"] is None


def test_a_market_that_follows_the_benchmark_a_session_later_has_all_its_beta_in_the_lag():
    from app.modules.portfolio.metrics_calculator import lagged_beta_components
    # The Taiwan case: today's TW close reflects the previous US session.
    rnd = random.Random(11)
    days = weekdays()
    spy = [rnd.gauss(0.0004, 0.01) for _ in days]
    closes = spy_from_returns(days, spy)
    lagged = [(d, spy[i - 1]) for i, d in enumerate(days) if i]
    b0, b1, n = lagged_beta_components(lagged, closes)
    assert b0 == pytest.approx(0.0, abs=1e-9)
    assert b1 == pytest.approx(1.0, abs=1e-9)
    assert risk_from_twr_returns(lagged, closes, TODAY)["beta"] == pytest.approx(1.0, abs=1e-9)


def test_returns_across_a_benchmark_gap_are_not_paired():
    from app.modules.portfolio.metrics_calculator import lagged_beta_components
    rnd = random.Random(2)
    days = weekdays()
    spy = [rnd.gauss(0, 0.01) for _ in days]
    closes = spy_from_returns(days, spy)
    port = list(zip(days, spy))
    _, _, n_full = lagged_beta_components(port, closes)
    hole = days[150]  # a mid-week US holiday: no close that day
    _, _, n_gap = lagged_beta_components(port, [c for c in closes if c[0] != hole])
    # Lost: the holiday itself, the day after (its return spans two sessions), and
    # the day after that (its previous session would be the spanning one).
    assert n_full - n_gap == 3


def test_a_weekend_move_at_the_end_of_the_window_lands_on_the_last_weekday():
    sat = date(2026, 10, 3)  # TODAY is Thursday 10-08; use an earlier Saturday window end
    rows = [(sat - timedelta(days=1 + i), 0.0) for i in range(30) if (sat - timedelta(days=1 + i)).weekday() < 5]
    rows.append((sat, 0.10))
    out = risk_from_twr_returns(rows, [], sat)
    assert out["return_1y"] == pytest.approx(0.10)


# ─── blended benchmark ──────────────────────────────────────────────────────

from app.modules.portfolio.metrics_calculator import blended_benchmark_closes, usd_leg_in_twd

MON = date(2026, 9, 7)  # a Monday


def wd(n):
    """The n-th weekday from MON (0-based)."""
    d, k = MON, 0
    while k < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            k += 1
    return d


def test_a_blend_moves_by_the_weighted_leg_returns():
    tw = [(wd(0), 100.0), (wd(1), 110.0)]  # +10%
    us = [(wd(0), 50.0), (wd(1), 50.0)]    # flat
    idx = blended_benchmark_closes([(0.7, tw), (0.3, us)], wd(0), wd(1))
    assert idx[1][1] / idx[0][1] - 1 == pytest.approx(0.07)


def test_a_holiday_in_one_leg_reads_flat_and_the_move_lands_next_session():
    tw = [(wd(0), 100.0), (wd(2), 110.0)]  # no close on wd(1): a Taiwan holiday
    us = [(wd(0), 50.0), (wd(1), 50.0), (wd(2), 50.0)]
    idx = blended_benchmark_closes([(0.5, tw), (0.5, us)], wd(0), wd(2))
    levels = [v for _, v in idx]
    assert levels[1] == pytest.approx(levels[0])          # holiday: flat
    assert levels[2] / levels[1] - 1 == pytest.approx(0.05)  # half of +10% next session


def test_the_blend_starts_when_every_leg_has_a_level_and_weights_are_normalised():
    tw = [(wd(2), 100.0), (wd(3), 102.0)]
    us = [(wd(0), 50.0), (wd(1), 51.0), (wd(2), 51.0), (wd(3), 51.0)]
    idx = blended_benchmark_closes([(2.0, tw), (2.0, us)], wd(0), wd(3))
    assert idx[0][0] == wd(2)
    assert idx[1][1] / idx[0][1] - 1 == pytest.approx(0.01)
    assert blended_benchmark_closes([(1.0, tw), (1.0, [])], wd(0), wd(3)) == []


def test_a_usd_leg_includes_the_currency_move():
    vt = [(wd(0), 100.0), (wd(1), 100.0)]
    fx = [(wd(0) - timedelta(days=3), 30.0), (wd(1), 33.0)]  # rate carried from an earlier day
    twd = usd_leg_in_twd(vt, fx)
    assert twd == [(wd(0), 3000.0), (wd(1), 3300.0)]
