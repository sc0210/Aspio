"""
API Health Check Service

Monitors external API status (FinLab, TradingView) for market data services.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from enum import Enum

from ...core.config import get_settings
from app.utils.datetime_helpers import utc_now

logger = logging.getLogger(__name__)
settings = get_settings()


class APIStatus(str, Enum):
    """API status enumeration"""
    OPERATIONAL = "operational"
    DEGRADED = "degraded"
    DOWN = "down"
    UNKNOWN = "unknown"


class APIHealthChecker:
    """Check health status of external APIs"""

    def __init__(self):
        self.last_check: Dict[str, datetime] = {}
        self.cached_status: Dict[str, Dict[str, Any]] = {}
        self.cache_duration = timedelta(minutes=5)  # Cache status for 5 minutes

    async def check_finlab_api(self) -> Dict[str, Any]:
        """
        Check FinLab API health

        Returns health status for Taiwan stock market data API
        """
        api_name = "finlab"

        # Check cache first
        if self._is_cached(api_name):
            logger.debug(f"Returning cached status for {api_name}")
            return self.cached_status[api_name]

        status = {
            "name": "FinLab API",
            "provider": "FinLab",
            "description": "Taiwan Stock Market Data (TWSE, TPEx)",
            "status": APIStatus.UNKNOWN,
            "configured": bool(settings.FINLAB_API_TOKEN),
            "last_check": utc_now().isoformat(),
            "response_time_ms": None,
            "error": None
        }

        if not settings.FINLAB_API_TOKEN:
            status["status"] = APIStatus.DOWN
            status["error"] = "API token not configured"
            self._cache_status(api_name, status)
            return status

        try:
            # Simple health check: verify token exists
            # In production, you might want to make a lightweight API call
            from app.modules.portfolio.market_data_service import get_market_data_service

            start_time = utc_now()

            # Try to initialize service (validates config)
            service = get_market_data_service(
                finlab_token=settings.FINLAB_API_TOKEN,
                tradingview_key=settings.TRADINGVIEW_API_KEY
            )

            # Check if service can be initialized
            if service.finlab_token:
                elapsed = (utc_now() - start_time).total_seconds() * 1000
                status["status"] = APIStatus.OPERATIONAL
                status["response_time_ms"] = round(elapsed, 2)
                logger.info(f"FinLab API check: {status['status']}")
            else:
                status["status"] = APIStatus.DOWN
                status["error"] = "Service initialization failed"

        except Exception as e:
            logger.error(f"FinLab API health check failed: {str(e)}")
            status["status"] = APIStatus.DOWN
            status["error"] = str(e)

        self._cache_status(api_name, status)
        return status

    async def check_tradingview_api(self) -> Dict[str, Any]:
        """
        Check TradingView API health

        Returns health status for US/Global stock market data API
        """
        api_name = "tradingview"

        # Check cache first
        if self._is_cached(api_name):
            logger.debug(f"Returning cached status for {api_name}")
            return self.cached_status[api_name]

        status = {
            "name": "TradingView API",
            "provider": "TradingView",
            "description": "US & Global Stock Market Data",
            "status": APIStatus.UNKNOWN,
            "configured": bool(settings.TRADINGVIEW_API_KEY),
            "last_check": utc_now().isoformat(),
            "response_time_ms": None,
            "error": None
        }

        if not settings.TRADINGVIEW_API_KEY:
            status["status"] = APIStatus.DOWN
            status["error"] = "API key not configured"
            self._cache_status(api_name, status)
            return status

        try:
            from app.modules.portfolio.market_data_service import get_market_data_service

            start_time = utc_now()

            # Initialize service
            service = get_market_data_service(
                finlab_token=settings.FINLAB_API_TOKEN,
                tradingview_key=settings.TRADINGVIEW_API_KEY
            )

            # Check if service can be initialized
            if service.tradingview_key:
                elapsed = (utc_now() - start_time).total_seconds() * 1000
                status["status"] = APIStatus.OPERATIONAL
                status["response_time_ms"] = round(elapsed, 2)
                logger.info(f"TradingView API check: {status['status']}")
            else:
                status["status"] = APIStatus.DOWN
                status["error"] = "Service initialization failed"

        except Exception as e:
            logger.error(f"TradingView API health check failed: {str(e)}")
            status["status"] = APIStatus.DOWN
            status["error"] = str(e)

        self._cache_status(api_name, status)
        return status

    async def check_all_apis(self) -> Dict[str, Any]:
        """
        Check all external APIs

        Returns comprehensive health status for all market data APIs
        """
        finlab = await self.check_finlab_api()
        tradingview = await self.check_tradingview_api()

        # Determine overall status
        statuses = [finlab["status"], tradingview["status"]]

        if all(s == APIStatus.OPERATIONAL for s in statuses):
            overall = APIStatus.OPERATIONAL
        elif all(s == APIStatus.DOWN for s in statuses):
            overall = APIStatus.DOWN
        elif any(s == APIStatus.DOWN for s in statuses):
            overall = APIStatus.DEGRADED
        else:
            overall = APIStatus.UNKNOWN

        operational_count = sum(1 for s in statuses if s == APIStatus.OPERATIONAL)
        total_count = len(statuses)

        return {
            "overall_status": overall,
            "apis": {
                "finlab": finlab,
                "tradingview": tradingview
            },
            "summary": {
                "total_apis": total_count,
                "operational": operational_count,
                "degraded": sum(1 for s in statuses if s == APIStatus.DEGRADED),
                "down": sum(1 for s in statuses if s == APIStatus.DOWN),
            },
            "checked_at": utc_now().isoformat()
        }

    def _is_cached(self, api_name: str) -> bool:
        """Check if cached status is still valid"""
        if api_name not in self.cached_status:
            return False

        if api_name not in self.last_check:
            return False

        age = utc_now() - self.last_check[api_name]
        return age < self.cache_duration

    def _cache_status(self, api_name: str, status: Dict[str, Any]) -> None:
        """Cache API status"""
        self.cached_status[api_name] = status
        self.last_check[api_name] = utc_now()

# Singleton instance
_health_checker: Optional[APIHealthChecker] = None


def get_api_health_checker() -> APIHealthChecker:
    """Get or create API health checker instance"""
    global _health_checker
    if _health_checker is None:
        _health_checker = APIHealthChecker()
    return _health_checker
