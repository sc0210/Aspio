"""
Market Data Service for Aspiro Portfolio

This service routes market data requests to appropriate APIs based on market type:
- FinLab for Taiwan stocks (TWSE, TPEx)
- TradingView for US and global stocks
- Yahoo Finance as fallback

⚡ API OPTIMIZATION STRATEGY (for free tier limits):
1. FinLab data.get() fetches ENTIRE market - cache at market level, not symbol level
2. Reuse cached market data for multiple symbol lookups
3. Use database storage for historical data (avoids re-fetching)
4. Smart TTL: cache until market close (~13:30 TST)
5. Deduplication: in-flight request tracking prevents duplicate API calls

⚡ ROBUSTNESS IMPROVEMENTS (2026-04-01):
1. 10-30 second timeouts on all API calls
2. Retry logic with exponential backoff (3 attempts)
3. NaN validation before returning data
4. Fallback strategies when primary provider fails
"""

import logging
import asyncio
import math
from datetime import datetime, timedelta, time as dt_time, date as date_cls
from typing import List, Dict, Optional, Any
from decimal import Decimal
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# Cache namespace identifier (kept for log messages)
FINLAB_CACHE_NAMESPACE = "finlab_market_data"

# ---------------------------------------------------------------------------
# Module-level in-memory TTL cache replacing Redis symbol-level caching.
# Structure: key -> {"value": ..., "expires_at": float}
# ---------------------------------------------------------------------------
import time as _time

_symbol_cache: dict = {}


def _sym_cache_get(key: str):
    entry = _symbol_cache.get(key)
    if entry and _time.time() < entry["expires_at"]:
        return entry["value"]
    if key in _symbol_cache:
        del _symbol_cache[key]
    return None


def _sym_cache_set(key: str, value, ttl: int) -> None:
    _symbol_cache[key] = {"value": value, "expires_at": _time.time() + ttl}

# In-memory cache for FinLab market DataFrames (shared across requests)
# This prevents multiple API calls when fetching data for multiple symbols.
# ⚠️ MEMORY: frames stored here MUST be truncated to the FinLab window —
# a full-history frame for the whole TW market is ~100MB, and holding five of
# them OOMs a 512MB Railway instance. See _fetch_finlab_market_window.
_finlab_market_cache: Dict[str, Any] = {
    "close": None,
    "open": None,
    "high": None,
    "low": None,
    "volume": None,
    "window_start": None,  # earliest date covered by the cached frames
    "last_fetch": None,
    "fetch_lock": None,  # Will be initialized as asyncio.Lock
    # Single-flight state. The worker thread behind a fetch cannot be
    # cancelled, so a caller timing out MUST NOT allow a second fetch to
    # start: two concurrent whole-market parses is exactly what OOMs a
    # 512MB host. "fetch_task" is the one in-flight fetch (shared by all
    # waiters); "failed_at" starts the retry cooldown after a failure.
    "fetch_task": None,
    "failed_at": None,
}

# Track in-flight requests to prevent duplicate API calls
_inflight_requests: Dict[str, asyncio.Event] = {}


def _get_cache_ttl_until_market_close() -> int:
    """
    Calculate TTL (in seconds) until Taiwan market close (13:30 TST)
    If market is closed, return TTL until next trading day's close

    Returns:
        int: Seconds until market close (min 3600, max 86400)
    """
    tw_tz = ZoneInfo("Asia/Taipei")
    now = datetime.now(tw_tz)

    # Taiwan market closes at 13:30
    market_close = now.replace(hour=13, minute=30, second=0, microsecond=0)

    # If already past today's close, use tomorrow's close
    if now.time() > dt_time(13, 30):
        market_close += timedelta(days=1)

    # Skip weekends
    while market_close.weekday() >= 5:  # Saturday=5, Sunday=6
        market_close += timedelta(days=1)

    ttl_seconds = int((market_close - now).total_seconds())

    # Ensure TTL is at least 1 hour and at most 24 hours
    ttl_seconds = max(3600, min(ttl_seconds, 86400))

    logger.info(
        f"FinLab cache TTL: {ttl_seconds}s ({ttl_seconds/3600:.1f} hours) until market close"
    )
    return ttl_seconds


# Fallback when settings.FINLAB_WINDOW_DAYS is unavailable.
DEFAULT_FINLAB_WINDOW_DAYS = 400

# Taiwan tickers reach us in both forms — bare ("0050") from FinLab-era rows and
# Yahoo-style ("0050.TW") from holdings created through the US path. The two
# providers want opposite forms, so normalise per provider rather than trusting
# whatever the caller passed. The spellings themselves live in `symbols`, which
# also decides which one gets stored.
from .symbols import _TW_SUFFIXES, to_bare_tw_symbol, to_yahoo_tw_symbol
from app.utils.datetime_helpers import business_now, business_today
from app.utils.datetime_helpers import utc_now


# TWSE rejects requests without a browser-ish UA, and throttles at roughly
# 3 requests / 5 seconds — exceeded, it starts returning empty payloads.
TWSE_USER_AGENT = "Mozilla/5.0 (compatible; Aspiro/1.0)"
TWSE_REQUEST_INTERVAL_SECONDS = 2.0

# STOCK_DAY row layout:
#   [date, volume, turnover, open, high, low, close, change, transactions]
_TWSE_DATE, _TWSE_VOLUME = 0, 1
_TWSE_OPEN, _TWSE_HIGH, _TWSE_LOW, _TWSE_CLOSE = 3, 4, 5, 6

# Dates come as Republic-of-China years: "115/08/13" is 2026-08-13.
_ROC_YEAR_OFFSET = 1911


def _twse_number(raw: Any) -> Optional[float]:
    """Parse a TWSE cell: thousands separators, and "--" for a no-trade day."""
    if raw is None:
        return None
    text_val = str(raw).replace(",", "").strip()
    if not text_val or text_val in {"--", "---", "X"}:
        return None
    try:
        value = float(text_val)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _parse_twse_row(row: List[str]) -> Optional[Dict[str, Any]]:
    """One STOCK_DAY row -> the same dict shape the other providers return."""
    if not row or len(row) <= _TWSE_CLOSE:
        return None

    try:
        roc_year, month, day = str(row[_TWSE_DATE]).split("/")
        iso_date = date_cls(
            int(roc_year) + _ROC_YEAR_OFFSET, int(month), int(day)
        ).isoformat()
    except (ValueError, TypeError):
        return None

    close = _twse_number(row[_TWSE_CLOSE])
    if close is None or close <= 0:
        # Suspended or no trades — no bar to record.
        return None

    volume = _twse_number(row[_TWSE_VOLUME])
    return {
        "date": iso_date,
        "open": _twse_number(row[_TWSE_OPEN]),
        "high": _twse_number(row[_TWSE_HIGH]),
        "low": _twse_number(row[_TWSE_LOW]),
        "close": close,
        "volume": int(volume) if volume is not None else None,
        "source": "twse",
    }


def resolve_symbol_market(symbol: str, candidate_markets) -> str:
    """Pick the market to fetch a symbol under when holdings disagree.

    ``PortfolioHolding.market`` is user-supplied and often wrong — the same
    ticker shows up as both TW and US across holdings. Every batch fetch is
    keyed by symbol, so letting row order decide the provider sends a TW ETF to
    the US provider, which 404s and drops the caller onto a stale fallback.
    """
    base = (symbol or "").upper()

    # A Taiwan ticker is recognisable from the symbol itself (bare numeric code
    # or Yahoo suffix), so trust that over any market label attached to it.
    if base.endswith(_TW_SUFFIXES) or base.split(".")[0].isdigit():
        return "TW"

    labels = {m for m in candidate_markets if m}
    if len(labels) == 1:
        return next(iter(labels))

    # Genuinely ambiguous: prefer an exchange-specific label over the "US"
    # default, which is what an unset market falls back to.
    non_us = sorted(m for m in labels if m.upper() != "US")
    return non_us[0] if non_us else "US"

# How long a caller waits for the whole-market fetch (five OHLCV tables)
# before falling back to Yahoo. The fetch itself keeps running in the
# background and populates the cache when it completes.
FINLAB_FETCH_TIMEOUT_SECONDS = 150.0

# After a fetch fails, don't start another one for this long — fail fast to
# the Yahoo fallback instead of re-triggering ~100MB downloads back-to-back.
FINLAB_FETCH_COOLDOWN_SECONDS = 600.0


_finlab_storage_configured = False


def _finlab_cache_covers(window_start: datetime) -> bool:
    """True if the cached market frames are fresh and span back to window_start."""
    if _finlab_market_cache["close"] is None or not _finlab_market_cache["last_fetch"]:
        return False
    cached_start = _finlab_market_cache.get("window_start")
    if cached_start is not None and cached_start > window_start:
        return False
    return utc_now() - _finlab_market_cache["last_fetch"] < timedelta(hours=1)


def _fetch_finlab_market_window(
    token: Optional[str], window_start: datetime
) -> Dict[str, Any]:
    """
    Blocking fetch of the five TW-market OHLCV tables, truncated to window_start.

    Runs in a worker thread (finlab.login and data.get are blocking network
    calls). Memory-critical: each finlab table is the FULL market history
    (~100MB) and data.get has no partial-download option, so every internal
    reference finlab keeps must be neutralized:
    - storage → FileStorage(use_cache=False): disk-only, no in-RAM table copies
    - data.truncate_start: finlab finalizes/returns only rows >= window_start,
      so its finalized-result cache (finlab>=2.x) holds small frames, not full ones
    - _finalized_cache.clear(): drop finalized references outright (finlab>=2.x;
      pandas copy-on-write slices can still pin the full parent buffers)
    - our frames are deep-copied so nothing references the full download
    """
    import gc

    import finlab
    from finlab import data

    if token:
        finlab.login(token)

    global _finlab_storage_configured
    if not _finlab_storage_configured:
        try:
            data.set_storage(data.FileStorage(use_cache=False))
        except Exception as e:
            logger.warning(
                f"finlab disk-only storage unavailable ({e}); "
                "default storage will keep full market tables in RAM"
            )
        _finlab_storage_configured = True

    # Left set on purpose: any future data.get elsewhere in the process stays
    # truncated instead of silently materializing full-history frames.
    data.truncate_start = window_start.strftime("%Y-%m-%d")

    datasets = {
        "close": "price:收盤價",
        "open": "price:開盤價",
        "high": "price:最高價",
        "low": "price:最低價",
        "volume": "price:成交股數",
    }

    frames: Dict[str, Any] = {}
    for key, dataset in datasets.items():
        full = data.get(dataset)
        # Manual slice as defense in case truncate_start is ignored by the
        # installed finlab version; .copy() materializes the slice so `full`
        # can actually be freed (a copy-on-write slice would keep the parent's
        # buffers alive).
        frames[key] = full.loc[full.index >= window_start].copy()
        del full
        gc.collect()

    try:
        from finlab.data.context import _default_context

        _default_context._finalized_cache.clear()
    except Exception:
        pass  # finlab<2.x has no finalized cache
    gc.collect()

    return frames


async def _finlab_market_fetch_task(
    token: Optional[str], window_start: datetime
) -> None:
    """
    The single in-flight whole-market fetch. Callers wait on this task through
    asyncio.shield, so a caller timing out never cancels it — it runs to
    completion and lands its frames in _finlab_market_cache, where the next
    request finds them instead of triggering a re-download.
    """
    try:
        frames = await asyncio.to_thread(
            _fetch_finlab_market_window, token, window_start
        )
        _finlab_market_cache.update(frames)
        _finlab_market_cache["window_start"] = window_start
        _finlab_market_cache["last_fetch"] = utc_now()
        _finlab_market_cache["failed_at"] = None
        logger.info(
            "💾 Truncated market data cached in memory "
            "(subsequent symbols = 0 API calls)"
        )
    except Exception as e:
        _finlab_market_cache["failed_at"] = utc_now()
        logger.error(f"❌ FinLab market fetch failed: {e}", exc_info=True)
        raise
    finally:
        _finlab_market_cache["fetch_task"] = None



class MarketDataService:
    """
    Unified market data service that routes to appropriate API providers
    """

    def __init__(
        self,
        finlab_token: Optional[str] = None,
        tradingview_key: Optional[str] = None,
        enable_finlab: bool = True,
        enable_tradingview: bool = True,
        enable_yahoo: bool = True,
    ):
        """
        Initialize market data service

        Args:
            finlab_token: FinLab API token for Taiwan stocks
            tradingview_key: TradingView API key for US stocks
            enable_finlab: Whether to enable FinLab integration
            enable_tradingview: Whether to enable TradingView integration
            enable_yahoo: Whether to enable Yahoo Finance fallback
        """
        from app.core.config import get_settings

        self.finlab_token = finlab_token
        self.tradingview_key = tradingview_key
        # settings.FINLAB_ENABLED is a global kill switch: it lets ops disable
        # the memory-heavy whole-market FinLab path on memory-capped hosts
        # without code changes (TW symbols then use the Yahoo fallback).
        self.enable_finlab = (
            enable_finlab
            and bool(finlab_token)
            and getattr(get_settings(), "FINLAB_ENABLED", True)
        )
        self.enable_tradingview = enable_tradingview and bool(tradingview_key)
        self.enable_yahoo = enable_yahoo

        logger.debug(
            f"MarketDataService initialized - "
            f"FinLab: {self.enable_finlab}, "
            f"TradingView: {self.enable_tradingview}, "
            f"Yahoo: {self.enable_yahoo}"
        )

    async def get_historical_data(
        self, symbol: str, market: str, days: int = 365
    ) -> List[Dict[str, Any]]:
        """
        Get historical price data for a symbol

        Args:
            symbol: Stock symbol (e.g., "0050", "AAPL", "BTC-USD")
            market: Market type ("TW", "US", "CRYPTO", etc.)
            days: Number of days of historical data

        Returns:
            List of historical data points with date, open, high, low, close, volume
        """
        # Skip API calls for cash/non-tradeable symbols
        if symbol.startswith(("CASH-", "EMERGENCY-", "CPF-", "TWD-", "USD-", "SGD-")):
            logger.debug(f"Skipping historical data fetch for cash symbol: {symbol}")
            return []

        logger.debug(f"Fetching historical data: {symbol} ({market}) - {days} days")

        try:
            if market == "TW":
                # Taiwan stocks - use FinLab with Yahoo fallback
                if self.enable_finlab:
                    try:
                        finlab_data = await self._get_finlab_historical(symbol, days)
                        if finlab_data:
                            logger.debug(f"✅ FinLab success for {symbol}")
                            return finlab_data
                        logger.warning(
                            f"⚠️ FinLab returned no data for {symbol}, trying Yahoo fallback"
                        )
                    except Exception as e:
                        logger.error(
                            f"❌ FinLab error for {symbol}: {str(e)}, trying Yahoo fallback"
                        )

                # ⚡ FALLBACK: Use Yahoo Finance (add .TW suffix if not present)
                if self.enable_yahoo:
                    yahoo_symbol = to_yahoo_tw_symbol(symbol)
                    logger.debug(f"📥 Falling back to Yahoo for {symbol}")
                    yahoo_data = await self._get_yahoo_historical(yahoo_symbol, days)
                    if yahoo_data:
                        logger.debug(f"✅ Yahoo fallback success for {symbol}")
                        return yahoo_data
                    logger.warning(f"⚠️ Yahoo also failed for {symbol}")

                # ⚡ LAST RESORT: the exchange itself. Both commercial feeds drop
                # individual sessions — neither had 0050's 2026-08-13 bar, which
                # the exchange publishes as 106.70 — and a hole in the series
                # misstates every chart and day change spanning it.
                twse_data = await self._get_twse_historical(symbol, days)
                if twse_data:
                    logger.info(f"✅ TWSE fallback success for {symbol}")
                    return twse_data

                logger.warning(f"⚠️ No TW provider returned data for {symbol}")
                return []

            elif market in ["US", "NYSE", "NASDAQ"]:
                # US stocks - use TradingView or Yahoo fallback
                if self.enable_tradingview:
                    return await self._get_tradingview_historical(symbol, days)
                elif self.enable_yahoo:
                    return await self._get_yahoo_historical(symbol, days)
                else:
                    logger.warning("No provider available for US stocks")
                    return []

            elif market in ("TW-INDEX", "FX"):
                # Indices (^TWII) and FX pairs (TWD=X) are Yahoo-only and keep
                # their symbol as is: the TW path would append ".TW", and FinLab
                # has neither.
                if self.enable_yahoo:
                    return await self._get_yahoo_historical(symbol, days)
                return []

            elif market == "CRYPTO":
                # Cryptocurrency - use Yahoo Finance
                if self.enable_yahoo:
                    return await self._get_yahoo_historical(symbol, days)
                else:
                    logger.warning("No provider available for crypto")
                    return []

            else:
                # Unknown market - try Yahoo Finance
                logger.warning(f"Unknown market type: {market}, using Yahoo fallback")
                if self.enable_yahoo:
                    return await self._get_yahoo_historical(symbol, days)
                return []

        except Exception as e:
            logger.error(f"Error fetching historical data for {symbol}: {str(e)}")
            return []

    async def _get_finlab_historical(
        self, symbol: str, days: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch historical data from FinLab API (Taiwan stocks)

        ⚡ API OPTIMIZATION: FinLab data.get() fetches ENTIRE market data in one call.
        We cache the market-level DataFrames in memory and reuse them for multiple symbols.
        This dramatically reduces API calls when syncing multiple TW stocks.

        Based on FinLab official documentation:
        https://doc.finlab.tw/reference/data/

        Args:
            symbol: Taiwan stock symbol (e.g., "0050", "2330")
            days: Number of days of historical data

        Returns:
            List of historical data points
        """
        global _finlab_market_cache, _inflight_requests

        try:
            try:
                # Importability probe only — the actual fetch (login + data.get)
                # runs in a worker thread via _fetch_finlab_market_window.
                import finlab  # noqa: F401
            except ImportError:
                logger.warning("finlab not installed — falling back to Yahoo Finance for TW stocks")
                if self.enable_yahoo:
                    return await self._get_yahoo_historical(
                        to_yahoo_tw_symbol(symbol), days
                    )
                return []

            # FinLab indexes the market by bare ticker code, so a holding stored
            # as "0050.TW" must be looked up as "0050" or it reads as unknown.
            symbol = to_bare_tw_symbol(symbol)

            from datetime import datetime, timedelta
            import pandas as pd

            from app.core.config import get_settings

            logger.info(f"Fetching FinLab data for {symbol}")

            # Calculate start and end dates on the business day, not the
            # container's, so the window matches the dates everything else uses.
            # (In practice a UTC end rarely loses a bar: TW closes 13:30 Taipei and
            # publishes after 14:00, which is 06:00 UTC on the same date. The point
            # is consistency with the rest of the app, not a lost bar.)
            # Naive on purpose: this is compared against FinLab's DataFrame index,
            # which is tz-naive, and mixing the two raises. What matters is that the
            # wall clock is Taipei's rather than the container's.
            end_date = business_now().replace(tzinfo=None)
            start_date = end_date - timedelta(days=days)

            # ⚡ MEMORY GUARD: the in-memory market cache only spans
            # FINLAB_WINDOW_DAYS. Longer lookbacks fall back to Yahoo
            # (per-symbol fetch, cheap on RAM).
            window_days = (
                getattr(
                    get_settings(), "FINLAB_WINDOW_DAYS", DEFAULT_FINLAB_WINDOW_DAYS
                )
                or DEFAULT_FINLAB_WINDOW_DAYS
            )
            if days > window_days:
                logger.info(
                    f"FinLab window capped at {window_days}d "
                    f"(requested {days}d for {symbol}) — deferring to Yahoo fallback"
                )
                return []

            window_start = end_date - timedelta(days=window_days)

            # ===== STEP 1: Check symbol-level in-memory cache =====
            # Keyed on the business day so the cache turns over at midnight Taipei
            # rather than 08:00, which is when a UTC key would roll.
            cache_date = business_today().strftime("%Y-%m-%d")
            cache_key = f"{FINLAB_CACHE_NAMESPACE}:{symbol}:{cache_date}:{days}d"

            cached_symbol_data = _sym_cache_get(cache_key)

            if cached_symbol_data is not None:
                logger.info(f"✅ In-memory cache HIT for {symbol} (0 API calls)")
                return cached_symbol_data

            # ===== STEP 2: Check in-memory market-level cache =====
            # This is key to reducing API calls when syncing multiple symbols
            market_cache_valid = _finlab_cache_covers(window_start)
            if market_cache_valid:
                logger.debug("✅ Memory cache HIT for TW market data")

            # ===== STEP 3: Fetch market data if not cached =====
            if not market_cache_valid:
                # Initialize lock if needed
                if _finlab_market_cache["fetch_lock"] is None:
                    _finlab_market_cache["fetch_lock"] = asyncio.Lock()

                # The lock only guards fetch-task creation (single-flight);
                # waiting happens outside it so a slow fetch doesn't chain
                # each waiter's timeout behind the previous caller's.
                fetch_task = None
                async with _finlab_market_cache["fetch_lock"]:
                    if _finlab_cache_covers(window_start):
                        logger.info(
                            "✅ Memory cache populated while waiting (0 API calls)"
                        )
                    else:
                        failed_at = _finlab_market_cache.get("failed_at")
                        if failed_at is not None and (
                            (utc_now() - failed_at).total_seconds()
                            < FINLAB_FETCH_COOLDOWN_SECONDS
                        ):
                            logger.warning(
                                "FinLab fetch cooling down after a recent "
                                f"failure — using Yahoo fallback for {symbol}"
                            )
                            return []

                        fetch_task = _finlab_market_cache["fetch_task"]
                        if fetch_task is None or fetch_task.done():
                            logger.info(
                                f"📥 Fetching TW market data from FinLab "
                                f"(5 API calls, keeping last {window_days}d in memory)..."
                            )
                            fetch_task = asyncio.create_task(
                                _finlab_market_fetch_task(
                                    self.finlab_token, window_start
                                )
                            )
                            _finlab_market_cache["fetch_task"] = fetch_task
                        else:
                            logger.info(
                                "⏳ FinLab market fetch already in flight — waiting"
                            )

                if fetch_task is not None:
                    # shield: a timeout abandons only THIS caller's wait. The
                    # fetch's worker thread can't be cancelled anyway, and
                    # starting a second fetch alongside the orphaned thread is
                    # what OOM'd the 512MB host (two whole-market parses in
                    # RAM at once).
                    try:
                        await asyncio.wait_for(
                            asyncio.shield(fetch_task),
                            timeout=FINLAB_FETCH_TIMEOUT_SECONDS,
                        )
                    except asyncio.TimeoutError:
                        logger.error(
                            "❌ FinLab fetch still running after "
                            f"{FINLAB_FETCH_TIMEOUT_SECONDS:.0f}s — Yahoo "
                            f"fallback for {symbol}; fetch continues in background"
                        )
                        return []
                    except Exception:
                        # Fetch failed; _finlab_market_fetch_task already
                        # logged it and armed the cooldown.
                        return []

                        _finlab_market_cache.update(frames)
                        _finlab_market_cache["window_start"] = window_start
                        _finlab_market_cache["last_fetch"] = utc_now()

                        logger.info(
                            "💾 Truncated market data cached in memory "
                            "(subsequent symbols = 0 API calls)"
                        )

            # ===== STEP 4: Extract symbol data from cached market DataFrames =====
            close_df = _finlab_market_cache["close"]
            open_df = _finlab_market_cache["open"]
            high_df = _finlab_market_cache["high"]
            low_df = _finlab_market_cache["low"]
            volume_df = _finlab_market_cache["volume"]

            if close_df is None:
                logger.warning(f"FinLab market data unavailable for {symbol}")
                return []

            # Check if symbol exists in the data
            if symbol not in close_df.columns:
                logger.warning(f"FinLab: Symbol {symbol} not found in dataset")
                _sym_cache_set(cache_key, [], ttl=1800)  # negative cache 30min
                return []

            # Filter by date range
            close_series = close_df[symbol]
            close_series = close_series[close_series.index >= start_date]
            close_series = close_series[close_series.index <= end_date]

            if len(close_series) == 0:
                logger.warning(f"FinLab: No data in date range for {symbol}")
                _sym_cache_set(cache_key, [], ttl=1800)  # negative cache 30min (market closed / holiday)
                return []

            # Get corresponding OHLV data
            open_series = open_df[symbol].loc[close_series.index]
            high_series = high_df[symbol].loc[close_series.index]
            low_series = low_df[symbol].loc[close_series.index]
            volume_series = volume_df[symbol].loc[close_series.index]

            # Combine into historical data list
            historical_data = []
            for date_idx in close_series.index:
                # Skip if close price is missing
                if pd.isna(close_series[date_idx]):
                    continue

                historical_data.append(
                    {
                        "date": date_idx.isoformat(),
                        "open": (
                            float(open_series[date_idx])
                            if not pd.isna(open_series[date_idx])
                            else float(close_series[date_idx])
                        ),
                        "high": (
                            float(high_series[date_idx])
                            if not pd.isna(high_series[date_idx])
                            else float(close_series[date_idx])
                        ),
                        "low": (
                            float(low_series[date_idx])
                            if not pd.isna(low_series[date_idx])
                            else float(close_series[date_idx])
                        ),
                        "close": float(close_series[date_idx]),
                        "volume": (
                            int(volume_series[date_idx])
                            if not pd.isna(volume_series[date_idx])
                            else 0
                        ),
                    }
                )

            logger.info(
                f"FinLab: Retrieved {len(historical_data)} data points for {symbol}"
            )

            # Cache the symbol's historical data in-memory
            ttl_seconds = _get_cache_ttl_until_market_close()
            _sym_cache_set(cache_key, historical_data, ttl_seconds)
            logger.info(
                f"💾 Cached {symbol} data in memory (TTL: {ttl_seconds/3600:.1f}h)"
            )

            return historical_data

        except ImportError:
            logger.error("FinLab package not installed")
            return []
        except KeyError as e:
            logger.error(f"FinLab: Symbol {symbol} not found in dataset: {str(e)}")
            return []
        except Exception as e:
            logger.error(f"FinLab API error for {symbol}: {str(e)}")
            import traceback

            logger.debug(traceback.format_exc())
            return []

    async def _get_tradingview_historical(
        self, symbol: str, days: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch historical data from TradingView API (US/global stocks)

        Args:
            symbol: Stock symbol (e.g., "AAPL", "TSLA")
            days: Number of days of historical data

        Returns:
            List of historical data points
        """
        try:
            from tradingview_ta import TA_Handler, Interval

            logger.info(f"Fetching TradingView data for {symbol}")

            # TradingView TA library provides analysis, not historical data
            # For historical data, you'd need to use TradingView's WebSocket API
            # or REST API which requires different approach

            # This is a simplified implementation using current data only
            handler = TA_Handler(
                symbol=symbol,
                exchange="NASDAQ",
                screener="america",
                interval=Interval.INTERVAL_1_DAY,
            )

            analysis = handler.get_analysis()

            # Note: TradingView TA doesn't provide historical data easily
            # You might need to use their charting library or REST API
            # For now, return current data point only
            current_data = {
                "date": utc_now().isoformat(),
                "open": analysis.indicators.get("open", 0),
                "high": analysis.indicators.get("high", 0),
                "low": analysis.indicators.get("low", 0),
                "close": analysis.indicators.get("close", 0),
                "volume": analysis.indicators.get("volume", 0),
            }

            logger.warning(
                f"TradingView TA only provides current data, not full {days} days history"
            )
            return [current_data]

        except ImportError:
            logger.error("TradingView-TA package not installed")
            return []
        except Exception as e:
            logger.error(f"TradingView API error for {symbol}: {str(e)}")
            return []

    async def _get_yahoo_historical(
        self, symbol: str, days: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch historical data from Yahoo Finance (fallback for all markets)

        ⚡ OPTIMIZATION: Redis cache with 1-hour TTL to reduce API calls
        ⚡ ROBUSTNESS: 10-second timeout with retry logic

        Args:
            symbol: Stock symbol (e.g., "AAPL", "0050.TW", "BTC-USD")
            days: Number of days of historical data

        Returns:
            List of historical data points
        """
        try:
            import warnings
            import yfinance as yf
            import pandas as pd
            # yfinance internals call deprecated pd.Timestamp.utcnow — suppress until yfinance fixes it
            warnings.filterwarnings("ignore", message=".*utcnow.*", module="yfinance.*")

            # Check in-memory cache first
            cache_key = (
                f"yahoo_market_data:{symbol}:{days}d:"
                f"{business_today().strftime('%Y-%m-%d')}"
            )
            cached_data = _sym_cache_get(cache_key)

            if cached_data is not None:
                logger.debug(f"✅ Yahoo cache HIT for {symbol} (0 API calls)")
                return cached_data

            logger.debug(f"📥 Fetching Yahoo Finance data for {symbol}")

            # ⚡ FIX: Add timeout wrapper with retry logic
            max_retries = 3
            retry_delays = [1, 2, 4]  # Exponential backoff: 1s, 2s, 4s

            # Use start/end dates for reliable long-range fetches.
            # yfinance's period= only accepts specific strings (1d,5d,1mo,3mo,6mo,1y,2y,5y,max)
            # and silently truncates arbitrary Nd values like "365d" to ~90 days.
            from datetime import date as _date, timedelta as _td
            _end = business_today()
            _start = _end - _td(days=days)

            for attempt in range(max_retries):
                try:
                    # Wrap in asyncio.wait_for to add timeout
                    hist = await asyncio.wait_for(
                        asyncio.to_thread(
                            lambda: yf.Ticker(symbol).history(
                                start=_start.isoformat(),
                                end=(_end + _td(days=1)).isoformat(),  # end is exclusive in yfinance
                            )
                        ),
                        timeout=15.0  # slightly longer for large date ranges
                    )

                    if hist.empty:
                        logger.warning(f"No historical data found for {symbol}")
                        return []

                    historical_data = []
                    for date_idx, row in hist.iterrows():
                        # ⚡ VALIDATION: Skip rows with NaN values
                        if any(pd.isna(val) for val in [row["Open"], row["High"], row["Low"], row["Close"]]):
                            logger.warning(f"⚠️ Skipping row with NaN for {symbol} on {date_idx}")
                            continue

                        historical_data.append(
                            {
                                "date": date_idx.isoformat(),
                                "open": float(row["Open"]),
                                "high": float(row["High"]),
                                "low": float(row["Low"]),
                                "close": float(row["Close"]),
                                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
                            }
                        )

                    if historical_data:
                        logger.info(
                            f"Yahoo Finance: Retrieved {len(historical_data)} data points for {symbol}"
                        )

                        # Cache for 1 hour (in-memory)
                        _sym_cache_set(cache_key, historical_data, 3600)

                        return historical_data
                    else:
                        logger.warning(f"No valid data after filtering NaN for {symbol}")
                        return []

                except asyncio.TimeoutError:
                    if attempt < max_retries - 1:
                        delay = retry_delays[attempt]
                        logger.warning(
                            f"⏱️ Yahoo API timeout for {symbol} (attempt {attempt + 1}/{max_retries}), "
                            f"retrying in {delay}s..."
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"❌ Yahoo API timeout for {symbol} after {max_retries} attempts")
                        return []

                except Exception as e:
                    if attempt < max_retries - 1:
                        delay = retry_delays[attempt]
                        logger.warning(
                            f"⚠️ Yahoo API error for {symbol}: {str(e)} "
                            f"(attempt {attempt + 1}/{max_retries}), retrying in {delay}s..."
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.error(
                            f"❌ Yahoo API error for {symbol} after {max_retries} attempts: {str(e)}"
                        )
                        return []

            return []

        except ImportError:
            logger.error("yfinance package not installed")
            return []
        except Exception as e:
            logger.error(f"Yahoo Finance error for {symbol}: {str(e)}")
            return []

    async def get_current_price(self, symbol: str, market: str) -> Optional[Decimal]:
        """
        Get current price for a symbol

        ⚡ PERFORMANCE: Uses cached historical data, only fetches 5 days to minimize API calls
        Falls back to real-time fetch if historical data unavailable

        Args:
            symbol: Stock symbol
            market: Market type

        Returns:
            Current price as Decimal or None
        """
        # Skip API calls for cash/non-tradeable symbols
        if symbol.startswith(("CASH-", "EMERGENCY-", "CPF-", "TWD-", "USD-", "SGD-")):
            logger.debug(f"Skipping price fetch for cash symbol: {symbol}")
            return None

        logger.debug(f"Fetching current price: {symbol} ({market})")

        try:
            # PRIMARY: authoritative real-time / last-traded quote.
            # The "current price" must NOT be derived from the last row of the
            # daily OHLC history — that frame lags the live market. Its most
            # recent row is frequently the *previous* session's close (or a NaN
            # placeholder for the current day that we skip), which would surface
            # a stale price on the portfolio page — e.g. showing 0050 at
            # yesterday's 104.45 instead of today's actual 107.80.
            realtime = await self._get_realtime_price(symbol, market)
            if realtime is not None and realtime.is_finite() and realtime > 0:
                logger.debug(
                    f"✅ Current price for {symbol}: {realtime} (real-time quote)"
                )
                return realtime

            # FALLBACK: most recent close from historical data. Only used when no
            # live quote is available; it can lag the live market by a session.
            historical = await self.get_historical_data(symbol, market, days=5)
            if historical and len(historical) > 0:
                latest = historical[-1]
                price = Decimal(str(latest.get("close", 0)))
                if price.is_finite() and price > 0:
                    logger.debug(
                        f"📉 Current price for {symbol}: {price} "
                        f"(historical fallback: {latest.get('date', 'unknown')})"
                    )
                    return price

            logger.warning(f"No price data available for {symbol} from any provider")
            return None

        except Exception as e:
            logger.error(f"Error fetching current price for {symbol}: {str(e)}")
            return None

    async def _get_twse_historical(
        self, symbol: str, days: int
    ) -> List[Dict[str, Any]]:
        """Daily bars straight from the Taiwan Stock Exchange.

        The exchange's own STOCK_DAY report is free, unauthenticated and
        complete — it is the reference the commercial feeds are derived from,
        so it is the right place to turn when they disagree or drop a session.
        Used only as a last resort because it is served one calendar month per
        request and throttles aggressively.

        Listed (上市) securities only; OTC/TPEx (``.TWO``) is a different
        service and is not covered here.
        """
        stock_no = to_bare_tw_symbol(symbol)
        if not stock_no.isdigit():
            return []

        cache_key = f"twse_hist:{stock_no}:{days}"
        cached = _sym_cache_get(cache_key)
        if cached is not None:
            return cached

        today = business_today()
        start = today - timedelta(days=days)

        # One request per calendar month spanned.
        months: List[date_cls] = []
        cursor = date_cls(start.year, start.month, 1)
        while cursor <= today:
            months.append(cursor)
            cursor = (
                date_cls(cursor.year + 1, 1, 1)
                if cursor.month == 12
                else date_cls(cursor.year, cursor.month + 1, 1)
            )

        rows: Dict[str, Dict[str, Any]] = {}
        for month in months:
            payload = await self._fetch_twse_month(stock_no, month)
            for row in payload:
                parsed = _parse_twse_row(row)
                if parsed and parsed["date"] >= start.isoformat():
                    rows[parsed["date"]] = parsed

        result = [rows[k] for k in sorted(rows)]
        if result:
            # Settled daily bars; a short TTL is enough to spare the exchange
            # repeat calls inside one backfill run.
            _sym_cache_set(cache_key, result, 1800)
        return result

    async def _fetch_twse_month(
        self, stock_no: str, month: "date_cls"
    ) -> List[List[str]]:
        """One month of STOCK_DAY rows, or [] on any failure."""
        import json
        import urllib.request

        url = (
            "https://www.twse.com.tw/exchangeReport/STOCK_DAY"
            f"?response=json&date={month.strftime('%Y%m%d')}&stockNo={stock_no}"
        )

        def _fetch() -> List[List[str]]:
            req = urllib.request.Request(url, headers={"User-Agent": TWSE_USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = json.load(resp)
            if body.get("stat") != "OK":
                logger.debug(
                    f"TWSE {stock_no} {month:%Y-%m}: stat={body.get('stat')!r}"
                )
                return []
            return body.get("data") or []

        try:
            rows = await asyncio.wait_for(asyncio.to_thread(_fetch), timeout=25.0)
        except asyncio.TimeoutError:
            logger.warning(f"⏱️ TWSE timeout for {stock_no} {month:%Y-%m}")
            return []
        except Exception as e:
            logger.warning(f"TWSE fetch failed for {stock_no} {month:%Y-%m}: {e}")
            return []

        # TWSE throttles hard (roughly 3 requests / 5s); pace multi-month walks.
        await asyncio.sleep(TWSE_REQUEST_INTERVAL_SECONDS)
        return rows

    async def get_previous_close(self, symbol: str, market: str) -> Optional[Decimal]:
        """Previous session's close as the *provider* reports it.

        This is what public quotes compare against, and it is deliberately not
        derived from our own ``historical_prices`` table: that table is only as
        complete as the nightly sync, and a single missing session silently
        turns "today's change" into a multi-day one (0050 on 2026-08-14 read
        +1.14% against a 2-day-old close instead of -0.28%). Both providers were
        missing the 2026-08-13 bar for that ETF while the live quote carried the
        correct previous close all along.

        Populated as a side effect of the Yahoo live-quote fetch — one
        ``fast_info`` round-trip yields price and previous close together — so a
        warm price cache usually means this costs nothing.
        """
        if symbol.startswith(("CASH-", "EMERGENCY-", "CPF-", "TWD-", "USD-", "SGD-")):
            return None

        if not self.enable_yahoo:
            return None

        yahoo_symbol = (
            to_yahoo_tw_symbol(symbol) if (market or "").upper() == "TW" else symbol
        )
        cache_key = f"yahoo_prev_close:{yahoo_symbol}"

        cached = _sym_cache_get(cache_key)
        if cached is not None:
            return cached

        # Cache miss: the live-price fetch is what fills this cache.
        await self._get_yahoo_current_price(yahoo_symbol)
        return _sym_cache_get(cache_key)

    async def _get_realtime_price(
        self, symbol: str, market: str
    ) -> Optional[Decimal]:
        """
        Fetch the latest real-time (last-traded / intraday) price for a symbol.

        This is the authoritative source for a holding's *current* price and is
        intentionally separate from the daily history frame (see get_current_price
        for why deriving current price from history[-1] surfaces stale values).

        Routes to the same providers as get_historical_data:
        - TW: FinLab real-time (with a staleness guard) → Yahoo live quote
        - US: TradingView → Yahoo live quote
        - CRYPTO / other: Yahoo live quote
        """
        try:
            if market == "TW":
                if self.enable_finlab:
                    try:
                        price = await self._get_finlab_current_price(symbol)
                        if price is not None and price.is_finite() and price > 0:
                            return price
                    except Exception as e:
                        logger.debug(f"FinLab real-time fetch failed for {symbol}: {e}")

                if self.enable_yahoo:
                    return await self._get_yahoo_current_price(
                        to_yahoo_tw_symbol(symbol)
                    )

            elif market in ["US", "NYSE", "NASDAQ"]:
                if self.enable_tradingview:
                    try:
                        price = await self._get_tradingview_current_price(symbol)
                        if price is not None and price.is_finite() and price > 0:
                            return price
                    except Exception as e:
                        logger.debug(f"TradingView fetch failed for {symbol}: {e}")

                if self.enable_yahoo:
                    return await self._get_yahoo_current_price(symbol)

            elif market == "CRYPTO":
                if self.enable_yahoo:
                    return await self._get_yahoo_current_price(symbol)

            else:
                if self.enable_yahoo:
                    return await self._get_yahoo_current_price(symbol)

        except Exception as e:
            logger.debug(f"Real-time price fetch failed for {symbol}: {e}")

        return None

    async def _get_finlab_current_price(self, symbol: str) -> Optional[Decimal]:
        """
        Fetch real-time price from FinLab for Taiwan stocks.

        ⚡ OPTIMIZATION: Reuses market-level cache from _get_finlab_historical
        instead of making a separate API call.
        """
        global _finlab_market_cache

        try:

            # Market DataFrames are keyed by bare ticker code (see
            # _get_finlab_historical) — "0050.TW" would miss every column.
            symbol = to_bare_tw_symbol(symbol)

            # First, try to get from market cache (already loaded by get_historical_data)
            if (
                _finlab_market_cache["close"] is not None
                and _finlab_market_cache["last_fetch"]
            ):
                cache_age = utc_now() - _finlab_market_cache["last_fetch"]
                if cache_age < timedelta(hours=1):
                    close_df = _finlab_market_cache["close"]
                    if symbol in close_df.columns:
                        # Get the most recent non-NaN close price
                        close_series = close_df[symbol].dropna()
                        if len(close_series) > 0:
                            # Staleness guard: an outdated FinLab client/token can
                            # return a dataset that ends months/years ago. Never
                            # present such a close as the "current" price — fall
                            # through so the caller uses a fresher provider.
                            last_idx = close_series.index[-1]
                            try:
                                last_dt = last_idx.to_pydatetime()
                            except AttributeError:
                                last_dt = last_idx
                            # Naive both sides: FinLab's index is tz-naive (see the
                            # window comment above), and mixing raises TypeError —
                            # which the broad `except` below logs at debug and
                            # swallows, so every TW symbol would quietly fall
                            # through to Yahoo with nothing above debug to say why.
                            if (business_now().replace(tzinfo=None) - last_dt).days > 7:
                                logger.warning(
                                    f"⚠️ FinLab data for {symbol} is stale "
                                    f"(latest {getattr(last_idx, 'date', lambda: last_idx)()}); "
                                    f"skipping FinLab real-time price"
                                )
                            else:
                                price = float(close_series.iloc[-1])
                                logger.info(
                                    f"✅ FinLab current price for {symbol}: {price} (from memory cache, 0 API calls)"
                                )
                                return Decimal(str(price))

            # If no cache, trigger a historical fetch which will populate the cache
            # This ensures we use the optimized market-level caching
            logger.info(
                f"📥 Market cache miss for current price, fetching historical data to populate cache..."
            )
            historical = await self._get_finlab_historical(symbol, days=5)

            if historical and len(historical) > 0:
                price = float(historical[-1]["close"])
                logger.info(
                    f"✅ FinLab current price for {symbol}: {price} (from historical fetch)"
                )
                return Decimal(str(price))

            return None

        except Exception as e:
            # warning, not debug: a TypeError here once sent every TW price
            # quietly to Yahoo, and nothing in the log said so.
            logger.warning(
                f"FinLab current price failed for {symbol}: {e}", exc_info=True
            )
        return None

    async def _get_yahoo_current_price(self, symbol: str) -> Optional[Decimal]:
        """
        Fetch the latest real-time / last-traded price from Yahoo Finance.

        Uses Yahoo's live quote (``fast_info.last_price``) rather than the last
        row of the daily OHLC history. The daily history frame lags the live
        market: its most recent row is frequently the previous session's close,
        or a NaN placeholder for the current day that _get_yahoo_historical
        drops — either of which makes "current price" stale (e.g. yesterday's
        104.45 instead of today's 107.80). Falls back to the latest available
        historical close only when the live quote is unavailable.
        """
        try:
            import warnings
            import math
            import yfinance as yf

            # yfinance internals call deprecated pd.Timestamp.utcnow — suppress
            warnings.filterwarnings("ignore", message=".*utcnow.*", module="yfinance.*")

            cache_key = f"yahoo_rt_price:{symbol}"
            cached = _sym_cache_get(cache_key)
            if cached is not None:
                return cached

            def _fetch_quote():
                fi = yf.Ticker(symbol).fast_info
                # fast_info supports both mapping and attribute access depending
                # on the yfinance version — try both.
                def _field(*keys):
                    for key in keys:
                        try:
                            val = fi[key]
                        except Exception:
                            try:
                                val = getattr(fi, key)
                            except Exception:
                                val = None
                        if val is not None:
                            return val
                    return None

                # One fast_info round-trip yields both. The previous close is the
                # provider's own, which is what public quotes show — deriving it
                # from our historical table instead makes the day change wrong
                # whenever that table is missing a session.
                return (
                    _field("last_price", "lastPrice"),
                    _field("previous_close", "previousClose"),
                )

            raw, raw_prev = await asyncio.wait_for(
                asyncio.to_thread(_fetch_quote), timeout=15.0
            )

            if raw_prev is not None:
                prev_val = float(raw_prev)
                if math.isfinite(prev_val) and prev_val > 0:
                    # Longer TTL than price: the previous close is fixed for the
                    # whole session, so this rarely needs a refetch.
                    _sym_cache_set(
                        f"yahoo_prev_close:{symbol}", Decimal(str(prev_val)), 3600
                    )

            if raw is not None:
                price_val = float(raw)
                if math.isfinite(price_val) and price_val > 0:
                    price = Decimal(str(price_val))
                    # Short TTL: current price changes intraday; the smart update
                    # gate (should_update_price) already limits how often we ask.
                    _sym_cache_set(cache_key, price, 600)  # 10 minutes
                    logger.info(f"✅ Yahoo live price for {symbol}: {price}")
                    return price

            # Fallback: latest available close from daily history.
            historical = await self._get_yahoo_historical(symbol, days=5)
            if historical and len(historical) > 0:
                price = Decimal(str(historical[-1]["close"]))
                logger.info(
                    f"📉 Yahoo current price for {symbol}: {price} "
                    f"(history fallback — no live quote)"
                )
                return price

            return None
        except asyncio.TimeoutError:
            logger.warning(f"⏱️ Yahoo live price timeout for {symbol}")
        except Exception as e:
            logger.debug(f"Yahoo current price fetch failed for {symbol}: {e}")
        return None

    async def _get_tradingview_current_price(self, symbol: str) -> Optional[Decimal]:
        """Fetch real-time price from TradingView"""
        try:
            from tradingview_ta import TA_Handler, Interval

            handler = TA_Handler(
                symbol=symbol,
                exchange="NASDAQ",
                screener="america",
                interval=Interval.INTERVAL_1_DAY,
            )

            analysis = handler.get_analysis()
            close_price = analysis.indicators.get("close")

            if close_price is not None:
                return Decimal(str(close_price))
        except Exception as e:
            logger.debug(f"TradingView current price fetch failed for {symbol}: {e}")
        return None

def get_market_data_service(
    finlab_token: Optional[str] = None,
    tradingview_key: Optional[str] = None,
) -> MarketDataService:
    """
    Factory function to create market data service instance

    Args:
        finlab_token: FinLab API token
        tradingview_key: TradingView API key

    Returns:
        MarketDataService instance
    """
    from app.core.config import get_settings

    settings = get_settings()

    # Use provided tokens or fall back to settings
    finlab_token = finlab_token or getattr(settings, "FINLAB_API_TOKEN", None)
    tradingview_key = tradingview_key or getattr(settings, "TRADINGVIEW_API_KEY", None)

    return MarketDataService(
        finlab_token=finlab_token,
        tradingview_key=tradingview_key,
        enable_finlab=True,
        enable_tradingview=True,
        enable_yahoo=True,
    )


# ===== API Usage Utilities =====


def clear_finlab_market_cache():
    """
    Clear the in-memory FinLab market cache.

    Use this when:
    - Market data needs to be refreshed immediately
    - After market close to ensure next-day data is fresh
    - For testing purposes
    """
    # Clear the data in place. fetch_lock, fetch_task and failed_at stay: they keep
    # refills to one in-flight whole-market fetch and hold the failure cooldown,
    # and dropping them let a clear start a second concurrent fetch.
    for key in ("close", "open", "high", "low", "volume", "window_start", "last_fetch"):
        _finlab_market_cache[key] = None
    logger.info("🗑️ FinLab market cache cleared")


def get_finlab_cache_status() -> Dict[str, Any]:
    """
    Get the current status of the FinLab market cache.

    Returns:
        Dictionary with cache status information including:
        - is_cached: Whether market data is cached
        - last_fetch: When the data was last fetched
        - cache_age_seconds: How old the cache is
        - symbols_available: Number of symbols in cache (if cached)
    """
    global _finlab_market_cache

    if _finlab_market_cache["last_fetch"] is None:
        return {
            "is_cached": False,
            "last_fetch": None,
            "cache_age_seconds": None,
            "symbols_available": 0,
            "message": "No market data cached - next request will fetch from FinLab API",
        }

    cache_age = utc_now() - _finlab_market_cache["last_fetch"]
    symbols_count = 0

    if _finlab_market_cache["close"] is not None:
        try:
            symbols_count = len(_finlab_market_cache["close"].columns)
        except Exception:
            pass

    window_start = _finlab_market_cache.get("window_start")

    return {
        "is_cached": True,
        "last_fetch": _finlab_market_cache["last_fetch"].isoformat(),
        "cache_age_seconds": int(cache_age.total_seconds()),
        "cache_age_minutes": round(cache_age.total_seconds() / 60, 1),
        "symbols_available": symbols_count,
        "window_start": window_start.isoformat() if window_start else None,
        "is_stale": cache_age > timedelta(hours=1),
        "message": f"Market data cached {cache_age.seconds}s ago with {symbols_count} symbols",
    }


def get_api_optimization_stats() -> Dict[str, Any]:
    """
    Get API usage optimization statistics.

    Returns:
        Dictionary with optimization stats to help monitor API usage
    """
    cache_status = get_finlab_cache_status()

    # Calculate potential savings
    # If cache is valid, subsequent symbol fetches cost 0 API calls
    potential_symbols_per_cache = cache_status.get("symbols_available", 0)

    return {
        "finlab_cache_status": cache_status,
        "optimization_strategy": {
            "market_level_caching": "Enabled - fetches all TW stocks in 5 API calls",
            "symbol_level_caching": "Enabled - Redis cache with TTL until market close",
            "request_deduplication": "Enabled - asyncio.Lock prevents concurrent fetches",
            "database_storage": "Enabled - historical data stored in DB",
        },
        "api_call_estimate": {
            "first_tw_symbol": "5 API calls (OHLCV for entire market)",
            "subsequent_tw_symbols": "0 API calls (from memory cache)",
            "yahoo_fallback": "1 API call per symbol (no batch)",
            "cached_symbols": "0 API calls (from Redis or memory)",
        },
        "recommendations": [
            "Sync multiple TW symbols together to leverage market-level cache",
            "Run historical sync during off-peak hours",
            "Use force_refresh sparingly to preserve API quota",
        ],
    }
