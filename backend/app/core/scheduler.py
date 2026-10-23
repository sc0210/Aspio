"""
Background Scheduler for Aspiro

Handles scheduled tasks like:
- Price updates after market close
- Historical data sync
- Cleanup jobs
"""

import logging
from typing import Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED

from sqlalchemy import select, text

from app.core.database import engine
from app.core.database import async_session
from app.modules.portfolio.price_update_service import PriceUpdateService
from app.modules.portfolio.historical_price_service import HistoricalPriceService
from app.modules.portfolio.models import PortfolioHolding
from app.modules.users.models import User
from app.modules.portfolio.market_data_service import resolve_symbol_market

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler: Optional[AsyncIOScheduler] = None


def job_listener(event):
    """Listen for job execution events"""
    if event.exception:
        logger.error(f"Scheduled job {event.job_id} failed: {event.exception}")
    else:
        logger.info(f"Scheduled job {event.job_id} completed successfully")


async def update_all_users_prices(market: str = "ALL"):
    """
    Update prices for all users' portfolios after market close

    Args:
        market: "TW", "US", "CRYPTO", or "ALL"
    """
    logger.info(f"Starting scheduled price update for market: {market}")

    async with async_session() as session:
        try:
            # Get all active users with holdings
            if market == "ALL":
                query = select(User.id).distinct()
            else:
                # Get users with holdings in specific market
                query = (
                    select(PortfolioHolding.user_id)
                    .where(PortfolioHolding.market == market)
                    .where(PortfolioHolding.is_active == True)
                    .distinct()
                )

            result = await session.execute(query)
            user_ids = [row[0] for row in result.fetchall()]

            if not user_ids:
                logger.info(f"No users with {market} holdings to update")
                return

            logger.info(f"Found {len(user_ids)} users with {market} holdings — running symbol-batch update")

            # Symbol-first batch update: fetch each unique symbol once,
            # bulk-update all holdings for that symbol. O(unique_symbols) instead
            # of O(users × holdings) — scales to any number of users.
            price_service = PriceUpdateService(session)
            total_stats = await price_service.update_all_symbols_prices(force=False)
            total_stats["users"] = len(user_ids)

            logger.info(
                "Scheduled price update complete: "
                f"{total_stats['users']} users, "
                f"{total_stats['updated']} symbols updated, "
                f"{total_stats['cached']} skipped (fresh), "
                f"{total_stats['failed']} failed"
            )

        except Exception as e:
            logger.error(f"Scheduled price update failed: {e}", exc_info=True)


async def sync_historical_data_for_all_users(days: int = 7):
    """
    Sync recent historical data for all users' portfolios
    Run this daily to keep historical data up to date
    """
    logger.info(f"Starting scheduled historical data sync ({days} days)")

    async with async_session() as session:
        try:
            # Get all distinct symbols with their markets
            query = (
                select(
                    PortfolioHolding.symbol,
                    PortfolioHolding.market,
                    PortfolioHolding.type,
                )
                .join(User, User.id == PortfolioHolding.user_id)
                .where(PortfolioHolding.is_active == True)
                # Blocked accounts' holdings still drive outside fetches otherwise.
                .where(User.is_active == True, User.deleted_at.is_(None))
                .distinct()
            )

            result = await session.execute(query)
            holdings_data = result.fetchall()

            if not holdings_data:
                logger.info("No holdings to sync historical data for")
                return

            # Build symbol-market mapping, filtering out non-tradable items
            NON_TRADABLE_SYMBOLS = {
                "SAVINGS",
                "TWD-SAVINGS",
                "CPF-OA",
                "ANNUAL-BUDGET",
                "CRYPTO",
                "CASH",
                "EMERGENCY-FUND",
                "BUDGET",
            }
            markets_by_symbol: dict[str, set] = {}
            for row in holdings_data:
                sym = row.symbol.upper()
                # Cash-type holdings and lending positions have no quotable
                # price; fetching them only burns provider calls and inflates
                # the job's failure count, hiding real sync breakage.
                if row.type and str(row.type).lower() == "cash":
                    continue
                if (
                    sym in NON_TRADABLE_SYMBOLS
                    or sym.startswith("CASH-")
                    or sym.startswith("EMERGENCY-")
                    or sym.endswith("-SAVINGS")
                    or sym.endswith("-BUDGET")
                    or sym.endswith("-LEND")
                ):
                    continue
                markets_by_symbol.setdefault(row.symbol, set()).add(row.market)

            symbol_markets = {
                symbol: resolve_symbol_market(symbol, candidates)
                for symbol, candidates in markets_by_symbol.items()
            }
            # The FX series time-weighted return values USD holdings with. No
            # one holds "TWD=X", so it would never be refreshed otherwise.
            from app.modules.portfolio.performance_tracker import FX_SERIES

            for fx_symbol in FX_SERIES.values():
                symbol_markets.setdefault(fx_symbol, "FX")
            # The beta benchmark. Nobody holds SPY either, so it went unrefreshed
            # from 2026-03 and beta (gated on a fresh SPY) could never be shown.
            symbol_markets.setdefault("SPY", "US")
            # The blended benchmark's legs (see AnalyticsService): the TAIEX, and VT
            # for users who don't happen to hold it.
            symbol_markets.setdefault("^TWII", "TW-INDEX")
            symbol_markets.setdefault("VT", "US")
            symbols = list(symbol_markets.keys())

            logger.info(f"Syncing historical data for {len(symbols)} symbols")

            # Sync historical data
            hist_service = HistoricalPriceService(session)
            result = await hist_service.update_holdings_historical_data(
                symbols=symbols, markets=symbol_markets, days=days
            )

            logger.info(
                "Historical sync complete: "
                f"{result['successful']} successful, "
                f"{result['cached']} cached, "
                f"{result['failed']} failed, "
                f"{result['total_records']} records"
            )

        except Exception as e:
            logger.error(f"Scheduled historical sync failed: {e}", exc_info=True)


async def send_payment_due_reminders():
    """Emit PAYMENT_DUE notifications for loans due in the next few days.

    Lightweight (a single loans scan + a few inserts), so — unlike the price
    job — it is safe to run in-process without OOM risk. Owns its own
    session and commit; the producer only flushes.
    """
    from app.modules.loans.reminders import generate_payment_due_reminders

    logger.info("Starting scheduled payment-due reminder scan")
    async with async_session() as session:
        try:
            created = await generate_payment_due_reminders(session)
            await session.commit()
            logger.info("Payment-due reminder scan complete: %d created", created)
        except Exception as e:
            await session.rollback()
            logger.error(f"Payment-due reminder scan failed: {e}", exc_info=True)


async def send_spending_alerts():
    """Emit spending alerts for users over their recent monthly average.

    Lightweight batch scan (a couple of aggregates per active user); safe
    in-process. Owns its own session and commit; the producer only flushes.
    """
    from app.modules.transactions.spending_alerts import generate_spending_alerts

    logger.info("Starting scheduled spending-alert scan")
    async with async_session() as session:
        try:
            created = await generate_spending_alerts(session)
            await session.commit()
            logger.info("Spending-alert scan complete: %d created", created)
        except Exception as e:
            await session.rollback()
            logger.error(f"Spending-alert scan failed: {e}", exc_info=True)


def init_scheduler():
    """Initialize the APScheduler with scheduled jobs"""
    global scheduler

    if scheduler is not None:
        logger.warning("Scheduler already initialized")
        return scheduler

    scheduler = AsyncIOScheduler(timezone=ZoneInfo("UTC"))

    # Add event listener for job monitoring
    scheduler.add_listener(job_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

    # ==========================================
    # Taiwan Market Price Update
    # Run at 14:00 TST (06:00 UTC) - 30 min after market close
    # ==========================================
    scheduler.add_job(
        update_all_users_prices,
        CronTrigger(hour=6, minute=0, timezone=ZoneInfo("UTC")),
        id="tw_market_price_update",
        name="Taiwan Market Price Update",
        kwargs={"market": "TW"},
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: Taiwan market price update at 14:00 TST (06:00 UTC)")

    # ==========================================
    # US Market Price Update
    # Run at 16:30 EST (21:30 UTC or 20:30 UTC during DST)
    # Using 21:30 UTC as a safe time that works year-round
    # ==========================================
    scheduler.add_job(
        update_all_users_prices,
        CronTrigger(hour=21, minute=30, timezone=ZoneInfo("UTC")),
        id="us_market_price_update",
        name="US Market Price Update",
        kwargs={"market": "US"},
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: US market price update at 16:30 EST (21:30 UTC)")

    # ==========================================
    # Crypto Price Update
    # Run every 6 hours (crypto markets are 24/7)
    # ==========================================
    scheduler.add_job(
        update_all_users_prices,
        CronTrigger(hour="8,20", minute=0, timezone=ZoneInfo("UTC")),
        id="crypto_price_update",
        name="Crypto Price Update",
        kwargs={"market": "CRYPTO"},
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: Crypto price update at 08:00 and 20:00 UTC")

    # ==========================================
    # Daily Historical Data Sync
    # Run at 22:00 UTC (after both TW and US markets close)
    # Only sync last 7 days to minimize API usage
    # ==========================================
    scheduler.add_job(
        sync_historical_data_for_all_users,
        CronTrigger(hour=22, minute=0, timezone=ZoneInfo("UTC")),
        id="daily_historical_sync",
        name="Daily Historical Data Sync",
        kwargs={"days": 7},
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: Daily historical data sync at 22:00 UTC")

    # ==========================================
    # Daily Payment-Due Reminders
    # Run at 01:00 UTC (09:00 TST) — morning local time so reminders land
    # before the user's day starts. Idempotent, so a missed run self-heals.
    # ==========================================
    scheduler.add_job(
        send_payment_due_reminders,
        CronTrigger(hour=1, minute=0, timezone=ZoneInfo("UTC")),
        id="daily_payment_due_reminders",
        name="Daily Payment-Due Reminders",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: Daily payment-due reminders at 09:00 TST (01:00 UTC)")

    # ==========================================
    # Daily Spending Alerts
    # Run at 01:05 UTC (09:05 TST) — just after payment reminders. Once-per-
    # month per user, so a missed run self-heals on the next day's scan.
    # ==========================================
    scheduler.add_job(
        send_spending_alerts,
        CronTrigger(hour=1, minute=5, timezone=ZoneInfo("UTC")),
        id="daily_spending_alerts",
        name="Daily Spending Alerts",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: Daily spending alerts at 09:05 TST (01:05 UTC)")

    return scheduler


# ---------------------------------------------------------------------------
# Single-instance election
#
# uvicorn --workers N forks N complete application processes, each of which
# runs the lifespan startup. Without this, --workers 2 started two schedulers
# and every cron job fired twice — on the Pi that meant the FinLab refresh
# burning double its 500MB/day quota.
#
# A Postgres session-level advisory lock picks exactly one leader. The lock is
# tied to the holding connection, so a crashed or restarted worker releases it
# automatically and the next boot re-elects without manual cleanup.
# ---------------------------------------------------------------------------
SCHEDULER_ADVISORY_LOCK_KEY = 8_147_320_051  # arbitrary, must stay stable


async def try_acquire_scheduler_lock():
    """Return a held connection if this process won the scheduler role, else None.

    Never raises: a database problem must mean "this worker does not schedule",
    not "this worker fails to boot".
    """
    try:
        conn = await engine.connect()
    except Exception as e:
        logger.warning(f"Scheduler lock unavailable (cannot connect): {e}")
        return None

    try:
        acquired = (
            await conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": SCHEDULER_ADVISORY_LOCK_KEY},
            )
        ).scalar()
    except Exception as e:
        logger.warning(f"Scheduler lock unavailable (query failed): {e}")
        try:
            await conn.close()
        except Exception:
            pass
        return None

    if acquired:
        return conn

    try:
        await conn.close()
    except Exception:
        pass
    return None


async def release_scheduler_lock(conn) -> None:
    """Drop the advisory lock and close the connection that held it."""
    if conn is None:
        return
    try:
        await conn.execute(
            text("SELECT pg_advisory_unlock(:key)"),
            {"key": SCHEDULER_ADVISORY_LOCK_KEY},
        )
    except Exception as e:
        logger.debug(f"Scheduler lock unlock failed (closing anyway): {e}")
    finally:
        try:
            await conn.close()
        except Exception:
            pass


def start_scheduler():
    """Start the scheduler"""
    global scheduler

    if scheduler is None:
        scheduler = init_scheduler()

    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started successfully")

        # Log next run times for all jobs
        for job in scheduler.get_jobs():
            next_run = job.next_run_time
            if next_run:
                logger.info(f"  - {job.name}: next run at {next_run.isoformat()}")
    else:
        logger.info("Scheduler is already running")


def stop_scheduler():
    """Stop the scheduler gracefully"""
    global scheduler

    if scheduler and scheduler.running:
        scheduler.shutdown(wait=True)
        logger.info("Scheduler stopped")

    scheduler = None


def get_scheduler_status():
    """Get current scheduler status and job information"""
    global scheduler

    if scheduler is None:
        return {"running": False, "jobs": []}

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append(
            {
                "id": job.id,
                "name": job.name,
                "next_run": (
                    job.next_run_time.isoformat() if job.next_run_time else None
                ),
                "pending": job.pending,
            }
        )

    return {"running": scheduler.running, "jobs": jobs}
