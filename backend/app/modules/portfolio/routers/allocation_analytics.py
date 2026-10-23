"""Portfolio router: Allocation, analytics, rebalancing, and benchmark endpoints.

Split out from the original monolithic ``portfolio/router.py``.
Behavior is preserved exactly; paths remain identical.
"""

from ._shared import *  # noqa: F401,F403  (shared imports/constants/helpers)
from ._shared import (  # noqa: F401  explicit re-import for underscore-prefixed names
    _lp_cache_get,
    _lp_cache_set,
    _get_sort_key,
    _mc,
    _price_cache,
    fetch_historical_data_background,
)
from ..symbols import canonical_symbol
from app.utils.datetime_helpers import business_today
from app.core.exceptions import AspiroException

router = APIRouter()


_DEMO_ALLOCATION_COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"]
_DEMO_SECTOR_LABELS = {"broad_market": "Taiwan Market", "global_market": "Global Market"}


def _demo_allocation_slices(as_float: bool = False) -> Dict[str, List[Dict[str, Any]]]:
    """by_type / by_sector / by_region of the demo portfolio, from DEMO_HOLDINGS."""
    total = sum(h["total_value"] for h in DEMO_HOLDINGS)

    def group(key) -> List[Dict[str, Any]]:
        buckets: Dict[str, Decimal] = {}
        for h in DEMO_HOLDINGS:
            label = key(h)
            buckets[label] = buckets.get(label, Decimal("0")) + h["total_value"]
        ordered = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
        out = []
        for i, (label, value) in enumerate(ordered):
            pct = (value / total * 100).quantize(Decimal("0.1")) if total else Decimal("0")
            out.append(
                {
                    "type": label,
                    "percentage": float(pct) if as_float else pct,
                    "value": float(value) if as_float else value,
                    "color": _DEMO_ALLOCATION_COLORS[i % len(_DEMO_ALLOCATION_COLORS)],
                }
            )
        return out

    return {
        "by_type": group(lambda h: h["type"].upper()),
        "by_sector": group(lambda h: _DEMO_SECTOR_LABELS.get(h["sector"], h["sector"])),
        "by_region": group(lambda h: h.get("region") or h.get("market") or "Other"),
    }


@router.get("/allocation")
async def get_asset_allocation(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get asset allocation breakdown"""

    # Demo allocation, derived from DEMO_HOLDINGS. This described the retired
    # AAPL/GOOGL/BTC account (Stock/Crypto/negative Cash, NT$21K) beside a
    # NT$2M portfolio of two ETFs.
    demo_allocation = {
        key: [AssetAllocation(**slice_) for slice_ in slices]
        for key, slices in _demo_allocation_slices().items()
    }

    if not current_user:
        return ApiResponse.success_response(data=demo_allocation)

    try:
        allocation = await AnalyticsService(session).get_asset_allocation(current_user.id)
        return ApiResponse.success_response(data=allocation)

    except Exception as e:
        # Return demo data on error
        return ApiResponse.success_response(data=demo_allocation)


@router.get("/analytics")
@rate_limit_analytics
async def get_portfolio_analytics(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get comprehensive portfolio analytics including performance and allocation data.
    Optimized: Uses single database query + in-memory calculations for speed.
    Rate limited: 5 requests/minute per user
    """
    # Demo analytics data
    demo_analytics = {
        # Period returns off the same value walk /daily-performance serves, and
        # allocations off DEMO_HOLDINGS. Both described the retired
        # AAPL/GOOGL/BTC account: an 11.1% year and a negative cash slice.
        "performance": {
            "oneDay": demo_period_return_pct(1),
            "oneWeek": demo_period_return_pct(7),
            "oneMonth": demo_period_return_pct(30),
            "threeMonths": demo_period_return_pct(91),
            "sixMonths": demo_period_return_pct(182),
            "oneYear": demo_period_return_pct(365),
        },
        "allocation": {
            "byType": [
                {"type": a["type"], "percentage": a["percentage"], "value": a["value"], "color": a["color"]}
                for a in _demo_allocation_slices(as_float=True)["by_type"]
            ],
            "bySector": [
                {"sector": a["type"], "percentage": a["percentage"], "value": a["value"], "color": a["color"]}
                for a in _demo_allocation_slices(as_float=True)["by_sector"]
            ],
            "byRegion": [
                {"region": a["type"], "percentage": a["percentage"], "value": a["value"], "color": a["color"]}
                for a in _demo_allocation_slices(as_float=True)["by_region"]
            ],
        },
        # Ranked, not sliced. `[:3]` and `[-2:]` returned the same two rows once
        # the demo portfolio held two holdings, so "Worst Performers" listed the
        # same ETFs as "Top Performers".
        "topPerformers": sorted(
            DEMO_HOLDINGS, key=lambda h: h["gain_loss_percentage"], reverse=True
        )[:1],
        "worstPerformers": sorted(
            DEMO_HOLDINGS, key=lambda h: h["gain_loss_percentage"]
        )[:1],
        "diversificationScore": 75,
        "riskScore": 45,
        "sharpeRatio": 1.12,
        "beta": 0.94,
    }

    if not current_user:
        return ApiResponse.success_response(data=demo_analytics)

    try:
        # ⚡ PERFORMANCE FIX: Single optimized query instead of 2 separate queries
        portfolio_service = get_portfolio_service(session)

        # Get default portfolio (cached)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)
        if not portfolio:
            logger.warning(f"No default portfolio found for user {current_user.id}")
            return ApiResponse.success_response(data=demo_analytics)

        # Get holdings in a single query
        holdings, _ = await portfolio_service.holding_repo.get_portfolio_holdings(
            portfolio.id, current_user.id, limit=100
        )

        if not holdings:
            logger.info(f"No holdings found for portfolio {portfolio.id}")
            return ApiResponse.success_response(data=demo_analytics)

        # ⚡ PERFORMANCE FIX: Calculate everything in-memory from single query result
        active_holdings = [h for h in holdings if h.is_active and h.total_value > 0]

        # Calculate allocation
        total_value = sum(h.total_value for h in active_holdings) or Decimal("1")
        colors = ["#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#8B5CF6", "#F97316"]

        # By type
        type_dict = {}
        sector_dict = {}
        region_dict = {}

        for holding in active_holdings:
            # By type
            h_type = (holding.type or "Unknown").replace("_", " ").title()
            type_dict[h_type] = (
                type_dict.get(h_type, Decimal("0")) + holding.total_value
            )

            # By sector
            sector = holding.sector or "Unknown"
            sector_dict[sector] = (
                sector_dict.get(sector, Decimal("0")) + holding.total_value
            )

            # By region
            region = holding.region or "Unknown"
            region_dict[region] = (
                region_dict.get(region, Decimal("0")) + holding.total_value
            )

        # Calculate performance from current total gain/loss
        total_gain_loss_pct = (
            float(portfolio.total_gain_loss_percentage)
            if portfolio.total_gain_loss_percentage
            else 0
        )

        # Sharpe and beta come from /portfolio/risk-metrics, not from here: this
        # endpoint's own calculation called a function it never imported, so it
        # always returned null. The keys stay for the frontend's fallback read.

        # Sort holdings for top/worst performers
        sorted_by_performance = sorted(
            active_holdings,
            key=lambda h: (
                float(h.gain_loss_percentage) if h.gain_loss_percentage else 0
            ),
            reverse=True,
        )

        # Build response
        analytics_data = {
            "performance": {
                "oneDay": total_gain_loss_pct * 0.003,
                "oneWeek": total_gain_loss_pct * 0.02,
                "oneMonth": total_gain_loss_pct * 0.08,
                "threeMonths": total_gain_loss_pct * 0.25,
                "sixMonths": total_gain_loss_pct * 0.50,
                "oneYear": total_gain_loss_pct,
            },
            "allocation": {
                "byType": [
                    {
                        "type": asset_type,
                        "percentage": float((value / total_value) * 100),
                        "value": float(value),
                        "color": colors[i % len(colors)],
                    }
                    for i, (asset_type, value) in enumerate(type_dict.items())
                ],
                "bySector": [
                    {
                        "sector": sector,
                        "percentage": float((value / total_value) * 100),
                        "value": float(value),
                        "color": colors[i % len(colors)],
                    }
                    for i, (sector, value) in enumerate(sector_dict.items())
                ],
                "byRegion": [
                    {
                        "region": region,
                        "percentage": float((value / total_value) * 100),
                        "value": float(value),
                        "color": colors[i % len(colors)],
                    }
                    for i, (region, value) in enumerate(region_dict.items())
                ],
            },
            "topPerformers": [
                {
                    "symbol": h.symbol,
                    "name": h.name,
                    "gainLossPercentage": (
                        float(h.gain_loss_percentage) if h.gain_loss_percentage else 0
                    ),
                    "totalValue": float(h.total_value),
                }
                for h in sorted_by_performance[:5]
            ],
            "worstPerformers": [
                {
                    "symbol": h.symbol,
                    "name": h.name,
                    "gainLossPercentage": (
                        float(h.gain_loss_percentage) if h.gain_loss_percentage else 0
                    ),
                    "totalValue": float(h.total_value),
                }
                for h in sorted_by_performance[-5:]
            ],
            "diversificationScore": min(
                100,
                len(set(h.type for h in active_holdings)) * 20
                + len(set(h.sector for h in active_holdings if h.sector)) * 10
                + len(set(h.market for h in active_holdings)) * 15,
            ),
            "riskScore": min(
                100,
                max([float((v / total_value) * 100) for v in type_dict.values()] or [0])
                + 20,
            ),
            "sharpeRatio": None,
            "beta": None,
        }

        return ApiResponse.success_response(data=analytics_data)

    except Exception as e:
        logger.error(f"Error getting portfolio analytics: {str(e)}", exc_info=True)
        # Return demo data on error
        return ApiResponse.success_response(data=demo_analytics)


@router.get(
    "/rebalancing/allocation",
    summary="Get current asset allocation",
    description="Get current asset allocation with deviations from targets",
)
async def get_asset_allocation(
    current_user: CurrentUser,
    portfolio_id: Optional[UUID] = Query(
        None, description="Portfolio ID (default portfolio if not specified)"
    ),
    session: AsyncSession = Depends(get_db),
):
    """
    Get current asset allocation and compare with target allocations.

    Returns detailed allocation breakdown showing:
    - Current value and percentage for each asset
    - Target percentage
    - Deviation from target
    - Recommended action (BUY/SELL/HOLD)
    - Amount needed to rebalance
    """
    try:
        from ..rebalancing_service import get_rebalancing_service

        rebalancing_service = get_rebalancing_service(session)
        allocation_summary = await rebalancing_service.get_current_allocation(
            user_id=current_user.id, portfolio_id=portfolio_id
        )

        logger.info(f"Asset allocation retrieved for user {current_user.id}")

        return ApiResponse.success_response(
            data=allocation_summary.model_dump(),
            message="Asset allocation retrieved successfully",
        )

    except AspiroException:
        raise  # keep 404s etc. instead of masking them as 500
    except Exception as e:
        logger.error(f"Failed to get asset allocation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get(
    "/rebalancing/plan",
    summary="Get rebalancing plan",
    description="Generate a detailed rebalancing plan with recommended transactions",
)
async def get_rebalancing_plan(
    current_user: CurrentUser,
    portfolio_id: Optional[UUID] = Query(
        None, description="Portfolio ID (default portfolio if not specified)"
    ),
    session: AsyncSession = Depends(get_db),
):
    """
    Generate a comprehensive rebalancing plan.

    Returns:
    - List of recommended buy/sell transactions
    - Available funds from overweight assets
    - Estimated transaction fees
    - Expected cash position after rebalancing
    """
    try:
        from ..rebalancing_service import get_rebalancing_service

        rebalancing_service = get_rebalancing_service(session)
        rebalancing_plan = await rebalancing_service.calculate_rebalancing_plan(
            user_id=current_user.id, portfolio_id=portfolio_id
        )

        logger.info(f"Rebalancing plan generated for user {current_user.id}")

        return ApiResponse.success_response(
            data=rebalancing_plan.model_dump(),
            message="Rebalancing plan generated successfully",
        )

    except AspiroException:
        raise  # keep 404s etc. instead of masking them as 500
    except Exception as e:
        logger.error(f"Failed to generate rebalancing plan: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get(
    "/rebalancing/fx-accumulation",
    summary="Get FX accumulation status",
    description="Get foreign currency accumulation tracking for conversion triggers",
)
async def get_fx_accumulation(
    current_user: CurrentUser,
    portfolio_id: Optional[UUID] = Query(
        None, description="Portfolio ID (default portfolio if not specified)"
    ),
    session: AsyncSession = Depends(get_db),
):
    """
    Get FX (Foreign Exchange) accumulation status.

    Tracks accumulated foreign currency and alerts when conversion threshold is reached.
    Useful for managing FX conversion timing and costs.
    """
    try:
        from ..rebalancing_service import get_rebalancing_service

        rebalancing_service = get_rebalancing_service(session)
        fx_accumulation = await rebalancing_service.calculate_fx_accumulation(
            user_id=current_user.id, portfolio_id=portfolio_id
        )

        logger.info(f"FX accumulation retrieved for user {current_user.id}")

        return ApiResponse.success_response(
            data=[fx.model_dump() for fx in fx_accumulation],
            message="FX accumulation retrieved successfully",
        )

    except AspiroException:
        raise  # keep 404s etc. instead of masking them as 500
    except Exception as e:
        logger.error(f"Failed to get FX accumulation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get(
    "/rebalancing/alerts",
    summary="Get rebalancing alerts",
    description="Get active rebalancing alerts for portfolio maintenance",
)
async def get_rebalancing_alerts(
    current_user: CurrentUser,
    portfolio_id: Optional[UUID] = Query(
        None, description="Portfolio ID (default portfolio if not specified)"
    ),
    session: AsyncSession = Depends(get_db),
):
    """
    Get active rebalancing alerts.

    Returns alerts for:
    - Portfolio rebalancing requirements
    - FX conversion triggers
    - Low cash warnings
    - Asset allocation deviations
    """
    try:
        from ..rebalancing_service import get_rebalancing_service

        rebalancing_service = get_rebalancing_service(session)
        alerts = await rebalancing_service.get_rebalancing_alerts(
            user_id=current_user.id, portfolio_id=portfolio_id
        )

        logger.info(
            f"Rebalancing alerts retrieved for user {current_user.id}: {len(alerts)} alerts"
        )

        return ApiResponse.success_response(
            data={
                "alerts": [alert.model_dump() for alert in alerts],
                "total_alerts": len(alerts),
                "critical_alerts": sum(1 for a in alerts if a.severity == "error"),
                "last_checked": datetime.now(timezone.utc),
            },
            message="Rebalancing alerts retrieved successfully",
        )

    except AspiroException:
        raise  # keep 404s etc. instead of masking them as 500
    except Exception as e:
        logger.error(f"Failed to get rebalancing alerts: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get(
    "/rebalancing/dashboard",
    summary="Get complete rebalancing dashboard data",
    description="Get all rebalancing data in one request for dashboard display",
)
async def get_rebalancing_dashboard(
    current_user=Depends(get_optional_current_user),
    portfolio_id: Optional[UUID] = Query(
        None, description="Portfolio ID (default portfolio if not specified)"
    ),
    session: AsyncSession = Depends(get_db),
):
    """
    Get comprehensive rebalancing dashboard data.

    Combines all rebalancing components into a single response:
    - Enhanced metrics with rebalancing info
    - Current asset allocation
    - Rebalancing plan (if needed)
    - FX accumulation status
    - Active alerts

    Optimized for dashboard display to minimize API calls.
    Supports demo mode for unauthenticated users.
    """
    # Return demo data for unauthenticated users
    if not current_user:
        logger.info("📊 Returning DEMO rebalancing dashboard (user not authenticated)")
        return ApiResponse.success_response(
            data=DEMO_REBALANCING_DASHBOARD,
            message="Demo rebalancing dashboard data retrieved successfully",
        )

    try:
        from ..rebalancing_service import get_rebalancing_service

        rebalancing_service = get_rebalancing_service(session)
        dashboard_data = await rebalancing_service.get_dashboard_rebalancing_data(
            user_id=current_user.id, portfolio_id=portfolio_id
        )

        logger.info(f"Rebalancing dashboard data retrieved for user {current_user.id}")

        return ApiResponse.success_response(
            data=dashboard_data.model_dump(),
            message="Rebalancing dashboard data retrieved successfully",
        )

    except HTTPException:
        raise
    except AspiroException:
        raise  # keep 404s etc. instead of masking them as 500
    except Exception as e:
        logger.error(f"Failed to get rebalancing dashboard: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.put(
    "/rebalancing/target-allocations",
    summary="Update target asset allocations",
    description="Update user-defined target allocation percentages for portfolio rebalancing",
)
async def update_target_allocations(
    request: dict, current_user: CurrentUser, session: AsyncSession = Depends(get_db)
):
    """
    Update target allocation percentages for portfolio assets.

    Request body should contain:
    {
        "targets": [
            {"asset": "0050", "targetPct": 0.35},
            {"asset": "VT", "targetPct": 0.30},
            {"asset": "CASH", "targetPct": 0.35}
        ]
    }

    The sum of all targetPct values must equal 1.0 (100%).
    """
    try:
        from decimal import Decimal

        targets = request.get("targets", [])

        if not targets:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No target allocations provided",
            )

        # Validate total percentage
        total_pct = sum(Decimal(str(t.get("targetPct", 0))) for t in targets)
        if abs(total_pct - Decimal("1.0")) > Decimal("0.001"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Total allocation must equal 100% (got {float(total_pct) * 100:.1f}%)",
            )

        # Store target allocations in user's portfolio metadata
        # This is a simplified implementation using portfolio metadata
        # In production, you'd want to create an AssetAllocationTarget model

        logger.info(f"Target allocations updated for user {current_user.id}: {targets}")

        # Get user's default portfolio
        from ..repositories import PortfolioRepository

        portfolio_repo = PortfolioRepository(session)
        portfolio = await portfolio_repo.get_default_portfolio(current_user.id)

        if not portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Default portfolio not found",
            )

        # Store targets in portfolio metadata with full asset details
        # Important: Create a new dict to avoid SQLAlchemy MetaData object issues
        current_metadata = dict(portfolio.item_metadata) if portfolio.item_metadata else {}

        # Store both percentages and asset metadata (name, type)
        current_metadata["target_allocations"] = {
            target["asset"]: {
                "targetPct": float(target["targetPct"]),
                "assetName": target.get("assetName", target["asset"]),
                "assetType": target.get("assetType", "unknown"),
            }
            for target in targets
        }
        current_metadata["target_allocations_updated_at"] = datetime.now(
            timezone.utc
        ).isoformat()

        # Assign the updated dict back (a new object, so the JSON column is marked dirty)
        portfolio.item_metadata = current_metadata

        # Commit to database
        await session.commit()
        await session.refresh(portfolio)

        logger.info(
            f"Target allocations persisted to portfolio {portfolio.id} for user {current_user.id}"
        )

        return ApiResponse.success_response(
            data={
                "targets": targets,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            message="Target allocations updated successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update target allocations: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


BENCHMARK_MAP = {
    "SPY": ("SPY", "US"),
    "QQQ": ("QQQ", "US"),
    "VTI": ("VTI", "US"),
    "0050.TW": ("0050.TW", "TW"),
    "006208.TW": ("006208.TW", "TW"),
}

BENCHMARK_DEMO = {
    "SPY": {"name": "S&P 500 ETF", "color": "#f59e0b"},
    "QQQ": {"name": "NASDAQ-100 ETF", "color": "#8b5cf6"},
    "VTI": {"name": "Total Market ETF", "color": "#06b6d4"},
    "0050.TW": {"name": "Taiwan 50 ETF", "color": "#10b981"},
    "006208.TW": {"name": "Fubon TWSE ETF", "color": "#f97316"},
}


async def _store_benchmark_background(yahoo_symbol: str, market: str, raw_data: list):
    """Store fetched benchmark prices to DB in the background for future cache hits."""
    try:
        from app.core.database import async_session
        from ..historical_price_repository import HistoricalPriceRepository

        price_records = []
        for d in raw_data:
            try:
                price_date = datetime.fromisoformat(d["date"].replace("Z", "+00:00")).date() if isinstance(d["date"], str) else d["date"]
                close = d.get("close")
                if not close:
                    continue
                price_records.append({
                    "symbol": yahoo_symbol.upper(),
                    "market": market,
                    "date": price_date,
                    "open": d.get("open"),
                    "high": d.get("high"),
                    "low": d.get("low"),
                    "close": float(close),
                    "volume": d.get("volume"),
                    "adjusted_close": d.get("adjusted_close"),
                    "source": "yahoo",
                    "currency": "TWD" if market == "TW" else "USD",
                    "exchange": d.get("exchange"),
                })
            except Exception:
                continue

        if price_records:
            async with async_session() as bg_session:
                repo = HistoricalPriceRepository(bg_session)
                await repo.bulk_upsert_prices(price_records)
                await bg_session.commit()
                logger.debug(f"Stored {len(price_records)} benchmark prices for {yahoo_symbol}")
    except Exception as e:
        logger.warning(f"Background benchmark storage failed for {yahoo_symbol}: {e}")


@router.get("/benchmark")
@rate_limit_market_data
async def get_benchmark_data(
    background_tasks: BackgroundTasks,
    symbol: str = Query("SPY", description="Benchmark symbol — any valid Yahoo Finance ticker (SPY, QQQ, VTI, 0050.TW, or custom)"),
    days: int = Query(365, ge=7, le=1825, description="Number of days"),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get benchmark historical price data normalized to % return from period start.

    Accepts any valid Yahoo Finance ticker, not just preset benchmarks.
    Tries DB cache first; falls back to direct Yahoo Finance fetch.
    Stores fresh data to DB in background for subsequent cache hits.
    """
    symbol = symbol.upper().strip().replace("%2E", ".").replace("%2F", "/")

    if not symbol or len(symbol) > 20:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid symbol")

    # Resolve yahoo ticker + market: use map for known symbols, else treat as direct ticker
    if symbol in BENCHMARK_MAP:
        yahoo_symbol, market = BENCHMARK_MAP[symbol]
    else:
        # Unknown/custom symbol — pass through directly; infer market from suffix
        yahoo_symbol = symbol
        market = "TW" if symbol.endswith(".TW") else "US"

    meta = BENCHMARK_DEMO.get(symbol, {"name": symbol, "color": "#6b7280"})

    # Demo mode: generate synthetic benchmark data
    if not current_user:
        import random
        random.seed(42)
        demo_data = []
        end = business_today()
        start = end - timedelta(days=days)
        price = 100.0
        cur = start
        while cur <= end:
            change = random.gauss(0.0004, 0.012)
            price *= (1 + change)
            demo_data.append({"date": cur.isoformat(), "close": round(price, 4)})
            cur += timedelta(days=1)
        first_price = demo_data[0]["close"] if demo_data else 1.0
        for d in demo_data:
            d["returnPct"] = round((d["close"] - first_price) / first_price * 100, 4)
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": {
                    "symbol": symbol,
                    "name": meta["name"],
                    "color": meta["color"],
                    "points": demo_data,
                },
            },
        )

    try:
        end_date = business_today()
        start_date = end_date - timedelta(days=days)

        historical_service = get_historical_price_service(session)

        # 1. Try DB cache first (fast path)
        # Yahoo's ticker is what the provider is asked for; the canonical form
        # is what the table stores, so the cache has to be read under that one.
        prices = await historical_service.get_historical_prices_for_symbol(
            symbol=canonical_symbol(yahoo_symbol),
            start_date=start_date,
            end_date=end_date,
        )

        raw_yahoo_data = None
        if not prices:
            # 2. Fetch directly from Yahoo Finance (bypasses the broken async-for-break pattern)
            raw_yahoo_data = await historical_service.market_data.get_historical_data(
                symbol=yahoo_symbol, market=market, days=days
            )
            if raw_yahoo_data:
                # Convert to the same format as DB prices
                prices = []
                for d in raw_yahoo_data:
                    close = d.get("close")
                    if not close:
                        continue
                    dt = d.get("date", "")
                    if not isinstance(dt, str):
                        dt = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
                    prices.append({"date": dt, "close": float(close)})
                # 3. Store to DB in background so next request hits cache
                if prices:
                    background_tasks.add_task(_store_benchmark_background, yahoo_symbol, market, raw_yahoo_data)

        if not prices:
            return JSONResponse(
                status_code=200,
                content={
                    "success": False,
                    "data": None,
                    "message": f"No historical data found for '{symbol}'. Make sure it is a valid Yahoo Finance ticker.",
                },
            )

        # Sort by date ascending and normalize to period return %
        prices_sorted = sorted(prices, key=lambda p: p.get("date", ""))
        first_close = float(prices_sorted[0].get("close", 1) or 1)

        points = []
        for p in prices_sorted:
            close = float(p.get("close", 0) or 0)
            if close <= 0:
                continue
            return_pct = (close - first_close) / first_close * 100
            points.append({
                "date": p.get("date", ""),
                "close": round(close, 4),
                "returnPct": round(return_pct, 4),
            })

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": {
                    "symbol": symbol,
                    "name": meta["name"],
                    "color": meta["color"],
                    "points": points,
                },
            },
        )

    except Exception as e:
        logger.error(f"Failed to get benchmark data for {symbol}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# ========================================
# DIVIDEND TRACKING ENDPOINTS
# ========================================


