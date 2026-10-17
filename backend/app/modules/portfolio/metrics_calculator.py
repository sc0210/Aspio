"""
Portfolio performance metrics calculator (Phase 1).
Pure functions — no DB, no async.
"""
import math
from typing import Optional, List, Tuple


def compute_max_drawdown(portfolio_values: List[float]) -> Optional[float]:
    """Maximum peak-to-trough drawdown as a negative fraction (-0.23 = -23%)."""
    if len(portfolio_values) < 5:
        return None
    peak = portfolio_values[0]
    max_dd = 0.0
    for v in portfolio_values:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak
            if dd > max_dd:
                max_dd = dd
    return -max_dd


def compute_annualized_volatility(
    daily_returns: List[float], trading_days: int = 252
) -> Optional[float]:
    """Annualised standard deviation of log daily returns."""
    n = len(daily_returns)
    if n < 10:
        return None
    mean = sum(daily_returns) / n
    variance = sum((r - mean) ** 2 for r in daily_returns) / (n - 1)
    return math.sqrt(variance * trading_days)


def compute_sharpe_ratio(
    annualized_return: float, volatility: float, risk_free_rate: float = 0.04
) -> Optional[float]:
    """Sharpe = (return - risk_free) / volatility. Uses 4% risk-free rate (US T-Bill proxy)."""
    if not volatility or volatility <= 0:
        return None
    return (annualized_return - risk_free_rate) / volatility


def compute_hhi(weights: List[float]) -> float:
    """Herfindahl-Hirschman Index on 0-10 000 scale. <1000 competitive, >2500 concentrated."""
    return sum(w * w for w in weights) * 10_000


def compute_alpha(
    portfolio_cagr: float,
    beta: float,
    benchmark_cagr: float,
    risk_free_rate: float = 0.04,
) -> float:
    """Jensen's Alpha = portfolio_CAGR - [risk_free + beta*(benchmark_CAGR - risk_free)]."""
    return portfolio_cagr - (risk_free_rate + beta * (benchmark_cagr - risk_free_rate))


# ─── Risk metrics from time-weighted daily returns ───────────────────────────

# A year of returns is the window every figure below shares, so alpha compares
# like with like.
RISK_WINDOW_DAYS = 365
# Fewer paired days than this and a beta is mostly noise.
MIN_BETA_PAIRS = 60
# The benchmark must cover the window's start this closely for alpha.
BENCHMARK_EDGE_DAYS = 7
# Fewer trading days than this and a Sharpe ratio is noise.
MIN_SHARPE_DAYS = 60


def risk_from_twr_returns(
    daily_returns: List[Tuple],
    benchmark_closes: List[Tuple],
    today,
    risk_free_rate: float = 0.04,
) -> dict:
    """Volatility, drawdown, Sharpe, day stats, beta and alpha for the trailing year.

    `daily_returns` are the portfolio's time-weighted daily returns as
    (date, r): your own buys and sells are already taken out, so a deposit is
    not a "+40% day" and a large buy cannot fake a drawdown recovery. That is
    what the previous inputs got wrong — a value series rebuilt from today's
    quantities in mixed currencies, which produced a beta of 30.

    Weekend returns are compounded into the next weekday rather than kept as
    days of their own: for stocks they are exact zeros (prices carried forward)
    that would understate volatility, while crypto genuinely moves on a
    weekend and that move must not be lost. `benchmark_closes` is (date, close)
    for SPY.
    Returns a dict of fractions (or None where there is not enough data).
    """
    from datetime import timedelta

    start = today - timedelta(days=RISK_WINDOW_DAYS)
    rets: List[Tuple] = []
    carry = 1.0
    for d, r in sorted(daily_returns):
        if not (start < d <= today):
            continue
        carry *= 1.0 + float(r)
        if d.weekday() < 5:
            rets.append((d, carry - 1.0))
            carry = 1.0
    if carry != 1.0 and rets:  # a weekend at the very end of the window
        last_d, last_r = rets[-1]
        rets[-1] = (last_d, (1.0 + last_r) * carry - 1.0)
    out: dict = {
        "volatility": None, "max_drawdown": None, "sharpe": None, "return_1y": None,
        "best_day": None, "worst_day": None, "up_days": 0, "down_days": 0,
        "win_rate": None, "beta": None, "alpha": None, "data_days": len(rets),
    }
    if len(rets) < 10:
        return out
    r_only = [r for _, r in rets]

    out["volatility"] = compute_annualized_volatility(r_only)
    index, level = [], 1.0
    for r in r_only:
        level *= 1.0 + r
        index.append(level)
    out["max_drawdown"] = compute_max_drawdown([1.0] + index)
    out["return_1y"] = level - 1.0
    # Sharpe needs an annual return against the annual risk-free rate, and a
    # few weeks of history make any ratio noise.
    if out["volatility"] and len(r_only) >= MIN_SHARPE_DAYS:
        annual = level ** (252.0 / len(r_only)) - 1.0
        out["sharpe"] = compute_sharpe_ratio(annual, out["volatility"], risk_free_rate)
    out["best_day"] = max(r_only)
    out["worst_day"] = min(r_only)
    out["up_days"] = sum(1 for r in r_only if r > 0)
    out["down_days"] = sum(1 for r in r_only if r < 0)
    traded = out["up_days"] + out["down_days"]
    out["win_rate"] = out["up_days"] / traded if traded else None

    closes = sorted((d, float(c)) for d, c in benchmark_closes if c and float(c) > 0)
    b0, b1, n = lagged_beta_components(rets, closes)
    if b0 is not None and n >= MIN_BETA_PAIRS:
        out["beta"] = b0 + b1

    in_window = [(d, c) for d, c in closes if start <= d <= today]
    if out["beta"] is not None and in_window:
        first_d, first_c = in_window[0]
        last_d, last_c = in_window[-1]
        # Both sides must span the window, or alpha compares two periods.
        portfolio_covers = (rets[0][0] - start).days <= BENCHMARK_EDGE_DAYS
        bench_covers = (first_d - start).days <= BENCHMARK_EDGE_DAYS and (today - last_d).days <= BENCHMARK_EDGE_DAYS
        if portfolio_covers and bench_covers:
            bench_1y = last_c / first_c - 1.0
            out["alpha"] = compute_alpha(out["return_1y"], out["beta"], bench_1y, risk_free_rate)
    return out


def _adjacent_sessions(earlier, later) -> bool:
    """Consecutive trading sessions: the next day, or Friday to Monday."""
    gap = (later - earlier).days
    return gap == 1 or (gap == 3 and later.weekday() == 0)


def lagged_beta_components(daily_returns: List[Tuple], benchmark_closes: List[Tuple]):
    """Dimson beta components (b0, b1, n) from one joint regression.

    Fits r_d = a + b0·x(d) + b1·x(prev session) on the days where both regressors
    exist, where x(d) is the benchmark's one-session return ending on d. b0 + b1
    is the beta: Taiwan closes before New York opens, so a US move reaches a
    TW-listed holding the next trading day, and b0 alone biases beta toward zero.

    A benchmark return is used only between adjacent sessions — across a US
    holiday it spans several sessions and is not comparable with a one-day
    portfolio return — and the "previous session" is the actual preceding close,
    found by bisection, not merely the latest usable return.
    """
    from bisect import bisect_left

    dates = [d for d, _ in benchmark_closes]
    close_on = dict(benchmark_closes)

    def session_return(d):
        i = bisect_left(dates, d)
        if i >= len(dates) or dates[i] != d or i == 0:
            return None
        prev = dates[i - 1]
        if not _adjacent_sessions(prev, d):
            return None
        return close_on[d] / close_on[prev] - 1.0

    def previous_session(d):
        i = bisect_left(dates, d)
        if i == 0:
            return None
        prev = dates[i - 1]
        return prev if _adjacent_sessions(prev, d) else None

    rows = []
    for d, r in daily_returns:
        x0 = session_return(d)
        p = previous_session(d)
        x1 = session_return(p) if p is not None else None
        if x0 is not None and x1 is not None:
            rows.append((float(r), x0, x1))

    n = len(rows)
    if n < 3:
        return None, None, n
    my = sum(r for r, _, _ in rows) / n
    m0 = sum(x for _, x, _ in rows) / n
    m1 = sum(x for _, _, x in rows) / n
    s00 = sum((x0 - m0) ** 2 for _, x0, _ in rows)
    s11 = sum((x1 - m1) ** 2 for _, _, x1 in rows)
    s01 = sum((x0 - m0) * (x1 - m1) for _, x0, x1 in rows)
    s0y = sum((x0 - m0) * (r - my) for r, x0, _ in rows)
    s1y = sum((x1 - m1) * (r - my) for r, _, x1 in rows)
    det = s00 * s11 - s01 * s01
    if det <= 0:
        return None, None, n
    b0 = (s11 * s0y - s01 * s1y) / det
    b1 = (s00 * s1y - s01 * s0y) / det
    return b0, b1, n


# ─── Blended benchmark ───────────────────────────────────────────────────────


def blended_benchmark_closes(
    legs: List[Tuple[float, List[Tuple]]],
    start,
    end,
) -> List[Tuple]:
    """A daily-rebalanced index over weekdays from weighted legs.

    `legs` is [(weight, [(date, level)])] with every level already in the
    portfolio's currency (TWD) — a US leg is its close times that day's USD/TWD
    rate. Each leg carries its last level over its own market's holidays, which
    is exactly how the portfolio's TWR series treats a held security, so the two
    stay comparable day by day: the holiday reads flat and the move lands on the
    next session. The index starts on the first weekday every leg has a level.

    Returns [(date, index)] on weekdays, ready for `risk_from_twr_returns` as the
    benchmark. Empty when a leg has no data or the weights are not positive.
    """
    from datetime import timedelta

    total = sum(w for w, _ in legs if w > 0)
    if total <= 0 or any(not series for w, series in legs if w > 0):
        return []
    legs = [(w / total, sorted(series)) for w, series in legs if w > 0]

    cursors = [0] * len(legs)
    current: List = [None] * len(legs)
    out: List[Tuple] = []
    prev_levels = None
    index = 100.0
    d = start
    while d <= end:
        for k, (_, series) in enumerate(legs):
            while cursors[k] < len(series) and series[cursors[k]][0] <= d:
                current[k] = float(series[cursors[k]][1])
                cursors[k] += 1
        if d.weekday() < 5 and all(c is not None and c > 0 for c in current):
            if prev_levels is not None:
                r = sum(w * (current[k] / prev_levels[k] - 1.0) for k, (w, _) in enumerate(legs))
                index *= 1.0 + r
            prev_levels = list(current)
            out.append((d, index))
        d += timedelta(days=1)
    return out


def usd_leg_in_twd(closes: List[Tuple], usd_twd: List[Tuple]) -> List[Tuple]:
    """A USD-priced series converted to TWD with the latest rate on or before each close."""
    from bisect import bisect_right

    rates = sorted(usd_twd)
    rate_days = [d for d, _ in rates]
    out = []
    for d, c in sorted(closes):
        i = bisect_right(rate_days, d)
        if i and c:
            out.append((d, float(c) * float(rates[i - 1][1])))
    return out
