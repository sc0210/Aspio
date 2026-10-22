"""Portfolio router: Sync, import/export, status, and API-health admin endpoints.

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
from app.modules.admin.dependencies import RequirePermission
from app.modules.admin.models import AdminPermission, AdminUser

router = APIRouter()


@router.post("/sync-historical-prices")
async def sync_historical_prices(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
    days: int = Query(
        90, description="Number of days of historical data to fetch", ge=1, le=365
    ),
):
    """
    Manually trigger historical price data sync for all portfolio holdings.

    Use this endpoint to populate historical data needed for daily performance charts.
    This may take a few minutes depending on the number of holdings.
    """

    try:
        from app.modules.portfolio.historical_price_service import (
            get_historical_price_service,
        )

        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        if not portfolio or not portfolio.holdings:
            return ApiResponse.error_response(message="No holdings found in portfolio")

        # Filter out non-tradable items (cash, savings, budgets, etc.)
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

        tradable_holdings = [
            h
            for h in portfolio.holdings
            if h.symbol.upper() not in NON_TRADABLE_SYMBOLS
            and not h.symbol.upper().startswith("CASH-")
            and not h.symbol.upper().endswith("-SAVINGS")
            and not h.symbol.upper().endswith("-BUDGET")
        ]

        if not tradable_holdings:
            return ApiResponse.error_response(
                message="No tradable holdings found in portfolio"
            )

        # Build symbol-market mapping from tradable holdings only
        symbol_markets = {
            holding.symbol: holding.market for holding in tradable_holdings
        }
        symbols = list(symbol_markets.keys())

        logger.info(
            f"User {current_user.email} triggered historical sync for {len(symbols)} tradable symbols ({days} days)"
        )

        # Fetch historical data
        hist_service = get_historical_price_service(session)
        result = await hist_service.update_holdings_historical_data(
            symbols=symbols, markets=symbol_markets, days=days
        )

        logger.info(f"Historical sync complete: {result}")

        return ApiResponse.success_response(
            data=result,
            message=f"Historical data synced for {result['successful'] + result['cached']} symbols",
        )

    except Exception as e:
        logger.error(f"Error syncing historical prices: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.post("/import-preview")
async def import_preview(
    file: UploadFile = File(..., description="CSV or XLSX file to import"),
    current_user: CurrentUser = None,  # noqa: B008 — FastAPI injects via Annotated[User, Depends(...)]
):
    """
    Parse an uploaded CSV or XLSX portfolio file and return structured JSON.

    Accepts multipart/form-data field name: ``file``.
    Max file size: 5 MB.
    Requires authentication.

    Returns plain JSON (not wrapped in ApiResponse) so the frontend can handle
    partial-success responses (valid rows alongside an error list).

    Response shape::

        {
          "holdings": [
            {
              "symbol": "AAPL",
              "name": "AAPL",
              "type": "stock",
              "currency": "USD",
              "exchange": "US",
              "quantity": 10.0,
              "averageCost": 150.0,
              "purchaseDate": "2024-01-15"
            }
          ],
          "errors": ["Row 3: Shares must be positive"]
        }
    """
    from ..services import parse_import_file as _parse_import_file

    MAX_SIZE = 5 * 1024 * 1024  # 5 MB

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum allowed size is 5 MB.",
        )

    filename = file.filename or ""
    result = await _parse_import_file(content, filename)
    return JSONResponse(content=result)


@router.get("/template")
async def import_template(
    current_user: CurrentUser = None,  # noqa: B008 — FastAPI injects via Annotated[User, Depends(...)]
):
    """Download the blank portfolio import template as XLSX.

    Served as XLSX (not CSV) so the ``StockID`` column is text-formatted: Excel
    keeps leading-zero Taiwan tickers (e.g. ``0050``) intact instead of coercing
    them to numbers. This is the same format produced by ``/export``, so a filled
    template re-imports cleanly via ``/import-preview``.
    """
    from ..services import build_import_template_xlsx as _build_template

    xlsx_data = await asyncio.to_thread(_build_template)
    return StreamingResponse(
        iter([xlsx_data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=portfolio_template.xlsx"},
    )


@router.get("/export")
async def export_portfolio(
    format: str = Query("xlsx", description="Export format (xlsx, csv)"),
    date_from: Optional[str] = Query(None, description="Filter by purchase date start (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter by purchase date end (YYYY-MM-DD)"),
    current_user: CurrentUser = None,
    session: AsyncSession = Depends(get_db),
):
    """Export portfolio data"""

    try:
        from datetime import datetime as _dt
        portfolio_service = get_portfolio_service(session)

        def _parse(s: Optional[str]):
            if not s:
                return None
            try:
                return _dt.fromisoformat(s)
            except ValueError:
                return _dt.strptime(s, "%Y-%m-%d")

        from_label = date_from or "all"
        to_label = date_to or "time"

        if format.lower() == "xlsx":
            xlsx_data = await portfolio_service.export_portfolio_xlsx(
                current_user.id,
                date_from=_parse(date_from),
                date_to=_parse(date_to),
            )
            filename = f"portfolio_{from_label}_{to_label}.xlsx"
            return StreamingResponse(
                iter([xlsx_data]),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )
        elif format.lower() == "csv":
            csv_data = await portfolio_service.export_portfolio_csv(
                current_user.id,
                date_from=_parse(date_from),
                date_to=_parse(date_to),
            )
            filename = f"portfolio_{from_label}_{to_label}.csv"
            return StreamingResponse(
                iter([csv_data]),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported export format. Use 'xlsx' or 'csv'",
            )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# Regional Investment Endpoints
@router.get("/status")
async def portfolio_status():
    """Get portfolio service status"""
    return ApiResponse.success_response(
        data={
            "service": "portfolio",
            "status": "available",
            "features": [
                "portfolio_management",
                "holdings_tracking",
                "market_data",
                "performance_analytics",
                "regional_investments",
                "export_functionality",
            ],
        },
        message="Portfolio service is fully operational",
    )


@router.get("/api-health")
async def get_api_health_status():
    """
    Get health status of external market data APIs

    Returns operational status for:
    - FinLab API (Taiwan stock market data)
    - TradingView API (US/Global stock market data)
    """
    try:
        health_checker = get_api_health_checker()
        health_status = await health_checker.check_all_apis()

        return ApiResponse.success_response(
            data=health_status,
            message=f"API health check completed - {health_status['overall_status']}",
        )

    except Exception as e:
        logger.error(f"Failed to check API health: {str(e)}")
        return ApiResponse.success_response(
            data={
                "overall_status": "unknown",
                "apis": {},
                "summary": {
                    "total_apis": 0,
                    "operational": 0,
                    "degraded": 0,
                    "down": 0,
                },
                "error": str(e),
            },
            message="Failed to check API health",
        )


@router.get("/api-cache-status")
async def get_api_cache_status(current_user: CurrentUser):
    """
    Get the current status of the FinLab market data cache.

    This endpoint helps monitor API usage optimization:
    - Shows if market-level cache is active
    - Reports cache age and available symbols
    - Provides recommendations for API usage

    Use this to verify the cache is working before triggering sync operations.
    """
    try:
        from app.modules.portfolio.market_data_service import (
            get_finlab_cache_status,
            get_api_optimization_stats,
        )

        cache_status = get_finlab_cache_status()
        optimization_stats = get_api_optimization_stats()

        return ApiResponse.success_response(
            data={
                "cache_status": cache_status,
                "optimization": optimization_stats,
            },
            message=cache_status.get("message", "Cache status retrieved"),
        )

    except Exception as e:
        logger.error(f"Failed to get cache status: {str(e)}")
        return ApiResponse.error_response(
            message=f"Failed to get cache status: {str(e)}"
        )


@router.post("/clear-market-cache")
async def clear_market_data_cache(
    # Process-wide cache shared by every user: an operator action, not a user one.
    current_admin: AdminUser = Depends(RequirePermission(AdminPermission.MANAGE_SETTINGS)),
):
    """
    Clear the in-memory FinLab market data cache.

    Use this when:
    - You need to force-refresh market data immediately
    - After market close to ensure next-day data is fresh
    - For troubleshooting data issues

    Note: This does NOT clear Redis cache or database records.
    The next market data request will fetch fresh data from FinLab API.
    """
    try:
        from app.modules.portfolio.market_data_service import (
            clear_finlab_market_cache,
            get_finlab_cache_status,
        )

        clear_finlab_market_cache()
        new_status = get_finlab_cache_status()

        logger.info(f"User {current_user.email} cleared market data cache")

        return ApiResponse.success_response(
            data={"new_cache_status": new_status},
            message="Market data cache cleared successfully",
        )

    except Exception as e:
        logger.error(f"Failed to clear cache: {str(e)}")
        return ApiResponse.error_response(message=f"Failed to clear cache: {str(e)}")


