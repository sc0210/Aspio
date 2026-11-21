"""The Taiwan CAPE and where it sits in its own history. Pure: no I/O.

CAPE (Shiller P/E) for month t is the real TAIEX over the average real earnings
of the ten years to t. Earnings per index point for a month are taiex / market
P/E. Both price and earnings are deflated by CPI, so the ratio is

    CAPE_t = (taiex_t / cpi_t) / mean over the 120 months to t of (E_s / cpi_s)

The reading is relative to Taiwan's own history, not to a fixed number. Taiwan
has sat far above US-style thresholds for years, because its biggest earners'
profits grew much faster than a ten-year average can follow, so "above 30"
would call it expensive every month.
"""

import math
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Sequence

WINDOW_MONTHS = 120
# A window may miss a few months (a TWSE outage on the day a backfill ran);
# below this many it is not a ten-year average any more.
MIN_WINDOW_MONTHS = 114
CHEAP_BELOW_PERCENTILE = 20.0
EXPENSIVE_ABOVE_PERCENTILE = 80.0


@dataclass(frozen=True)
class MonthInput:
    month: date  # first day of the month
    as_of: date
    taiex: float
    market_pe: float
    cpi: Optional[float]
    is_final: bool


@dataclass(frozen=True)
class CapePoint:
    month: date
    cape: float


@dataclass
class CapeReading:
    available: bool
    as_of: Optional[date] = None
    cape: Optional[float] = None
    percentile: Optional[float] = None
    band: Optional[str] = None  # cheap | fair | expensive
    since: Optional[date] = None
    low: Optional[float] = None
    high: Optional[float] = None
    # The band's edges: cheap at or below, expensive above. The chart draws
    # these, so a line and the badge can never disagree.
    cheap_at_or_below: Optional[float] = None
    expensive_above: Optional[float] = None
    taiex: Optional[float] = None
    market_pe: Optional[float] = None
    history: List[CapePoint] = field(default_factory=list)


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _with_cpi(rows: Sequence[MonthInput]) -> List[MonthInput]:
    """Rows in month order, each with a CPI.

    CPI is published about a week after a month ends, so the newest months have
    none yet and take the latest published value. Months before the first
    published CPI are dropped.
    """
    out: List[MonthInput] = []
    last_cpi: Optional[float] = None
    for r in sorted(rows, key=lambda r: r.month):
        cpi = r.cpi if r.cpi else last_cpi
        if cpi:
            last_cpi = cpi
            out.append(MonthInput(r.month, r.as_of, r.taiex, r.market_pe, cpi, r.is_final))
    return out


def cape_series(rows: Sequence[MonthInput]) -> List[CapePoint]:
    """CAPE for every month that has a full enough ten-year window."""
    months = [r for r in _with_cpi(rows) if r.market_pe > 0 and r.taiex > 0]
    real_earnings = [(r.month, (r.taiex / r.market_pe) / r.cpi) for r in months]
    points: List[CapePoint] = []
    for i, r in enumerate(months):
        window = [
            e for m, e in real_earnings[: i + 1]
            if _months_between(m, r.month) < WINDOW_MONTHS
        ]
        if len(window) < MIN_WINDOW_MONTHS:
            continue
        # The first month of a window must reach back ~ten years, or a short
        # history with no gaps would pass the count alone.
        first = next(m for m, _ in real_earnings[: i + 1] if _months_between(m, r.month) < WINDOW_MONTHS)
        if _months_between(first, r.month) < MIN_WINDOW_MONTHS - 1:
            continue
        avg = sum(window) / len(window)
        if avg > 0:
            points.append(CapePoint(r.month, (r.taiex / r.cpi) / avg))
    return points


def read_cape(rows: Sequence[MonthInput]) -> CapeReading:
    """The latest CAPE, where it sits among every earlier month's, and the band.

    The percentile is the share of the other months whose CAPE was strictly
    lower, so "higher than 94% of months" is literally true and never reads
    100% of a set that includes itself. Cheap is below the 20th percentile,
    expensive above the 80th; both edges are returned as CAPE values.
    """
    series = cape_series(rows)
    if len(series) < 2:
        return CapeReading(available=False)
    latest = series[-1]
    values = [p.cape for p in series]
    others = sorted(values[:-1])
    m = len(others)
    percentile = 100.0 * sum(1 for v in others if v < latest.cape) / m
    # With others sorted, "more than 80% of them are lower" holds exactly when
    # the value is above others[floor(0.8m)], and "fewer than 20%" exactly
    # when it is at or below others[ceil(0.2m) - 1].
    expensive_above = others[math.floor(EXPENSIVE_ABOVE_PERCENTILE / 100 * m)]
    cheap_at_or_below = others[max(math.ceil(CHEAP_BELOW_PERCENTILE / 100 * m) - 1, 0)]
    if latest.cape > expensive_above:
        band = "expensive"
    elif latest.cape <= cheap_at_or_below:
        band = "cheap"
    else:
        band = "fair"
    source = next(r for r in rows if r.month == latest.month)
    return CapeReading(
        available=True,
        as_of=source.as_of,
        cape=latest.cape,
        percentile=percentile,
        band=band,
        since=series[0].month,
        low=min(values),
        high=max(values),
        cheap_at_or_below=cheap_at_or_below,
        expensive_above=expensive_above,
        taiex=source.taiex,
        market_pe=source.market_pe,
        history=series,
    )
