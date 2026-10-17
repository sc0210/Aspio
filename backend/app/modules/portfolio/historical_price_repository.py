"""
Historical Price Repository

Handles database operations for historical price data caching.

⚡ OPTIMIZATION FEATURES:
1. Batch queries for multiple symbols (single DB round-trip)
2. In-memory dict caching for frequently accessed date ranges
3. Efficient UPSERT operations with PostgreSQL ON CONFLICT
4. Window functions for latest price lookups
"""

import logging
import time as _time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional, Dict, Any

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from .models import HistoricalPrice
from .symbols import canonical_symbol
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)

# Cache namespace identifier (kept for log messages)
HIST_PRICE_CACHE_NAMESPACE = "historical_prices"
# Default TTL for cached price data (1 hour)
HIST_PRICE_CACHE_TTL = 3600

# ---------------------------------------------------------------------------
# Module-level in-memory TTL cache replacing Redis for batch price history
# ---------------------------------------------------------------------------
_hist_cache: dict = {}


def _hcache_get(key: str):
    entry = _hist_cache.get(key)
    if entry and _time.time() < entry["expires_at"]:
        return entry["value"]
    if key in _hist_cache:
        del _hist_cache[key]
    return None


def _hcache_set(key: str, value, ttl: int) -> None:
    _hist_cache[key] = {"value": value, "expires_at": _time.time() + ttl}


def _hcache_delete(key: str) -> None:
    _hist_cache.pop(key, None)


class HistoricalPriceRepository:
    """Repository for historical price data operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_price_history(
        self,
        symbol: str,
        start_date: date,
        end_date: Optional[date] = None,
        limit: int = 1000,
    ) -> List[HistoricalPrice]:
        """
        Get historical prices for a symbol within a date range.

        Args:
            symbol: Stock symbol
            start_date: Start date (inclusive)
            end_date: End date (inclusive), defaults to today
            limit: Maximum number of records to return

        Returns:
            List of HistoricalPrice objects ordered by date ascending
        """
        if end_date is None:
            end_date = business_today()

        stmt = (
            select(HistoricalPrice)
            .where(
                and_(
                    HistoricalPrice.symbol == symbol.upper(),
                    HistoricalPrice.date >= start_date,
                    HistoricalPrice.date <= end_date,
                )
            )
            .order_by(HistoricalPrice.date.asc())
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_batch_price_history(
        self,
        symbols: List[str],
        start_date: date,
        end_date: Optional[date] = None,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        ⚡ OPTIMIZED: Get historical prices for MULTIPLE symbols in a SINGLE query.

        This is much more efficient than calling get_price_history() for each symbol,
        as it makes only one database round-trip regardless of the number of symbols.

        Args:
            symbols: List of stock symbols
            start_date: Start date (inclusive)
            end_date: End date (inclusive), defaults to today

        Returns:
            Dict mapping symbol -> list of price dicts, ordered by date ascending
        """
        if not symbols:
            return {}

        if end_date is None:
            end_date = business_today()

        symbols_upper = [s.upper() for s in symbols]

        # Check in-memory cache first
        cache_key = f"{HIST_PRICE_CACHE_NAMESPACE}:batch:{','.join(sorted(symbols_upper))}:{start_date}:{end_date}"
        cached = _hcache_get(cache_key)
        if cached:
            logger.debug(
                f"✅ Cache HIT for batch price history ({len(symbols)} symbols)"
            )
            return cached

        logger.info(
            f"📥 Loading price history for {len(symbols)} symbols from DB ({start_date} to {end_date})"
        )

        # Single query for all symbols
        stmt = (
            select(HistoricalPrice)
            .where(
                and_(
                    HistoricalPrice.symbol.in_(symbols_upper),
                    HistoricalPrice.date >= start_date,
                    HistoricalPrice.date <= end_date,
                )
            )
            .order_by(HistoricalPrice.symbol, HistoricalPrice.date.asc())
        )

        result = await self.session.execute(stmt)
        rows = result.scalars().all()

        # Group by symbol
        prices_by_symbol: Dict[str, List[Dict[str, Any]]] = {
            s: [] for s in symbols_upper
        }

        for price in rows:
            prices_by_symbol[price.symbol].append(
                {
                    "date": price.date.isoformat(),
                    "open": float(price.open) if price.open else None,
                    "high": float(price.high) if price.high else None,
                    "low": float(price.low) if price.low else None,
                    "close": float(price.close),
                    "volume": price.volume,
                    "currency": price.currency,
                    "source": price.source,
                }
            )

        total_records = sum(len(v) for v in prices_by_symbol.values())
        logger.info(
            f"✅ Loaded {total_records} total price records for {len(symbols)} symbols"
        )

        # Cache for 1 hour (prices don't change for historical dates)
        _hcache_set(cache_key, prices_by_symbol, HIST_PRICE_CACHE_TTL)

        return prices_by_symbol

    async def get_price_on_date(
        self, symbol: str, target_date: date
    ) -> Optional[HistoricalPrice]:
        """
        Get price for a symbol on a specific date.
        If exact date not found, returns the most recent price before that date.

        Args:
            symbol: Stock symbol
            target_date: Target date

        Returns:
            HistoricalPrice object or None
        """
        # Try exact match first
        stmt = select(HistoricalPrice).where(
            and_(
                HistoricalPrice.symbol == symbol.upper(),
                HistoricalPrice.date == target_date,
            )
        )
        result = await self.session.execute(stmt)
        price = result.scalar_one_or_none()

        if price:
            return price

        # Fall back to most recent price before target date
        stmt = (
            select(HistoricalPrice)
            .where(
                and_(
                    HistoricalPrice.symbol == symbol.upper(),
                    HistoricalPrice.date <= target_date,
                )
            )
            .order_by(HistoricalPrice.date.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_latest_price(self, symbol: str) -> Optional[HistoricalPrice]:
        """Get the most recent price for a symbol"""
        stmt = (
            select(HistoricalPrice)
            .where(HistoricalPrice.symbol == symbol.upper())
            .order_by(HistoricalPrice.date.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_latest_prices_for_symbols(
        self, symbols: List[str]
    ) -> Dict[str, Optional[Dict[str, Any]]]:
        """
        Get the most recent price for multiple symbols in a single query.

        Returns a mapping of SYMBOL -> price-dict (or None if not found).
        Uses a window function (ROW_NUMBER OVER PARTITION BY symbol ORDER BY date DESC)
        to select the latest row per symbol efficiently.
        """
        if not symbols:
            return {}

        symbols_upper = [s.upper() for s in symbols]

        # Build a subquery that ranks rows per symbol by date desc
        rn = (
            func.row_number()
            .over(
                partition_by=HistoricalPrice.symbol,
                order_by=HistoricalPrice.date.desc(),
            )
            .label("rn")
        )

        subq = (
            select(
                HistoricalPrice.symbol.label("symbol"),
                HistoricalPrice.date.label("date"),
                HistoricalPrice.close.label("close"),
                HistoricalPrice.open.label("open"),
                HistoricalPrice.high.label("high"),
                HistoricalPrice.low.label("low"),
                HistoricalPrice.volume.label("volume"),
                HistoricalPrice.currency.label("currency"),
                HistoricalPrice.source.label("source"),
                HistoricalPrice.exchange.label("exchange"),
                rn,
            ).where(HistoricalPrice.symbol.in_(symbols_upper))
        ).subquery()

        stmt = select(subq).where(subq.c.rn == 1)

        result = await self.session.execute(stmt)
        rows = result.fetchall()

        out: Dict[str, Optional[Dict[str, Any]]] = {}
        for row in rows:
            sym = row.symbol
            out[sym] = {
                "symbol": row.symbol,
                "date": row.date.isoformat() if row.date else None,
                "close": float(row.close) if row.close is not None else None,
                "open": float(row.open) if row.open is not None else None,
                "high": float(row.high) if row.high is not None else None,
                "low": float(row.low) if row.low is not None else None,
                "volume": row.volume,
                "currency": row.currency,
                "source": row.source,
                "exchange": row.exchange,
            }

        # Ensure all requested symbols have an entry (None if missing)
        for s in symbols_upper:
            if s not in out:
                out[s] = None

        return out

    async def bulk_upsert_prices(self, price_data: List[Dict[str, Any]]) -> int:
        """
        Bulk insert or update historical prices using PostgreSQL UPSERT.

        Args:
            price_data: List of price dictionaries with keys:
                symbol, market, date, open, high, low, close, volume, source, currency

        Returns:
            Number of records inserted/updated
        """
        if not price_data:
            return 0

        try:
            # Prepare data - ensure all have required fields
            prepared_data = []
            skipped_records = []

            for item in price_data:
                # ⚡ VALIDATION: Skip records with NaN or invalid prices
                close_price = Decimal(str(item["close"]))

                # Check if close price is finite (not NaN or Infinity)
                if not close_price.is_finite() or close_price <= 0:
                    skipped_records.append({
                        "symbol": item["symbol"],
                        "date": item["date"],
                        "close": str(item["close"]),
                        "reason": "Non-finite or zero close price"
                    })
                    logger.warning(
                        f"⚠️ Skipping invalid price data: {item['symbol']} on {item['date']}, "
                        f"close={item['close']} (NaN or invalid)"
                    )
                    continue

                # Helper function to safely convert to Decimal
                def safe_decimal(value):
                    if value is None:
                        return None
                    try:
                        dec = Decimal(str(value))
                        return dec if dec.is_finite() else None
                    except Exception:
                        return None

                record = {
                    # The one place price rows are written, and so the one place
                    # the spelling has to be settled: a benchmark fetch stores
                    # under Yahoo's ticker ("0050.TW") while the sync stores the
                    # bare code, and the same security ends up with two separate,
                    # shallower histories.
                    "symbol": canonical_symbol(item["symbol"]),
                    "market": item["market"],
                    "date": item["date"],
                    "close": close_price,
                    "source": item.get("source", "finlab"),
                    "currency": item.get("currency", "USD"),
                    "exchange": item.get("exchange"),
                    "open": safe_decimal(item.get("open")),
                    "high": safe_decimal(item.get("high")),
                    "low": safe_decimal(item.get("low")),
                    "volume": int(item["volume"]) if item.get("volume") else None,
                    "adjusted_close": safe_decimal(item.get("adjusted_close")),
                    "updated_at": datetime.now(timezone.utc),
                }
                prepared_data.append(record)

            # Log skipped records for monitoring
            if skipped_records:
                logger.error(
                    f"❌ Skipped {len(skipped_records)} invalid price records: {skipped_records}"
                )

            # PostgreSQL UPSERT (INSERT ... ON CONFLICT DO UPDATE)
            stmt = insert(HistoricalPrice).values(prepared_data)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_historical_prices_symbol_date",
                set_={
                    "open": stmt.excluded.open,
                    "high": stmt.excluded.high,
                    "low": stmt.excluded.low,
                    "close": stmt.excluded.close,
                    "volume": stmt.excluded.volume,
                    "adjusted_close": stmt.excluded.adjusted_close,
                    "source": stmt.excluded.source,
                    "currency": stmt.excluded.currency,
                    "updated_at": stmt.excluded.updated_at,
                },
            )

            await self.session.execute(stmt)
            await self.session.commit()

            logger.info(f"Bulk upserted {len(prepared_data)} historical price records")

            # Invalidate ALL cached entries that mention any updated symbol.
            # This covers both the per-symbol "latest" entries and the batch
            # price-history entries that the daily-performance endpoint caches.
            # Without this, a historical sync would not be reflected for up to 1 hour.
            try:
                affected_symbols = {rec["symbol"] for rec in prepared_data}
                keys_to_delete = [
                    key for key in list(_hist_cache.keys())
                    if any(sym in key for sym in affected_symbols)
                ]
                for key in keys_to_delete:
                    _hcache_delete(key)
            except Exception:
                logger.warning(
                    "Failed to invalidate price cache after upsert", exc_info=True
                )

            return len(prepared_data)

        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error in bulk_upsert_prices: {str(e)}", exc_info=True)
            raise

    async def get_missing_date_ranges(
        self, symbol: str, start_date: date, end_date: Optional[date] = None
    ) -> List[tuple[date, date]]:
        """
        Find date ranges where historical data is missing.

        Args:
            symbol: Stock symbol
            start_date: Start date to check
            end_date: End date to check (defaults to today)

        Returns:
            List of (start_date, end_date) tuples representing missing ranges
        """
        if end_date is None:
            end_date = business_today()

        # Get all dates we have data for
        stmt = (
            select(HistoricalPrice.date)
            .where(
                and_(
                    HistoricalPrice.symbol == symbol.upper(),
                    HistoricalPrice.date >= start_date,
                    HistoricalPrice.date <= end_date,
                )
            )
            .order_by(HistoricalPrice.date.asc())
        )
        result = await self.session.execute(stmt)
        existing_dates = set(row[0] for row in result.all())

        # Generate all business days in range
        # Note: This is simplified - doesn't account for holidays
        all_dates = []
        current = start_date
        while current <= end_date:
            # Skip weekends (5=Saturday, 6=Sunday)
            if current.weekday() < 5:
                all_dates.append(current)
            current += timedelta(days=1)

        # Find missing dates
        missing_dates = sorted(set(all_dates) - existing_dates)

        if not missing_dates:
            return []

        # Group consecutive dates into ranges
        ranges = []
        range_start = missing_dates[0]
        prev_date = missing_dates[0]

        for current_date in missing_dates[1:]:
            if (current_date - prev_date).days > 1:
                # Gap found - close current range
                ranges.append((range_start, prev_date))
                range_start = current_date
            prev_date = current_date

        # Close final range
        ranges.append((range_start, missing_dates[-1]))

        return ranges

    async def get_data_coverage_stats(self, symbol: str) -> Dict[str, Any]:
        """
        Get statistics about data coverage for a symbol.

        Returns:
            Dictionary with min_date, max_date, total_days, data_points
        """
        stmt = select(
            func.min(HistoricalPrice.date).label("min_date"),
            func.max(HistoricalPrice.date).label("max_date"),
            func.count(HistoricalPrice.id).label("data_points"),
        ).where(HistoricalPrice.symbol == symbol.upper())

        result = await self.session.execute(stmt)
        row = result.one_or_none()

        if not row or not row.min_date:
            return {
                "symbol": symbol,
                "min_date": None,
                "max_date": None,
                "total_days": 0,
                "data_points": 0,
                "coverage_percentage": 0,
            }

        total_days = (row.max_date - row.min_date).days + 1
        coverage_pct = (row.data_points / total_days * 100) if total_days > 0 else 0

        return {
            "symbol": symbol,
            "min_date": row.min_date.isoformat(),
            "max_date": row.max_date.isoformat(),
            "total_days": total_days,
            "data_points": row.data_points,
            "coverage_percentage": round(coverage_pct, 2),
        }


