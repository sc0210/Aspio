"""Which close a holding's day change is measured against, and whether its price is stale.

Two sources offer a previous close, and they disagree:

- ``portfolio_holdings.previous_close``, captured from Yahoo's ``fast_info``
  alongside the price. It is not always the prior session's official close: on
  2026-11-13 it read 100.85 for 0050 where TWSE (via FinLab) closed it at 100.95,
  and 156.01 for VT, which closed at 156.71 and has no session near 156.01.
- ``historical_prices``, the official daily bars the P&L calendar is built from.

The page used the first and the calendar the second, so the same day had two
answers. The base is now the official bar of the session just before the price's
own. "The session before" comes from the market's recorded days, so the day after
a holiday finds the last real session. The stored quote is used only when that bar
is missing from the holding's own series: a gap in the nightly sync (0050 lacked
2026-08-13, which made the delta a two-day move).

Every reader of a day change goes through `resolve_day_change`.
"""

import logging
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from app.utils.market_sessions import price_session_date, session_market

from .historical_price_repository import HistoricalPriceRepository
from .manual_pricing import is_manually_priced
from .symbols import symbol_lookup_variants

logger = logging.getLogger(__name__)

# The history window every reader uses, so they all see the same bars.
LOOKBACK_DAYS = 30
# Without the market's calendar, how old a bar may be and still count as the
# previous session: a weekend plus a public holiday.
MAX_PREVIOUS_CLOSE_AGE_DAYS = 7
# A price is stale once its market has traded this many sessions since.
STALE_AFTER_SESSIONS = 2
# ...or, if the market's history has stopped too, once it is this old.
STALE_AFTER_DAYS = 14


@dataclass(frozen=True)
class DayChangeBase:
    previous_close: Optional[Decimal]
    price_stale: bool


def session_before(day: date) -> date:
    """The weekday before `day`: the fallback when the market's days are unknown."""
    prev = day - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def previous_session(day: date, market_days: Optional[Set[date]]) -> date:
    """The last day before `day` the market traded, as far as its bars show."""
    known = [d for d in (market_days or ()) if d < day]
    return max(known) if known else session_before(day)


def freshest_series(
    prices_by_symbol: Dict[str, List[Dict[str, Any]]], variants: Iterable[str]
) -> List[Dict[str, Any]]:
    """The candidate key whose series has the most recent close.

    A relabelled ticker leaves a dead series behind under its old key, so taking
    the freshest avoids reading months-old prices.
    """
    best: List[Dict[str, Any]] = []
    for candidate in variants:
        series = [p for p in prices_by_symbol.get(candidate.upper(), []) if _usable_close(p)]
        if series and (not best or str(series[-1]["date"]) > str(best[-1]["date"])):
            best = series
    return best


def _usable_close(bar: Dict[str, Any]) -> bool:
    """A bar whose close parses as a finite number; a bad row is skipped, not a 500."""
    try:
        return bool(bar.get("close")) and Decimal(str(bar["close"])).is_finite()
    except (ArithmeticError, ValueError):
        return False


def _positive(value: Optional[Decimal]) -> Optional[Decimal]:
    if value is None:
        return None
    value = Decimal(str(value))
    return value if value.is_finite() and value > 0 else None


def choose_previous_close(
    stored: Optional[Decimal],
    series: Sequence[Dict[str, Any]],
    price_session: Optional[date],
    today: date,
    manually_priced: bool = False,
    market_days: Optional[Set[date]] = None,
) -> Optional[Decimal]:
    """The close the day change of a price from `price_session` is measured against.

    `series` is the holding's daily bars, ascending, as dicts with ``date`` (ISO
    string) and ``close``. None for a hand-priced holding: its price is whatever
    the user typed, so a market close says nothing about its "today".
    """
    if manually_priced:
        return None
    bars = []
    for p in series:
        try:
            bars.append((date.fromisoformat(str(p["date"])[:10]), Decimal(str(p["close"]))))
        except (KeyError, ValueError, ArithmeticError):
            continue

    if price_session is not None:
        before = [b for b in bars if b[0] < price_session]
        if before and before[-1][0] == previous_session(price_session, market_days):
            return _positive(before[-1][1])

    stored = _positive(stored)
    if stored is not None:
        return stored

    # Nothing captured from the quote. With the market's calendar known, the bar
    # above was the only acceptable one: anything older is a gap, and a multi-day
    # move would be shown as "today".
    if price_session is not None and market_days:
        return None
    # Calendar unknown: the last bar before the price's session (today when that
    # is unknown too), unless too old to be the previous one. Never a bar after
    # the price: a BTC price from 2025-10 against last week's close read -30%.
    reference = price_session or today
    before = [b for b in bars if b[0] < reference]
    if before and (reference - before[-1][0]).days <= MAX_PREVIOUS_CLOSE_AGE_DAYS:
        return _positive(before[-1][1])
    return None


def is_price_stale(
    price_session: Optional[date],
    today: date,
    manually_priced: bool,
    market_days: Optional[Set[date]],
) -> bool:
    """Whether the market has moved on without this price.

    Counted in the market's own sessions, so a holiday week (Lunar New Year) is
    not staleness; one session behind is normal (tonight's close not fetched yet).
    """
    if manually_priced or price_session is None:
        return False
    since = sum(1 for d in (market_days or ()) if d > price_session)
    return since >= STALE_AFTER_SESSIONS or (today - price_session).days > STALE_AFTER_DAYS


def _get(holding: Any, name: str) -> Any:
    return holding.get(name) if isinstance(holding, dict) else getattr(holding, name, None)


async def resolve_day_change(
    session,
    holdings: Sequence[Any],
    today: date,
    prices_by_symbol: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> List[DayChangeBase]:
    """The day-change base and staleness of each holding (ORM rows or dicts).

    Pass `prices_by_symbol` when the caller already read the LOOKBACK_DAYS
    window. A failed history read leaves the stored quotes to stand in rather
    than failing the caller.
    """
    repo = HistoricalPriceRepository(session)
    start = today - timedelta(days=LOOKBACK_DAYS)
    variants = [
        symbol_lookup_variants(_get(h, "symbol"), _get(h, "market")) if _get(h, "symbol") else []
        for h in holdings
    ]
    # Each read in a savepoint: a failed statement otherwise aborts the caller's
    # transaction, and its next query (the dashboard's, say) fails with it.
    def savepoint():
        return session.begin_nested() if session is not None else nullcontext()

    if prices_by_symbol is None:
        symbols = sorted({s for vs in variants for s in vs})
        try:
            async with savepoint():
                prices_by_symbol = (
                    await repo.get_batch_price_history(symbols, start, today) if symbols else {}
                )
        except Exception:
            logger.warning("Day change: price history unavailable; using stored quotes", exc_info=True)
            prices_by_symbol = {}
    try:
        async with savepoint():
            days_by_label = await repo.get_market_days(start, today)
    except Exception:
        logger.warning("Day change: market days unavailable", exc_info=True)
        days_by_label = {}
    days_by_market: Dict[str, Set[date]] = {}
    for label, days in days_by_label.items():
        days_by_market.setdefault(session_market(label), set()).update(days)

    bases = []
    for h, vs in zip(holdings, variants):
        holding_type = _get(h, "type")
        manual = is_manually_priced(_get(h, "symbol"), getattr(holding_type, "value", holding_type))
        session_day = price_session_date(_get(h, "market"), _get(h, "last_price_update_at"))
        market_days = days_by_market.get(session_market(_get(h, "market")))
        bases.append(DayChangeBase(
            previous_close=choose_previous_close(
                _get(h, "previous_close"), freshest_series(prices_by_symbol, vs),
                session_day, today, manually_priced=manual, market_days=market_days,
            ),
            price_stale=is_price_stale(session_day, today, manual, market_days),
        ))
    return bases
