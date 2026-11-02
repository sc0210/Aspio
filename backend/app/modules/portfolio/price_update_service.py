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
from sqlalchemy import select, and_, case, func, or_, update, text

from .manual_pricing import MANUALLY_PRICED_TYPES, is_manually_priced
from .models import PortfolioHolding
from app.modules.users.models import User
from .market_data_service import get_market_data_service, resolve_symbol_market
from ...core.config import get_settings
from app.utils.datetime_helpers import business_today
from app.utils.market_sessions import last_settled_close

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
            # Market closed: refresh only if the stored price predates the most
            # recent close that is final (bell + grace, weekends skipped). Before
            # the open that is yesterday's close, so a pre-open refresh no longer
            # refetches every lot; a write in the minutes after the bell (a
            # mid-auction quote) is not mistaken for the day's close.
            session_market = market.upper() if market.upper() in cls.MARKET_HOURS else "US"
            settled = last_settled_close(session_market, now)
            if settled is None:
                # Unmodelled session: at most once per UTC day.
                return last_update.date() < now.date()
            return last_update < settled


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
        self, symbol: str, market: str,
        *, prefetched: bool = False, api_price: Optional[Decimal] = None,
        allow_historical_fallback: bool = True,
    ) -> Optional[Decimal]:
        """
        Get current price with multiple fallback strategies

        Fallback chain:
        1. Try market data API
        2. If that fails, a recent historical close (unless disabled)
        3. Otherwise None

        There is no "reuse the stored price" step any more: handing the lot's own
        price back as a fresh quote is how a failed fetch got stamped as an update.

        Args:
            symbol: Stock symbol
            market: Market type
            allow_historical_fallback: When False, step 2 is skipped and the
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

        # Fallback: a recent historical close
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

    async def apply_quote(
        self,
        symbol: str,
        price: Decimal,
        previous_close: Optional[Decimal],
        quote_time: datetime,
        user_id: Optional[str] = None,
    ) -> int:
        """Write one quote onto every active, feed-priced lot of `symbol` (or one user's).

        The single price write every path shares — the scheduler, the per-user
        refresh. One set-based UPDATE, so the derived columns are computed by
        Postgres from each row's *committed* quantity and average cost under its
        row lock. The per-user refresh used to compute them in Python from a
        snapshot read before a network wait of up to 15 s; a sell that committed in
        between was then overwritten with the pre-sale value and cost.

        `quote_time` guards order: a row stamped later than this quote keeps its
        price, so a refresh that fetched first and commits last cannot undo a
        newer write. A previous close the provider did not give is cleared rather
        than kept beside a new price — kept, it could be days older and turn a
        multi-day move into "today's change"; the read path falls back to the
        stored history instead.

        Returns the number of lots written.
        """
        cost = PortfolioHolding.quantity * PortfolioHolding.average_cost
        value = PortfolioHolding.quantity * price
        prev = (
            previous_close
            if previous_close is not None and previous_close.is_finite() and previous_close > 0
            else None
        )
        stmt = (
            update(PortfolioHolding)
            .where(PortfolioHolding.symbol == symbol)
            .where(PortfolioHolding.is_active == True)  # noqa: E712
            .where(PortfolioHolding.type.notin_(sorted(MANUALLY_PRICED_TYPES)))
            .where(
                or_(
                    PortfolioHolding.last_price_update_at.is_(None),
                    PortfolioHolding.last_price_update_at <= quote_time,
                )
            )
            .values(
                current_price=price,
                previous_close=prev,
                total_cost=cost,
                total_value=value,
                gain_loss=value - cost,
                gain_loss_percentage=case(
                    (cost > 0, (value - cost) / cost * 100), else_=0
                ),
                last_price_update_at=quote_time,
            )
            .execution_options(synchronize_session=False)
        )
        if user_id is not None:
            stmt = stmt.where(PortfolioHolding.user_id == user_id)
        result = await self.session.execute(stmt)
        return result.rowcount or 0

    async def _fetch_live_quote(self, symbol: str, market: str):
        """(price, previous_close) from the providers, or None. Never a stored price.

        A provider miss returns None, so nothing is written and nothing is stamped
        fresh: the old fallback handed back the lot's own stored price, which was
        then written with a new timestamp, so a failed fetch looked like a refresh
        and the gate stopped retrying until the next session.
        """
        price = await self._get_price_with_fallback(
            symbol=symbol, market=market, allow_historical_fallback=False
        )
        if not price or not price.is_finite() or price <= 0:
            return None
        prev = await self.market_data_service.get_previous_close(symbol, market)
        return price, prev

    async def update_portfolio_prices(
        self, user_id: str, portfolio_id: Optional[str] = None, force: bool = False
    ) -> Dict[str, Any]:
        """Refresh one user's feed-priced lots.

        Reads only what it needs to decide (symbol, market, freshness), ends that
        read transaction before any network wait so no pooled connection is pinned
        across provider calls, then writes through `apply_quote` — set-based, so a
        sell or edit committed meanwhile is respected, not overwritten.
        """
        query = select(
            PortfolioHolding.symbol,
            PortfolioHolding.market,
            PortfolioHolding.type,
            PortfolioHolding.last_price_update_at,
        ).where(
            and_(
                PortfolioHolding.user_id == user_id, PortfolioHolding.is_active == True  # noqa: E712
            )
        )
        if portfolio_id:
            query = query.where(PortfolioHolding.portfolio_id == portfolio_id)
        rows = (await self.session.execute(query)).all()

        if not rows:
            return {"total": 0, "updated": 0, "cached": 0, "failed": 0}

        # Holdings no feed prices keep the price the user set (manual_pricing).
        tradable = [r for r in rows if not is_manually_priced(r.symbol, r.type)]
        stats: Dict[str, Any] = {
            "total": len(tradable),
            "updated": 0,
            "cached": 0,
            "failed": 0,
            "skipped": len(rows) - len(tradable),
            "by_market": {},
        }
        if not tradable:
            return stats

        # One market and one freshness per symbol: the stalest lot decides, so a
        # lot added (or refreshed) recently does not hide an older sibling.
        markets: Dict[str, set] = {}
        oldest: Dict[str, Optional[datetime]] = {}
        lots_per_symbol: Dict[str, int] = {}
        for r in tradable:
            markets.setdefault(r.symbol, set()).add(r.market)
            lots_per_symbol[r.symbol] = lots_per_symbol.get(r.symbol, 0) + 1
            stamp = r.last_price_update_at
            if r.symbol not in oldest:
                oldest[r.symbol] = stamp
            elif oldest[r.symbol] is not None and (stamp is None or stamp < oldest[r.symbol]):
                oldest[r.symbol] = stamp
        pairs = sorted(
            (symbol, resolve_symbol_market(symbol, candidates))
            for symbol, candidates in markets.items()
        )

        def _bump(market: str, key: str, n: int) -> None:
            bucket = stats["by_market"].setdefault(
                market, {"total": 0, "updated": 0, "cached": 0, "failed": 0}
            )
            bucket["total"] += n
            bucket[key] += n
            stats[key] += n

        to_fetch = []
        for symbol, market in pairs:
            if force or self.market_hours_manager.should_update_price(market, oldest[symbol]):
                to_fetch.append((symbol, market))
            else:
                _bump(market, "cached", lots_per_symbol[symbol])

        if not to_fetch:
            return stats

        # End the read transaction before the network wait (nothing is pending:
        # the caller's writes, if any, come after this call).
        await self.session.commit()

        sem = asyncio.Semaphore(self.SYMBOL_FETCH_CONCURRENCY)

        async def _one(symbol: str, market: str):
            async with sem:
                try:
                    return await self._fetch_live_quote(symbol, market)
                except Exception as e:
                    logger.warning(f"⚠️ Quote fetch failed for {symbol}: {e}")
                    return None

        quotes = await asyncio.gather(*[_one(s, m) for s, m in to_fetch])
        quote_time = datetime.now(ZoneInfo("UTC"))

        try:
            for (symbol, market), quote in zip(to_fetch, quotes):
                if quote is None:
                    _bump(market, "failed", lots_per_symbol[symbol])
                    continue
                price, prev = quote
                written = await self.apply_quote(symbol, price, prev, quote_time, user_id=user_id)
                _bump(market, "updated", written)
                # Lots a newer write already covered count as current, not failed.
                if lots_per_symbol[symbol] > written:
                    _bump(market, "cached", lots_per_symbol[symbol] - written)
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
        # One grouped query answers it for every symbol at once. MIN, not MAX: the
        # stalest lot decides. With MAX, one user's refresh at 13:45 (or a lot
        # added a minute ago) marked the symbol fresh and the job skipped it for
        # every other user until the next session.
        if force:
            to_fetch = list(symbol_market_pairs)
        else:
            last_updates: Dict[str, Any] = {}
            freshness = await self.session.execute(
                select(
                    PortfolioHolding.symbol,
                    func.min(PortfolioHolding.last_price_update_at),
                    func.count(PortfolioHolding.id)
                    - func.count(PortfolioHolding.last_price_update_at),
                )
                .where(PortfolioHolding.is_active == True)
                .where(PortfolioHolding.type.notin_(sorted(MANUALLY_PRICED_TYPES)))
                .where(PortfolioHolding.symbol.in_([s for s, _ in symbol_market_pairs]))
                .group_by(PortfolioHolding.symbol)
            )
            for row in freshness.fetchall():
                # A never-priced lot (NULL) makes the whole symbol due.
                last_updates[row[0]] = None if row[2] else row[1]

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
                    quote = await self._fetch_live_quote(symbol, market)
                    if quote is None:
                        return symbol, None, None
                    return symbol, quote[0], quote[1]

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

        # 4. Apply the prefetched quotes: sorted, one commit per symbol. Sorted
        # so every run takes row locks in the same order; committed per symbol so
        # locks are held for one statement, not the whole market, and one failed
        # statement (which aborts a Postgres transaction) loses one symbol rather
        # than rolling back every symbol before it.
        for symbol, market in sorted(to_fetch):
            if symbol not in quotes:
                continue
            new_price, previous_close = quotes[symbol]
            try:
                await self.apply_quote(symbol, new_price, previous_close, now)
                await self.session.commit()
                stats["updated"] += 1
                priced_users |= users_by_symbol.get(symbol, set())
                logger.debug(f"Bulk updated {symbol} → {new_price}")
            except Exception as e:
                await self.session.rollback()
                logger.error(f"Failed symbol batch update for {symbol}: {e}")
                stats["failed"] += 1

        stats["users"] = len(priced_users)

        logger.info(
            f"Symbol-batch update done: {stats['updated']} symbols updated, "
            f"{stats['cached']} skipped (fresh), {stats['failed']} failed"
        )

        # Sync parent portfolio totals from the now-updated holdings, through the
        # same converting function the per-user refresh uses. This used to be one
        # raw `SUM(total_value)` across currencies — NT$1,000,000 and US$10,000
        # stored as "1,010,000" — which then overwrote the converted figure the
        # LINE bot, dividend yields, rebalancing and admin read.
        if stats["updated"] > 0:
            from .services import PortfolioService

            updated_symbols = {s for s, _ in to_fetch if s in quotes}
            affected = (await self.session.execute(
                select(PortfolioHolding.portfolio_id, PortfolioHolding.user_id)
                .where(PortfolioHolding.is_active == True)  # noqa: E712
                .where(PortfolioHolding.symbol.in_(sorted(updated_symbols)))
                .distinct()
            )).all()
            portfolio_service = PortfolioService(self.session)
            synced = 0
            for portfolio_id, owner_id in affected:
                try:
                    await portfolio_service._update_portfolio_totals(portfolio_id, owner_id)
                    await self.session.commit()
                    synced += 1
                except Exception as e:
                    await self.session.rollback()
                    logger.error(f"Failed to sync totals for portfolio {portfolio_id}: {e}")
            logger.info(f"Portfolio totals synced for {synced} portfolio(s) after symbol-batch update")

        return stats


def get_price_update_service(session: AsyncSession) -> PriceUpdateService:
    """Factory function to get price update service instance"""
    return PriceUpdateService(session)
