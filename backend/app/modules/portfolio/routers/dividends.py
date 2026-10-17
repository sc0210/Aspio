"""Portfolio router: Dividend endpoints.

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


# How often each demo holding pays, and how many days ago each of its last
# year's payments landed: 0050 semi-annually, VT quarterly.
_DEMO_DIVIDEND_SCHEDULE = {
    "0050": [96, 278],
    "VT": [8, 99, 190, 281],
}


def demo_dividend_payload(period: str = "1y") -> Dict[str, Any]:
    """The demo account's dividend income, in the shape get_dividend_data
    returns, derived from DEMO_HOLDINGS.

    This was a USD stub — projected_annual 175.50 from AAPL and MSFT, neither of
    them held — which the dashboard printed as "Annual Income NT$176" beside a
    NT$2M portfolio. Projected income is per-share dividend x quantity, exactly
    as the authenticated calculation does it, and the last twelve months of
    payments add up to it.
    """
    period_days = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "all": 3650}.get(period, 365)
    today = business_today()

    projected = sum(
        float(h["annual_dividend"]) * float(h["quantity"]) for h in DEMO_HOLDINGS
    )
    total_cost = float(DEMO_PORTFOLIO["total_cost"])
    total_value = float(DEMO_PORTFOLIO["total_value"])

    payments = []
    for h in DEMO_HOLDINGS:
        schedule = _DEMO_DIVIDEND_SCHEDULE.get(h["symbol"], [])
        if not schedule:
            continue
        per_share = float(h["annual_dividend"]) / len(schedule)
        shares = float(h["quantity"])
        for days_ago in schedule:
            if days_ago > period_days:
                continue
            payments.append(
                {
                    "date": (today - timedelta(days=days_ago)).isoformat(),
                    "symbol": h["symbol"],
                    "amount": round(per_share * shares, 2),
                    "currency": h["currency"],
                    "shares": shares,
                    "per_share": round(per_share, 4),
                }
            )
    payments.sort(key=lambda p: p["date"], reverse=True)
    received = round(sum(p["amount"] for p in payments), 2)
    yield_on_value = round(projected / total_value * 100, 4) if total_value else None

    return {
        "total_dividends": received or None,
        "dividend_yield": yield_on_value,
        "projected_annual": round(projected, 2),
        "yield_on_cost": round(projected / total_cost * 100, 4) if total_cost else None,
        "yield_on_value": yield_on_value,
        # Not in the authenticated payload, which leaves the reader to assume
        # TWD; stated here so the demo cannot be read as anything else.
        "currency": DEMO_PORTFOLIO["currency"],
        "payments": payments,
    }


@router.get("/dividends", operation_id="get_dividends_demo", include_in_schema=False)
async def get_dividends_demo(
    period: str = Query("1y", description="Period for dividend data"),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get dividend income data (legacy demo stub)"""

    if not current_user:
        return ApiResponse.success_response(data=demo_dividend_payload(period))

    try:
        portfolio_service = get_portfolio_service(session)
        dividends = await portfolio_service.get_dividend_data(
            user_id=current_user.id, period=period
        )
        return ApiResponse.success_response(data=dividends)

    except Exception:
        # A failure is an error, not an answer. The demo account's figures read as
        # NT$56,500 a year the user does not have, and the nulls that replaced them
        # read as "no dividends" to every caller. The frontend hides the figure on
        # an error either way (getDividendIncome returns null).
        logger.exception("Failed to compute dividend data")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to compute dividend data",
        )


@router.post(
    "/dividends",
    response_model=ApiResponse[DividendResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_dividend(
    dividend: DividendCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Create a new dividend record"""
    from ..models import Dividend, PortfolioHolding
    from sqlalchemy import select

    try:
        # Verify holding exists if holding_id provided
        if dividend.holding_id:
            stmt = select(PortfolioHolding).where(
                PortfolioHolding.id == dividend.holding_id,
                PortfolioHolding.user_id == current_user.id,
            )
            result = await session.execute(stmt)
            holding = result.scalar_one_or_none()

            if not holding:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Holding not found"
                )

        # Calculate net amount
        net_amount = dividend.net_amount or (
            dividend.total_amount - dividend.tax_withheld
        )

        # Create dividend
        new_dividend = Dividend(
            user_id=current_user.id,
            holding_id=dividend.holding_id,
            symbol=dividend.symbol,
            name=dividend.name,
            payment_date=dividend.payment_date,
            ex_dividend_date=dividend.ex_dividend_date,
            record_date=dividend.record_date,
            amount_per_share=dividend.amount_per_share,
            shares_owned=dividend.shares_owned,
            total_amount=dividend.total_amount,
            currency=dividend.currency,
            tax_withheld=dividend.tax_withheld,
            net_amount=net_amount,
            status=dividend.status,
            notes=dividend.notes,
        )

        session.add(new_dividend)
        await session.commit()
        await session.refresh(new_dividend)

        return ApiResponse.success_response(
            data=DividendResponse.model_validate(new_dividend),
            message="Dividend created successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        await session.rollback()
        logger.error(f"Failed to create dividend: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An internal error occurred"
        )


@router.get("/dividends", response_model=ApiResponse[List[DividendResponse]])
async def get_dividends(
    symbol: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = None,
    session: AsyncSession = Depends(get_db),
):
    """Get dividend history"""
    from ..models import Dividend
    from sqlalchemy import select, and_

    try:
        conditions = [Dividend.user_id == current_user.id]
        if symbol:
            conditions.append(Dividend.symbol == symbol)
        if start_date:
            conditions.append(Dividend.payment_date >= start_date)
        if end_date:
            conditions.append(Dividend.payment_date <= end_date)

        stmt = (
            select(Dividend)
            .where(and_(*conditions))
            .order_by(Dividend.payment_date.desc())
            .limit(100)
        )
        result = await session.execute(stmt)
        dividends = result.scalars().all()

        return ApiResponse.success_response(
            data=[DividendResponse.model_validate(d) for d in dividends]
        )
    except Exception as e:
        logger.error(f"Failed to fetch dividends: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An internal error occurred"
        )


@router.delete("/dividends/{dividend_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dividend(
    dividend_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Delete a dividend record"""
    from ..models import Dividend
    from sqlalchemy import select

    try:
        stmt = select(Dividend).where(
            Dividend.id == dividend_id, Dividend.user_id == current_user.id
        )
        result = await session.execute(stmt)
        dividend = result.scalar_one_or_none()

        if not dividend:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dividend not found"
            )

        await session.delete(dividend)
        await session.commit()
        return None
    except HTTPException:
        raise
    except Exception as e:
        await session.rollback()
        logger.error(f"Failed to delete dividend: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An internal error occurred"
        )
