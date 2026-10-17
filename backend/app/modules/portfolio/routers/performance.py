"""Portfolio router: Performance, risk, and historical performance endpoints.

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


def _demo_performance() -> Dict[str, Any]:
    """The demo portfolio's performance, off the same walk /daily-performance
    serves. This was a NT$28,450 AAPL/GOOGL account with a hand-typed chart."""
    series = demo_value_series(35)
    last, prev = series[-1], series[-2]
    day_change = Decimal(str(round(last["value"] - prev["value"], 2)))
    return {
        "total_value": DEMO_PORTFOLIO["total_value"],
        "total_cost": DEMO_PORTFOLIO["total_cost"],
        "total_gain_loss": DEMO_PORTFOLIO["total_gain_loss"],
        "total_gain_loss_percentage": DEMO_PORTFOLIO["total_gain_loss_percentage"],
        "day_change": day_change,
        "day_change_percentage": (day_change / Decimal(str(prev["value"])) * 100).quantize(
            Decimal("0.01")
        ),
        # Weekly points, ending today.
        "chart_data": [
            {"date": p["date"].isoformat(), "value": Decimal(str(p["value"]))}
            for p in series[::-1][::5][::-1]
        ],
        "top_holdings": DEMO_HOLDINGS[:3],
    }


def _demo_twr() -> Dict[str, Any]:
    """TWR for the demo account: one buy on DEMO_SERIES_START and no cash flow
    since, so TWR is simply value over cost. This stated NT$100,000 invested
    beside a NT$1.925M cost basis on the next card over."""
    end = business_today()
    invested = float(DEMO_PORTFOLIO["total_cost"])
    current = float(DEMO_PORTFOLIO["total_value"])
    total_days = max((end - DEMO_SERIES_START).days, 1)
    total_return = (current / invested - 1) * 100
    annualized = ((current / invested) ** (365 / total_days) - 1) * 100
    return {
        "twr": round(total_return, 2),
        "annualized_return": round(annualized, 2),
        "total_return_percentage": round(total_return, 2),
        "annualized_return_percentage": round(annualized, 2),
        "total_invested": invested,
        "current_value": current,
        "total_gain_loss": current - invested,
        "total_days": total_days,
        "start_date": DEMO_SERIES_START.isoformat(),
        "end_date": end.isoformat(),
        "holdings_analyzed": len(DEMO_HOLDINGS),
        "message": "DEMO: Sample time-weighted return data",
    }


@router.get("/performance", response_model=Dict[str, Any])
async def get_performance(
    current_user=Depends(get_optional_current_user),
    period: str = Query("1m", description="Performance period (1d, 1w, 1m, 3m, 1y)"),
    session: AsyncSession = Depends(get_db),
):
    """Get portfolio performance metrics"""

    if not current_user:
        return _demo_performance()

    try:
        portfolio_service = get_portfolio_service(session)
        performance = await portfolio_service.get_portfolio_performance(
            user_id=current_user.id, period=period
        )
        return performance

    except Exception as e:
        # Never the demo account's figures: a signed-in user would read a believable
        # NT$2M portfolio they do not have. Fail like the other endpoints here.
        logger.error(f"Failed to compute portfolio performance: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to compute portfolio performance")


@router.get("/risk-metrics", response_model=Dict[str, Any])
async def get_risk_metrics(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get Phase 1 portfolio risk and performance metrics:
    CAGR, max drawdown, annualized volatility, Sharpe ratio, and HHI concentration.
    """

    def _hhi_label(hhi: Optional[float]) -> str:
        if hhi is None:
            return "Unknown"
        if hhi < 1000:
            return "Competitive"
        if hhi <= 2500:
            return "Moderate"
        return "Concentrated"

    if not current_user:
        return {
            "success": True,
            "data": {
                "cagr": 0.112,
                "cagr_percentage": 11.2,
                "max_drawdown": -0.087,
                "max_drawdown_percentage": -8.7,
                "annualized_volatility": 0.143,
                "annualized_volatility_percentage": 14.3,
                "sharpe_ratio": 0.85,
                "hhi": 1850.0,
                "hhi_label": "Moderate",
                "beta": 0.94,
                "alpha": 0.023,
                "alpha_percentage": 2.3,
                "benchmark_symbol": "SPY",
                "risk_free_rate": 0.04,
                "data_days": 252,
                "has_historical_data": True,
                "message": "DEMO: Sample risk metrics",
            },
        }

    try:
        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)
        if not portfolio:
            return {
                "success": True,
                "data": {
                    "cagr": None,
                    "cagr_percentage": None,
                    "max_drawdown": None,
                    "max_drawdown_percentage": None,
                    "annualized_volatility": None,
                    "annualized_volatility_percentage": None,
                    "sharpe_ratio": None,
                    "hhi": None,
                    "hhi_label": "Unknown",
                    "risk_free_rate": 0.04,
                    "data_days": 0,
                    "has_historical_data": False,
                },
            }

        portfolio_id = portfolio.id

        analytics = AnalyticsService(session)
        perf = await analytics.calculate_portfolio_performance(
            portfolio_id, current_user.id
        )

        # Compute HHI from current holdings weights
        holding_repo = HoldingRepository(session)
        holdings, _ = await holding_repo.get_portfolio_holdings(
            portfolio_id, current_user.id, limit=100
        )

        hhi: Optional[float] = None
        if holdings:
            total_val = sum(float(h.total_value or 0) for h in holdings)
            if total_val > 0:
                weights = [float(h.total_value or 0) / total_val for h in holdings]
                hhi = _mc.compute_hhi(weights)

        cagr_raw = float(perf.annualized_return) / 100 if perf.annualized_return is not None else None
        vol_raw = float(perf.volatility) / 100 if perf.volatility is not None else None
        dd_raw = float(perf.max_drawdown) / 100 if perf.max_drawdown is not None else None

        data_days = 0
        has_historical = False
        if vol_raw is not None or dd_raw is not None:
            has_historical = True
            data_days = int(perf.up_days) + int(perf.down_days)

        alpha_raw = perf.alpha
        alpha_pct = safe_float(alpha_raw * 100) if alpha_raw is not None else None

        return {
            "success": True,
            "data": {
                "cagr": safe_float(cagr_raw),
                "cagr_percentage": safe_float(cagr_raw * 100) if cagr_raw is not None else None,
                "max_drawdown": safe_float(dd_raw),
                "max_drawdown_percentage": safe_float(dd_raw * 100) if dd_raw is not None else None,
                "annualized_volatility": safe_float(vol_raw),
                "annualized_volatility_percentage": safe_float(vol_raw * 100) if vol_raw is not None else None,
                "sharpe_ratio": safe_float(float(perf.sharpe_ratio)) if perf.sharpe_ratio is not None else None,
                "hhi": safe_float(hhi),
                "hhi_label": _hhi_label(hhi),
                "beta": safe_float(perf.beta),
                "alpha": safe_float(alpha_raw),
                "alpha_percentage": alpha_pct,
                "benchmark_symbol": perf.benchmark or "SPY",
                "risk_free_rate": 0.04,
                "data_days": data_days,
                "has_historical_data": has_historical,
            },
        }

    except Exception as e:
        logger.error(f"Error computing risk metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to compute risk metrics")


@router.get("/performance/time-weighted-return")
async def get_time_weighted_return(
    start_date: Optional[date] = Query(
        None, description="Start date for calculation (defaults to earliest purchase)"
    ),
    end_date: Optional[date] = Query(
        None, description="End date for calculation (defaults to today)"
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Calculate time-weighted return (TWR) for the portfolio.

    TWR eliminates the effects of cash flows and provides a better measure
    of investment performance over time, ideal for long-term investors.
    """
    if not current_user:
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": _demo_twr(),
            },
        )

    try:
        from ..performance_tracker import PerformanceTracker

        tracker = PerformanceTracker(session)

        # Get user's default portfolio
        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        if not portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found"
            )

        # Calculate TWR
        twr_data = await tracker.calculate_time_weighted_return(
            portfolio_id=portfolio.id,
            user_id=current_user.id,
            start_date=start_date,
            end_date=end_date,
        )

        return ApiResponse.success_response(
            data=twr_data, message="Time-weighted return calculated successfully"
        )

    except Exception as e:
        logger.error(
            f"Failed to calculate time-weighted return: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/performance/historical")
async def get_historical_performance(
    interval: str = Query(
        "monthly", description="Data interval: daily, weekly, monthly, yearly"
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get historical performance data points for charting.

    Returns a time series of portfolio values and returns based on purchase dates.
    """
    if not current_user:
        # Demo data: twelve monthly points off the demo value walk, against the
        # demo cost basis. This was a NT$100,000 account growing to 112,100.
        cost = float(DEMO_PORTFOLIO["total_cost"])
        series = demo_value_series(366)
        monthly = series[::-1][::21][:12][::-1]  # ~21 weekdays a month, ending today
        demo_data = [
            {
                "date": p["date"].isoformat(),
                "value": p["value"],
                "cost": cost,
                "gain_loss": round(p["value"] - cost, 2),
                "gain_loss_percentage": round((p["value"] - cost) / cost * 100, 2),
            }
            for p in monthly
        ]

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": demo_data,
                "message": "DEMO: Sample historical performance data",
            },
        )

    try:
        from ..performance_tracker import PerformanceTracker

        tracker = PerformanceTracker(session)

        # Get user's default portfolio
        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        if not portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found"
            )

        # Get historical data
        historical_data = await tracker.get_historical_performance(
            portfolio_id=portfolio.id, user_id=current_user.id, interval=interval
        )

        return ApiResponse.success_response(
            data=historical_data,
            message=f"Historical performance data retrieved ({interval} interval)",
        )

    except Exception as e:
        logger.error(f"Failed to get historical performance: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/performance/holding-periods")
async def get_holding_periods(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Analyze holding periods and categorize investments by time horizon.

    Categorizes holdings into:
    - Short-term: < 1 year
    - Medium-term: 1-3 years
    - Long-term: > 3 years
    """
    if not current_user:
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": {
                    "average_holding_period_days": 730,
                    "average_holding_period_years": 2.0,
                    "total_holdings": 10,
                    "short_term_count": 3,
                    "medium_term_count": 5,
                    "long_term_count": 2,
                    "categorization": {
                        "short_term_pct": 30.0,
                        "medium_term_pct": 50.0,
                        "long_term_pct": 20.0,
                    },
                    "message": "DEMO: Sample holding periods data",
                },
            },
        )

    try:
        from ..performance_tracker import PerformanceTracker

        tracker = PerformanceTracker(session)

        # Get user's default portfolio
        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        if not portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found"
            )

        # Calculate holding periods
        periods_data = await tracker.calculate_holding_periods(
            portfolio_id=portfolio.id, user_id=current_user.id
        )

        return ApiResponse.success_response(
            data=periods_data, message="Holding periods analyzed successfully"
        )

    except Exception as e:
        logger.error(f"Failed to analyze holding periods: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# Historical Price Data Endpoints


