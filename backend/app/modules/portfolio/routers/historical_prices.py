"""Portfolio router: Historical price fetch/query endpoints.

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
from app.utils.datetime_helpers import business_today

router = APIRouter()


@router.post("/historical-prices/fetch")
async def fetch_historical_prices(
    symbol: str = Query(..., description="Stock symbol to fetch"),
    market: str = Query(..., description="Market type (TW, US, CRYPTO)"),
    days: int = Query(
        default=365, ge=1, le=3650, description="Number of days of history"
    ),
    force_refresh: bool = Query(
        default=False, description="Force refresh even if cached"
    ),
    session: AsyncSession = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """
    Fetch and store historical price data for a specific symbol.

    This endpoint will:
    1. Check if data already exists in cache
    2. Fetch missing data from market data API (FinLab, Yahoo, etc.)
    3. Store the data in the database
    4. Return summary of operation
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to fetch historical data",
        )

    try:
        historical_service = get_historical_price_service(session)

        end_date = business_today()
        start_date = end_date - timedelta(days=days)

        result = await historical_service.fetch_and_store_historical_data(
            symbol=symbol.upper(),
            market=market.upper(),
            start_date=start_date,
            end_date=end_date,
            force_refresh=force_refresh,
        )

        return ApiResponse.success_response(
            data=result, message=f"Historical data fetch completed for {symbol}"
        )

    except Exception as e:
        logger.error(
            f"Failed to fetch historical prices for {symbol}: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.post("/historical-prices/fetch-all")
async def fetch_all_holdings_historical_prices(
    days: int = Query(
        default=365, ge=1, le=3650, description="Number of days of history"
    ),
    portfolio_id: Optional[UUID] = Query(
        default=None, description="Specific portfolio ID"
    ),
    session: AsyncSession = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """
    Fetch historical price data for all holdings in user's portfolio(s).

    This is useful for:
    - Initial setup to populate historical data cache
    - Periodic refresh of all holdings data
    - Backfilling missing data
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to fetch historical data",
        )

    try:
        # Get user's holdings
        holding_repo = get_holding_repository(session)

        if portfolio_id:
            holdings = await holding_repo.get_holdings_by_portfolio(portfolio_id)
        else:
            holdings = await holding_repo.get_holdings_by_user(current_user.id)

        if not holdings:
            return ApiResponse.success_response(
                data={"message": "No holdings found"},
                message="No holdings to fetch data for",
            )

        # Extract symbols and markets
        symbols = []
        markets = {}
        for holding in holdings:
            symbol = holding.symbol.upper()
            if symbol not in symbols:
                symbols.append(symbol)
                markets[symbol] = holding.market

        # Fetch data for all symbols
        historical_service = get_historical_price_service(session)
        result = await historical_service.update_holdings_historical_data(
            symbols=symbols, markets=markets, days=days
        )

        return ApiResponse.success_response(
            data=result,
            message=f"Historical data fetch completed for {result['total_symbols']} symbols",
        )

    except Exception as e:
        logger.error(
            f"Failed to fetch historical prices for all holdings: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/historical-prices/{symbol}")
async def get_historical_prices(
    symbol: str = Path(..., description="Stock symbol"),
    start_date: Optional[date] = Query(
        default=None, description="Start date (YYYY-MM-DD)"
    ),
    end_date: Optional[date] = Query(default=None, description="End date (YYYY-MM-DD)"),
    days: Optional[int] = Query(
        default=None, ge=1, le=3650, description="Number of days (alternative to dates)"
    ),
    session: AsyncSession = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """
    Get historical price data for a symbol from the database cache.

    You can specify the date range in two ways:
    1. Using start_date and end_date
    2. Using days (will fetch last N days from today)

    Note: This endpoint works without authentication for demo/debug purposes.
    """
    # Allow anonymous access for debug purposes
    try:
        # Determine date range
        if days is not None:
            end_date = business_today()
            start_date = end_date - timedelta(days=days)
        elif start_date is None:
            # Default to last 365 days
            end_date = business_today()
            start_date = end_date - timedelta(days=365)
        elif end_date is None:
            end_date = business_today()

        historical_service = get_historical_price_service(session)
        prices = await historical_service.get_historical_prices_for_symbol(
            symbol=symbol.upper(), start_date=start_date, end_date=end_date
        )

        return ApiResponse.success_response(
            data={
                "symbol": symbol.upper(),
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "count": len(prices),
                "prices": prices,
            },
            message=f"Retrieved {len(prices)} historical prices for {symbol}",
        )

    except Exception as e:
        logger.error(
            f"Failed to get historical prices for {symbol}: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/historical-prices/{symbol}/sparkline")
async def get_sparkline_data(
    symbol: str = Path(..., description="Stock symbol"),
    days: int = Query(
        default=30, ge=7, le=90, description="Number of days for sparkline"
    ),
    session: AsyncSession = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """
    Get lightweight historical price data for sparkline charts.
    Returns only closing prices for the last N days (default 30).

    This endpoint is optimized for sparkline visualization and returns
    a simple array of prices instead of full price data.
    """
    try:
        end_date = business_today()
        start_date = end_date - timedelta(days=days)

        historical_service = get_historical_price_service(session)
        prices = await historical_service.get_historical_prices_for_symbol(
            symbol=symbol.upper(), start_date=start_date, end_date=end_date
        )

        # Extract only closing prices for sparkline
        sparkline_data = [float(p["close"]) for p in prices if p.get("close")]

        return ApiResponse.success_response(
            data={
                "symbol": symbol.upper(),
                "days": len(sparkline_data),
                "prices": sparkline_data,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            },
            message=f"Retrieved sparkline data for {symbol}",
        )

    except Exception as e:
        logger.error(
            f"Failed to get sparkline data for {symbol}: {str(e)}", exc_info=True
        )
        # Return empty array on error to allow graceful fallback
        return ApiResponse.success_response(
            data={
                "symbol": symbol.upper(),
                "days": 0,
                "prices": [],
                "start_date": (
                    start_date.isoformat() if "start_date" in locals() else None
                ),
                "end_date": end_date.isoformat() if "end_date" in locals() else None,
            },
            message=f"No historical data available for {symbol}",
        )


@router.get("/historical-prices/{symbol}/stats")
async def get_historical_price_stats(
    symbol: str = Path(..., description="Stock symbol"),
    session: AsyncSession = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """
    Get statistics about historical price data coverage for a symbol.

    Returns information about date range, number of data points, and coverage percentage.

    Note: This endpoint works without authentication for demo/debug purposes.
    """
    # Allow anonymous access for debug purposes
    try:
        from ..historical_price_repository import HistoricalPriceRepository

        repo = HistoricalPriceRepository(session)
        stats = await repo.get_data_coverage_stats(symbol.upper())

        return ApiResponse.success_response(
            data=stats, message=f"Coverage stats for {symbol}"
        )

    except Exception as e:
        logger.error(f"Failed to get stats for {symbol}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# ========================================
# BENCHMARK COMPARISON ENDPOINT
# ========================================

# Supported benchmarks: symbol → (yahoo_symbol, market)
