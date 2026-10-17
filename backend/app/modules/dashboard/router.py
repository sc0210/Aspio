"""
Simple FastAPI router for dashboard endpoints - works without database
Provides basic REST API for dashboard data to test API integration.
"""

import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List
from fastapi import APIRouter, Query, status, Depends, Request, HTTPException
from fastapi.responses import JSONResponse
from app.modules.users.dependencies import (
    get_current_active_user as get_current_user,
    get_optional_current_user as get_real_optional_user,
)
from app.modules.users.models import User
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.logger import get_logger
from app.utils.date_utils import DateRangeCalculator

from app.common import demo_fixtures
from app.utils.datetime_helpers import business_today

logger = get_logger(__name__)

# The demo account's figures live in one module both this and the portfolio
# module read; re-exported here because callers and tests import them from the
# router. See app/common/demo_fixtures.py for why.
DEMO_MORTGAGE_BALANCE = demo_fixtures.DEMO_MORTGAGE_BALANCE
DEMO_CARD_BALANCE = demo_fixtures.DEMO_CARD_BALANCE
DEMO_TOTAL_DEBT = demo_fixtures.DEMO_TOTAL_DEBT
DEMO_MORTGAGE_SHARE = demo_fixtures.DEMO_MORTGAGE_SHARE

# Mock dashboard data for demo mode only
def build_stats_payload(
    *,
    life_wallet: float,
    portfolio_wallet: float,
    emergency_wallet: float,
    total_debt: float,
    total_income: float,
    total_expenses: float,
    portfolio_value: float,
    emergency_fund_months: float,
    portfolio_change: float = 0.0,
    upcoming_bills: int = 0,
    investment_return: float = 0.0,
    credit_utilization: float = 0.0,
) -> dict:
    """The shape of GET /dashboard/stats, built in one place.

    Both branches of that endpoint return this. They used to assemble their own
    dicts, and the demo one drifted: it answered with netWorth 23,400 beside a
    NT$2.5M balance sheet and portfolioValue 28,450.75 — the figure the fixture
    reconciliation removed everywhere else — because nothing tied the two
    branches together. Naming each field once is what ties them.

    The three wallets and the totals are snake_case; the cash-flow fields are
    camelCase because that is what the authenticated branch has always emitted
    and what clients read.

    `portfolio_value` and `emergency_fund_months` are passed in rather than
    worked out here, because neither is a view of the wallets. portfolio_value
    is the legacy sum of the portfolio AND emergency wallets
    (`services.py::get_dashboard_stats`), and coverage has to divide by a
    MONTHLY spending rate — `_calc_emergency_fund_months` measures the window
    to get one, which is why the same fund no longer reads six times shorter on
    6M than on 30D. Deriving either from what is in scope here silently
    undoes that.
    """
    total_asset = life_wallet + portfolio_wallet + emergency_wallet
    net_saved = total_income - total_expenses

    return {
        # Three-wallet system
        "life_wallet": life_wallet,
        "portfolio_wallet": portfolio_wallet,
        "emergency_wallet": emergency_wallet,
        "total_asset": total_asset,
        "total_debt": total_debt,
        "investment_total": portfolio_wallet,
        # Legacy field names, kept because clients read them
        "totalBalance": life_wallet,
        "totalIncome": total_income,
        "totalExpenses": total_expenses,
        "netWorth": total_asset - total_debt,
        "savingsRate": demo_fixtures.demo_savings_rate(total_income, total_expenses),
        "portfolioValue": portfolio_value,
        "portfolioChange": portfolio_change,
        "monthlyChange": net_saved,
        "upcomingBills": upcoming_bills,
        "investmentReturn": investment_return,
        "creditUtilization": credit_utilization,
        "emergencyFundMonths": emergency_fund_months,
    }


# Roughly how much of a month each period covers. `.get(period, 1.0)` so an
# unrecognised period answers with a month rather than with nothing.
_DEMO_PERIOD_MULTIPLIERS = {
    "7d": 0.25,
    "14d": 0.5,
    "month": 1.0,
    "30d": 1.0,
    "90d": 3.0,
    "6m": 6.0,
    "ytd": 8.0,
    "1y": 12.0,
}


def demo_stats(multiplier: float = 1.0) -> dict:
    """The demo account over a window.

    Balances are point-in-time and do not move with it; the cash flow through it
    does, and so does everything derived from the cash flow. Scaling used to
    multiply the two totals in place and leave savingsRate and monthlyChange
    behind, so a 90-day request answered with three months of spending beside a
    one-month net figure.
    """
    return build_stats_payload(
        life_wallet=demo_fixtures.DEMO_LIFE_WALLET,
        portfolio_wallet=demo_fixtures.DEMO_PORTFOLIO_WALLET,
        emergency_wallet=demo_fixtures.DEMO_EMERGENCY_WALLET,
        # Matches demoLoans in frontend/src/data/demoData.ts — a 1.2M mortgage
        # balance plus a 45K card instalment. Without it the same demo account
        # owed NT$3.85M on the loans page and nothing on the dashboard, and the
        # whole debt half of the dashboard never rendered.
        total_debt=DEMO_TOTAL_DEBT,
        total_income=demo_fixtures.DEMO_MONTHLY_INCOME * multiplier,
        total_expenses=demo_fixtures.DEMO_MONTHLY_EXPENSES * multiplier,
        portfolio_value=demo_fixtures.DEMO_PORTFOLIO_VALUE_LEGACY,
        emergency_fund_months=demo_fixtures.DEMO_EMERGENCY_FUND_MONTHS,
        portfolio_change=2850.25,
        upcoming_bills=2,
        investment_return=demo_fixtures.DEMO_INVESTMENT_RETURN,
        credit_utilization=23.0,
    )


DEMO_DASHBOARD_STATS = demo_stats()

MOCK_RECENT_ACTIVITIES = [
    {
        "id": "activity_001",
        "type": "transaction",
        "title": "Grocery Shopping",
        "amount": -85.50,
        "change": None,
        "progress": None,
        "time": "2 hours ago",
        "category": "Food & Dining",
        "description": "Weekly grocery shopping at SuperMart",
    },
    {
        "id": "activity_002",
        "type": "goal_progress",
        "title": "Emergency Fund",
        "amount": None,
        "change": None,
        "progress": 68,
        "time": "1 day ago",
        "category": "Savings",
        "description": "Added $500 to emergency fund",
    },
    {
        "id": "activity_003",
        "type": "investment",
        "title": "AAPL Stock",
        "amount": 2850.00,
        "change": 2.3,
        "progress": None,
        "time": "2 days ago",
        "category": "Technology",
        "description": "Portfolio value increased",
    },
    {
        "id": "activity_004",
        "type": "achievement",
        "title": "Savings Streak",
        "amount": None,
        "change": None,
        "progress": None,
        "time": "3 days ago",
        "category": "Gamification",
        "description": "Completed 30-day savings streak!",
    },
]

# One demo month of spending and income by category, in NT$. Each list sums to
# the month /dashboard/stats reports (DEMO_MONTHLY_EXPENSES / _INCOME), so the
# Cash Flow card's total and its top-category rows describe one month.
#
# These were dollar figures (Salary 4,200 against the fixture's NT$63,000 salary)
# served with currency "USD" and printed as NT$ by a TWD dashboard.
MOCK_SPENDING_CATEGORIES = [
    {"name": "Food & Dining", "amount": 12_000.0, "color": "#FF6B6B"},
    {"name": "Other", "amount": 5_600.0, "color": "#54A0FF"},
    {"name": "Shopping", "amount": 4_500.0, "color": "#45B7D1"},
    {"name": "Transportation", "amount": 3_200.0, "color": "#4ECDC4"},
    {"name": "Entertainment", "amount": 2_800.0, "color": "#96CEB4"},
    {"name": "Utilities", "amount": 2_600.0, "color": "#FECA57"},
    {"name": "Healthcare", "amount": 1_500.0, "color": "#FF9FF3"},
]

MOCK_INCOME_CATEGORIES = [
    # The salary the frontend fixture's demo profile states (monthly_income).
    {"name": "Salary", "amount": 63_000.0, "color": "#10B981"},
    {"name": "Side Income", "amount": 8_000.0, "color": "#6EE7B7"},
    # ~1/12 of the demo portfolio's NT$56,500 projected annual dividends.
    {"name": "Dividends", "amount": 4_700.0, "color": "#34D399"},
    {"name": "Interest", "amount": 1_300.0, "color": "#A7F3D0"},
    {"name": "Other", "amount": 1_000.0, "color": "#D1FAE5"},
]


def demo_category_breakdown(mock: list, period: str) -> list:
    """A demo category list scaled to ``period`` the way /stats scales its
    totals, in TWD, with percentages of the scaled total.

    Builds new dicts: the spending branch used to `.copy()` the list and then
    scale the shared dicts inside it, so every demo request multiplied the
    module-level amounts again.
    """
    multiplier = _DEMO_PERIOD_MULTIPLIERS.get(period, 1.0)
    categories = [
        {**c, "amount": round(c["amount"] * multiplier, 2), "currency": "TWD"}
        for c in mock
    ]
    total = sum(c["amount"] for c in categories)
    for c in categories:
        c["percentage"] = round(c["amount"] / total * 100, 2) if total > 0 else 0
    return categories


MOCK_GOALS_OVERVIEW = [
    {
        "id": "goal_001",
        "title": "Emergency Fund",
        "current": 6800.00,
        "target": 10000.00,
        "progress": 68,
        "color": "#FF6B6B",
    },
    {
        "id": "goal_002",
        "title": "Vacation Fund",
        "current": 1250.00,
        "target": 3000.00,
        "progress": 42,
        "color": "#4ECDC4",
    },
    {
        "id": "goal_003",
        "title": "House Down Payment",
        "current": 15000.00,
        "target": 50000.00,
        "progress": 30,
        "color": "#45B7D1",
    },
]

MOCK_UPCOMING_EVENTS = [
    {
        "id": "event_001",
        "type": "goal_deadline",
        "title": "Vacation Fund Goal",
        "description": "Target completion for summer vacation",
        "date": "2025-06-15",
        "priority": "medium",
        "amount": 1750.00,
        "daysUntil": 126,
    },
    {
        "id": "event_002",
        "type": "bill_reminder",
        "title": "Credit Card Payment",
        "description": "Monthly credit card payment due",
        "date": "2025-01-25",
        "priority": "high",
        "amount": 850.50,
        "daysUntil": 14,
    },
    {
        "id": "event_003",
        "type": "investment_review",
        "title": "Portfolio Rebalancing",
        "description": "Quarterly portfolio review and rebalancing",
        "date": "2025-03-31",
        "priority": "low",
        "amount": None,
        "daysUntil": 79,
    },
]

router = APIRouter(tags=["dashboard"])

@router.get("/stats", status_code=status.HTTP_200_OK)
async def get_dashboard_stats(
    request: Request,
    period: str = Query(
        "month",
        description="Time period for stats (month=this month, 30d=last 30 days)",
    ),
    current_user: Optional[User] = Depends(get_real_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get dashboard statistics for the specified period.

    Period options:
    - 'month': Current calendar month (THIS MONTH)
    - '30d': Last 30 days (rolling window)
    - '7d': Last 7 days
    - '90d': Last 90 days
    - '1y': Last year
    """

    logger.debug(
        f"Dashboard stats: user={'authenticated' if current_user else 'demo'}"
    )

    if current_user:
        # Authenticated user - fetch real data from database using DashboardService
        logger.info(
            f"🔑 Dashboard stats requested by authenticated user: {current_user.email}, user_id: {current_user.id}"
        )

        from app.modules.dashboard.services import DashboardService
        from app.modules.dashboard.schemas import PeriodEnum

        # Map period string to enum
        period_map = {
            "7d": PeriodEnum.SEVEN_DAYS,
            "14d": PeriodEnum.FOURTEEN_DAYS,
            "month": PeriodEnum.MONTH,
            "30d": PeriodEnum.THIRTY_DAYS,
            "90d": PeriodEnum.NINETY_DAYS,
            "6m": PeriodEnum.SIX_MONTHS,
            "1y": PeriodEnum.ONE_YEAR,
            "ytd": PeriodEnum.YEAR_TO_DATE,
        }
        period_enum = period_map.get(period, PeriodEnum.MONTH)

        try:
            # Use DashboardService to get real stats
            dashboard_service = DashboardService(db)
            stats_response = await dashboard_service.get_dashboard_stats(
                user_id=str(current_user.id),
                period=period_enum,
                force_refresh=False,
            )

            # Convert Pydantic model to dict and format for response
            # Use model_dump() instead of accessing attributes to avoid recursion
            stats = build_stats_payload(
                life_wallet=float(stats_response.life_wallet or 0),
                portfolio_wallet=float(stats_response.portfolio_wallet or 0),
                emergency_wallet=float(stats_response.emergency_wallet or 0),
                total_debt=float(stats_response.total_debt or 0),
                total_income=float(stats_response.total_income or 0),
                total_expenses=float(stats_response.total_expenses or 0),
                portfolio_value=float(stats_response.portfolio_value or 0),
                emergency_fund_months=float(stats_response.emergency_fund_months or 0),
                portfolio_change=float(stats_response.portfolio_change or 0),
                upcoming_bills=int(stats_response.upcoming_bills or 0),
                investment_return=float(stats_response.investment_return or 0),
                credit_utilization=float(stats_response.credit_utilization or 0),
            )

            logger.info(
                f"✅ Real dashboard stats fetched for user {current_user.email}: Income=${stats['totalIncome']}, Expenses=${stats['totalExpenses']}"
            )

            # Debug: Log the actual wallet values being sent to frontend
            logger.info(
                f"Sending to frontend - Wallets: Life={stats['life_wallet']}, "
                f"Portfolio={stats['portfolio_wallet']}, "
                f"Emergency={stats['emergency_wallet']}, Total Asset={stats['total_asset']}"
            )

        except HTTPException:
            raise
        except Exception:
            # Surface the failure instead of rendering all-zero balances;
            # the frontend retries 5xx once and has dashboard/error.tsx.
            logger.exception(
                f"❌ Error fetching real dashboard stats for user {current_user.email}"
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch dashboard statistics",
            )
    else:
        # Demo mode - return mock data
        logger.info("Dashboard stats requested in demo mode")
        stats = demo_stats(_DEMO_PERIOD_MULTIPLIERS.get(period, 1.0))

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "data": {
                **stats,
                "period": period,
                "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
            },
        },
    )

@router.get("/recent-activity", status_code=status.HTTP_200_OK)
async def get_recent_activity(
    request: Request,
    limit: int = Query(10, ge=1, le=50, description="Number of recent activities"),
    current_user: Optional[User] = Depends(get_real_optional_user),
):
    """Get recent dashboard activities"""

    if current_user:
        # Authenticated user - return empty activities
        logger.info(
            f"Recent activities requested by authenticated user: {current_user.email}"
        )
        activities = []
    else:
        # Demo mode - return mock activities
        logger.info("Recent activities requested in demo mode")
        activities = MOCK_RECENT_ACTIVITIES[:limit]

    return JSONResponse(status_code=200, content={"success": True, "data": activities})

@router.get("/overview", status_code=status.HTTP_200_OK)
async def get_dashboard_overview():
    """Get complete dashboard overview"""

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "data": {
                "stats": DEMO_DASHBOARD_STATS,
                "recentActivities": MOCK_RECENT_ACTIVITIES[:5],
                "spendingCategories": demo_category_breakdown(
                    MOCK_SPENDING_CATEGORIES, "month"
                ),
                "goalsOverview": MOCK_GOALS_OVERVIEW,
                "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
            },
        },
    )

@router.get("/upcoming-events", status_code=status.HTTP_200_OK)
async def get_upcoming_events(
    days_ahead: int = Query(30, ge=1, le=365, description="Look ahead days"),
):
    """Get upcoming events and reminders"""

    # Filter events within the specified timeframe
    filtered_events = [
        event for event in MOCK_UPCOMING_EVENTS if event["daysUntil"] <= days_ahead
    ]

    return JSONResponse(
        status_code=200, content={"success": True, "data": filtered_events}
    )

@router.get("/monthly-trend", status_code=status.HTTP_200_OK)
async def get_monthly_trend(
    months: int = Query(6, ge=1, le=24, description="Number of months"),
):
    """Get monthly spending/income trend data"""

    # Generate mock trend data
    trends = []
    base_date = business_today().replace(day=1)

    for i in range(months):
        month_date = base_date - timedelta(days=30 * i)
        trends.append(
            {
                "date": month_date.strftime("%Y-%m"),
                "income": 4200 + (i * 50) + ((i % 2) * 200),
                "expenses": 2850 + (i * 30) + ((i % 3) * 150),
                "netSavings": 1350 + (i * 20) + ((i % 2) * 50),
                "month": month_date.strftime("%B %Y"),
            }
        )

    trends.reverse()  # Chronological order

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "data": {"trends": trends, "period": f"{months} months"},
        },
    )

@router.get("/spending-by-category", status_code=status.HTTP_200_OK)
async def get_spending_by_category(
    request: Request,
    period: str = Query(
        "30d", description="Time period for analysis (7d, 30d, 90d, 6m, 1y)"
    ),
    force_refresh: bool = Query(False, description="Force refresh from database"),
    current_user: Optional[User] = Depends(get_real_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get spending breakdown by category with high performance.

    This enhanced endpoint provides:
    - Real database queries for authenticated users
    - Redis caching for sub-500ms response times
    - Demo data for unauthenticated users
    - Support for multiple time periods
    - Consistent category colors for UI
    """

    start_time = datetime.now(timezone.utc)

    try:
        if current_user:
            logger.info(
                f"📊 Authenticated user {current_user.email} requesting spending by category (period: {period})"
            )

            # Import database dependencies here to avoid circular imports
            from app.modules.transactions.repositories import TransactionRepository
            from app.modules.transactions.models import TransactionType

            try:
                try:
                    transaction_repo = TransactionRepository(db)

                    # Same period vocabulary and date-range resolution as
                    # /stats and /wallet-trends — using a local 7d/30d/90d/6m/1y
                    # only mapping here previously meant "month" (the
                    # dashboard's default) silently fell back to a rolling
                    # 30-day window instead of the calendar month /stats uses,
                    # so this card's total disagreed with its own breakdown.
                    start_date, end_date = DateRangeCalculator.get_range_for_dashboard_period(period)

                    # Get category breakdown from database. amount_field="amount"
                    # (native/TWD) matches get_summary's total_expenses — the
                    # default amount_usd column made this breakdown's numbers
                    # ~30x smaller than the card's own total (USD vs TWD).
                    breakdown = await transaction_repo.get_category_breakdown(
                        user_id=str(current_user.id),
                        date_from=start_date,
                        date_to=end_date,
                        transaction_type=TransactionType.EXPENSE,
                        amount_field="amount",
                    )

                    # Transform to expected format with colors
                    category_colors = {
                        "Food & Dining": "#FF6B6B",
                        "Transportation": "#4ECDC4",
                        "Shopping": "#45B7D1",
                        "Entertainment": "#96CEB4",
                        "Utilities": "#FECA57",
                        "Healthcare": "#FF9FF3",
                        "Housing": "#FD79A8",
                        "Education": "#74B9FF",
                        "Insurance": "#A29BFE",
                        "Travel": "#FDCB6E",
                        "Personal Care": "#E17055",
                        "Gifts & Donations": "#00B894",
                        "Business Services": "#E84393",
                        "Automotive": "#6C5CE7",
                        "Home Improvement": "#A0E7E5",
                        "Subscriptions": "#B2BEC3",
                        "Taxes": "#636E72",
                        "Investment": "#00CEC9",
                        "Savings": "#81ECEC",
                        "Other": "#54A0FF",
                    }

                    categories = []
                    total_amount = 0

                    for item in breakdown:
                        amount = float(item["amount"]) if item["amount"] else 0
                        total_amount += amount

                        categories.append(
                            {
                                "name": item["category_name"],
                                "amount": amount,
                                "percentage": round(item["percentage"], 2),
                                "color": category_colors.get(
                                    item["category_name"], "#6B7280"
                                ),
                                "transaction_count": item["transaction_count"] or 0,
                                "currency": "TWD",
                            }
                        )

                    execution_time = (datetime.now(timezone.utc) - start_time).total_seconds()
                    logger.info(
                        f"✅ Real spending data fetched for user {current_user.email} in {execution_time:.3f}s"
                    )

                    return JSONResponse(
                        status_code=200,
                        content={
                            "success": True,
                            "data": {
                                "categories": categories,
                                "total_amount": total_amount,
                                "period": period,
                                "currency": "TWD",
                                "last_updated": datetime.now(timezone.utc).isoformat() + "Z",
                            },
                        },
                    )
                except Exception as inner_e:
                    logger.error(
                        f"❌ Database error for user {current_user.email}: {str(inner_e)}"
                    )
                    raise
            except Exception as e:
                logger.error(f"❌ Error in spending category endpoint: {str(e)}")

                # Return empty data on database error instead of failing
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "data": {
                            "categories": [],
                            "total_amount": 0,
                            "period": period,
                            "currency": "TWD",
                            "last_updated": datetime.now(timezone.utc).isoformat() + "Z",
                        },
                        "message": "No spending data available",
                    },
                )
        else:
            # Demo mode - return mock data
            logger.info(
                f"📊 Demo mode user requesting spending by category (period: {period})"
            )

            categories = demo_category_breakdown(MOCK_SPENDING_CATEGORIES, period)

            execution_time = (datetime.now(timezone.utc) - start_time).total_seconds()
            logger.info(f"✅ Demo spending data returned in {execution_time:.3f}s")

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    # Tests expect the data payload to be a list in demo mode
                    "data": categories,
                },
            )

    except Exception as e:
        logger.error(
            f"❌ Unexpected error in spending-by-category: {str(e)}",
            exc_info=True,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error while fetching spending data",
        )

@router.get("/income-by-category", status_code=status.HTTP_200_OK)
async def get_income_by_category(
    request: Request,
    period: str = Query(
        "30d", description="Time period for analysis (7d, 30d, 90d, 6m, 1y)"
    ),
    current_user: Optional[User] = Depends(get_real_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get income breakdown by category. Mirrors /spending-by-category but for
    TransactionType.INCOME, so the Cash Flow card can show top income sources.

    Real DB queries for authenticated users, mock data in demo mode. Returns an
    empty list rather than failing when there is no data.
    """
    start_time = datetime.now(timezone.utc)

    income_colors = {
        "Salary": "#10B981",
        "Bonus": "#059669",
        "Dividends": "#34D399",
        "Interest": "#6EE7B7",
        "Investment": "#00CEC9",
        "Side Income": "#A7F3D0",
        "Freelance": "#2DD4BF",
        "Business": "#14B8A6",
        "Rental": "#5EEAD4",
        "Gifts": "#86EFAC",
        "Refund": "#BBF7D0",
        "Other": "#D1FAE5",
    }

    try:
        if current_user:
            from app.modules.transactions.repositories import TransactionRepository
            from app.modules.transactions.models import TransactionType

            # Same resolver as /stats and /spending-by-category — see the
            # comment there for why this must not be a local 7d/30d/... map.
            start_date, end_date = DateRangeCalculator.get_range_for_dashboard_period(period)

            try:
                transaction_repo = TransactionRepository(db)
                # amount_field="amount" (native/TWD) matches get_summary's
                # total_income — the default amount_usd column made this
                # breakdown ~30x smaller than the Cash Flow card's own income
                # total (USD vs TWD). Mirrors the /spending-by-category fix.
                breakdown = await transaction_repo.get_category_breakdown(
                    user_id=str(current_user.id),
                    date_from=start_date,
                    date_to=end_date,
                    transaction_type=TransactionType.INCOME,
                    amount_field="amount",
                )

                categories = []
                total_amount = 0.0
                for item in breakdown:
                    amount = float(item["amount"]) if item["amount"] else 0.0
                    total_amount += amount
                    categories.append(
                        {
                            "name": item["category_name"],
                            "amount": amount,
                            "percentage": round(item["percentage"], 2),
                            "color": income_colors.get(item["category_name"], "#10B981"),
                            "transaction_count": item["transaction_count"] or 0,
                            "currency": "TWD",
                        }
                    )

                execution_time = (datetime.now(timezone.utc) - start_time).total_seconds()
                logger.info(
                    f"✅ Real income data fetched for user {current_user.email} in {execution_time:.3f}s"
                )
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "data": {
                            "categories": categories,
                            "total_amount": total_amount,
                            "period": period,
                            "currency": "TWD",
                            "last_updated": datetime.now(timezone.utc).isoformat() + "Z",
                        },
                    },
                )
            except Exception as inner_e:
                logger.error(f"❌ Error in income category endpoint: {str(inner_e)}")
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "data": {
                            "categories": [],
                            "total_amount": 0,
                            "period": period,
                            "currency": "TWD",
                            "last_updated": datetime.now(timezone.utc).isoformat() + "Z",
                        },
                        "message": "No income data available",
                    },
                )
        else:
            # Demo mode - return mock data
            categories = demo_category_breakdown(MOCK_INCOME_CATEGORIES, period)
            return JSONResponse(
                status_code=200,
                content={"success": True, "data": categories},
            )

    except Exception as e:
        logger.error(f"❌ Unexpected error in income-by-category: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error while fetching income data",
        )

@router.get("/goals-overview", status_code=status.HTTP_200_OK)
async def get_goals_overview():
    """Get goals overview for dashboard"""

    total_target = sum(goal["target"] for goal in MOCK_GOALS_OVERVIEW)
    total_current = sum(goal["current"] for goal in MOCK_GOALS_OVERVIEW)
    overall_progress = (total_current / total_target) * 100 if total_target > 0 else 0

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "data": {
                "goals": MOCK_GOALS_OVERVIEW,
                "summary": {
                    "totalGoals": len(MOCK_GOALS_OVERVIEW),
                    "totalTarget": total_target,
                    "totalCurrent": total_current,
                    "overallProgress": round(overall_progress, 1),
                    "activeGoals": len(
                        [g for g in MOCK_GOALS_OVERVIEW if g["progress"] < 100]
                    ),
                    "completedGoals": len(
                        [g for g in MOCK_GOALS_OVERVIEW if g["progress"] >= 100]
                    ),
                },
            },
        },
    )

@router.get("/wallet-trends", status_code=status.HTTP_200_OK)
async def get_wallet_trends(
    request: Request,
    period: str = Query("30d", description="Time period for wallet trends"),
    current_user: Optional[User] = Depends(get_real_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Get daily wallet balance trends for all three wallets"""

    if current_user:
        # Authenticated user - fetch real wallet trend data
        logger.info(
            f"Wallet trends requested by authenticated user: {current_user.email}"
        )

        from app.modules.dashboard.services import DashboardService
        from app.modules.dashboard.schemas import PeriodEnum

        # Map period string to enum
        period_map = {
            "7d": PeriodEnum.SEVEN_DAYS,
            "14d": PeriodEnum.FOURTEEN_DAYS,
            "month": PeriodEnum.MONTH,
            "30d": PeriodEnum.THIRTY_DAYS,
            "90d": PeriodEnum.NINETY_DAYS,
            "6m": PeriodEnum.SIX_MONTHS,
            "1y": PeriodEnum.ONE_YEAR,
            "ytd": PeriodEnum.YEAR_TO_DATE,
        }
        period_enum = period_map.get(period, PeriodEnum.MONTH)

        try:
            # Use DashboardService to get wallet trend data
            dashboard_service = DashboardService(db)
            trends_response = await dashboard_service.get_wallet_trends(
                user_id=str(current_user.id),
                period=period_enum,
                force_refresh=False,
            )

            # Convert Pydantic model to dict for response
            wallet_data = {
                "dataPoints": [
                    {
                        "date": point.date,
                        "lifeWallet": float(point.life_wallet),
                        "portfolioWallet": float(point.portfolio_wallet),
                        "emergencyWallet": float(point.emergency_wallet),
                        "totalAsset": float(point.total_asset),
                        "investmentTotal": float(point.investment_total),
                        "debtBalance": float(point.debt_balance),
                        "debtByLoan": {
                            loan_id: float(balance)
                            for loan_id, balance in (point.debt_by_loan or {}).items()
                        },
                    }
                    for point in trends_response.data_points
                ],
                "baseline": (
                    {
                        "date": trends_response.baseline.date,
                        "lifeWallet": float(trends_response.baseline.life_wallet),
                        "portfolioWallet": float(trends_response.baseline.portfolio_wallet),
                        "emergencyWallet": float(trends_response.baseline.emergency_wallet),
                        "totalAsset": float(trends_response.baseline.total_asset),
                        "investmentTotal": float(trends_response.baseline.investment_total),
                        "debtBalance": float(trends_response.baseline.debt_balance),
                    }
                    if trends_response.baseline
                    else None
                ),
                "period": trends_response.period,
                "startDate": trends_response.start_date.isoformat(),
                "endDate": trends_response.end_date.isoformat(),
                "currency": trends_response.currency,
                "lastUpdated": trends_response.last_updated.isoformat() + "Z",
            }

            logger.info(
                f"✅ Wallet trends fetched for user {current_user.email}: {len(trends_response.data_points)} points"
            )

            return JSONResponse(
                status_code=200, content={"success": True, "data": wallet_data}
            )

        except Exception as e:
            logger.error(
                f"❌ Error fetching wallet trends for user {current_user.email}: {str(e)}"
            )
            # Fallback to empty data on error
            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "data": {
                        "dataPoints": [],
                        "period": period,
                        "startDate": business_today().isoformat(),
                        "endDate": business_today().isoformat(),
                        "currency": "TWD",
                        "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
                    },
                },
            )
    else:
        # Demo mode - return mock data
        logger.info(f"Wallet trends requested in demo mode with period: {period}")

        # Map period to number of days for demo data generation
        period_days_map = {
            "7d": 7,
            "14d": 14,
            # Days elapsed this calendar month, NOT 30. This said 30 with the
            # comment "current month approximation", so demo mode answered
            # "this month" with a rolling 30-day window — /wallet-trends
            # returned a window identical to 30d while the P&L calendar beside
            # it filtered from the 1st, and the two tiles disagreed. Same bug
            # the "ytd" line below already had to fix.
            "month": business_today().day,
            "30d": 30,
            "90d": 90,
            "6m": 180,
            "1y": 365,
            # Without this, "ytd" fell through to the 30-day default and a demo
            # visitor asking for the year got a month, silently.
            "ytd": max(1, (business_today() - date(business_today().year, 1, 1)).days + 1),
        }
        num_days = period_days_map.get(period, 30)
        # One extra day at the front, split off as `baseline` below — the same
        # shape the authenticated path returns, so a caller taking last - first
        # measures the whole period rather than one day less of it.
        num_days += 1

        # The series has to LAND on the same wallet balances /stats reports, not
        # merely look plausible: both feed the same screens, and a trend whose
        # last point disagrees with the headline beside it reads as a sudden
        # jump on the chart — or worse, as two different answers to "what do I
        # have today". These grow into DEMO_DASHBOARD_STATS rather than starting
        # from an unrelated figure.
        end_life = DEMO_DASHBOARD_STATS["life_wallet"]
        end_portfolio = DEMO_DASHBOARD_STATS["portfolio_wallet"]
        end_emergency = DEMO_DASHBOARD_STATS["emergency_wallet"]
        end_debt = DEMO_DASHBOARD_STATS["total_debt"]

        # Where the window opened, as a fraction of where it closes. A longer
        # window shows more growth, so a year looks like a year and a week does
        # not pretend to.
        opening_share = max(0.55, 1 - 0.12 * (num_days / 365))

        mock_points = []
        for i in range(num_days):
            date_val = business_today() - timedelta(days=num_days - 1 - i)
            # A one-day window is all "today" — on 1 January, "ytd" is exactly
            # that. Dividing by max(num_days - 1, 1) would leave its only point
            # at the *opening* share, putting the chart 10% below the headline
            # beside it on the one day of the year nobody would think to check.
            progress = 1.0 if num_days <= 1 else i / (num_days - 1)
            grown = opening_share + (1 - opening_share) * progress

            # A little shape, so the line is not a ruler — but only on the
            # portfolio, which is the wallet that actually moves with a market.
            #
            # Tapered to nothing rather than switched off on the last point:
            # truncating it left the penultimate point carrying up to ±1.2% and
            # the final one carrying none, which put a visible step in the last
            # segment — the very artefact this whole function was rewritten to
            # remove, just moved one day left.
            wobble = 1 + 0.012 * math.sin(i / 6.0) * (1 - progress)

            # Every wallet is scaled by the same window-length factor. Growing
            # the emergency fund a flat 11% regardless made it the fastest-moving
            # wallet on a 7-day window, where the other two move 0.2%.
            life = end_life * grown
            portfolio = end_portfolio * grown * wobble
            emergency = end_emergency * grown

            mock_points.append(
                {
                    "date": date_val.strftime("%Y-%m-%d"),
                    "lifeWallet": round(life, 2),
                    "portfolioWallet": round(portfolio, 2),
                    "emergencyWallet": round(emergency, 2),
                    "totalAsset": round(life + portfolio + emergency, 2),
                    "investmentTotal": round(portfolio, 2),
                    # Falling as it is repaid, so the demo net-worth line is not
                    # just the asset line shifted down — the two moving apart is
                    # exactly what the card reading them is for.
                    "debtBalance": round(end_debt * (1.06 - 0.06 * progress), 2),
                    # Keyed by the demo loan ids the frontend fixture uses, so
                    # the breakdown sums to the total beside it here as it does
                    # for a real account. An empty map next to a non-zero
                    # balance says "no debt is reported" while reporting debt.
                    "debtByLoan": {
                        "demo-loan-1": round(
                            end_debt * (1.06 - 0.06 * progress) * DEMO_MORTGAGE_SHARE, 2
                        ),
                        "demo-loan-2": round(
                            end_debt
                            * (1.06 - 0.06 * progress)
                            * (1 - DEMO_MORTGAGE_SHARE),
                            2,
                        ),
                    },
                }
            )

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": {
                    "dataPoints": mock_points[1:],
                    "baseline": mock_points[0] if mock_points else None,
                    "period": period,
                    "startDate": (
                        business_today() - timedelta(days=num_days - 2)
                    ).strftime("%Y-%m-%d"),
                    "endDate": business_today().strftime("%Y-%m-%d"),
                    "currency": "TWD",
                    "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
                },
            },
        )

@router.get("/historical-trends", status_code=status.HTTP_200_OK)
async def get_historical_trends(
    request: Request,
    period: str = Query("30d", description="Time period for trends"),
    current_user: Optional[User] = Depends(get_real_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Get historical financial trend data for charts"""

    if current_user:
        # Authenticated user - fetch real trend data from database
        logger.info(
            f"Historical trends requested by authenticated user: {current_user.email}"
        )

        from app.modules.dashboard.services import DashboardService
        from app.modules.dashboard.schemas import PeriodEnum

        # Map period string to enum
        # Note: 'month' means current calendar month to match dashboard stats
        period_map = {
            "7d": PeriodEnum.SEVEN_DAYS,
            "14d": PeriodEnum.FOURTEEN_DAYS,
            "month": PeriodEnum.MONTH,  # Current calendar month (matches dashboard stats)
            "30d": PeriodEnum.THIRTY_DAYS,
            "90d": PeriodEnum.NINETY_DAYS,
            "6m": PeriodEnum.SIX_MONTHS,
            "1y": PeriodEnum.ONE_YEAR,
            "ytd": PeriodEnum.YEAR_TO_DATE,
        }
        period_enum = period_map.get(period, PeriodEnum.MONTH)

        try:
            # Use DashboardService to get real trend data
            dashboard_service = DashboardService(db)
            trends_response = await dashboard_service.get_historical_trends(
                user_id=str(current_user.id),
                period=period_enum,
                force_refresh=False,
            )

            # Convert Pydantic model to dict for response
            trend_data = {
                "dataPoints": [
                    {
                        "date": point.date,
                        "income": float(point.income),
                        "expenses": float(point.expenses),
                        "balance": float(point.balance),
                        "netWorth": float(point.net_worth),
                        "portfolioValue": float(point.portfolio_value or 0),
                    }
                    for point in trends_response.data_points
                ],
                "period": trends_response.period,
                "startDate": trends_response.start_date.isoformat(),
                "endDate": trends_response.end_date.isoformat(),
                "currency": trends_response.currency,
                "lastUpdated": trends_response.last_updated.isoformat() + "Z",
            }

            logger.info(
                f"✅ Historical trends fetched for user {current_user.email}: {len(trends_response.data_points)} points"
            )

            return JSONResponse(
                status_code=200, content={"success": True, "data": trend_data}
            )

        except Exception as e:
            logger.error(
                f"❌ Error fetching historical trends for user {current_user.email}: {str(e)}"
            )
            # Fallback to empty data on error
            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "data": {
                        "dataPoints": [],
                        "period": period,
                        "startDate": business_today().isoformat(),
                        "endDate": business_today().isoformat(),
                        "currency": "TWD",
                        "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
                    },
                },
            )
    else:
        # Demo mode - return empty (frontend will use mock data)
        logger.info("Historical trends requested in demo mode")
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": {
                    "dataPoints": [],
                    "period": period,
                    "startDate": business_today().isoformat(),
                    "endDate": business_today().isoformat(),
                    "currency": "TWD",
                    "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
                },
                "message": "Demo mode - use mock data",
            },
        )

@router.post("/refresh", status_code=status.HTTP_200_OK)
async def refresh_dashboard():
    """Refresh dashboard data"""

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "message": "Dashboard data refreshed successfully",
            "data": {
                "refreshedAt": datetime.now(timezone.utc).isoformat() + "Z",
                "componentsRefreshed": [
                    "stats",
                    "recent-activity",
                    "goals-overview",
                    "portfolio-overview",
                    "spending-categories",
                ],
            },
        },
    )

# Health check for the dashboard module
@router.get("/health")
async def health_check():
    """Health check endpoint for the dashboard module"""
    return {
        "status": "healthy",
        "module": "dashboard-simple",
        "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
        "mockDataComponents": ["stats", "activities", "categories", "goals", "events"],
    }
