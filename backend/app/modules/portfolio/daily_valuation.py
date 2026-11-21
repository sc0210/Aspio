"""The rules every per-day portfolio value series shares.

Three loops value the same holdings day by day: GET /portfolio/daily-performance
(the dashboard chart and P&L calendar) and the dashboard's wallet trend and
historical trend (the strip above them). They used to disagree on the same
morning by about NT$125K on a NT$6M account, for two reasons this module fixes
for all three:

* FX. Only daily-performance converted each day at that day's rate; the trends
  used today's rate for every past day, so the month's opening value moved
  whenever the rate did.
* The latest close. A holding's current_price already holds a session's close
  once the price refresh ran after the bell, but the stored daily history only
  gets that close when the history job next runs. Until then a loop reading
  only the history carried the previous close over the newest day, so a
  Friday move in US funds was simply missing from the calendar.
"""

import logging
from bisect import bisect_right
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Dict, Optional, Tuple

from app.utils.market_sessions import (
    last_settled_close,
    price_session_date,
    session_market,
    session_timezone,
)

from .performance_tracker import FX_SERIES

logger = logging.getLogger(__name__)


def settled_quote_day(holding, now: Optional[datetime] = None) -> Optional[date]:
    """The trading day whose close the holding's current_price is, or None.

    Two conditions, both needed. The price was written after the market's most
    recent final close (bell plus grace), and it belongs to that same session:
    a price fetched during the next session is also later than the last close,
    but it is a partial price of a newer day, not that close. Exchange labels
    (NASDAQ, TWSE) map to their session; markets with no modelled session
    (crypto, SG, ...) give None and keep their existing pricing.
    """
    market = session_market(getattr(holding, "market", None))
    tz = session_timezone(market)
    stamped = getattr(holding, "last_price_update_at", None)
    if tz is None or stamped is None or not holding.current_price:
        return None
    settled = last_settled_close(market, now)
    if settled is None:
        return None
    if stamped.tzinfo is None:
        stamped = stamped.replace(tzinfo=timezone.utc)
    close_day = settled.astimezone(tz).date()
    if stamped < settled or price_session_date(market, stamped) != close_day:
        return None
    return close_day


class DailyFx:
    """Units of base currency per unit of a holding's currency, on a given day.

    Past days use the stored FX closes (TWD=X), carried over weekends and
    holidays for up to a week. Today, and any pair with no stored series, use
    the live rate, fetched once per currency, which is also what the headline
    totals use, so the series' last point matches them.
    """

    def __init__(self, base_currency: str, end_date: date, closes, exchange_service):
        self._base = base_currency.upper()
        self._end = end_date
        self._closes: Dict[str, Tuple[list, list]] = closes
        self._exchange = exchange_service
        self._live: Dict[str, Optional[Decimal]] = {}

    @classmethod
    async def load(
        cls, hist_price_service, exchange_service, base_currency: str,
        from_date: date, end_date: date,
    ) -> "DailyFx":
        """`from_date` is the first day that will be asked for, less a buffer
        for the close before it (a Monday asked about on its own needs Friday's)."""
        closes: Dict[str, Tuple[list, list]] = {}
        if base_currency.upper() in ("TWD", "USD"):
            try:
                raw = await hist_price_service.get_batch_price_range(
                    symbols=sorted(set(FX_SERIES.values())),
                    start_date=from_date,
                    end_date=end_date,
                )
            except Exception as e:
                # Every day then converts at the live rate: a flatter FX line,
                # not a missing series. One failed read used to take down the
                # whole portfolio trend.
                logger.error(f"Stored FX closes unavailable, using the live rate: {e}")
                raw = {}
            for fx_symbol, by_day in (raw or {}).items():
                points = sorted(
                    (date.fromisoformat(d), Decimal(str(v["close"])))
                    for d, v in by_day.items() if v and v.get("close")
                )
                closes[fx_symbol] = ([d for d, _ in points], [c for _, c in points])
        return cls(base_currency, end_date, closes, exchange_service)

    def _twd_per(self, currency: str, day: Optional[date]) -> Optional[Decimal]:
        if day is None or day >= self._end:
            return None
        series = self._closes.get(FX_SERIES.get(currency, ""))
        if not series:
            return None
        dates, closes = series
        i = bisect_right(dates, day) - 1
        # A weekend or holiday carries the last close; a longer gap is a
        # missing series, not a market at rest.
        if i < 0 or (day - dates[i]).days > 7:
            return None
        return closes[i]

    async def rate(self, currency: Optional[str], day: Optional[date]) -> Optional[Decimal]:
        cur = (currency or "USD").upper()
        if cur == self._base:
            return Decimal("1")
        rate = None
        if self._base == "TWD":
            rate = self._twd_per(cur, day)
        elif cur == "TWD":
            twd_per_base = self._twd_per(self._base, day)
            rate = (Decimal("1") / twd_per_base) if twd_per_base else None
        if rate:
            return rate
        if cur not in self._live:
            try:
                self._live[cur] = await self._exchange.get_exchange_rate(
                    from_currency=cur, to_currency=self._base
                )
            except Exception as e:
                logger.error(f"Error fetching {cur}->{self._base} rate: {e}")
                self._live[cur] = None
        return self._live[cur]
