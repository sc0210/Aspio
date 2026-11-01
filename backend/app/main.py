#!/usr/bin/env python3
"""
Aspiro FastAPI Backend - Main Application Entry Point

This module sets up the FastAPI application with all routes, middleware,
and configuration for the Aspiro personal finance platform.
"""

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, Header, HTTPException, status as http_status
from fastapi.middleware.cors import CORSMiddleware

# Add the app directory to the Python path
app_dir = Path(__file__).parent
sys.path.insert(0, str(app_dir))

from app.core.config import get_settings
from app.core.database import init_db
from app.core.exceptions import setup_exception_handlers
from app.core.logger import get_logger, setup_logging
from app.middleware.cors import setup_cors
from app.middleware.pure_asgi import setup_pure_asgi_middleware
from app.middleware.rate_limit import setup_rate_limiting
from app.modules.admin.router import router as admin_router
from app.modules.admin.init_admin import init_admin_users
from app.modules.auth.router import router as auth_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.goals.router import router as goals_router
from app.modules.notifications.router import router as notifications_router
from app.modules.portfolio.router import router as portfolio_router
from app.modules.reports.router import router as reports_router
from app.modules.transactions.router import router as transactions_router
from app.modules.users.router_simple import router as users_router
from app.modules.users.enhanced_router import router as enhanced_users_router
from app.modules.loans.router import router as loans_router
from app.modules.peers.router import router as peers_router
from app.modules.line_bot.router import router as line_bot_router
from app.common.schemas import ApiResponse
from app.core.scheduler import (
    start_scheduler,
    stop_scheduler,
    get_scheduler_status,
    try_acquire_scheduler_lock,
    release_scheduler_lock,
)

# Configure logging using centralized setup
setup_logging()
logger = get_logger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management"""
    logger.info("Starting Aspiro FastAPI backend...")

    # Attachments live on disk. AttachmentService creates the directory when it is
    # used; this only reports at boot whether uploads will work, so a root-owned
    # volume shows in the startup log rather than as a 500 on the first upload.
    # Deliberately not fatal: everything except uploads still works.
    upload_dir = Path(settings.UPLOAD_PATH)
    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
        probe = upload_dir / ".write-test"
        probe.touch()
        probe.unlink()
        logger.info(f"Uploads stored in {upload_dir.resolve()} (mount a volume here to persist)")
    except OSError as e:
        logger.error(f"Upload directory {upload_dir} is not writable, attachments will fail: {e}")
    if "MAX_FILE_SIZE" in os.environ and "MAX_FILE_SIZE_MB" not in os.environ:
        logger.warning(
            "MAX_FILE_SIZE (bytes) is no longer read; set MAX_FILE_SIZE_MB. "
            f"Using {settings.MAX_FILE_SIZE_MB} MB."
        )

    try:
        # Initialize database
        await init_db()
        logger.info("Database initialized")
    except Exception as e:
        logger.warning(f"Database initialization skipped: {e}")

    # Start background scheduler for price updates.
    # Gated by ENABLE_SCHEDULER: ON for local Docker dev, OFF in production
    # The routine price-refresh jobs load pandas/finlab/yfinance in-process and
    # spike RAM, so on a memory-tight host they run only
    # locally. See app/core/scheduler.py and config.ENABLE_SCHEDULER.
    # Under `uvicorn --workers N` every worker runs this startup, so the
    # scheduler is elected rather than simply started: exactly one process
    # takes a Postgres advisory lock and owns the cron jobs. Without it, N
    # workers meant N copies of every job.
    app.state.scheduler_lock = None
    if settings.ENABLE_SCHEDULER:
        app.state.scheduler_lock = await try_acquire_scheduler_lock()
        if app.state.scheduler_lock is not None:
            try:
                start_scheduler()
                logger.info("Background scheduler started (this worker holds the lock)")
            except Exception as e:
                logger.warning(f"Scheduler initialization skipped: {e}")
                await release_scheduler_lock(app.state.scheduler_lock)
                app.state.scheduler_lock = None
        else:
            logger.info(
                "Background scheduler owned by another worker — not starting here"
            )
    else:
        logger.info("Background scheduler disabled (ENABLE_SCHEDULER=false)")

    # Initialize admin users
    try:
        from app.core.database import get_db

        async for session in get_db():
            await init_admin_users(session)
            logger.info("Admin users initialized")
            break
    except Exception as e:
        logger.warning(f"Admin initialization skipped: {e}")

    # Demo account: opt-in, because its password is published in this repository
    try:
        from app.core.database import get_db
        from app.modules.users.init_demo_user import disable_demo_user, init_demo_user

        async for session in get_db():
            if settings.DEMO_ACCOUNT_ENABLED:
                await init_demo_user(session)
            else:
                await disable_demo_user(session)
            break
    except Exception as e:
        logger.warning(f"Demo user initialization skipped: {e}")

    # Seed demo user's portfolio + transactions
    if settings.DEMO_ACCOUNT_ENABLED:
        try:
            from app.core.database import get_db
            from app.modules.users.init_demo_data import init_demo_data

            async for session in get_db():
                await init_demo_data(session)
                break
        except Exception as e:
            logger.warning(f"Demo data seeding skipped: {e}")

    yield

    # Shutdown scheduler
    try:
        stop_scheduler()
        logger.info("Background scheduler stopped")
    except Exception as e:
        logger.warning(f"Scheduler shutdown error: {e}")

    # Hand the scheduler role back so the next boot can re-elect immediately.
    try:
        await release_scheduler_lock(getattr(app.state, "scheduler_lock", None))
        app.state.scheduler_lock = None
    except Exception as e:
        logger.warning(f"Scheduler lock release error: {e}")

    logger.info("Shutting down Aspiro FastAPI backend...")


def create_app() -> FastAPI:
    """Create and configure FastAPI application"""

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="Personal Finance API for Asian Markets",
        docs_url="/docs" if settings.ENABLE_API_DOCS else None,
        redoc_url="/redoc" if settings.ENABLE_API_DOCS else None,
        openapi_url="/openapi.json" if settings.ENABLE_API_DOCS else None,
        lifespan=lifespan,
    )

    # The last middleware added is the outermost. Request ID, security headers
    # and logging wrap everything, preflights included. CORS sits just outside
    # the limiter, so its 429 gets CORS headers for allowlisted origins only.
    setup_rate_limiting(app)
    setup_cors(app)
    setup_pure_asgi_middleware(app)

    # Setup exception handlers
    setup_exception_handlers(app)

    # Include routers
    api_prefix = "/api/v1"

    app.include_router(
        admin_router, prefix=f"{api_prefix}/admin", tags=["Admin Management"]
    )
    app.include_router(
        auth_router, prefix=f"{api_prefix}/auth", tags=["Authentication"]
    )

    # Password-less dev sign-in. Mounted only when explicitly enabled *and* the
    # environment is a development one — in production the routes do not exist
    # at all, so they 404 rather than relying on a runtime check.
    if settings.dev_login_active:
        from app.modules.auth.dev_router import router as dev_auth_router

        app.include_router(
            dev_auth_router, prefix=f"{api_prefix}/auth", tags=["Development Auth"]
        )
        logger.warning(
            "DEV LOGIN ENABLED — /auth/dev-login issues tokens for any local "
            "account without a password. Never enable this outside development."
        )
    app.include_router(users_router, prefix=f"{api_prefix}/users", tags=["Users"])
    app.include_router(
        enhanced_users_router, prefix=f"{api_prefix}/users", tags=["Enhanced User Management"]
    )
    app.include_router(
        dashboard_router, prefix=f"{api_prefix}/dashboard", tags=["Dashboard"]
    )
    app.include_router(goals_router, prefix=f"{api_prefix}/goals", tags=["Goals"])
    app.include_router(
        portfolio_router, prefix=f"{api_prefix}/portfolio", tags=["Portfolio"]
    )
    app.include_router(reports_router, prefix=f"{api_prefix}/reports", tags=["Reports"])
    app.include_router(
        transactions_router, prefix=f"{api_prefix}/transactions", tags=["Transactions"]
    )
    app.include_router(
        notifications_router,
        prefix=f"{api_prefix}/notifications",
        tags=["Notifications"],
    )
    app.include_router(loans_router, prefix=f"{api_prefix}/loans", tags=["Loans"])
    app.include_router(peers_router, prefix=f"{api_prefix}/peers", tags=["Peers"])
    if settings.line_bot_enabled:
        app.include_router(line_bot_router, prefix=f"{api_prefix}/line-bot", tags=["LINE Bot"])
    else:
        logger.info("LINE bot not configured (LINE_CHANNEL_SECRET/ACCESS_TOKEN unset) — /line-bot routes off")

    # Public and unauthenticated: the landing page asks before anyone signs in.
    @app.get(f"{api_prefix}/features", tags=["Health"])
    async def features():
        """Optional add-ons this instance has configured, so the UI can hide the rest."""
        return ApiResponse.success_response(data={"line_bot": settings.line_bot_enabled})

    # Health check endpoints
    @app.get("/health", tags=["Health"])
    async def health_check():
        """Basic health check endpoint. `commit` is the SHA the image was built from."""
        import os

        return {
            "status": "healthy",
            "service": "aspiro-backend",
            "commit": os.getenv("GIT_SHA", "unknown"),
        }

    @app.get("/health/detailed", tags=["Health"])
    async def detailed_health_check(x_health_key: Optional[str] = Header(default=None)):
        """Detailed health check — requires X-Health-Key header matching HEALTH_CHECK_KEY env var."""
        import os

        health_key = os.getenv("HEALTH_CHECK_KEY", "")
        if not health_key or x_health_key != health_key:
            raise HTTPException(
                status_code=http_status.HTTP_401_UNAUTHORIZED,
                detail="Valid X-Health-Key header required",
            )
        """Detailed health check with service dependencies"""
        try:
            from app.core.database import get_db_health, engine

            db_health = await get_db_health()

            # Get connection pool status
            pool_status = engine.pool.status()
            pool_info = {
                "size": engine.pool.size(),
                "checked_in": engine.pool.checkedin(),
                "checked_out": engine.pool.checkedout(),
                "overflow": engine.pool.overflow(),
                "status": pool_status,
            }
        except Exception as e:
            logger.warning(f"Database health check failed: {e}")
            db_health = False
            # /health is public: the driver's message can name hosts and DSN parts.
            pool_info = {"error": "database unavailable"}

        # Get scheduler status
        scheduler_status = get_scheduler_status()

        return {
            "status": "healthy",  # API is healthy even if dependencies are down
            "service": "aspiro-backend",
            "version": settings.APP_VERSION,
            "dependencies": {
                "database": "healthy" if db_health else "unavailable",
                "redis": "disabled",
            },
            "database_pool": pool_info,
            "scheduler": scheduler_status,
        }

    @app.get("/health/scheduler", tags=["Health"])
    async def scheduler_status(x_health_key: Optional[str] = Header(default=None)):
        """Get scheduler status and upcoming jobs — requires X-Health-Key header."""
        import os

        health_key = os.getenv("HEALTH_CHECK_KEY", "")
        if not health_key or x_health_key != health_key:
            raise HTTPException(
                status_code=http_status.HTTP_401_UNAUTHORIZED,
                detail="Valid X-Health-Key header required",
            )
        sched = get_scheduler_status()
        return {
            "status": "running" if sched["running"] else "stopped",
            "jobs": sched["jobs"],
        }

    return app


# Create the FastAPI app instance
app = create_app()


if __name__ == "__main__":
    """Run the application with uvicorn for development"""
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
        access_log=True,
    )
