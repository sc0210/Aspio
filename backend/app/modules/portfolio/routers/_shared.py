"""Shared imports, constants, and helpers for portfolio sub-routers.

This module centralizes the original module-level imports, the in-process
price cache, demo fixtures, and helper functions so that each sub-router can
import them without duplication or circular imports.
"""

import asyncio
import functools
import logging
import math
from decimal import Decimal
from datetime import datetime, date, timedelta, timezone
from typing import List, Optional, Dict, Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from app.common import demo_fixtures

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Path,
    Body,
    UploadFile,
    status,
    BackgroundTasks,
)
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.database import get_db
from ...users.dependencies import CurrentUser, get_optional_current_user
from ....common.schemas import ApiResponse, PaginationParams, PaginationMeta
from ....core.rate_limiter import (
    rate_limit_market_data,
    rate_limit_analytics,
    rate_limit_portfolio_sync,
)
from ..schemas import (
    PortfolioCreate,
    PortfolioUpdate,
    PortfolioResponse,
    PortfolioSummary,
    HoldingCreate,
    HoldingUpdate,
    HoldingResponse,
    HoldingFilters,
    TransactionCreate,
    TransactionUpdate,
    TransactionResponse,
    TransactionFilters,
    BulkTransactionCreate,
    BulkTransactionResponse,
    PortfolioPerformance,
    MarketDataResponse,
    AssetAllocation,
    PaginatedPortfoliosResponse,
    PaginatedHoldingsResponse,
    PaginatedTransactionsResponse,
)
from ..dividend_schemas import (
    DividendCreate,
    DividendUpdate,
    DividendReinvest,
    DividendResponse,
    DividendSummary,
    DividendHistoryFilter,
)
from ..sell_schemas import SellHoldingResponse
from ..services import get_portfolio_service, AnalyticsService
from ..repositories import (
    get_portfolio_repository,
    get_holding_repository,
    get_transaction_repository,
    PortfolioRepository,
    HoldingRepository,
)
from ..price_update_service import get_price_update_service
from ..api_health import get_api_health_checker
from ..irr_update_service import get_irr_update_service
from ..historical_price_service import get_historical_price_service
from ....utils.exchange_rate_service import ExchangeRateService
from ..historical_price_repository import HistoricalPriceRepository
from .. import metrics_calculator as _mc
import time as _router_time
import threading as _threading
from app.utils.datetime_helpers import business_today
from app.utils.datetime_helpers import utc_now


logger = logging.getLogger(__name__)
class _PriceCache:
    """Thread-safe in-process TTL cache for market prices."""

    def __init__(self):
        self._store: dict = {}
        self._lock = _threading.Lock()

    def get(self, key: str):
        with self._lock:
            entry = self._store.get(key)
            if entry and _router_time.time() < entry["expires_at"]:
                return entry["value"]
            if key in self._store:
                del self._store[key]
            return None

    def set(self, key: str, value, ttl: int) -> None:
        with self._lock:
            self._store[key] = {"value": value, "expires_at": _router_time.time() + ttl}

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_price_cache = _PriceCache()


def _lp_cache_get(key: str):
    return _price_cache.get(key)


def _lp_cache_set(key: str, value, ttl: int) -> None:
    _price_cache.set(key, value, ttl)

logger = logging.getLogger(__name__)


def safe_float(value: Any) -> Optional[float]:
    """
    Safely convert a value to float, filtering out JSON-incompatible values.
    Returns None if the value is inf, -inf, or NaN.
    """
    if value is None:
        return None
    try:
        f = float(value)
        # Filter out inf, -inf, and NaN as they are not JSON compliant
        return f if math.isfinite(f) else None
    except (ValueError, TypeError):
        return None


# Mock data for demo purposes (when user is not authenticated)


def _demo_pct(gain: Decimal, cost: Decimal) -> Decimal:
    """Gain as a percent of cost, to two places — derived, never typed in.

    The fixture used to state 3.4 and 5.3 beside rows whose cost and value
    give 3.45 and 5.26, so a lot row and the total above it disagreed.
    """
    return (gain / cost * 100).quantize(Decimal("0.01")) if cost else Decimal("0")


def _demo_holding(
    *,
    symbol: str,
    name: str,
    quantity: Decimal,
    average_cost: Decimal,
    current_price: Decimal,
    market: str,
    exchange: str,
    sector: str,
    region: str,
    dividend_per_share: Decimal,
) -> Dict[str, Any]:
    total_cost = quantity * average_cost
    total_value = quantity * current_price
    gain = total_value - total_cost
    return {
        "id": str(uuid4()),
        "symbol": symbol,
        "name": name,
        "type": "etf",
        "quantity": quantity,
        "average_cost": average_cost,
        "current_price": current_price,
        "total_cost": total_cost,
        "total_value": total_value,
        "gain_loss": gain,
        "gain_loss_percentage": _demo_pct(gain, total_cost),
        # Every row is in the account's currency: the frontend fixture carries
        # VT at NT$4,000 a unit, and the demo account is one TWD balance sheet.
        "currency": "TWD",
        "exchange": exchange,
        # Without this the row fell back to HoldingResponse's default "US", and
        # 0050 — a TWSE ETF — rendered under a US flag.
        "market": market,
        "sector": sector,
        "region": region,
        "dividend_yield": (dividend_per_share / current_price * 100).quantize(
            Decimal("0.01")
        ),
        # PER SHARE, as the column is everywhere else: get_dividend_data
        # multiplies it by quantity. This stored the yearly total (46,500), which
        # read as NT$465M a year to anything that used it the real way.
        "annual_dividend": dividend_per_share,
        "is_active": True,
        "last_price_update_at": utc_now(),
        "metadata": {},
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }


DEMO_HOLDINGS = [
    _demo_holding(
        symbol="0050",
        name="元大台灣50 ETF",
        quantity=Decimal("10000"),
        average_cost=Decimal("145.00"),
        current_price=Decimal("150.00"),
        market="TW",
        exchange="TWSE",
        sector="broad_market",
        region="Taiwan",
        dividend_per_share=Decimal("4.65"),  # 3.1% at NT$150
    ),
    _demo_holding(
        symbol="VT",
        name="Vanguard Total World Stock ETF",
        quantity=Decimal("125"),
        average_cost=Decimal("3800.00"),
        current_price=Decimal("4000.00"),
        market="US",
        exchange="NYSE",
        sector="global_market",
        region="Global",
        dividend_per_share=Decimal("80.00"),  # 2.0% at NT$4,000
    ),
]

_DEMO_TOTAL_VALUE = sum(h["total_value"] for h in DEMO_HOLDINGS)
_DEMO_TOTAL_COST = sum(h["total_cost"] for h in DEMO_HOLDINGS)

DEMO_PORTFOLIO = {
    "id": str(uuid4()),
    "name": "Demo Portfolio",
    "description": "Sample investment portfolio for demo purposes",
    # The same TWD account the dashboard and the frontend fixtures describe.
    #
    # This used to be a USD portfolio of AAPL/GOOGL/BTC worth 28,450 while
    # /dashboard/stats reported a portfolio wallet of NT$2,000,000 — the same
    # demo wallet, seventy times apart, on two screens a visitor sees one after
    # the other. The totals are now summed from DEMO_HOLDINGS, so the portfolio
    # cannot disagree with its own rows.
    "currency": "TWD",
    "is_default": True,
    "is_active": True,
    "auto_update": True,
    "total_value": _DEMO_TOTAL_VALUE,
    "total_cost": _DEMO_TOTAL_COST,
    "total_gain_loss": _DEMO_TOTAL_VALUE - _DEMO_TOTAL_COST,
    "total_gain_loss_percentage": _demo_pct(
        _DEMO_TOTAL_VALUE - _DEMO_TOTAL_COST, _DEMO_TOTAL_COST
    ),
    "last_price_update_at": utc_now(),
    "last_rebalance_at": utc_now(),
    "metadata": {},
    "created_at": utc_now(),
    "updated_at": utc_now(),
}


# ── Demo value history ───────────────────────────────────────────────────────
# Every demo time series (/daily-performance, /historical, /performance,
# /performance/historical, the analytics period returns) is read off this one
# walk, so the dashboard chart, /portfolio/trend and the stats strip describe
# the same account. They used to start from 28,450.75 — the retired AAPL/GOOGL
# portfolio — and drew a NT$24K chart beside a NT$2M wallet.
#
# The demo account opened on 2024-01-01 (createdAt in the frontend's
# DEMO_PORTFOLIO). Each holding trends geometrically from its cost basis on that
# day to its current value today, with a mean-reverting wobble on top, and the
# last point is pinned to DEMO_HOLDINGS' current value exactly. The wobble is
# seeded per date from a fixed start, so the series is deterministic: refetching
# or widening the window never reshuffles a day already shown.
DEMO_SERIES_START = date(2024, 1, 1)
_DEMO_WOBBLE = {"0050": 0.0085, "VT": 0.0075}  # daily shock, ~0.8%
_DEMO_WOBBLE_PERSISTENCE = 0.97  # AR(1): swings of a few % that fade over weeks


def _last_weekday(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


@functools.lru_cache(maxsize=4)
def _demo_full_series(end: date) -> tuple:
    """Every weekday from DEMO_SERIES_START to ``end`` (a weekday). Cached per
    end date: a few thousand seeded draws, shared by every demo series."""
    import random

    span = max((end - DEMO_SERIES_START).days, 1)

    weekdays: List[date] = []
    d = DEMO_SERIES_START
    while d <= end:
        if d.weekday() < 5:
            weekdays.append(d)
        d += timedelta(days=1)

    noise: Dict[str, List[float]] = {}
    for h in DEMO_HOLDINGS:
        sym = h["symbol"]
        sigma = _DEMO_WOBBLE.get(sym, 0.008)
        level, path = 0.0, []
        for day in weekdays:
            shock = random.Random(f"aspiro-demo:{sym}:{day.isoformat()}").gauss(0.0, sigma)
            level = _DEMO_WOBBLE_PERSISTENCE * level + shock
            path.append(level)
        noise[sym] = path

    points: List[Dict[str, Any]] = []
    for idx, day in enumerate(weekdays):
        t = (day - DEMO_SERIES_START).days / span
        per_holding: Dict[str, float] = {}
        for h in DEMO_HOLDINGS:
            sym = h["symbol"]
            cost, value = float(h["total_cost"]), float(h["total_value"])
            trend = cost * (value / cost) ** t
            wobble = math.exp(noise[sym][idx] - noise[sym][-1])
            per_holding[sym] = round(trend * wobble, 2)
        points.append(
            {"date": day, "value": round(sum(per_holding.values()), 2), "holdings": per_holding}
        )

    if points:
        # Pin the last point to the fixture exactly, not to within a rounding.
        points[-1]["holdings"] = {
            h["symbol"]: float(h["total_value"]) for h in DEMO_HOLDINGS
        }
        points[-1]["value"] = float(DEMO_PORTFOLIO["total_value"])
    return tuple(points)


def demo_value_series(
    days: int, end: Optional[date] = None
) -> List[Dict[str, Any]]:
    """Weekday points over the last ``days`` days, ending on the last weekday
    on/before ``end`` (default: the business day). Each point is
    ``{"date": date, "value": float, "holdings": {symbol: float}}``; the final
    point's value is the demo portfolio's total value. Returns copies, so a
    caller may annotate them.
    """
    end = _last_weekday(end or business_today())
    window_start = max(end - timedelta(days=max(days, 0)), DEMO_SERIES_START)
    return [
        {**p, "holdings": dict(p["holdings"])}
        for p in _demo_full_series(end)
        if p["date"] >= window_start
    ]


def demo_period_return_pct(days: int) -> float:
    """Percent change of the demo portfolio over the last ``days`` days.

    The base is the value as of the window's start: the last weekday on or
    before it, not the first point inside it. On a Monday a 1-day window holds
    only Monday, so the inside-the-window base read 0.00% every week.
    """
    end = _last_weekday(business_today())
    window_start = end - timedelta(days=max(days, 0))
    series = _demo_full_series(end)
    base = next((p for p in reversed(series) if p["date"] <= window_start), None)
    if base is None and series:
        base = series[0]  # window reaches back past the demo's first point
    if base is None or not base["value"] or base is series[-1]:
        return 0.0
    return round((series[-1]["value"] / base["value"] - 1) * 100, 2)


# Demo rebalancing dashboard data
# Rebalancing, described against the same two holdings the portfolio serves.
#
# This used to be a third demo portfolio: NT$28,450 across 0050/VT/CRYPTO/CASH/
# SAVINGS, three of which no longer exist in DEMO_HOLDINGS. A visitor who had
# just seen /portfolio at NT$2,000,000 opened /rebalancing and found a different
# account. Numbers below are derived from DEMO_HOLDINGS: 0050 at 75% against a
# 60% target, VT at 25% against 40%, so the page has a real drift to show.
_DEMO_REBAL_TOTAL = float(DEMO_PORTFOLIO["total_value"])          # 2,000,000
_DEMO_REBAL_DRIFT = 300000.00                                      # 15% of it
_DEMO_REBAL_CASH_TARGET = 0.10                                     # the planner's cash target

# Accumulating TWD towards a USD purchase. `ready_to_convert` and the metrics
# block's copy of it are both derived from these, so the tracker cannot say
# "ready" on one screen and "not yet" on the other.
_DEMO_FX_RATE = 32.5
_DEMO_FX_ACCUMULATED_USD = 1250.00
_DEMO_FX_ACCUMULATED_TWD = _DEMO_FX_ACCUMULATED_USD * _DEMO_FX_RATE
_DEMO_FX_THRESHOLD = 80000.00

# 0.1425% brokerage + 0.1% securities transaction tax, on the sell only. Named
# once: the plan states it, the sale nets it, and the cash left over is what it
# costs — three figures that have to move together.
_DEMO_REBAL_SELL_FEE = round(_DEMO_REBAL_DRIFT * 0.002425, 2)
# Proceeds are net of the fee, as `_build_rebalancing_plan` accumulates them.
_DEMO_REBAL_AVAILABLE_FUNDS = _DEMO_REBAL_DRIFT - _DEMO_REBAL_SELL_FEE

DEMO_REBALANCING_DASHBOARD = {
    # `DashboardMetricsEnhanced`, which is what the authenticated endpoint
    # returns here — this block used to be a different object entirely, naming
    # total_portfolio_value / total_cost / total_gain_loss and none of the nine
    # fields the schema declares. Nothing reads it today, which is exactly how
    # it stayed wrong: the endpoint serves this dict raw, so only the fixture
    # tests can see it. The figures come from the same constants the dashboard
    # answers with, so the two screens agree.
    "metrics": {
        "total_balance": demo_fixtures.DEMO_LIFE_WALLET,
        "monthly_income": demo_fixtures.DEMO_MONTHLY_INCOME,
        "monthly_expenses": demo_fixtures.DEMO_MONTHLY_EXPENSES,
        "net_worth": demo_fixtures.DEMO_NET_WORTH,
        "savings_rate": demo_fixtures.demo_savings_rate(
            demo_fixtures.DEMO_MONTHLY_INCOME, demo_fixtures.DEMO_MONTHLY_EXPENSES
        ),
        "portfolio_value": demo_fixtures.DEMO_PORTFOLIO_VALUE_LEGACY,
        "portfolio_growth": float(DEMO_PORTFOLIO["total_gain_loss_percentage"]),
        # What selling the overweight asset frees, after its fee — the same
        # figure the plan below reports, because it is the same sale.
        "available_funds": _DEMO_REBAL_AVAILABLE_FUNDS,
        "fx_accumulation_twd": _DEMO_FX_ACCUMULATED_TWD,
        "fx_ready_to_convert": _DEMO_FX_ACCUMULATED_TWD >= _DEMO_FX_THRESHOLD,
        "next_rebalance_date": None,
        "days_since_rebalance": None,
        "rebalancing_required": True,
        "last_updated": utc_now(),
    },
    "allocation_summary": {
        "total_portfolio_value": _DEMO_REBAL_TOTAL,
        "total_target_value": _DEMO_REBAL_TOTAL,
        "allocations": [
            {
                "asset_symbol": "0050",
                "asset_name": "元大台灣50 ETF",
                "asset_type": "etf",
                "current_value": 1500000.00,
                "current_percentage": 75.0,
                "target_percentage": 60.0,
                "deviation": 15.0,
                "delta_amount": -_DEMO_REBAL_DRIFT,
                "action": "sell",
                "color_code": "#3B82F6",
            },
            {
                "asset_symbol": "VT",
                "asset_name": "Vanguard Total World Stock ETF",
                "asset_type": "etf",
                "current_value": 500000.00,
                "current_percentage": 25.0,
                "target_percentage": 40.0,
                "deviation": -15.0,
                "delta_amount": _DEMO_REBAL_DRIFT,
                "action": "buy",
                "color_code": "#8B5CF6",
            },
        ],
        # Required by AssetAllocationSummary, and read by rebalancingService's
        # transform rather than the `metrics` copies above — dropping them left
        # the page reporting no drift at all, which is the opposite of what this
        # fixture exists to show.
        "in_balance": False,
        "requires_rebalancing": True,
        "largest_deviation": 15.0,
        "last_rebalance_date": None,
        "currency": "TWD",
        "last_updated": utc_now(),
    },
    "rebalancing_plan": {
        "plan_id": str(uuid4()),
        "total_portfolio_value": _DEMO_REBAL_TOTAL,
        # Proceeds from the sells, net of fees, as `_build_rebalancing_plan`
        # accumulates them. Zero here said the buy needed outside money, beside
        # a sell of exactly its size.
        "available_funds": _DEMO_REBAL_AVAILABLE_FUNDS,
        "transactions": [
            {
                "asset_symbol": "0050",
                "asset_name": "元大台灣50 ETF",
                "action": "sell",
                "quantity": None,
                "amount": _DEMO_REBAL_DRIFT,
                "estimated_fees": _DEMO_REBAL_SELL_FEE,
                "priority": 1,
                "notes": "偏離目標 +15.0%，優先賣出",
            },
            {
                "asset_symbol": "VT",
                "asset_name": "Vanguard Total World Stock ETF",
                "action": "buy",
                "quantity": None,
                "amount": _DEMO_REBAL_DRIFT,
                "estimated_fees": 0.00,
                "priority": 1,
                "notes": "偏離目標 -15.0%，優先買入",
            },
        ],
        # Also required, and also read directly by the frontend transform.
        "total_buy_amount": _DEMO_REBAL_DRIFT,
        "total_sell_amount": _DEMO_REBAL_DRIFT,
        "total_fees": _DEMO_REBAL_SELL_FEE,
        # The sale funds the purchase exactly, so what is left is the fee drag.
        # target_cash_after is what the real planner computes — 10% of the
        # portfolio (rebalancing_service.py) — and RebalancingPlan declares it
        # required, but this dict is served unvalidated, so its absence here
        # went unnoticed until the schemas were asserted against.
        # cash + proceeds - purchases, the service's formula. The sale covers the
        # purchase, so what is left over is what the fee cost.
        "net_cash_after": _DEMO_REBAL_AVAILABLE_FUNDS - _DEMO_REBAL_DRIFT,
        "target_cash_after": _DEMO_REBAL_TOTAL * _DEMO_REBAL_CASH_TARGET,
    },
    "fx_accumulation": [
        {
            "currency": "USD",
            "accumulated_amount": _DEMO_FX_ACCUMULATED_USD,
            "accumulated_twd": _DEMO_FX_ACCUMULATED_TWD,
            "conversion_threshold": _DEMO_FX_THRESHOLD,
            "current_fx_rate": _DEMO_FX_RATE,
            "ready_to_convert": _DEMO_FX_ACCUMULATED_TWD >= _DEMO_FX_THRESHOLD,
            "estimated_conversion_fee": 122.00,
            "last_conversion_date": None,
            # What is still needed to reach the threshold.
            "next_conversion_target": _DEMO_FX_THRESHOLD - _DEMO_FX_ACCUMULATED_TWD,
        }
    ],
    "alerts": [],
}


# Portfolio Management Endpoints
def _get_sort_key(sort_by: str):
    """Get the sort key function for holdings based on sort_by parameter"""

    def safe_float_access(h, key):
        """Safely extract numeric value from holding dictionary or object"""
        if isinstance(h, dict):
            value = h.get(key, 0)
        else:
            value = getattr(h, key, 0)

        if isinstance(value, (int, float)):
            return float(value)
        elif isinstance(value, Decimal):
            return float(value)
        elif isinstance(value, str):
            try:
                return float(value)
            except (ValueError, TypeError):
                return 0.0
        else:
            return 0.0

    def safe_string_access(h, key):
        """Safely extract string value from holding dictionary or object"""
        if isinstance(h, dict):
            value = h.get(key, "")
        else:
            value = getattr(h, key, "")
        return str(value).lower()

    sort_mapping = {
        "symbol": lambda h: safe_string_access(h, "symbol"),
        "name": lambda h: safe_string_access(h, "name"),
        "value": lambda h: safe_float_access(h, "total_value"),
        "gainLoss": lambda h: safe_float_access(h, "gain_loss"),
        "gainLossPercentage": lambda h: safe_float_access(h, "gain_loss_percentage"),
    }
    return sort_mapping.get(sort_by, sort_mapping["value"])


async def fetch_historical_data_background(symbol: str, market: str, days: int = 90):
    """
    Background task to fetch historical data for a symbol.
    This runs after the API response is sent to avoid blocking the user.
    Uses a fresh database session to avoid concurrent operation conflicts.
    """
    try:
        from ...core.database import async_session
        from app.modules.portfolio.historical_price_service import (
            get_historical_price_service,
        )

        # Create a completely new database session for this background task
        # This avoids conflicts with other concurrent background tasks
        async with async_session() as bg_session:
            try:
                hist_service = get_historical_price_service(bg_session)

                await hist_service.fetch_and_store_historical_data(
                    symbol=symbol,
                    market=market,
                    start_date=business_today() - timedelta(days=days),
                    end_date=business_today(),
                    force_refresh=False,
                )
                logger.info(
                    f"Background: Fetched historical data for {symbol} ({market})"
                )
            except Exception as e:
                logger.warning(
                    f"Background: Error fetching historical data for {symbol}: {str(e)}"
                )
                await bg_session.rollback()
            finally:
                await bg_session.close()
    except Exception as e:
        logger.error(f"Background: Critical error for {symbol}: {str(e)}")




__all__ = [
    "asyncio",
    "logging",
    "math",
    "Decimal",
    "datetime",
    "date",
    "timedelta",
    "timezone",
    "List",
    "Optional",
    "Dict",
    "Any",
    "UUID",
    "uuid4",
    "ZoneInfo",
    "APIRouter",
    "Depends",
    "File",
    "HTTPException",
    "Query",
    "Path",
    "Body",
    "UploadFile",
    "status",
    "BackgroundTasks",
    "JSONResponse",
    "StreamingResponse",
    "AsyncSession",
    "get_db",
    "CurrentUser",
    "get_optional_current_user",
    "ApiResponse",
    "PaginationParams",
    "PaginationMeta",
    "rate_limit_market_data",
    "rate_limit_analytics",
    "rate_limit_portfolio_sync",
    "PortfolioCreate",
    "PortfolioUpdate",
    "PortfolioResponse",
    "PortfolioSummary",
    "HoldingCreate",
    "HoldingUpdate",
    "HoldingResponse",
    "HoldingFilters",
    "TransactionCreate",
    "TransactionUpdate",
    "TransactionResponse",
    "TransactionFilters",
    "BulkTransactionCreate",
    "BulkTransactionResponse",
    "PortfolioPerformance",
    "MarketDataResponse",
    "AssetAllocation",
    "PaginatedPortfoliosResponse",
    "PaginatedHoldingsResponse",
    "PaginatedTransactionsResponse",
    "DividendCreate",
    "DividendUpdate",
    "DividendReinvest",
    "DividendResponse",
    "DividendSummary",
    "DividendHistoryFilter",
    "SellHoldingResponse",
    "get_portfolio_service",
    "AnalyticsService",
    "get_portfolio_repository",
    "get_holding_repository",
    "get_transaction_repository",
    "PortfolioRepository",
    "HoldingRepository",
    "get_price_update_service",
    "get_api_health_checker",
    "get_irr_update_service",
    "get_historical_price_service",
    "ExchangeRateService",
    "HistoricalPriceRepository",
    "_mc",
    "_router_time",
    "_threading",
    "_PriceCache",
    "_price_cache",
    "_lp_cache_get",
    "_lp_cache_set",
    "logger",
    "safe_float",
    "DEMO_PORTFOLIO",
    "DEMO_HOLDINGS",
    "DEMO_SERIES_START",
    "demo_value_series",
    "demo_period_return_pct",
    "DEMO_REBALANCING_DASHBOARD",
    "_get_sort_key",
    "fetch_historical_data_background",
]
