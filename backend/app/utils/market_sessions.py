"""When a market's trading day is finished, and its close is therefore a close.

A price provider asked for a range that includes today returns a bar for the day
in progress: its "close" is simply the last trade so far. Stored as that date's
closing price it stands as fact until some later fetch happens to overwrite it —
so a US holding could sit in the portfolio history at a price from 90 minutes into
the session, and every figure built on that day moved overnight without anything
having changed.

The rule here is the one the scheduler already follows for its own jobs: a bar
belongs in the daily history once its market has closed for that date.
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

# Exchange local closing times. The grace period covers the minutes a provider
# takes to publish the official close after the bell.
_SESSIONS = {
    "TW": (ZoneInfo("Asia/Taipei"), time(13, 30)),
    # Taiwan indices (the TAIEX, ^TWII): same session as the listed market.
    "TW-INDEX": (ZoneInfo("Asia/Taipei"), time(13, 30)),
    # USD/TWD (TWD=X): Yahoo dates FX bars at London midnight, and each covers the
    # whole London day, still moving until it ends (07:00-08:00 Taipei the next
    # morning). Checked 2026-10-08: bars read "2026-10-08T00:00:00+01:00". A bar
    # is final only once its London day is over: 23:59 plus the grace period.
    "FX": (ZoneInfo("Europe/London"), time(23, 59)),
    "US": (ZoneInfo("America/New_York"), time(16, 0)),
}

GRACE_MINUTES = 30

# Crypto never closes, so a bar for today is as final as it will ever be; any
# market we do not model is treated the same way rather than silently dropped.
_ALWAYS_OPEN = {"CRYPTO", "CRYPTOCURRENCY"}


def session_closed(
    market: Optional[str],
    bar_date: date,
    now: Optional[datetime] = None,
) -> bool:
    """True once `market` has finished trading on `bar_date`.

    A date before today in that exchange's own timezone is closed by definition.
    Today is closed only after the bell plus a short grace period; a future date
    never is.
    """
    session = _SESSIONS.get((market or "").upper())
    if session is None:
        return True  # crypto and anything unmodelled: nothing to wait for

    tz, closing_time = session
    now = now or datetime.now(timezone.utc)
    local_now = now.astimezone(tz)

    if bar_date < local_now.date():
        return True
    if bar_date > local_now.date():
        return False

    closes_at = datetime.combine(bar_date, closing_time, tzinfo=tz)
    return (local_now - closes_at).total_seconds() >= GRACE_MINUTES * 60


def last_settled_close(market: Optional[str], now: Optional[datetime] = None) -> Optional[datetime]:
    """The most recent close of `market` that is final by `now`, in UTC.

    "Final" is the bell plus the grace period, the same rule `session_closed`
    applies to bars. Weekends are skipped (no holiday calendar: a weekday holiday
    still has a nominal close, which only means one redundant refresh). None for
    markets this module does not model.

    A price stamped at or after this instant already reflects the latest close;
    one stamped before it is from an earlier session (or from mid-auction).
    """
    session = _SESSIONS.get((market or "").upper())
    if session is None:
        return None
    tz, closing_time = session
    now = now or datetime.now(timezone.utc)
    local_now = now.astimezone(tz)
    day = local_now.date()
    for _ in range(8):
        if day.weekday() < 5:
            settled = datetime.combine(day, closing_time, tzinfo=tz) + timedelta(minutes=GRACE_MINUTES)
            if settled <= local_now:
                return settled.astimezone(timezone.utc)
        day -= timedelta(days=1)
    return None


# Opening times, for what a page shows ("open", "last close Fri"). Only the
# markets above with a regular session; FX and crypto trade around the clock.
_OPENS = {"TW": time(9, 0), "TW-INDEX": time(9, 0), "US": time(9, 30)}
_ALIASES = {"NYSE": "US", "NASDAQ": "US", "AMEX": "US", "TWSE": "TW", "TPEX": "TW", "TWO": "TW"}


def session_market(market: Optional[str]) -> str:
    """The session a holding's market label trades on (NYSE → US, TWSE → TW)."""
    key = (market or "").upper()
    return _ALIASES.get(key, key)


def is_trading(market: Optional[str], now: Optional[datetime] = None) -> Optional[bool]:
    """True while `market` is in session, False outside it, None if unmodelled.

    Crypto always trades. No holiday calendar: a weekday holiday reads as open
    during hours (the price simply does not move).
    """
    key = session_market(market)
    if key in _ALWAYS_OPEN:
        return True
    if key not in _OPENS:
        return None
    tz, closing_time = _SESSIONS[key]
    local = (now or datetime.now(timezone.utc)).astimezone(tz)
    return local.weekday() < 5 and _OPENS[key] <= local.time() < closing_time


def price_session_date(market: Optional[str], stamp: Optional[datetime]) -> Optional[date]:
    """The trading day a price stamped at `stamp` belongs to, in the market's zone.

    A price fetched before a day's open (or on a weekend) is the previous
    session's close, so it belongs to that session. None when unknown.
    """
    key = session_market(market)
    if stamp is None or key not in _OPENS:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    tz, _ = _SESSIONS[key]
    local = stamp.astimezone(tz)
    day = local.date()
    if local.weekday() >= 5 or local.time() < _OPENS[key]:
        day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day
