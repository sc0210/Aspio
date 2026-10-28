"""
Admin monitoring and management services.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy import select, func, text, and_, case
from sqlalchemy.ext.asyncio import AsyncSession
import logging
import os
import time

from app.core.config import get_settings
from app.core.scheduler import (
    JOB_STATUS_CATEGORY,
    JOB_STATUS_KEY_PREFIX,
    SCHEDULER_ADVISORY_LOCK_KEY,
    get_scheduler_status,
)
from app.modules.users.models import User
from app.modules.portfolio.models import (
    CurrencyRate,
    HistoricalPrice,
    Portfolio,
    PortfolioHolding,
    PortfolioTransaction,
)
from app.modules.transactions.models import Transaction
from app.utils.datetime_helpers import business_day_of, business_today
from .models import AdminUser, AdminAuditLog, SystemSetting
from .repositories import AdminRepository, AuditLogRepository

logger = logging.getLogger(__name__)

# Track application start time
_APP_START_TIME = time.time()

# Days a feed may lag before the health check calls it stale. Prices allow for a
# weekend plus a market holiday; FX rates are written daily. (daily_wallet_snapshots
# is not a feed: nothing has written it since the dashboard stopped reading it.)
STALE_AFTER_DAYS = {"historical_prices": 4, "fx_rates": 2}

# Every scheduled job runs at least daily, so a last run older than this means
# runs are being missed (the scheduler grants a run up to 6 hours' grace).
JOB_OVERDUE_AFTER_HOURS = 30


class AdminMonitoringService:
    """Service for admin monitoring operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_system_statistics(self) -> Dict[str, Any]:
        """Get overall system statistics"""

        now = datetime.now(timezone.utc)
        today = now.date()
        week_ago = now - timedelta(days=7)

        # 4 user-count queries → 1 query with CASE aggregations
        user_row = (await self.session.execute(
            select(
                func.count(User.id).label("total"),
                func.count(case((User.is_active == True, 1))).label("active"),
                func.count(case((func.date(User.created_at) == today, 1))).label("today"),
                func.count(case((User.created_at >= week_ago, 1))).label("this_week"),
            )
        )).one()

        # portfolio count + total value in 1 query
        portfolio_row = (await self.session.execute(
            select(
                func.count(Portfolio.id).label("total"),
                func.coalesce(
                    func.sum(Portfolio.total_value).filter(Portfolio.is_active == True), 0
                ).label("total_value"),
            )
        )).one()

        # Sequential on purpose: all three share this request's AsyncSession,
        # which cannot serve concurrent operations (see get_analytics).
        holdings_count = await self.session.execute(
            select(func.count(PortfolioHolding.id))
        )
        tx_count = await self.session.execute(select(func.count(Transaction.id)))
        db_size = await self._get_database_size()

        return {
            "total_users": user_row.total or 0,
            "active_users": user_row.active or 0,
            "new_users_today": user_row.today or 0,
            "new_users_this_week": user_row.this_week or 0,
            "total_portfolios": portfolio_row.total or 0,
            "total_holdings": holdings_count.scalar() or 0,
            "total_transactions": tx_count.scalar() or 0,
            "total_portfolio_value_usd": float(portfolio_row.total_value),
            "database_size_mb": db_size,
            "cache_hit_rate": 0.85,
            "uptime_seconds": int(time.time() - _APP_START_TIME),
            "active_sessions": 0,
        }

    async def get_database_statistics(self) -> Dict[str, Any]:
        """Get database performance statistics"""

        db_size = await self._get_database_size()

        # ── Table stats ────────────────────────────────────────────────────────
        table_stats_query = text("""
            SELECT
                t.relname                                          AS tablename,
                pg_size_pretty(pg_total_relation_size(c.oid))     AS total_size,
                pg_size_pretty(pg_relation_size(c.oid))           AS table_size,
                pg_size_pretty(
                    pg_total_relation_size(c.oid)
                    - pg_relation_size(c.oid))                    AS index_size,
                pg_total_relation_size(c.oid)                     AS size_bytes,
                COALESCE(t.n_live_tup, 0)                        AS live_rows,
                COALESCE(t.n_dead_tup, 0)                        AS dead_rows,
                COALESCE(t.n_ins_since_vacuum, 0)                AS rows_since_vacuum,
                t.last_autovacuum,
                t.last_analyze,
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = t.relname)                    AS column_count,
                COALESCE(t.seq_scan, 0)                          AS seq_scans,
                COALESCE(t.idx_scan, 0)                          AS idx_scans
            FROM pg_stat_user_tables t
            JOIN pg_class c ON c.relname = t.relname
            WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            ORDER BY pg_total_relation_size(c.oid) DESC
            LIMIT 25;
        """)
        result = await self.session.execute(table_stats_query)
        table_stats = [
            {
                "table": row[0],
                "total_size": row[1],
                "table_size": row[2],
                "index_size": row[3],
                "size_bytes": int(row[4]) if row[4] else 0,
                "live_rows": int(row[5]) if row[5] else 0,
                "dead_rows": int(row[6]) if row[6] else 0,
                "rows_since_vacuum": int(row[7]) if row[7] else 0,
                "last_autovacuum": row[8].isoformat() if row[8] else None,
                "last_analyze": row[9].isoformat() if row[9] else None,
                "column_count": int(row[10]) if row[10] else 0,
                "seq_scans": int(row[11]) if row[11] else 0,
                "idx_scans": int(row[12]) if row[12] else 0,
            }
            for row in result
        ]

        # ── Index stats ────────────────────────────────────────────────────────
        index_stats_query = text("""
            SELECT
                i.relname                                          AS tablename,
                ix.relname                                         AS indexname,
                COALESCE(s.idx_scan, 0)                           AS scans,
                COALESCE(s.idx_tup_read, 0)                       AS tuples_read,
                pg_size_pretty(pg_relation_size(ix.oid))          AS index_size,
                pg_relation_size(ix.oid)                          AS size_bytes,
                am.amname                                          AS index_type,
                ix.reltuples::bigint                               AS index_entries
            FROM pg_index idx
            JOIN pg_class i  ON i.oid  = idx.indrelid
            JOIN pg_class ix ON ix.oid = idx.indexrelid
            JOIN pg_am    am ON am.oid = ix.relam
            LEFT JOIN pg_stat_user_indexes s
                   ON s.indexrelid = idx.indexrelid
            WHERE i.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            ORDER BY pg_relation_size(ix.oid) DESC
            LIMIT 30;
        """)
        result = await self.session.execute(index_stats_query)
        index_stats = [
            {
                "table": row[0],
                "index": row[1],
                "scans": int(row[2]) if row[2] else 0,
                "tuples_read": int(row[3]) if row[3] else 0,
                "size": row[4],
                "size_bytes": int(row[5]) if row[5] else 0,
                "type": row[6],
                "entries": int(row[7]) if row[7] else 0,
            }
            for row in result
        ]

        # ── Database-level stats ───────────────────────────────────────────────
        db_stats_query = text("""
            SELECT
                numbackends,
                xact_commit,
                xact_rollback,
                blks_read,
                blks_hit,
                tup_inserted,
                tup_updated,
                tup_deleted,
                deadlocks,
                CASE WHEN (blks_hit + blks_read) > 0
                     THEN ROUND(blks_hit::numeric / (blks_hit + blks_read) * 100, 2)
                     ELSE 0
                END AS buffer_hit_pct
            FROM pg_stat_database
            WHERE datname = current_database();
        """)
        row = (await self.session.execute(db_stats_query)).first()
        db_level = {
            "connections": int(row[0]) if row else 0,
            "commits": int(row[1]) if row else 0,
            "rollbacks": int(row[2]) if row else 0,
            "blocks_read_disk": int(row[3]) if row else 0,
            "blocks_hit_cache": int(row[4]) if row else 0,
            "rows_inserted": int(row[5]) if row else 0,
            "rows_updated": int(row[6]) if row else 0,
            "rows_deleted": int(row[7]) if row else 0,
            "deadlocks": int(row[8]) if row else 0,
            "buffer_hit_pct": float(row[9]) if row else 0.0,
        } if row else {}

        # ── Active connections ─────────────────────────────────────────────────
        conn_query = text("""
            SELECT
                pid,
                usename,
                application_name,
                client_addr::text,
                state,
                COALESCE(LEFT(query, 120), '') AS query_snippet,
                ROUND(EXTRACT(EPOCH FROM (now() - query_start))::numeric, 1) AS duration_s,
                wait_event_type,
                wait_event
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid != pg_backend_pid()
              AND state IS NOT NULL
            ORDER BY query_start DESC NULLS LAST
            LIMIT 15;
        """)
        result = await self.session.execute(conn_query)
        active_connections = [
            {
                "pid": row[0],
                "user": row[1] or "—",
                "application": row[2] or "—",
                "client": row[3] or "local",
                "state": row[4] or "unknown",
                "query": row[5],
                "duration_s": float(row[6]) if row[6] is not None else 0.0,
                "wait_event_type": row[7],
                "wait_event": row[8],
            }
            for row in result
        ]

        # ── Unused indexes (zero scans) ────────────────────────────────────────
        unused_indexes = [idx for idx in index_stats if idx["scans"] == 0]

        return {
            "total_size_mb": db_size,
            "table_count": len(table_stats),
            "index_count": len(index_stats),
            "table_stats": table_stats,
            "index_stats": index_stats,
            "unused_indexes": unused_indexes,
            "db_level": db_level,
            "active_connections": active_connections,
        }

    async def run_vacuum(
        self,
        table_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run VACUUM ANALYZE on a table or the entire database.

        VACUUM cannot execute inside a transaction block, so we open a separate
        AUTOCOMMIT connection from the shared engine rather than using the
        request-scoped session.
        """
        from fastapi import HTTPException
        from app.core.database import engine

        # Validate / safely quote the table identifier to prevent injection
        safe_ident: Optional[str] = None
        if table_name:
            row = (await self.session.execute(
                text(
                    "SELECT quote_ident(relname) "
                    "FROM pg_stat_user_tables "
                    "WHERE schemaname = 'public' AND relname = :t"
                ),
                {"t": table_name},
            )).first()
            if not row:
                raise HTTPException(
                    status_code=404,
                    detail=f"Table '{table_name}' not found in public schema",
                )
            safe_ident = row[0]

        cmd = f"VACUUM (ANALYZE) {safe_ident}" if safe_ident else "VACUUM ANALYZE"

        start = time.time()
        autocommit_engine = engine.execution_options(isolation_level="AUTOCOMMIT")
        async with autocommit_engine.connect() as conn:
            await conn.execute(text(cmd))
        elapsed = round(time.time() - start, 2)

        return {
            "table": table_name or "all tables",
            "command": cmd,
            "duration_s": elapsed,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def get_audit_logs(
        self,
        action: Optional[str] = None,
        resource_type: Optional[str] = None,
        admin_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 50
    ) -> Dict[str, Any]:
        """Admin audit log entries, newest first, with the acting admin's email."""
        repo = AuditLogRepository(self.session)
        logs, total = await repo.search(
            action=action,
            resource_type=resource_type,
            admin_id=admin_id,
            skip=skip,
            limit=limit
        )

        admin_ids = {log.admin_user_id for log in logs}
        emails: Dict[UUID, str] = {}
        if admin_ids:
            rows = await self.session.execute(
                select(AdminUser.id, User.email)
                .join(User, User.id == AdminUser.user_id)
                .where(AdminUser.id.in_(admin_ids))
            )
            emails = {row.id: row.email for row in rows}

        return {
            "logs": [
                {
                    "id": str(log.id),
                    "action": log.action,
                    "resource_type": log.resource_type,
                    "resource_id": log.resource_id,
                    "status": log.status,
                    "error_message": log.error_message,
                    "admin_email": emails.get(log.admin_user_id),
                    "metadata": log.action_metadata or {},
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                }
                for log in logs
            ],
            "total": total,
            "page": skip // limit + 1,
            "limit": limit
        }

    async def get_system_health(self) -> Dict[str, Any]:
        """What a self-hosted operator needs to know is working.

        Only real signals: the database round trip, whether any worker holds the
        scheduler lock, each job's last recorded run, and how old the daily price
        and FX feeds are. Failures are logged, not
        returned, so driver messages (hosts, DSN fragments) stay out of the page.
        """
        settings = get_settings()

        database: Dict[str, Any]
        try:
            started = time.perf_counter()
            await self.session.execute(select(1))
            database = {
                "status": "healthy",
                "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            }
        except Exception:
            logger.warning("admin health: database check failed", exc_info=True)
            database = {"status": "unhealthy"}
        if database["status"] == "healthy":
            # Informational only: the round trip above is what decides health.
            try:
                database["version"] = (
                    await self.session.execute(text("SHOW server_version"))
                ).scalar()
                database["size_mb"] = round(await self._get_database_size(), 1)
            except Exception:
                logger.warning("admin health: database version check failed", exc_info=True)

        scheduler = await self._scheduler_health(settings.ENABLE_SCHEDULER)
        job_runs = await self._job_runs() if settings.ENABLE_SCHEDULER else []
        feeds = await self._feed_freshness()

        if database["status"] != "healthy":
            overall = "unhealthy"
        elif (
            scheduler["status"] == "unhealthy"
            or any(f["status"] == "stale" for f in feeds.values())
            or any(j["status"] == "failed" or j["overdue"] for j in job_runs)
        ):
            overall = "degraded"
        else:
            overall = "healthy"

        return {
            "status": overall,
            "app": {
                "version": settings.APP_VERSION,
                "commit": os.getenv("GIT_SHA", "unknown"),
                "environment": settings.ENVIRONMENT,
                "uptime_seconds": int(time.time() - _APP_START_TIME),
                "line_bot_enabled": settings.line_bot_enabled,
            },
            "database": database,
            "scheduler": scheduler,
            "job_runs": job_runs,
            "data_freshness": feeds,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def _scheduler_health(self, enabled: bool) -> Dict[str, Any]:
        """Whether any worker holds the scheduler lock.

        Asking this process is not enough: under `--workers N` one elected worker
        owns the jobs, and a request served by another would read "not running".
        A bigint advisory key shows in pg_locks split across classid (high 32
        bits) and objid (low 32 bits), with objsubid = 1.
        """
        if not enabled:
            return {"status": "disabled", "enabled": False, "running": False, "jobs": []}
        try:
            held = (
                await self.session.execute(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'"
                        " AND objsubid = 1 AND granted"
                        " AND (classid::bigint << 32) | objid::bigint = :key)"
                    ),
                    {"key": SCHEDULER_ADVISORY_LOCK_KEY},
                )
            ).scalar()
        except Exception:
            logger.warning("admin health: scheduler lock check failed", exc_info=True)
            return {"status": "unknown", "enabled": True, "running": False, "jobs": []}

        # Job details only exist in the worker that owns the scheduler.
        local = get_scheduler_status()
        return {
            "status": "healthy" if held else "unhealthy",
            "enabled": True,
            "running": bool(held),
            "jobs": local["jobs"] if local["running"] else [],
        }

    async def _job_runs(self) -> List[Dict[str, Any]]:
        """Each scheduled job's last recorded run (written by run_tracked_job).

        A job that has never run has no row, so a new install lists nothing until
        the first runs land.
        """
        try:
            rows = (
                await self.session.execute(
                    select(SystemSetting.key, SystemSetting.description, SystemSetting.value)
                    .where(SystemSetting.category == JOB_STATUS_CATEGORY)
                    .order_by(SystemSetting.key)
                )
            ).all()
        except Exception:
            logger.warning("admin health: job run check failed", exc_info=True)
            return []

        now = datetime.now(timezone.utc)
        runs = []
        for key, name, value in rows:
            value = value or {}
            try:
                started_at = datetime.fromisoformat(value["started_at"])
                overdue = now - started_at > timedelta(hours=JOB_OVERDUE_AFTER_HOURS)
            except (KeyError, TypeError, ValueError):
                started_at, overdue = None, False
            runs.append(
                {
                    "id": key.removeprefix(JOB_STATUS_KEY_PREFIX),
                    "name": name,
                    "status": value.get("status", "unknown"),
                    "last_run_at": started_at.isoformat() if started_at else None,
                    "duration_ms": value.get("duration_ms"),
                    "summary": value.get("summary") or {},
                    "error": value.get("error"),
                    "overdue": overdue,
                }
            )
        return runs

    async def _feed_freshness(self) -> Dict[str, Dict[str, Any]]:
        """Latest day each daily feed has data for, and whether that is stale."""
        today = business_today()
        sources = {
            "historical_prices": func.max(HistoricalPrice.date),
            "fx_rates": func.max(CurrencyRate.rate_timestamp),
        }
        feeds: Dict[str, Dict[str, Any]] = {}
        for name, latest_expr in sources.items():
            try:
                latest = (await self.session.execute(select(latest_expr))).scalar()
            except Exception:
                logger.warning("admin health: %s freshness check failed", name, exc_info=True)
                feeds[name] = {"status": "unknown", "latest": None, "age_days": None}
                continue
            if latest is None:
                # A fresh install has nothing yet; that is not a broken feed.
                feeds[name] = {"status": "empty", "latest": None, "age_days": None}
                continue
            latest_day = business_day_of(latest)
            age = (today - latest_day).days
            feeds[name] = {
                "status": "stale" if age > STALE_AFTER_DAYS[name] else "fresh",
                "latest": latest_day.isoformat(),
                "age_days": age,
                "stale_after_days": STALE_AFTER_DAYS[name],
            }
        return feeds

    async def _get_database_size(self) -> float:
        """Get current database size in MB"""
        try:
            query = text("SELECT pg_database_size(current_database()) / 1024.0 / 1024.0")
            result = await self.session.execute(query)
            return float(result.scalar())
        except Exception:
            return 0.0

    async def run_cleanup_preview(self) -> Dict[str, Any]:
        """Return counts of stale data that can be safely cleaned."""
        from datetime import datetime, timedelta, timezone
        from sqlalchemy import select, func, text
        from app.modules.users.init_demo_user import DEMO_EMAIL
        from app.modules.users.models import User
        from app.modules.transactions.models import Transaction
        from app.modules.loans.models import DebtAccount
        from app.modules.notifications.models import Notification, NotificationStatus

        # Get demo user id to exclude
        demo_result = await self.session.execute(select(User.id).where(User.email == DEMO_EMAIL))
        demo_id = demo_result.scalar_one_or_none()

        cutoff = datetime.now(timezone.utc) - timedelta(days=30)

        # Count soft-deleted transactions (excluding demo user)
        tx_q = select(func.count()).select_from(Transaction).where(Transaction.is_deleted == True)
        if demo_id:
            tx_q = tx_q.where(Transaction.user_id != demo_id)
        soft_deleted_transactions = (await self.session.execute(tx_q)).scalar_one()

        # Count soft-deleted loans (excluding demo user)
        loan_q = select(func.count()).select_from(DebtAccount).where(DebtAccount.is_deleted == True)
        if demo_id:
            loan_q = loan_q.where(DebtAccount.user_id != demo_id)
        soft_deleted_loans = (await self.session.execute(loan_q)).scalar_one()

        # Count stale currency rates (rows that are NOT the latest per pair)
        stale_rates_result = await self.session.execute(text("""
            SELECT COUNT(*) FROM currency_rates
            WHERE ctid NOT IN (
                SELECT DISTINCT ON (from_currency, to_currency) ctid
                FROM currency_rates
                ORDER BY from_currency, to_currency, rate_timestamp DESC
            )
        """))
        stale_currency_rates = stale_rates_result.scalar_one()

        # Count old read/sent notifications (excluding demo user)
        notif_q = select(func.count()).select_from(Notification).where(
            Notification.status.in_([NotificationStatus.READ, NotificationStatus.SENT]),
            Notification.created_at < cutoff,
        )
        if demo_id:
            notif_q = notif_q.where(Notification.user_id != demo_id)
        old_notifications = (await self.session.execute(notif_q)).scalar_one()

        return {
            "soft_deleted_transactions": int(soft_deleted_transactions),
            "soft_deleted_loans": int(soft_deleted_loans),
            "stale_currency_rates": int(stale_currency_rates),
            "old_notifications": int(old_notifications),
            "in_process_caches": 2,  # _price_cache + _profile_cache (always clearable)
            "demo_user_protected": DEMO_EMAIL,
            "notification_cutoff_days": 30,
        }

    async def run_cleanup(self) -> Dict[str, Any]:
        """Permanently remove stale data. Demo user data is never touched."""
        from datetime import datetime, timedelta, timezone
        from sqlalchemy import select, delete, text
        from app.modules.users.init_demo_user import DEMO_EMAIL
        from app.modules.users.models import User
        from app.modules.transactions.models import Transaction
        from app.modules.loans.models import DebtAccount
        from app.modules.notifications.models import Notification, NotificationStatus

        demo_result = await self.session.execute(select(User.id).where(User.email == DEMO_EMAIL))
        demo_id = demo_result.scalar_one_or_none()

        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        results: Dict[str, Any] = {}

        # 1. Clear in-process caches (safe, no DB changes)
        try:
            from app.modules.portfolio.router import _price_cache
            _price_cache.clear()
            results["price_cache_cleared"] = True
        except Exception:
            results["price_cache_cleared"] = False

        try:
            from app.modules.line_bot.service import _profile_cache
            _profile_cache.clear()
            results["line_profile_cache_cleared"] = True
        except Exception:
            results["line_profile_cache_cleared"] = False

        # 2. Hard-delete soft-deleted transactions (exclude demo user)
        tx_stmt = delete(Transaction).where(Transaction.is_deleted == True)
        if demo_id:
            tx_stmt = tx_stmt.where(Transaction.user_id != demo_id)
        tx_result = await self.session.execute(tx_stmt)
        results["soft_deleted_transactions"] = tx_result.rowcount

        # 3. Hard-delete soft-deleted loans (exclude demo user)
        loan_stmt = delete(DebtAccount).where(DebtAccount.is_deleted == True)
        if demo_id:
            loan_stmt = loan_stmt.where(DebtAccount.user_id != demo_id)
        loan_result = await self.session.execute(loan_stmt)
        results["soft_deleted_loans"] = loan_result.rowcount

        # 4. Prune stale currency rates (keep only latest per pair)
        stale_result = await self.session.execute(text("""
            DELETE FROM currency_rates
            WHERE ctid NOT IN (
                SELECT DISTINCT ON (from_currency, to_currency) ctid
                FROM currency_rates
                ORDER BY from_currency, to_currency, rate_timestamp DESC
            )
        """))
        results["stale_currency_rates"] = stale_result.rowcount

        # 5. Purge old read/sent notifications (exclude demo user)
        notif_stmt = delete(Notification).where(
            Notification.status.in_([NotificationStatus.READ, NotificationStatus.SENT]),
            Notification.created_at < cutoff,
        )
        if demo_id:
            notif_stmt = notif_stmt.where(Notification.user_id != demo_id)
        notif_result = await self.session.execute(notif_stmt)
        results["old_notifications"] = notif_result.rowcount

        await self.session.commit()
        return results


class UserManagementService:
    """Service for user management operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def search_users(
        self,
        search_query: Optional[str] = None,
        is_active: Optional[bool] = None,
        skip: int = 0,
        limit: int = 50
    ) -> Dict[str, Any]:
        """Search users with filters"""
        
        conditions = []
        if search_query:
            conditions.append(User.email.ilike(f"%{search_query}%"))
        if is_active is not None:
            conditions.append(User.is_active == is_active)

        where_clause = and_(*conditions) if conditions else True

        # Count without loading full rows
        total = (await self.session.execute(
            select(func.count(User.id)).where(where_clause)
        )).scalar()

        # Fetch only the 6 columns the caller actually needs
        rows = (await self.session.execute(
            select(
                User.id,
                User.email,
                User.name,
                User.is_active,
                User.created_at,
                User.last_login_at,
            )
            .where(where_clause)
            .order_by(User.created_at.desc())
            .offset(skip)
            .limit(limit)
        )).all()
        
        # Batch-fetch portfolio and transaction counts in 2 queries instead of 2N
        user_ids = [r.id for r in rows]

        portfolio_counts = {
            row.user_id: row.cnt
            for row in (await self.session.execute(
                select(Portfolio.user_id, func.count(Portfolio.id).label("cnt"))
                .where(Portfolio.user_id.in_(user_ids))
                .group_by(Portfolio.user_id)
            )).all()
        }
        transaction_counts = {
            row.user_id: row.cnt
            for row in (await self.session.execute(
                select(Transaction.user_id, func.count(Transaction.id).label("cnt"))
                .where(Transaction.user_id.in_(user_ids))
                .group_by(Transaction.user_id)
            )).all()
        }

        user_data = [
            {
                "id": str(r.id),
                "email": r.email,
                "full_name": r.name,
                "is_active": r.is_active,
                "created_at": r.created_at.isoformat(),
                "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None,
                "portfolio_count": portfolio_counts.get(r.id, 0),
                "transaction_count": transaction_counts.get(r.id, 0),
            }
            for r in rows
        ]
        
        return {
            "users": user_data,
            "total": total,
            "page": skip // limit + 1,
            "limit": limit
        }

    async def get_user_full_details(self, user_id: UUID) -> Dict[str, Any]:
        """Get full details for a specific user — 2 queries total (was 4)."""

        from fastapi import HTTPException
        user = await self.session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Single query for all portfolio stats
        stats_row = (await self.session.execute(
            select(
                func.count(Portfolio.id).label("portfolio_count"),
                func.coalesce(
                    func.sum(case((Portfolio.is_active == True, Portfolio.total_value), else_=0)), 0
                ).label("total_value"),
            ).where(Portfolio.user_id == user_id)
        )).first()

        transaction_count = (await self.session.execute(
            select(func.count(Transaction.id)).where(Transaction.user_id == user_id)
        )).scalar() or 0

        return {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "is_active": user.is_active,
            "is_verified": user.is_verified,
            "created_at": user.created_at.isoformat(),
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
            "portfolio_count": int(stats_row.portfolio_count) if stats_row else 0,
            "transaction_count": transaction_count,
            "total_portfolio_value": float(stats_row.total_value) if stats_row else 0.0,
        }

    async def toggle_user_active(self, user_id: UUID) -> Dict[str, Any]:
        """Toggle user is_active flag"""
        from fastapi import HTTPException

        user = await self.session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.is_active = not user.is_active
        await self.session.commit()
        await self.session.refresh(user)

        from ..users.dependencies import invalidate_user_auth_cache
        invalidate_user_auth_cache(user.id)

        return {
            "id": str(user.id),
            "email": user.email,
            "is_active": user.is_active,
        }

    async def log_admin_action(
        self,
        admin_id: UUID,
        action: str,
        resource_type: str,
        resource_id: Optional[str] = None,
        metadata: Optional[Dict] = None
    ):
        """Log an admin action to audit trail"""
        repo = AuditLogRepository(self.session)

        log_data = {
            "admin_user_id": admin_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "method": "API",
            "endpoint": "/admin",
            "status": "success",
            "action_metadata": metadata
        }

        await repo.create(log_data)

    async def get_pending_approval_users(
        self,
        skip: int = 0,
        limit: int = 50
    ) -> Dict[str, Any]:
        """Get all users with PENDING_APPROVAL status"""
        from app.modules.users.models import UserStatus

        query = select(User).where(User.status == UserStatus.PENDING_APPROVAL)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar()

        # Get users
        query = query.order_by(User.created_at.desc()).offset(skip).limit(limit)
        result = await self.session.execute(query)
        users = result.scalars().all()

        user_data = [
            {
                "id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
                "created_at": user.created_at.isoformat(),
                "status": user.status.value
            }
            for user in users
        ]

        return {
            "users": user_data,
            "total": total,
            "page": skip // limit + 1,
            "limit": limit
        }

    async def hard_delete_user(self, user_id: UUID) -> str:
        """
        Permanently delete a user and all associated data.

        Many FK constraints lack ON DELETE CASCADE at the database level (the ORM
        relationships are disabled to avoid circular-import issues). This method
        deletes dependent rows in the correct order before removing the user row,
        avoiding 409 / IntegrityError from FK violations.

        Returns the email of the deleted user.
        """
        uid = str(user_id)

        user = await self.session.get(User, user_id)
        if not user:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="User not found")

        user_email = user.email

        # ── 1. Admin records ──────────────────────────────────────────────────
        # audit logs reference admin_users.id → delete first
        await self.session.execute(
            text("""
                DELETE FROM admin_audit_logs
                WHERE admin_user_id IN (
                    SELECT id FROM admin_users WHERE user_id = :uid
                )
            """),
            {"uid": uid},
        )
        # admin_users.created_by_admin_id is a self-referential FK — NULL it out
        # before deleting, otherwise the DELETE violates the constraint when another
        # admin record was created by the admin being deleted.
        await self.session.execute(
            text("""
                UPDATE admin_users SET created_by_admin_id = NULL
                WHERE created_by_admin_id IN (
                    SELECT id FROM admin_users WHERE user_id = :uid
                )
            """),
            {"uid": uid},
        )
        await self.session.execute(
            text("DELETE FROM admin_users WHERE user_id = :uid"),
            {"uid": uid},
        )

        # ── 2. Auth / session tokens ──────────────────────────────────────────
        await self.session.execute(
            text("DELETE FROM refresh_tokens WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM user_sessions WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM oauth_providers WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM email_verification_tokens WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM password_reset_tokens WHERE user_id = :uid"), {"uid": uid}
        )

        # ── 3. User activity / gamification / notifications ───────────────────
        # These tables may not exist in all environments (optional migrations).
        # Each delete runs inside a savepoint so a missing table rolls back only
        # that one statement without aborting the outer transaction.
        _optional_tables = (
            "user_gamification_achievements",
            "user_gamification_profiles",
            "user_activity_logs",
            "user_data_exports",
            "user_security_logs",
            "user_preference_history",
            "notifications",
            "notification_preferences",
        )
        for tbl in _optional_tables:
            sp = await self.session.begin_nested()
            try:
                await self.session.execute(
                    text(f"DELETE FROM {tbl} WHERE user_id = :uid"),  # noqa: S608
                    {"uid": uid},
                )
                await sp.commit()
            except Exception:
                await sp.rollback()

        # ── 5. Transactions (attachments/batches first) ───────────────────────
        await self.session.execute(
            text("""
                DELETE FROM transaction_attachments
                WHERE transaction_id IN (
                    SELECT id FROM transactions WHERE user_id = :uid
                )
            """),
            {"uid": uid},
        )
        await self.session.execute(
            text("DELETE FROM recurring_transactions WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM transactions WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM transaction_import_batches WHERE user_id = :uid"), {"uid": uid}
        )

        # ── 6. Portfolio (deepest children first) ─────────────────────────────
        # dividends references portfolio_holdings
        await self.session.execute(
            text("DELETE FROM dividends WHERE user_id = :uid"), {"uid": uid}
        )
        # portfolio_transactions references both portfolio_holdings and portfolios
        await self.session.execute(
            text("DELETE FROM portfolio_transactions WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM portfolio_holdings WHERE user_id = :uid"), {"uid": uid}
        )
        await self.session.execute(
            text("DELETE FROM portfolios WHERE user_id = :uid"), {"uid": uid}
        )

        # ── 7. Goals (have DB-level cascade but delete explicitly) ────────────
        # chat_sessions is left to its ON DELETE CASCADE. The chat was retired
        # and nothing imports its models at runtime any more, so a database the
        # app created itself has no such table, and an explicit DELETE would
        # fail the whole account deletion there.
        await self.session.execute(
            text("DELETE FROM goals WHERE user_id = :uid"), {"uid": uid}
        )

        # ── 8. Clear self-referential referred_by ─────────────────────────────
        await self.session.execute(
            text("UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id = :uid"),
            {"uid": uid},
        )

        # ── 9. Finally delete the user ────────────────────────────────────────
        # Re-fetch to get a managed ORM object (expunge/delete clears identity map)
        user_to_delete = await self.session.get(User, user_id)
        if user_to_delete:
            await self.session.delete(user_to_delete)
        await self.session.commit()
        # Expunge identity map so subsequent session.get() hits the DB
        self.session.expunge_all()

        return user_email

    async def approve_user(self, user_id: UUID) -> User:
        """Approve a pending user and activate their account"""
        from app.modules.users.models import UserStatus
        from fastapi import HTTPException

        user = await self.session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if user.status != UserStatus.PENDING_APPROVAL:
            raise HTTPException(
                status_code=400,
                detail="User is not in PENDING_APPROVAL status"
            )

        # Update user status to ACTIVE
        user.status = UserStatus.ACTIVE
        user.is_active = True

        await self.session.commit()
        await self.session.refresh(user)

        from ..users.dependencies import invalidate_user_auth_cache
        invalidate_user_auth_cache(user.id)

        return user
