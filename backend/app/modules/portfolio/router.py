"""
Portfolio router for Aspiro FastAPI backend.

This module provides comprehensive REST API endpoints for portfolio management,
supporting multi-asset classes, regional investments, and real-time market data.

Structure
---------
The route handlers were split out of this previously-monolithic file into
concern-focused sub-routers under ``app.modules.portfolio.routers``. This module
now simply aggregates those sub-routers onto a single top-level ``router`` so the
public import in ``app/main.py`` continues to work unchanged::

    from app.modules.portfolio.router import router as portfolio_router

Every sub-router's route paths already carry their full sub-path (e.g.
``/holdings``, ``/performance/historical``), so they are mounted with NO extra
prefix. The application-level prefix (``/api/v1/portfolio``) is applied in
``app/main.py`` exactly as before, keeping every final path byte-for-byte
identical.

Shared imports, the in-process price cache, demo fixtures, and helper functions
live in ``app.modules.portfolio.routers._shared`` and are re-exported here for
backwards compatibility with any code importing them from this module.
"""

from fastapi import APIRouter

# Re-export shared constants/helpers for backwards compatibility (some other
# modules / tests historically imported these from portfolio.router).
from .routers._shared import (  # noqa: F401
    safe_float,
    DEMO_PORTFOLIO,
    DEMO_HOLDINGS,
    DEMO_REBALANCING_DASHBOARD,
    _get_sort_key,
    fetch_historical_data_background,
    _PriceCache,
    _price_cache,
    _lp_cache_get,
    _lp_cache_set,
    logger,
)
from .routers.allocation_analytics import (  # noqa: F401
    BENCHMARK_MAP,
    BENCHMARK_DEMO,
    _store_benchmark_background,
)

from .routers.portfolio_root import router as _portfolio_root_router
from .routers.holdings import router as _holdings_router
from .routers.market_data import router as _market_data_router
from .routers.performance import router as _performance_router
from .routers.performance_history import (  # noqa: F401  (get_daily_performance re-exported for back-compat)
    router as _performance_history_router,
    get_daily_performance,
)
from .routers.allocation_analytics import router as _allocation_analytics_router
from .routers.historical_prices import router as _historical_prices_router
from .routers.dividends import router as _dividends_router
from .routers.sync_admin import router as _sync_admin_router

# Top-level aggregating router. No prefix here — the application-level prefix
# (/api/v1/portfolio) is added by app/main.py. Each sub-router's paths are
# already fully-qualified relative to that prefix.
router = APIRouter()

router.include_router(_portfolio_root_router)
router.include_router(_holdings_router)
router.include_router(_market_data_router)
router.include_router(_performance_router)
router.include_router(_performance_history_router)
router.include_router(_allocation_analytics_router)
router.include_router(_historical_prices_router)
router.include_router(_dividends_router)
router.include_router(_sync_admin_router)
