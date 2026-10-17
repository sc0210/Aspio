"""
Database configuration and session management for Aspiro FastAPI backend.

This module handles PostgreSQL connection setup, session management,
and provides utilities for database operations.
"""

import logging
from datetime import datetime, timezone
from typing import AsyncGenerator
from uuid import uuid4

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, AsyncAdaptedQueuePool

from app.core.config import get_settings
from app.database.base import Base

logger = logging.getLogger(__name__)
settings = get_settings()


# Build connect_args — add SSL when DATABASE_URL signals it (Supabase / remote Postgres)
#
# PgBouncer in transaction mode (Supabase's :6543 pooler) multiplexes many client
# connections onto a smaller set of Postgres backends and does NOT pin a prepared
# statement to one backend. Deterministically-named prepared statements therefore
# collide across backends/processes, raising asyncpg DuplicatePreparedStatementError
# ("__asyncpg_stmt_N__ already exists") — which took prod auth/login + the LINE
# webhook down. We must neutralise prepared statements on BOTH layers:
#   * statement_cache_size=0          → asyncpg's own statement cache off
#   * prepared_statement_cache_size=0 → SQLAlchemy's asyncpg-adapter cache off
#   * prepared_statement_name_func    → unique per-statement names. The adapter
#       otherwise lets asyncpg auto-name statements "__asyncpg_stmt_N__"
#       (deterministic per process) — exactly what collides through PgBouncer.
# NOTE: statement_cache_size=0 ALONE is NOT sufficient — the SQLAlchemy adapter
# still prepares named statements. Verified empirically against the pooler.
_connect_args: dict = {
    "command_timeout": 60,
    "statement_cache_size": 0,
    "prepared_statement_cache_size": 0,
    "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    "server_settings": {
        "application_name": "aspiro-backend",
        "timezone": "UTC",
    },
}
if settings.database_use_ssl:
    import ssl as _ssl
    _ssl_ctx = _ssl.create_default_context()
    # Supabase uses a self-signed cert in its pooler chain; disable cert
    # verification while keeping the connection encrypted.
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = _ssl.CERT_NONE
    _connect_args["ssl"] = _ssl_ctx

# Strip query-string ssl params before passing URL to asyncpg — the driver reads
# SSL from connect_args, not the URL, so duplicate params cause an error.
_db_url = settings.DATABASE_URL
for _param in ("?ssl=require", "&ssl=require", "?sslmode=require", "&sslmode=require"):
    _db_url = _db_url.replace(_param, "")

# Connection pooling strategy:
#   NullPool opens a brand-new connection (TCP + TLS + auth handshake) on every
#   request. We previously forced it for the Supabase transaction pooler (:6543) to
#   sidestep named-prepared-statement mismatches through PgBouncer — but that's moot
#   now that prepared statements are neutralised in _connect_args (unique statement
#   names + caches disabled). The per-request handshake was adding ~0.5-1.3s of
#   latency to the first query of each request.
#
#   So we now default to QueuePool everywhere (set DATABASE_USE_NULLPOOL=true to opt
#   back out). QueuePool is safe through PgBouncer transaction mode: idle *client*
#   connections don't pin server backends — PgBouncer only assigns a backend for the
#   duration of a transaction. pool_pre_ping cheaply discards connections the pooler
#   dropped while idle, and a shorter recycle window keeps us from holding handles the
#   pooler has already reaped.
if settings.database_use_nullpool:
    engine = create_async_engine(
        _db_url,
        echo=settings.DATABASE_ECHO_SQL,
        poolclass=NullPool,
        connect_args=_connect_args,
    )
else:
    # Through any pooler, recycle well under its idle timeout (it reaps idle conns).
    _pool_recycle = 300 if settings.database_via_pooler else settings.DATABASE_POOL_RECYCLE

    # Guard against the session-mode pooler trap: it caps TOTAL clients at the pooler's
    # pool size, so a SQLAlchemy pool that reaches that cap throws EMAXCONNSESSION under
    # any concurrency. Warn loudly — the transaction pooler (:6543) is the right runtime
    # endpoint and has no such limit.
    if settings.database_session_mode_pooler:
        _max_conns = settings.DATABASE_POOL_SIZE + settings.DATABASE_MAX_OVERFLOW
        logger.warning(
            "DATABASE_URL uses the Supabase SESSION-mode pooler (:5432). This caps total "
            "clients at the pooler's pool size (often 15). Your SQLAlchemy pool can open up "
            "to %d connections PER replica — at or above that cap you'll get "
            "EMAXCONNSESSION 500s. Switch DATABASE_URL to the TRANSACTION pooler (:6543), "
            "or lower DATABASE_POOL_SIZE/DATABASE_MAX_OVERFLOW to leave headroom.",
            _max_conns,
        )

    engine = create_async_engine(
        _db_url,
        echo=settings.DATABASE_ECHO_SQL,
        # AsyncAdaptedQueuePool, NOT the sync QueuePool: create_async_engine rejects
        # QueuePool ("Pool class QueuePool cannot be used with asyncio engine") on
        # SQLAlchemy 2.0.51 (it was silently tolerated on 2.0.27). This is the async
        # queue pool — same pooling behaviour, and it's create_async_engine's default.
        poolclass=AsyncAdaptedQueuePool,
        pool_size=settings.DATABASE_POOL_SIZE,
        max_overflow=settings.DATABASE_MAX_OVERFLOW,
        pool_timeout=settings.DATABASE_POOL_TIMEOUT,
        pool_recycle=_pool_recycle,
        pool_pre_ping=True,
        connect_args=_connect_args,
    )

# Create async session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to get database session.

    This function provides a database session for FastAPI dependency injection.
    The session is automatically closed after the request is completed.

    Yields:
        AsyncSession: Database session
    """
    async with async_session() as session:
        try:
            # Log pool status periodically (every 100th request) — only with QueuePool
            if not settings.database_use_nullpool:
                if hasattr(get_db, "_request_count"):
                    get_db._request_count += 1
                    if get_db._request_count % 100 == 0:
                        pool_status = engine.pool.status()
                        logger.info(f"DB Pool Status: {pool_status}")
                else:
                    get_db._request_count = 1

            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            from fastapi.exceptions import RequestValidationError, HTTPException
            if not isinstance(e, (RequestValidationError, HTTPException)):
                if settings.database_use_nullpool:
                    logger.error(f"Database session error: {e}")
                else:
                    pool_status = engine.pool.status()
                    logger.error(f"Database session error: {e} | Pool: {pool_status}")
            raise
        finally:
            await session.close()


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Alias for get_db() — delegates entirely to the canonical implementation.

    Both names are kept as public symbols because many modules import each one
    independently. All commit/rollback/close semantics and pool-status logging
    live exclusively in get_db(); this wrapper adds no extra behaviour so there
    is a single source of truth.
    """
    async for session in get_db():
        yield session


async def init_db() -> None:
    """
    Initialize database connection and create tables if needed.

    This function should be called during application startup.
    """
    try:
        # Test database connection
        async with engine.begin() as conn:
            # Execute a simple query to test connection
            result = await conn.execute(text("SELECT 1"))
            logger.info("Database connection established successfully")

            if settings.SKIP_DB_SCHEMA_INIT:
                # Production: schema managed by alembic, skip create_all to save ~6s startup RTT
                logger.info("Skipping schema init (SKIP_DB_SCHEMA_INIT=true)")
            else:
                logger.info("Ensuring database tables exist...")
                await conn.run_sync(Base.metadata.create_all)
                logger.info("Database tables verified/created successfully")

    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


async def close_db() -> None:
    """Close database connection pool"""
    try:
        await engine.dispose()
        logger.info("Database connection pool closed")
    except Exception as e:
        logger.error(f"Error closing database connection: {e}")


async def get_db_health() -> bool:
    """
    Check database health for monitoring purposes.

    Returns:
        bool: True if database is healthy, False otherwise
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False


# Database utilities
# Slow query logging for performance monitoring
@event.listens_for(engine.sync_engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """Track query execution start time"""
    context._query_start_time = datetime.now(timezone.utc)


@event.listens_for(engine.sync_engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """Log slow queries that exceed threshold"""
    if hasattr(context, "_query_start_time"):
        total_time = (datetime.now(timezone.utc) - context._query_start_time).total_seconds() * 1000

        if total_time > settings.DATABASE_SLOW_QUERY_THRESHOLD_MS:
            logger.warning(
                f"Slow query detected ({total_time:.2f}ms):\n"
                f"SQL: {statement[:200]}...\n"
                f"Parameters: {parameters}"
            )


# Event listeners for connection pooling and logging
if settings.is_development:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        """Set PostgreSQL connection parameters for development"""
        logger.debug("New database connection established")

    @event.listens_for(engine.sync_engine, "checkout")
    def receive_checkout(dbapi_connection, connection_record, connection_proxy):
        """Log database connection checkout"""
        logger.debug("Database connection checked out from pool")

    @event.listens_for(engine.sync_engine, "checkin")
    def receive_checkin(dbapi_connection, connection_record):
        """Log database connection checkin"""
        logger.debug("Database connection returned to pool")


# Export commonly used objects
__all__ = [
    "Base",
    "engine",
    "async_session",
    "get_db",
    "get_async_session",
    "init_db",
    "close_db",
    "get_db_health",
]
