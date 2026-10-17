"""
Reports API router: the read endpoints behind /review.

Spending (this month and last), monthly trends (the year around it) and goals.
The /reports page, and with it the portfolio, comprehensive and CSV-export
endpoints only it called, was retired on 2026-09-17.
"""

from datetime import date, datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.users.dependencies import get_current_active_user
from app.modules.users.models import User
from app.core.logger import get_logger

from .schemas import (
    SpendingReport,
    MonthlyTrend,
    GoalsReport,
)
from .services import ReportsService
from app.utils.datetime_helpers import business_today

logger = get_logger(__name__)

router = APIRouter()


def _parse_date_param(date_str: Optional[str], default: date) -> date:
    """Parse date parameter from string"""
    if not date_str:
        return default

    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
    except (ValueError, AttributeError):
        try:
            return datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return default


@router.get("/spending", response_model=SpendingReport)
async def get_spending_report(
    date_from: Optional[str] = Query(
        None,
        description="Start date for report (ISO format or YYYY-MM-DD)",
    ),
    date_to: Optional[str] = Query(
        None,
        description="End date for report (ISO format or YYYY-MM-DD)",
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get spending analysis report for date range.

    Returns comprehensive spending breakdown including:
    - Total income and expenses
    - Net savings and savings rate
    - Category breakdown with percentages
    - Monthly spending trends
    - Top merchants
    - Insights and recommendations
    """
    logger.info(
        f"Generating spending report for user {current_user.id} "
        f"from {date_from} to {date_to}"
    )

    # Default to last 30 days if not specified
    default_to = business_today()
    default_from = default_to - timedelta(days=30)

    date_from_parsed = _parse_date_param(date_from, default_from)
    date_to_parsed = _parse_date_param(date_to, default_to)

    # Validate date range
    if date_from_parsed > date_to_parsed:
        raise HTTPException(
            status_code=400, detail="date_from must be before or equal to date_to"
        )

    service = ReportsService(db)
    report = await service.get_spending_report(
        str(current_user.id), date_from_parsed, date_to_parsed
    )

    logger.info(
        f"Spending report generated: income=${report.total_income:.2f}, "
        f"expenses=${report.total_expenses:.2f}, savings_rate={report.savings_rate:.1f}%"
    )

    return report


@router.get("/monthly-trends", response_model=List[MonthlyTrend])
async def get_monthly_trends(
    date_from: Optional[str] = Query(
        None, description="Start date (ISO format or YYYY-MM-DD)"
    ),
    date_to: Optional[str] = Query(
        None, description="End date (ISO format or YYYY-MM-DD)"
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Month-by-month income, expenses and net over a date range.

    The same figures `/spending` embeds as `monthlyTrends`, on their own. That
    endpoint eager-loads every transaction in the window and builds a category
    breakdown, top merchants and a previous-period comparison beside them —
    work worth doing for a month, and worth avoiding for the year the month
    review asks for purely to place one month among its neighbours.
    """
    default_to = business_today()
    default_from = default_to - timedelta(days=365)

    date_from_parsed = _parse_date_param(date_from, default_from)
    date_to_parsed = _parse_date_param(date_to, default_to)

    if date_from_parsed > date_to_parsed:
        raise HTTPException(
            status_code=400, detail="date_from must be before or equal to date_to"
        )

    service = ReportsService(db)
    return await service.get_monthly_trends(
        str(current_user.id), date_from_parsed, date_to_parsed
    )


@router.get("/goals", response_model=GoalsReport)
async def get_goals_report(
    date_from: Optional[str] = Query(
        None,
        description="Start date for report (ISO format or YYYY-MM-DD)",
    ),
    date_to: Optional[str] = Query(
        None,
        description="End date for report (ISO format or YYYY-MM-DD)",
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get goals tracking report.

    Returns comprehensive goals analysis including:
    - Total, active, and completed goals
    - Overall progress percentage
    - Individual goal progress with on-track status
    - Category summary
    - Monthly contribution requirements
    - Insights and recommendations
    """
    logger.info(
        f"Generating goals report for user {current_user.id} "
        f"from {date_from} to {date_to}"
    )

    # Default to last 30 days if not specified
    default_to = business_today()
    default_from = default_to - timedelta(days=30)

    date_from_parsed = _parse_date_param(date_from, default_from)
    date_to_parsed = _parse_date_param(date_to, default_to)

    # Validate date range
    if date_from_parsed > date_to_parsed:
        raise HTTPException(
            status_code=400, detail="date_from must be before or equal to date_to"
        )

    service = ReportsService(db)
    report = await service.get_goals_report(
        str(current_user.id), date_from_parsed, date_to_parsed
    )

    logger.info(
        f"Goals report generated: {report.total_goals} total goals, "
        f"{report.active_goals} active, {report.overall_progress:.1f}% progress"
    )

    return report
