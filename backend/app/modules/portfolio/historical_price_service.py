"""
Historical Price Service

Service for fetching and caching historical price data in background.
Integrates with market data providers (FinLab, Yahoo, TradingView) and stores in database.
"""

import logging
import asyncio
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from .historical_price_repository import HistoricalPriceRepository
from .market_data_service import MarketDataService
from .symbols import canonical_symbol
from app.core.config import get_settings
from app.utils.market_sessions import session_closed
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)
settings = get_settings()


class HistoricalPriceService:
    """Service for managing historical price data"""

    def __init__(
        self,
        session: AsyncSession,
        market_data_service: Optional[MarketDataService] = None,
    ):
        self.session = session
        self.repository = HistoricalPriceRepository(session)

        # Initialize market data service
        if market_data_service:
            self.market_data = market_data_service
        else:
            self.market_data = MarketDataService(
                finlab_token=(
                    settings.FINLAB_API_TOKEN
                    if hasattr(settings, "FINLAB_API_TOKEN")
                    else None
                ),
                enable_finlab=True,
                enable_yahoo=True,
                enable_tradingview=False,
            )

    async def fetch_and_store_historical_data(
        self,
        symbol: str,
        market: str,
        start_date: date,
        end_date: Optional[date] = None,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Fetch historical data from market API and store in database.

        Args:
            symbol: Stock symbol
            market: Market type (TW, US, CRYPTO)
            start_date: Start date
            end_date: End date (defaults to today)
            force_refresh: If True, fetch even if data exists

        Returns:
            Dictionary with status and count of records stored
        """
        if end_date is None:
            end_date = business_today()

        # Key the gap check on the spelling the write uses. `bulk_upsert_prices`
        # canonicalises, so a caller passing "0050.TW" would find its whole range
        # "missing" every time — refetching the full window on every call, which
        # for market="TW" is FinLab's whole-market pull, the documented OOM.
        symbol = canonical_symbol(symbol)

        logger.info(
            f"Fetching historical data for {symbol} ({market}) from {start_date} to {end_date}"
        )

        try:
            # Check what data we already have (unless force refresh)
            if not force_refresh:
                # Use a separate session to avoid concurrent operations error
                from ...database.session import get_db_session

                async for check_session in get_db_session():
                    check_repo = HistoricalPriceRepository(check_session)
                    missing_ranges = await check_repo.get_missing_date_ranges(
                        symbol, start_date, end_date
                    )
                    break

                if not missing_ranges:
                    logger.info(f"All data already cached for {symbol}")
                    return {
                        "status": "cached",
                        "symbol": symbol,
                        "records_stored": 0,
                        "message": "Data already in cache",
                    }

                logger.info(
                    f"Found {len(missing_ranges)} missing date ranges for {symbol}"
                )
            else:
                missing_ranges = [(start_date, end_date)]

            # Fetch data from market API
            days = (end_date - start_date).days
            historical_data = await self.market_data.get_historical_data(
                symbol=symbol, market=market, days=days
            )

            if not historical_data:
                logger.warning(f"No historical data returned from API for {symbol}")
                return {
                    "status": "error",
                    "symbol": symbol,
                    "records_stored": 0,
                    "message": "No data from API",
                }

            # Transform API response to database format
            price_records = []
            for day_data in historical_data:
                try:
                    # Parse date from different possible formats
                    if isinstance(day_data["date"], str):
                        price_date = datetime.fromisoformat(
                            day_data["date"].replace("Z", "+00:00")
                        ).date()
                    else:
                        price_date = day_data["date"]

                    # A bar for a session still in progress is not a close: the
                    # provider is reporting the last trade so far. Storing it as the
                    # day's closing price made every figure built on that day move
                    # overnight, when a later fetch quietly corrected it.
                    if not session_closed(market, price_date):
                        logger.debug(
                            f"Skipping {symbol} {price_date}: {market} has not closed yet"
                        )
                        continue

                    record = {
                        "symbol": symbol.upper(),
                        "market": market,
                        "date": price_date,
                        "open": day_data.get("open"),
                        "high": day_data.get("high"),
                        "low": day_data.get("low"),
                        "close": day_data.get("close"),
                        "volume": day_data.get("volume"),
                        "adjusted_close": day_data.get("adjusted_close"),
                        "source": day_data.get(
                            "source", "finlab" if market == "TW" else "yahoo"
                        ),
                        "currency": day_data.get(
                            "currency", "TWD" if market in ("TW", "TW-INDEX") else "USD"
                        ),
                        "exchange": day_data.get("exchange"),
                    }
                    price_records.append(record)
                except Exception as e:
                    logger.error(f"Error transforming price data: {e}")
                    continue

            if not price_records:
                return {
                    "status": "error",
                    "symbol": symbol,
                    "records_stored": 0,
                    "message": "Failed to transform API data",
                }

            # Bulk upsert to database
            # Bulk upsert to database using a fresh session/repository to avoid
            # AsyncSession concurrency conflicts when this method is invoked
            # concurrently from update routines.
            from ...database.session import get_db_session

            records_stored = 0
            async for db_session in get_db_session():
                repo = HistoricalPriceRepository(db_session)
                records_stored = await repo.bulk_upsert_prices(price_records)
                break

            logger.info(
                f"Successfully stored {records_stored} historical price records for {symbol}"
            )

            return {
                "status": "success",
                "symbol": symbol,
                "records_stored": records_stored,
                "date_range": {
                    "start": start_date.isoformat(),
                    "end": end_date.isoformat(),
                },
            }

        except Exception as e:
            logger.error(
                f"Error fetching historical data for {symbol}: {str(e)}", exc_info=True
            )
            return {
                "status": "error",
                "symbol": symbol,
                "records_stored": 0,
                "message": str(e),
            }

    async def update_holdings_historical_data(
        self,
        symbols: List[str],
        markets: Dict[str, str],  # symbol -> market mapping
        days: int = 365,
    ) -> Dict[str, Any]:
        """
        Update historical data for multiple symbols (for all holdings).

        Args:
            symbols: List of symbols to update
            markets: Mapping of symbol to market type
            days: Number of days of historical data to fetch

        Returns:
            Summary of updates
        """
        end_date = business_today()
        start_date = end_date - timedelta(days=days)

        logger.info(
            f"Updating historical data for {len(symbols)} symbols ({days} days)"
        )

        results = {
            "total_symbols": len(symbols),
            "successful": 0,
            "failed": 0,
            "cached": 0,
            "total_records": 0,
            "details": [],
        }

        # Use bounded concurrency to speed up sync while avoiding provider and DB overload.
        # Each fetch_and_store_historical_data call uses its own DB session for upserts,
        # so running them concurrently is safe.
        concurrency = getattr(settings, "HISTORICAL_SYNC_CONCURRENCY", 3)

        semaphore = asyncio.Semaphore(concurrency)

        async def _worker(sym: str):
            async with semaphore:
                market = markets.get(sym, "US")
                try:
                    res = await self.fetch_and_store_historical_data(
                        symbol=sym,
                        market=market,
                        start_date=start_date,
                        end_date=end_date,
                    )
                    return res
                except Exception as e:
                    logger.error(f"Exception fetching {sym}: {e}")
                    return {"status": "error", "symbol": sym, "message": str(e)}

        # Launch all tasks immediately; semaphore limits concurrency
        all_results = await asyncio.gather(*[_worker(sym) for sym in symbols])

        for result in all_results:
            if not result:
                continue
            if result.get("status") == "success":
                results["successful"] += 1
                results["total_records"] += result.get("records_stored", 0)
            elif result.get("status") == "cached":
                results["cached"] += 1
            else:
                results["failed"] += 1
            results["details"].append(result)

        logger.info(
            f"Historical data update complete: "
            f"{results['successful']} successful, "
            f"{results['cached']} cached, "
            f"{results['failed']} failed, "
            f"{results['total_records']} total records"
        )

        return results

    async def get_historical_prices_for_symbol(
        self, symbol: str, start_date: date, end_date: Optional[date] = None
    ) -> List[Dict[str, Any]]:
        """
        Get historical prices from database, with fallback to API if needed.

        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date (defaults to today)

        Returns:
            List of price dictionaries
        """
        if end_date is None:
            end_date = business_today()

        # Get data from database
        prices = await self.repository.get_price_history(symbol, start_date, end_date)

        # Convert to dictionaries
        result = []
        for price in prices:
            result.append(
                {
                    "date": price.date.isoformat(),
                    "open": float(price.open) if price.open else None,
                    "high": float(price.high) if price.high else None,
                    "low": float(price.low) if price.low else None,
                    "close": float(price.close),
                    "volume": price.volume,
                    "adjusted_close": (
                        float(price.adjusted_close) if price.adjusted_close else None
                    ),
                    "source": price.source,
                    "currency": price.currency,
                }
            )

        return result

    async def get_price_on_date(
        self, symbol: str, target_date: date
    ) -> Optional[Dict[str, Any]]:
        """
        Get price for a symbol on a specific date.

        Args:
            symbol: Stock symbol
            target_date: Target date

        Returns:
            Price dictionary or None
        """
        price = await self.repository.get_price_on_date(symbol, target_date)

        if not price:
            return None

        return {
            "date": price.date.isoformat(),
            "close": float(price.close),
            "open": float(price.open) if price.open else None,
            "high": float(price.high) if price.high else None,
            "low": float(price.low) if price.low else None,
            "volume": price.volume,
            "source": price.source,
            "currency": price.currency,
        }

    async def get_batch_price_range(
        self, symbols: List[str], start_date: date, end_date: date
    ) -> Dict[str, Dict[str, Dict[str, Any]]]:
        """
        ⚡ OPTIMIZED: Get historical prices for MULTIPLE symbols in a single DB query.

        Returns a nested dict: symbol -> date_string -> price_dict
        This structure is optimized for fast date-based lookups in performance calculations.

        Args:
            symbols: List of stock symbols
            start_date: Start date
            end_date: End date

        Returns:
            Dict[symbol, Dict[date_str, price_dict]]
        """
        # Use the optimized batch query from repository
        prices_by_symbol = await self.repository.get_batch_price_history(
            symbols, start_date, end_date
        )

        # Transform to date-indexed format for O(1) lookups
        result: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for symbol, prices in prices_by_symbol.items():
            result[symbol] = {p["date"]: p for p in prices}

        return result


def get_historical_price_service(session: AsyncSession) -> HistoricalPriceService:
    """Factory function to get historical price service"""
    return HistoricalPriceService(session)
