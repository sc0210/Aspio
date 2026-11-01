"""
Smart Market Price Update Service for Portfolio Holdings

This service implements intelligent price update strategies to minimize FinLab API usage:
1. Cache prices in database with last_price_update_at timestamp
2. Only fetch during market hours or at market close
3. Use hourly updates during trading hours
4. Use daily close price when market is closed
5. Respect FinLab API rate limits
"""

import asyncio
import logging
from datetime import datetime, time, timedelta
from typing import Optional, Dict, Any
from zoneinfo import ZoneInfo
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, update, text

from .manual_pricing import MANUALLY_PRICED_TYPES, is_manually_priced
from .models import PortfolioHolding
from app.modules.users.models import User
from .market_data_service import get_market_data_service, resolve_symbol_market
from ...core.config import get_settings
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)
settings = get_settings()


class MarketHoursManager:
    """Manager for market trading hours and schedules"""

    # Market trading hours, in each MARKET's own timezone — deliberately NOT
    # APP_TIMEZONE. The Taiwan exchange opens at 09:00 Taipei whatever timezone this
    # app measures its days in, so coupling the two would break the schedule the
    # moment APP_TIMEZONE changed.
    MARKET_HOURS = {
        "TW": {
            "timezone": "Asia/Taipei",
            "open": time(9, 0),  # 09:00 TST
            "close": time(13, 30),  # 13:30 TST
            "weekends": [5, 6],  # Saturday, Sunday
        },
        "US": {
            "timezone": "America/New_York",
            "open": time(9, 30),  # 09:30 EST/EDT
            "close": time(16, 0),  # 16:00 EST/EDT
            "weekends": [5, 6],  # Saturday, Sunday
        },
        "CRYPTO": {
            "timezone": "UTC",
            "open": time(0, 0),  # 24/7
            "close": time(23, 59),  # 24/7
            "weekends": [],  # No weekends for crypto
        },
    }

    @classmethod
    def is_market_open(cls, market: str) -> bool:
        """Check if market is currently open"""
        market_config = cls.MARKET_HOURS.get(market.upper())
        if not market_config:
            logger.warning(f"Unknown market: {market}, defaulting to US hours")
            market_config = cls.MARKET_HOURS["US"]

        tz = ZoneInfo(market_config["timezone"])
        now = datetime.now(tz)

        # Check if it's a weekend
        if now.weekday() in market_config["weekends"]:
            return False

        # Check if current time is within trading hours
        current_time = now.time()
        return market_config["open"] <= current_time <= market_config["close"]

    @classmethod
    def get_market_close_time(cls, market: str) -> Optional[datetime]:
        """Get today's market close time in UTC"""
        market_config = cls.MARKET_HOURS.get(market.upper())
        if not market_config:
            return None

        tz = ZoneInfo(market_config["timezone"])
        now = datetime.now(tz)

        # If weekend, return None
        if now.weekday() in market_config["weekends"]:
            return None

        close_time = datetime.combine(now.date(), market_config["close"])
        close_time = close_time.replace(tzinfo=tz)

        return close_time.astimezone(ZoneInfo("UTC"))

    @classmethod
    def should_update_price(cls, market: str, last_update: Optional[datetime]) -> bool:
        """
        Determine if price should be updated based on market hours and last update time

        Rules:
        1. If never updated, always update
        2. If market is open, update every hour
        3. If market is closed, only update once per day (after close)
        4. For crypto, update every hour
        """
        if not last_update:
            return True

        # Normalize last_update to UTC: assume UTC if naive, otherwise convert.
        # Converting aware inputs matters because the "updated today?" check below
        # compares last_update.date() against now.date() (UTC). Without conversion
        # an aware non-UTC input (e.g. Asia/Taipei, UTC+8) keeps its own wall-clock
        # date, which disagrees with the UTC date near the day boundary.
        if last_update.tzinfo is None:
            last_update = last_update.replace(tzinfo=ZoneInfo("UTC"))
        else:
            last_update = last_update.astimezone(ZoneInfo("UTC"))

        now = datetime.now(ZoneInfo("UTC"))
        time_since_update = now - last_update

        # ⚡ OPTIMIZATION: Extended update intervals for free API rate limits
        # Special handling for crypto (24/7 market)
        if market.upper() == "CRYPTO":
            # Update every 30 minutes (was 1 hour) - good balance for crypto volatility
            return time_since_update >= timedelta(minutes=30)

        # Check if market is currently open
        is_open = cls.is_market_open(market)

        if is_open:
            # During trading hours: update every 1 hour for better real-time tracking
            return time_since_update >= timedelta(hours=1)
        else:
            # Market closed: check if we've updated today after close
            market_close = cls.get_market_close_time(market)
            if not market_close:
                # Weekend or holiday - only update if not updated today
                now_date = now.date()
                last_update_date = last_update.date()
                return last_update_date < now_date

            # If we haven't updated since market close, update now
            if last_update < market_close:
                return True

            # Already updated after today's close
            return False


# Markets with their own scheduled price job. Any other market (SG, HK, ...)
# rides the US job, which runs last in the UTC day, after every other
# exchange has closed.
SCHEDULED_MARKETS = frozenset({"TW", "US", "CRYPTO"})


def scheduled_job_market(market: str) -> str:
    market = (market or "").upper()
    return market if market in SCHEDULED_MARKETS else "US"


class PriceUpdateService:
    """Service for smart price updates with caching and fallback strategies"""

    # Upstream quote fetches run concurrently but bounded, so a large symbol
    # set does not hammer the provider. Matches the per-user refresh path.
    SYMBOL_FETCH_CONCURRENCY = 8

    def __init__(self, session: AsyncSession, holding_repo=None):
        self.session = session
        self.holding_repo = holding_repo
        self.market_data_service = get_market_data_service(
            finlab_token=settings.FINLAB_API_TOKEN,
            tradingview_key=settings.TRADINGVIEW_API_KEY,
        )
        self.market_hours_manager = MarketHoursManager()

    async def _get_price_with_fallback(
        self, symbol: str, market: str, current_price: Optional[Decimal] = None,
        *, prefetched: bool = False, api_price: Optional[Decimal] = None,
        allow_historical_fallback: bool = True,
    ) -> Optional[Decimal]:
        """
        Get current price with multiple fallback strategies

        Fallback chain:
        1. Try market data API
        2. If fails and current_price exists, use current price
        3. If fails and no current_price, try yesterday's historical data
        4. If all fail, return None

        Args:
            symbol: Stock symbol
            market: Market type
            current_price: Current price from database (fallback)
            allow_historical_fallback: When False, step 3 is skipped and the
                caller gets None instead of an old close. Callers that would
                overwrite an existing, fresher price should pass False.

        Returns:
            Price as Decimal or None
        """
        # Primary: market data API. When ``prefetched`` is set, the call was already
        # made concurrently by update_portfolio_prices — reuse that result instead of
        # issuing a second, serial request.
        if prefetched:
            new_price = api_price
        else:
            try:
                new_price = await self.market_data_service.get_current_price(symbol, market)
            except Exception as e:
                logger.warning(f"⚠️ API error for {symbol}: {str(e)}")
                new_price = None

        if new_price and new_price.is_finite() and new_price > 0:
            return new_price
        if not prefetched:
            logger.warning(f"⚠️ API returned invalid price for {symbol}: {new_price}")

        # Fallback 1: Use existing current price
        if current_price and current_price > 0:
            logger.info(
                f"📌 Using existing price for {symbol}: {current_price} (API failed)"
            )
            return current_price

        # Fallback 2: Try to get yesterday's price from historical data
        if not allow_historical_fallback:
            logger.warning(
                f"⚠️ No live price for {symbol}; leaving the stored price alone "
                f"(historical fallback disabled for this caller)"
            )
            return None

        try:
            from .historical_price_repository import HistoricalPriceRepository
            from datetime import timedelta

            repo = HistoricalPriceRepository(self.session)
            yesterday = business_today() - timedelta(days=1)

            # Try last 5 days to account for weekends
            for days_back in range(1, 6):
                check_date = business_today() - timedelta(days=days_back)
                historical_price = await repo.get_price_on_date(symbol, check_date)

                if historical_price and historical_price.close > 0:
                    logger.info(
                        f"📅 Using historical price for {symbol}: {historical_price.close} "
                        f"(from {check_date})"
                    )
                    return historical_price.close

        except Exception as e:
            logger.warning(f"⚠️ Historical price fallback failed for {symbol}: {str(e)}")

        # All fallbacks failed
        logger.error(f"❌ All price sources failed for {symbol}")
        return None

    async def update_holding_price(
        self, holding: PortfolioHolding, force: bool = False,
        *, prefetched: bool = False, api_price: Optional[Decimal] = None,
    ) -> bool:
        """
        Update price for a single holding with smart caching

        Args:
            holding: The holding to update
            force: Force update regardless of cache status

        Returns:
            True if price was updated, False if cached price was used
        """
        # Check if update is needed (unless forced)
        if not force:
            should_update = self.market_hours_manager.should_update_price(
                holding.market, holding.last_price_update_at
            )

            if not should_update:
                logger.debug(
                    f"Using cached price for {holding.symbol} "
                    f"(last update: {holding.last_price_update_at})"
                )
                return False

        try:
            # ⚡ IMPROVED: Use fallback strategy (API → current price → historical data)
            new_price = await self._get_price_with_fallback(
                symbol=holding.symbol,
                market=holding.market,
                current_price=holding.current_price,
                prefetched=prefetched,
                api_price=api_price,
            )

            # If all fallback strategies failed, skip this holding
            if not new_price:
                logger.warning(
                    f"⚠️ All price sources failed for {holding.symbol}, "
                    f"keeping existing price: {holding.current_price}"
                )
                return False

            # ⚡ VALIDATION: Detect suspicious price changes (> 50% in one update)
            if holding.current_price and holding.current_price > 0:
                old_price = holding.current_price
                price_change_pct = abs(
                    (new_price - old_price) / old_price
                ) * Decimal("100")

                if price_change_pct > Decimal("50"):
                    logger.warning(
                        f"⚠️ Large price change detected for {holding.symbol}: "
                        f"{old_price} → {new_price} ({price_change_pct:.2f}% change). "
                        f"This might indicate data quality issue or stock split."
                    )
                    # Still update, but log for manual review

            # ⚡ VALIDATION: Ensure new price is valid (positive, finite)
            if not new_price.is_finite() or new_price <= 0:
                logger.error(
                    f"❌ Invalid price for {holding.symbol}: {new_price}, "
                    f"keeping existing price: {holding.current_price}"
                )
                return False

            # Update holding with new price
            holding.current_price = new_price
            holding.total_value = holding.quantity * new_price

            # Ensure total_cost is calculated correctly (quantity * average_cost)
            holding.total_cost = holding.quantity * holding.average_cost

            holding.gain_loss = holding.total_value - holding.total_cost

            if holding.total_cost > 0:
                holding.gain_loss_percentage = (
                    holding.gain_loss / holding.total_cost
                ) * Decimal("100")
            else:
                holding.gain_loss_percentage = Decimal("0")

            holding.last_price_update_at = datetime.now(ZoneInfo("UTC"))

            # Capture the provider's own previous close in the same pass. It is
            # served from the cache the live-price fetch just populated, so this
            # is normally free. Never clear a stored value on a miss — a stale
            # previous close still beats none, and the read path ages it out.
            previous_close = await self.market_data_service.get_previous_close(
                holding.symbol, holding.market
            )
            if (
                previous_close is not None
                and previous_close.is_finite()
                and previous_close > 0
            ):
                holding.previous_close = previous_close

            logger.debug(
                f"✅ Updated price for {holding.symbol}: "
                f"{holding.current_price} (market: {holding.market})"
            )

            return True

        except Exception as e:
            logger.error(
                f"❌ Exception updating price for {holding.symbol}: {str(e)}, "
                f"keeping existing price: {holding.current_price}"
            )
            return False

    async def update_portfolio_prices(
        self, user_id: str, portfolio_id: Optional[str] = None, force: bool = False
    ) -> Dict[str, Any]:
        """
        Update prices for all holdings in a portfolio

        Args:
            user_id: User ID
            portfolio_id: Optional portfolio ID (updates all portfolios if None)
            force: Force update all prices

        Returns:
            Dictionary with update statistics
        """
        # Build query to get holdings
        query = select(PortfolioHolding).where(
            and_(
                PortfolioHolding.user_id == user_id, PortfolioHolding.is_active == True
            )
        )

        if portfolio_id:
            query = query.where(PortfolioHolding.portfolio_id == portfolio_id)

        result = await self.session.execute(query)
        holdings = result.scalars().all()

        if not holdings:
            return {"total": 0, "updated": 0, "cached": 0, "failed": 0}

        # Holdings no feed prices keep the price the user set (manual_pricing).
        tradable_holdings = [
            h for h in holdings if not is_manually_priced(h.symbol, h.type)
        ]

        logger.info(
            f"Filtered {len(holdings)} holdings to {len(tradable_holdings)} tradable for price update "
            f"(crypto excluded for manual editing)"
        )

        stats = {
            "total": len(tradable_holdings),
            "updated": 0,
            "cached": 0,
            "failed": 0,
            "skipped": len(holdings) - len(tradable_holdings),
            "by_market": {},
        }

        if not tradable_holdings:
            return stats

        # ── Parallel price prefetch ───────────────────────────────────────────
        # The upstream price-API round-trips are the bottleneck: fetched serially
        # they took ~31s for ~60 symbols and blocked the single worker's event
        # loop (starving every other request). Fetch the prices that actually need
        # refreshing concurrently here — bounded so we don't hammer the upstream —
        # then apply them in the sequential DB loop below. get_current_price never
        # touches the DB session, so this is concurrency-safe; holding writes stay
        # serial on the shared session.
        to_fetch = [
            h for h in tradable_holdings
            if force or self.market_hours_manager.should_update_price(
                h.market, h.last_price_update_at
            )
        ]
        prefetched_prices: Dict[str, Optional[Decimal]] = {}
        if to_fetch:
            _sem = asyncio.Semaphore(8)

            async def _prefetch(symbol: str, market: str):
                async with _sem:
                    try:
                        return symbol, await self.market_data_service.get_current_price(symbol, market)
                    except Exception as e:
                        logger.warning(f"⚠️ Prefetch failed for {symbol}: {str(e)}")
                        return symbol, None

            _unique = {(h.symbol, h.market) for h in to_fetch}
            prefetched_prices = dict(
                await asyncio.gather(*[_prefetch(s, m) for s, m in _unique])
            )
            logger.info(
                f"Prefetched {len(prefetched_prices)} prices concurrently for "
                f"{len(to_fetch)} holding(s) needing update"
            )

        # Group holdings by market for efficient updates
        holdings_by_market = {}
        for holding in tradable_holdings:
            if holding.market not in holdings_by_market:
                holdings_by_market[holding.market] = []
            holdings_by_market[holding.market].append(holding)

        # Update holdings by market
        for market, market_holdings in holdings_by_market.items():
            market_stats = {
                "total": len(market_holdings),
                "updated": 0,
                "cached": 0,
                "failed": 0,
            }

            for holding in market_holdings:
                try:
                    was_updated = await self.update_holding_price(
                        holding,
                        force,
                        prefetched=holding.symbol in prefetched_prices,
                        api_price=prefetched_prices.get(holding.symbol),
                    )

                    if was_updated:
                        stats["updated"] += 1
                        market_stats["updated"] += 1
                    else:
                        stats["cached"] += 1
                        market_stats["cached"] += 1

                except Exception as e:
                    logger.error(f"Failed to update {holding.symbol}: {str(e)}")
                    stats["failed"] += 1
                    market_stats["failed"] += 1

            stats["by_market"][market] = market_stats

        # Commit all updates
        try:
            await self.session.commit()
            logger.info(
                f"Price update completed: {stats['updated']} updated, "
                f"{stats['cached']} cached, {stats['failed']} failed"
            )
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Failed to commit price updates: {str(e)}")
            raise

        return stats

    async def update_all_symbols_prices(
        self, force: bool = False, market: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Symbol-first batch price update for ALL users, optionally one market only.

        Instead of looping per-user (O(users × holdings) DB writes),
        this fetches each unique symbol once and bulk-updates every
        holding that shares that symbol — O(unique_symbols) API calls
        and O(unique_symbols) UPDATE statements regardless of user count.

        Called by the scheduler instead of the per-user loop.
        """

        # 1. Collect all unique (symbol, market) pairs from active tradable holdings
        result = await self.session.execute(
            select(PortfolioHolding.symbol, PortfolioHolding.market, PortfolioHolding.user_id)
            .join(User, User.id == PortfolioHolding.user_id)
            .where(PortfolioHolding.is_active == True)
            .where(PortfolioHolding.type.notin_(sorted(MANUALLY_PRICED_TYPES)))
            # Blocked accounts' holdings would otherwise still be fetched every run.
            .where(User.is_active == True, User.deleted_at.is_(None))
            .distinct()
        )
        # Collapse to ONE market per symbol. The query returns distinct
        # (symbol, market) pairs, so a ticker labelled both TW and US across
        # holdings used to be processed twice — and the second pass overwrote
        # the first for every holding of that symbol. That is how a fresh
        # 0050 quote of 106.40 got replaced by a stale 105.20: the US-labelled
        # pass 404'd on the bare ticker and fell through to old history.
        markets_by_symbol: Dict[str, set] = {}
        users_by_symbol: Dict[str, set] = {}
        for row in result.fetchall():
            # Holdings no feed prices keep the price the user set (manual_pricing).
            if is_manually_priced(row.symbol, None):
                continue
            markets_by_symbol.setdefault(row.symbol, set()).add(row.market)
            users_by_symbol.setdefault(row.symbol, set()).add(row.user_id)

        symbol_market_pairs = [
            (symbol, resolve_symbol_market(symbol, candidates))
            for symbol, candidates in markets_by_symbol.items()
        ]
        # Filter on the resolved market, not the row label: a bare TW code
        # labelled US still belongs to the TW job.
        if market:
            symbol_market_pairs = [
                (s, m) for s, m in symbol_market_pairs if scheduled_job_market(m) == market
            ]

        if not symbol_market_pairs:
            return {"total_symbols": 0, "updated": 0, "cached": 0, "failed": 0, "users": 0}

        stats = {"total_symbols": len(symbol_market_pairs), "updated": 0, "cached": 0, "failed": 0}
        priced_users: set = set()
        now = datetime.now(ZoneInfo("UTC"))

        logger.info(f"Symbol-batch price update: {len(symbol_market_pairs)} unique symbols across all users")

        # 2. Decide which symbols actually need a quote.
        #
        # This used to be one `LIMIT 1` query per symbol inside the update loop.
        # One grouped query answers it for every symbol at once, and MAX() makes
        # the answer deterministic — the old representative-row lookup had no
        # ORDER BY, so which holding's timestamp it read was arbitrary.
        if force:
            to_fetch = list(symbol_market_pairs)
        else:
            last_updates: Dict[str, Any] = {}
            freshness = await self.session.execute(
                select(
                    PortfolioHolding.symbol,
                    func.max(PortfolioHolding.last_price_update_at),
                )
                .where(PortfolioHolding.is_active == True)
                .where(PortfolioHolding.symbol.in_([s for s, _ in symbol_market_pairs]))
                .group_by(PortfolioHolding.symbol)
            )
            for row in freshness.fetchall():
                last_updates[row[0]] = row[1]

            to_fetch = []
            for symbol, market in symbol_market_pairs:
                if self.market_hours_manager.should_update_price(
                    market, last_updates.get(symbol)
                ):
                    to_fetch.append((symbol, market))
                else:
                    stats["cached"] += 1

        # 3. Fetch every quote concurrently, bounded.
        #
        # The upstream round-trips dominate this job and they are pure network
        # waits — fetched serially the all-users refresh scaled linearly with
        # the symbol count. get_current_price/get_previous_close never touch the
        # DB session, so this is concurrency-safe; the session stays serial in
        # the apply loop below. previous_close rides along in the same task
        # because on a cache miss it is a second round-trip of its own.
        quotes: Dict[str, Any] = {}
        if to_fetch:
            _sem = asyncio.Semaphore(self.SYMBOL_FETCH_CONCURRENCY)

            async def _fetch_quote(symbol: str, market: str):
                async with _sem:
                    # No historical fallback here: these holdings already carry
                    # a price, and writing an old close over a good one is
                    # strictly worse than leaving it until the next run.
                    price = await self._get_price_with_fallback(
                        symbol=symbol, market=market, allow_historical_fallback=False
                    )
                    if not price or not price.is_finite() or price <= 0:
                        return symbol, None, None
                    # The provider's own previous close, captured from the same
                    # quote so the pair always describes one session. Left
                    # untouched on a miss rather than nulled — the read path
                    # ages a stale one out.
                    prev = await self.market_data_service.get_previous_close(
                        symbol, market
                    )
                    return symbol, price, prev

            results = await asyncio.gather(
                *[_fetch_quote(s, m) for s, m in to_fetch],
                return_exceptions=True,
            )
            for (symbol, _market), outcome in zip(to_fetch, results):
                if isinstance(outcome, BaseException):
                    logger.error(f"Failed to fetch quote for {symbol}: {outcome}")
                    stats["failed"] += 1
                    continue
                _sym, price, prev = outcome
                if price is None:
                    logger.warning(f"No valid price for {symbol}, skipping bulk update")
                    stats["failed"] += 1
                    continue
                quotes[symbol] = (price, prev)

            logger.info(
                f"Prefetched {len(quotes)} quotes concurrently for "
                f"{len(to_fetch)} symbol(s) needing update"
            )

        # 4. Apply the prefetched quotes — serial, one bulk UPDATE per symbol.
        for symbol, market in to_fetch:
            if symbol not in quotes:
                continue
            new_price, previous_close = quotes[symbol]
            try:
                new_values = {
                    "current_price": new_price,
                    "total_value": PortfolioHolding.quantity * new_price,
                    "gain_loss": (PortfolioHolding.quantity * new_price) - PortfolioHolding.total_cost,
                    "gain_loss_percentage": text(
                        "CASE WHEN total_cost > 0 THEN "
                        "((quantity * :price - total_cost) / total_cost * 100) ELSE 0 END"
                    ),
                    "last_price_update_at": now,
                }
                if (
                    previous_close is not None
                    and previous_close.is_finite()
                    and previous_close > 0
                ):
                    new_values["previous_close"] = previous_close

                # Bulk UPDATE all holdings for this symbol in one SQL statement
                await self.session.execute(
                    update(PortfolioHolding)
                    .where(PortfolioHolding.symbol == symbol)
                    .where(PortfolioHolding.is_active == True)
                    .where(PortfolioHolding.type.notin_(sorted(MANUALLY_PRICED_TYPES)))
                    .values(**new_values)
                    .execution_options(synchronize_session=False),
                    {"price": float(new_price)},
                )
                stats["updated"] += 1
                priced_users |= users_by_symbol.get(symbol, set())
                logger.debug(f"Bulk updated {symbol} → {new_price}")

            except Exception as e:
                logger.error(f"Failed symbol batch update for {symbol}: {e}")
                stats["failed"] += 1

        stats["users"] = len(priced_users)

        try:
            await self.session.commit()
            logger.info(
                f"Symbol-batch update done: {stats['updated']} symbols updated, "
                f"{stats['cached']} skipped (fresh), {stats['failed']} failed"
            )
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Failed to commit symbol-batch price updates: {e}")
            raise

        # Sync parent portfolio totals from the now-updated holdings.
        # The per-user refresh path calls update_portfolio_values() per portfolio,
        # but the scheduler skips it, leaving portfolios.total_value stale.
        # One bulk SQL statement handles all portfolios efficiently.
        if stats["updated"] > 0:
            try:
                await self.session.execute(text("""
                    UPDATE portfolios p
                    SET
                        total_value              = COALESCE(sub.total_value, 0),
                        total_cost               = COALESCE(sub.total_cost, 0),
                        total_gain_loss          = COALESCE(sub.total_value, 0) - COALESCE(sub.total_cost, 0),
                        total_gain_loss_percentage = CASE
                            WHEN COALESCE(sub.total_cost, 0) > 0
                            THEN (COALESCE(sub.total_value, 0) - COALESCE(sub.total_cost, 0))
                                 / COALESCE(sub.total_cost, 0) * 100
                            ELSE 0
                        END,
                        updated_at = NOW()
                    FROM (
                        SELECT portfolio_id,
                               SUM(total_value) AS total_value,
                               SUM(total_cost)  AS total_cost
                        FROM   portfolio_holdings
                        WHERE  is_active = TRUE
                        GROUP  BY portfolio_id
                    ) sub
                    WHERE p.id = sub.portfolio_id
                      AND p.is_active = TRUE
                """))
                await self.session.commit()
                logger.info("Portfolio totals synced after symbol-batch price update")
            except Exception as e:
                await self.session.rollback()
                logger.error(f"Failed to sync portfolio totals after price update: {e}")

        return stats


def get_price_update_service(session: AsyncSession) -> PriceUpdateService:
    """Factory function to get price update service instance"""
    return PriceUpdateService(session)
