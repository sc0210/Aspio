"""
Exchange Rate Service for real-time currency conversion using ExchangeRate-API.

Caching Strategy (Redis removed):
1. In-memory dict cache with TTL tracking (module-level, lost on restart)
2. Database cache (daily, persists across restarts)

The in-memory cache replaces the Redis 1-hour tier. The database cache is
unchanged and continues to provide persistence.
"""

import asyncio
import contextlib
import logging
import time
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Optional
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, or_, select

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level in-memory cache: key -> {"value": Decimal, "expires_at": float}
# ---------------------------------------------------------------------------
_cache: Dict[str, Dict] = {}

_MEM_CACHE_TTL = 3600  # 1 hour, matching the former Redis TTL
# An estimate (last recorded rate, or the approximate table) is held only
# this long, so a live rate is tried again soon rather than an hour later.
_ESTIMATE_TTL = 600


def _mem_get(key: str) -> Optional[Decimal]:
    entry = _cache.get(key)
    if entry and time.time() < entry["expires_at"]:
        return entry["value"]
    if key in _cache:
        del _cache[key]
    return None


def _mem_set(key: str, value: Decimal, ttl: int = _MEM_CACHE_TTL) -> None:
    _cache[key] = {"value": value, "expires_at": time.time() + ttl}


# ---------------------------------------------------------------------------
# Single-flight guard: one in-flight miss per currency pair, process-wide.
#
# A dashboard load fans out into several concurrent requests (stats,
# wallet-trends, historical-trends, portfolio), each with its own session and
# its own ExchangeRateService. On a cold cache they all miss the same pair at
# the same moment, so every one of them used to call the upstream FX API and
# write its own duplicate currency_rates row — four USD->TWD fetches inside
# 550ms was the observed steady state. Serialising the miss path per pair
# collapses that to one fetch; the losers then read the cache the winner filled.
#
# Locks are keyed by pair and rebound when the running loop changes: an
# asyncio.Lock binds to the loop that first awaits it, and the test suite
# creates a fresh loop per case.
# ---------------------------------------------------------------------------
_inflight_locks: Dict[str, asyncio.Lock] = {}
_inflight_loop: Optional[asyncio.AbstractEventLoop] = None


def _inflight_lock(key: str) -> asyncio.Lock:
    global _inflight_loop

    loop = asyncio.get_running_loop()
    if _inflight_loop is not loop:
        _inflight_locks.clear()
        _inflight_loop = loop

    lock = _inflight_locks.get(key)
    if lock is None:
        lock = _inflight_locks[key] = asyncio.Lock()
    return lock


@contextlib.asynccontextmanager
async def _inflight(key: str):
    """Hold the pair's single-flight lock, and drop it from the registry once idle.

    The key comes from the request path, so keeping every lock forever let
    anonymous callers grow the registry by one entry per made-up pair.
    """
    lock = _inflight_lock(key)
    try:
        async with lock:
            yield
    finally:
        if not lock.locked() and not getattr(lock, "_waiters", None) and _inflight_locks.get(key) is lock:
            del _inflight_locks[key]


# The source written for a rate fetched live. Rows from before it carry the
# plain "exchangerate-api", which an outage also wrote for the hardcoded table.
LIVE_SOURCE = "exchangerate-api-live"


class ExchangeRateService:
    """
    Service for fetching and caching real-time exchange rates.

    Uses a 2-tier caching strategy:
    1. In-memory dict:  hourly cache (fast, lost on restart)
    2. Database:        daily cache (persists across restarts)
    """

    BASE_URL = "https://v6.exchangerate-api.com/v6"
    DB_CACHE_DAYS = 1

    def __init__(self, db_session: Optional[AsyncSession] = None):
        self.api_key = settings.EXCHANGE_RATES_API_KEY
        self.db_session = db_session
        # Keep these attributes for any code that reads them
        self._last_fetch: Dict[str, datetime] = {}
        self._cache: Dict[str, Dict[str, float]] = {}

    async def get_exchange_rate(
        self,
        from_currency: str,
        to_currency: str,
        force_refresh: bool = False,
    ) -> Optional[Decimal]:
        """
        Get exchange rate from one currency to another.

        Lookup order:
        1. In-memory cache (1 hour TTL for live rates)
        2. Database cache (a live rate recorded today)
        3. External API — saved to both caches
        4. The last live rate on record, however old — memory only, briefly
        5. The approximate table — memory only, briefly
        """
        from_currency = from_currency.upper()
        to_currency = to_currency.upper()

        if from_currency == to_currency:
            return Decimal("1.0")

        mem_key = f"exchange_rate:{from_currency}:{to_currency}"

        if not force_refresh:
            # 1. In-memory cache — the common case, taken without locking.
            cached = _mem_get(mem_key)
            if cached is not None:
                logger.debug(
                    f"In-memory cache hit: {from_currency}->{to_currency} = {cached}"
                )
                return cached

        # Everything below is the miss path: at most one caller per pair runs it
        # at a time, so concurrent misses cost one DB read and one API call
        # between them instead of one each.
        async with _inflight(mem_key):
            if not force_refresh:
                # The holder of the lock may have filled the cache while we
                # waited — that is the whole point of queueing here.
                cached = _mem_get(mem_key)
                if cached is not None:
                    logger.debug(
                        f"In-memory cache hit after wait: "
                        f"{from_currency}->{to_currency} = {cached}"
                    )
                    return cached

                # 2. Database cache
                db_rate = await self._get_from_db_cache(from_currency, to_currency)
                if db_rate is not None:
                    logger.debug(
                        f"Database cache hit: {from_currency}->{to_currency} = {db_rate}"
                    )
                    _mem_set(mem_key, db_rate)
                    return db_rate

            # 3. Fetch from API
            logger.info(
                f"Fetching exchange rate from API: {from_currency} -> {to_currency}"
            )
            rates = await self._fetch_rates(from_currency)
            if rates and to_currency in rates:
                rate = Decimal(str(rates[to_currency]))
                await self._save_to_db_cache(from_currency, to_currency, rate)
                _mem_set(mem_key, rate)
                return rate

            # No live rate. What follows is an estimate, so it is held in memory
            # briefly and never written to currency_rates. The API used to hand
            # back the hardcoded table on failure, and that got saved as
            # source="exchangerate-api" and served as today's rate for the rest
            # of the day.
            #
            # 4. The last real rate on record. Yesterday's USD->TWD is a far
            #    better answer than a table typed in by hand.
            last_known = await self._get_last_known_rate(from_currency, to_currency)
            if last_known is not None:
                logger.warning(
                    f"No live {from_currency}->{to_currency} rate; using the last "
                    f"one on record ({last_known})"
                )
                _mem_set(mem_key, last_known, ttl=_ESTIMATE_TTL)
                return last_known

            # 5. The approximate table, as a last resort.
            approximate = self._get_fallback_rates(from_currency).get(to_currency)
            if approximate is not None:
                rate = Decimal(str(approximate))
                logger.warning(
                    f"No live or recorded {from_currency}->{to_currency} rate; "
                    f"using the approximate table ({rate})"
                )
                _mem_set(mem_key, rate, ttl=_ESTIMATE_TTL)
                return rate

        logger.warning(f"Exchange rate not found: {from_currency} -> {to_currency}")
        return None

    async def get_usd_to_twd_rate(self) -> Optional[Decimal]:
        """Get current USD to TWD exchange rate."""
        return await self.get_exchange_rate("USD", "TWD")

    async def _fetch_rates(self, base_currency: str) -> Optional[Dict[str, float]]:
        """Live rates from ExchangeRate-API, or None when there are none.

        None, not the approximate table: a caller has to be able to tell a live
        rate from an estimate. get_exchange_rate falls back itself — to the last
        recorded rate first — and get_multiple_rates' callers label theirs.
        """
        if not self.api_key:
            logger.warning("EXCHANGE_RATES_API_KEY not configured; no live rates")
            return None

        try:
            url = f"{self.BASE_URL}/{self.api_key}/latest/{base_currency}"
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()

                if data.get("result") == "success":
                    rates = data.get("conversion_rates", {})
                    logger.info(
                        f"Fetched exchange rates for {base_currency} from API"
                    )
                    # Keep internal _cache/last_fetch for compat
                    cache_key = f"rates:{base_currency}"
                    self._cache[cache_key] = rates
                    self._last_fetch[base_currency] = datetime.now(timezone.utc)
                    return rates
                else:
                    logger.error(
                        f"ExchangeRate-API error: "
                        f"{data.get('error-type', 'Unknown error')}"
                    )
                    return None

        # The API key is part of the URL, and httpx puts the URL in its error
        # text: log the error's type and status, never the error itself.
        except httpx.HTTPStatusError as e:
            logger.warning(f"ExchangeRate-API answered HTTP {e.response.status_code} for {base_currency}")
            return None
        except httpx.RequestError as e:
            logger.warning(f"Could not reach ExchangeRate-API for {base_currency}: {type(e).__name__}")
            return None
        except Exception as e:
            logger.error(f"Error fetching exchange rates for {base_currency}: {type(e).__name__}")
            return None

    @staticmethod
    def _table_rates(base_currency: str) -> Dict[str, float]:
        """The hardcoded table from `base_currency`, without logging; {} for an unknown base."""
        usd_rates = {
            "USD": 1.0,
            "TWD": 31.5,
            "JPY": 150.0,
            "KRW": 1300.0,
            "CNY": 7.2,
            "HKD": 7.8,
            "SGD": 1.35,
            "EUR": 0.92,
            "GBP": 0.79,
            "THB": 35.0,
            "MYR": 4.7,
            "PHP": 56.0,
            "IDR": 15600.0,
            "VND": 24500.0,
        }
        if base_currency not in usd_rates:
            return {}
        base_to_usd = 1.0 / usd_rates[base_currency]
        return {currency: usd_rate * base_to_usd for currency, usd_rate in usd_rates.items()}

    def _get_fallback_rates(self, base_currency: str) -> Dict[str, float]:
        """Approximate fallback rates when API is unavailable."""
        rates = self._table_rates(base_currency)
        if rates:
            logger.info(f"Using fallback {base_currency} exchange rates")
        else:
            logger.warning(f"No fallback rates for {base_currency}")
        return rates

    async def _get_from_db_cache(
        self, from_currency: str, to_currency: str
    ) -> Optional[Decimal]:
        """Get exchange rate from database cache (valid for today, UTC).

        "Today" is UTC's, because `rate_timestamp` is written in UTC. Taking the
        host's local date instead made the window wrong by the UTC offset: in
        Taipei (UTC+8) every rate saved between local midnight and 08:00 sits
        before a local-midnight cutoff that is really 16:00 UTC the previous day,
        so the cache missed every lookup for eight hours a day and the service
        went back out to the provider — or fell through to a table estimate.

        A table estimate saved as live earlier today, before #386 stopped that,
        is passed over like everywhere else (see not_a_saved_estimate).
        """
        if not self.db_session:
            return None

        try:
            from app.modules.portfolio.models import CurrencyRate

            today_start = datetime.combine(
                datetime.now(timezone.utc).date(), datetime.min.time(), tzinfo=timezone.utc
            )

            conditions = [
                CurrencyRate.from_currency == from_currency,
                CurrencyRate.to_currency == to_currency,
                CurrencyRate.rate_timestamp >= today_start,
            ]
            trusted = not_a_saved_estimate(CurrencyRate, from_currency, to_currency)
            if trusted is not None:
                conditions.append(trusted)

            stmt = (
                select(CurrencyRate)
                .where(and_(*conditions))
                .order_by(CurrencyRate.rate_timestamp.desc())
                .limit(1)
            )

            result = await self.db_session.execute(stmt)
            currency_rate = result.scalar_one_or_none()

            if currency_rate:
                logger.debug(
                    f"DB cache hit: {from_currency}->{to_currency} "
                    f"from {currency_rate.rate_timestamp}"
                )
                return currency_rate.rate

        except Exception as e:
            logger.warning(f"Error reading from database cache: {e}", exc_info=True)

        return None

    async def _get_last_known_rate(
        self, from_currency: str, to_currency: str
    ) -> Optional[Decimal]:
        """The most recent recorded rate for the pair, however old.

        A table estimate saved as live is passed over (see not_a_saved_estimate).
        """
        if not self.db_session:
            return None

        try:
            from app.modules.portfolio.models import CurrencyRate

            conditions = [
                CurrencyRate.from_currency == from_currency,
                CurrencyRate.to_currency == to_currency,
            ]
            trusted = not_a_saved_estimate(CurrencyRate, from_currency, to_currency)
            if trusted is not None:
                conditions.append(trusted)

            stmt = (
                select(CurrencyRate)
                .where(and_(*conditions))
                .order_by(CurrencyRate.rate_timestamp.desc())
                .limit(1)
            )
            result = await self.db_session.execute(stmt)
            currency_rate = result.scalar_one_or_none()
            return currency_rate.rate if currency_rate else None

        except Exception as e:
            logger.warning(f"Error reading the last recorded rate: {e}", exc_info=True)
            return None

    async def _save_to_db_cache(
        self, from_currency: str, to_currency: str, rate: Decimal
    ) -> None:
        """Save exchange rate to database for daily caching."""
        if not self.db_session:
            logger.debug("No database session, skipping DB cache")
            return

        # Written through a session of its own. The one passed in belongs to the
        # caller's unit of work, and a rate lookup can happen in the middle of it:
        # committing that session here committed the caller's pending writes
        # early, and rolling it back after a failed cache insert discarded them.
        try:
            from app.core.database import async_session
            from app.modules.portfolio.models import CurrencyRate

            async with async_session() as cache_session:
                cache_session.add(
                    CurrencyRate(
                        from_currency=from_currency,
                        to_currency=to_currency,
                        rate=rate,
                        source=LIVE_SOURCE,
                        rate_timestamp=datetime.now(timezone.utc),
                    )
                )
                await cache_session.commit()

            logger.info(
                f"Saved to DB cache: {from_currency}->{to_currency} = {rate}"
            )

        except Exception as e:
            # A cache row that failed to save costs one more API call later. It
            # must not cost the caller its transaction.
            logger.warning(f"Error saving to database cache: {e}", exc_info=True)

    async def get_multiple_rates(
        self, base_currency: str, target_currencies: list[str]
    ) -> Dict[str, Optional[Decimal]]:
        """Get multiple exchange rates at once."""
        rates = await self._fetch_rates(base_currency)

        result = {}
        for target in target_currencies:
            target = target.upper()
            if rates and target in rates:
                result[target] = Decimal(str(rates[target]))
            else:
                result[target] = None

        return result

def not_a_saved_estimate(currency_rate_model, from_currency: str, to_currency: str):
    """A condition that passes over the table's estimate saved as a live rate, or None.

    Until #386 an outage saved the hardcoded table with the same label a real
    fetch wrote ("exchangerate-api", or "ExchangeRate-API" from the refresh
    endpoint). A row carrying LIVE_SOURCE is trusted whatever its value, so a
    real HKD rate on the 7.8 peg stands. An older row is passed over only when
    it equals the table, rounded as numeric(12, 6) stores it.

    Every reader of currency_rates applies it: today's cache and the last-known
    rate here, and PortfolioRepository.get_latest_rate for holding values.
    """
    estimate = ExchangeRateService._table_rates(from_currency.upper()).get(to_currency.upper())
    if estimate is None:
        return None
    stored_estimate = Decimal(repr(estimate)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    return or_(
        currency_rate_model.source == LIVE_SOURCE,
        currency_rate_model.rate != stored_estimate,
    )


def get_exchange_rate_service(
    db_session: Optional[AsyncSession] = None,
) -> ExchangeRateService:
    """Get ExchangeRateService instance with optional database session."""
    return ExchangeRateService(db_session=db_session)


__all__ = [
    "ExchangeRateService",
    "get_exchange_rate_service",
]
