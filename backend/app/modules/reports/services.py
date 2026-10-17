"""
Reports service: the spending, monthly-trend and goals reads behind /review.
"""

from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy import select, func, and_, or_, case, extract
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
import re
import calendar

from app.modules.transactions.models import (
    Transaction,
    TransactionType,
)
from app.modules.portfolio.models import Portfolio, PortfolioHolding
from app.utils.exchange_rate_service import get_exchange_rate_service
from app.utils.fx_sql import BASE_CURRENCY, in_twd, twd_rates_for
from app.modules.transactions.repositories import TransactionRepository
from app.modules.goals.models import Goal, GoalStatus, GoalCategory
from app.core.logger import get_logger
from .schemas import (
    SpendingReport,
    CategoryBreakdown,
    ComparisonPeriod,
    MonthlyTrend,
    SpendingInsight,
    GoalsReport,
    GoalProgress,
    GoalCategory as GoalCategorySchema,
)
from app.utils.datetime_helpers import business_today


logger = get_logger(__name__)


def _real_transactions():
    """The rows a report is allowed to count.

    Deleted rows are gone, and failed or cancelled ones never happened —
    counting either is not a rounding error, it is a different account. The
    dashboard has always excluded both (`TransactionRepository.get_summary`),
    so reports that included them did not merely overcount, they disagreed with
    the figure on the landing page for the same window.

    Pending is excluded too, for the same reason the dashboard excludes it:
    money that has not settled is not money you spent.

    It is the repository's own rule (`countable_conditions`), so the reports and
    the dashboard cannot drift apart on it again.
    """
    return and_(*TransactionRepository.countable_conditions())


# Mirrors frontend/src/utils/goalMatchers.ts::isRetirementGoal — keep the two in
# step. A goal renamed "Retirement Fund" often keeps its earlier category, and
# matching on category alone made /review's goals card show that goal at NT$0
# while /goals, which matches on the title too, credited it the portfolio.
_RETIREMENT_TITLE_KEYWORDS = ("retire", "財務自由", "退休")
# "FIRE" (financial independence, retire early) only as the capitalised acronym
# and a whole word. Lower-cased and as a substring it matched "Fireplace
# renovation" and "Fire insurance fund", and a goal matched here is credited the
# entire portfolio.
_FIRE_ACRONYM = re.compile(r"\bFIRE\b")


def _is_retirement_goal(goal) -> bool:
    """A retirement goal by category, or by a title that says it is one."""
    category = getattr(goal.category, "value", goal.category)
    if str(category or "").lower() == "retirement":
        return True
    title = goal.title or ""
    return any(keyword in title.lower() for keyword in _RETIREMENT_TITLE_KEYWORDS) or bool(
        _FIRE_ACRONYM.search(title)
    )


def _portfolio_credited_goal_id(goals):
    """The one goal the portfolio counts toward, or None.

    A retirement goal's progress is the portfolio, but the portfolio exists
    once. Crediting every matching goal counted it again for each, so a user
    with two retirement goals saw the total doubled and progress past 100%.

    The credit goes to the active match with the largest target, or to any
    match if none is active, ties broken by id. The frontend's
    portfolioCreditedGoal applies the same rule, so /goals and this report
    credit the same goal.
    """
    matches = [goal for goal in goals if _is_retirement_goal(goal)]
    if not matches:
        return None
    pool = [goal for goal in matches if goal.status == GoalStatus.ACTIVE] or matches
    return max(pool, key=lambda goal: (float(goal.target_amount), str(goal.id))).id


class ReportsService:
    """Service for generating financial reports"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_spending_report(
        self,
        user_id: str,
        date_from: date,
        date_to: date,
        detailed: bool = True,
    ) -> SpendingReport:
        """Generate spending analysis report.

        ``detailed=False`` skips the extras that cost a query each (monthly
        trends, previous-period comparison); totals, category breakdown and
        insights are always computed.

        Every row in the window is counted, transfers, loans received and
        investment purchases included: /review reads the wallet balances beside
        these figures, and those balances move on exactly that money. Leaving it
        out here left the two cards unable to explain each other — August read
        NT$158k of income beside a Life wallet up NT$635k.
        """

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Query transactions in date range with eager loading of category
        stmt = (
            select(Transaction)
            .options(selectinload(Transaction.category_obj))
            .where(
                and_(
                    Transaction.user_id == user_uuid,
                    Transaction.transaction_date >= date_from,
                    Transaction.transaction_date <= date_to,
                    _real_transactions(),
                )
            )
        )
        result = await self.db.execute(stmt)
        transactions = result.scalars().all()

        logger.info(
            f"Found {len(transactions)} transactions for user {user_uuid} "
            f"between {date_from} and {date_to}"
        )

        # Each row's amount in TWD. Every figure below is built from this rather
        # than from `t.amount`, so a USD row is worth what it is worth and not
        # its face value in New Taiwan dollars.
        # The currencies are the loaded rows' own; no second query for them.
        rates = await twd_rates_for(self.db, [t.currency for t in transactions])
        amounts = {
            t.id: float(t.amount) * float(rates.get((t.currency or BASE_CURRENCY).upper(), 1))
            for t in transactions
        }

        # Calculate totals
        # Rounded to the cent: these are float products of amount and rate, and
        # unrounded they carry noise (324567.00000000006) that the SQL-summed
        # monthly series does not.
        total_income = round(
            sum(amounts[t.id] for t in transactions if t.type == TransactionType.INCOME), 2
        )
        total_expenses = round(
            sum(amounts[t.id] for t in transactions if t.type == TransactionType.EXPENSE), 2
        )
        net_savings = total_income - total_expenses
        savings_rate = (net_savings / total_income * 100) if total_income > 0 else 0

        # Calculate average daily spending
        days = (date_to - date_from).days + 1
        average_daily_spending = total_expenses / days if days > 0 else 0

        # Category breakdown
        category_breakdown = await self._get_category_breakdown(transactions, amounts)
        income_breakdown = await self._get_category_breakdown(
            transactions, amounts, TransactionType.INCOME
        )

        # Monthly trends — standalone-only (extra grouped query)
        monthly_trends = (
            await self._get_monthly_trends(user_id, date_from, date_to, rates)
            if detailed
            else []
        )

        # Top merchants (in-memory over already-loaded transactions)
        top_merchants = await self._get_top_merchants(transactions, amounts)

        # Generate insights
        insights = self._generate_spending_insights(
            total_expenses, total_income, savings_rate, category_breakdown
        )

        # Comparison with previous period — standalone-only (reloads the prior period)
        comparison_period = (
            await self._get_comparison_period(user_id, date_from, date_to)
            if detailed
            else None
        )

        return SpendingReport(
            total_income=total_income,
            total_expenses=total_expenses,
            net_savings=net_savings,
            savings_rate=round(savings_rate, 2),
            average_daily_spending=round(average_daily_spending, 2),
            category_breakdown=category_breakdown,
            income_breakdown=income_breakdown,
            monthly_trends=monthly_trends,
            top_merchants=top_merchants,
            insights=insights,
            comparison_period=comparison_period,
        )

    async def _twd_rates(
        self,
        user_uuid,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> Dict[str, Decimal]:
        """Rates for the currencies this user actually has in the window.

        Asked per report rather than per row, and skipped entirely for the
        single-currency account that most of them are: with nothing but TWD in
        scope this returns {}, and every query below is then byte-for-byte the
        one it was before.
        """
        conditions = [Transaction.user_id == user_uuid, _real_transactions()]
        if date_from is not None:
            conditions.append(Transaction.transaction_date >= date_from)
        if date_to is not None:
            conditions.append(Transaction.transaction_date <= date_to)

        return await TransactionRepository(self.db).twd_rates_for_conditions(conditions)

    async def _get_category_breakdown(
        self,
        transactions: List[Transaction],
        amounts: Dict[Any, float],
        kind: TransactionType = TransactionType.EXPENSE,
    ) -> List[CategoryBreakdown]:
        """Amounts by category for one transaction type, spending by default, in TWD.

        `amounts` carries each row's converted value; reading `txn.amount` here
        would put a USD row's face value into a TWD pie chart. Income uses the
        same breakdown: /review shows where the month's money came from beneath
        where it went, and the two cards read the same shape.
        """

        category_totals: Dict[str, Dict[str, Any]] = {}
        total = 0

        for txn in transactions:
            if txn.type == kind:
                category_name = (
                    txn.category_obj.name if txn.category_obj else "Uncategorized"
                )
                if category_name not in category_totals:
                    category_totals[category_name] = {
                        "amount": 0,
                        "count": 0,
                        "color": (
                            txn.category_obj.color if txn.category_obj else "#6B7280"
                        ),
                    }
                category_totals[category_name]["amount"] += amounts[txn.id]
                category_totals[category_name]["count"] += 1
                total += amounts[txn.id]

        # Convert to list with percentages
        breakdown = []
        for category, data in category_totals.items():
            percentage = (data["amount"] / total * 100) if total > 0 else 0
            breakdown.append(
                CategoryBreakdown(
                    category=category,
                    amount=round(data["amount"], 2),
                    percentage=round(percentage, 2),
                    transaction_count=data["count"],
                    color=data["color"],
                )
            )

        # Sort by amount descending
        breakdown.sort(key=lambda x: x.amount, reverse=True)
        return breakdown

    async def get_monthly_trends(
        self, user_id: str, date_from: date, date_to: date
    ) -> List[MonthlyTrend]:
        """Month-by-month income and expense totals over a range.

        The same grouped query the spending report embeds, exposed on its own
        because the month-review page wants a year of these and nothing else.
        Reading them off `/reports/spending` meant eager-loading every
        transaction in the window and building a category breakdown, top
        merchants and a previous-year comparison, all to be discarded.
        """
        return await self._get_monthly_trends(user_id, date_from, date_to)

    async def _get_monthly_trends(
        self,
        user_id: str,
        date_from: date,
        date_to: date,
        rates: Optional[Dict[str, Decimal]] = None,
    ) -> List[MonthlyTrend]:
        """Calculate monthly spending trends, in TWD.

        `rates` is passed in by the spending report, which has already looked
        them up for the same window; a standalone caller gets its own.
        """

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
        if rates is None:
            rates = await self._twd_rates(user_uuid, date_from, date_to)
        amount_twd = in_twd(Transaction.amount, Transaction.currency, rates)

        # Query transactions grouped by month
        stmt = (
            select(
                func.to_char(Transaction.transaction_date, "YYYY-MM").label("month"),
                func.sum(
                    case(
                        (Transaction.type == TransactionType.INCOME, amount_twd),
                        else_=0,
                    )
                ).label("income"),
                func.sum(
                    case(
                        (Transaction.type == TransactionType.EXPENSE, amount_twd),
                        else_=0,
                    )
                ).label("expenses"),
            )
            .where(
                and_(
                    Transaction.user_id == user_uuid,
                    Transaction.transaction_date >= date_from,
                    Transaction.transaction_date <= date_to,
                    _real_transactions(),
                )
            )
            .group_by("month")
            .order_by("month")
        )

        result = await self.db.execute(stmt)
        rows = result.all()

        trends = []
        for row in rows:
            income = float(row.income) if row.income else 0
            expenses = float(row.expenses) if row.expenses else 0
            net = income - expenses
            amount = expenses  # Total amount is expenses for backwards compatibility

            trends.append(
                MonthlyTrend(
                    month=row.month,
                    amount=round(amount, 2),
                    income=round(income, 2),
                    expenses=round(expenses, 2),
                    net=round(net, 2),
                )
            )

        return trends

    async def _get_top_merchants(
        self, transactions: List[Transaction], amounts: Dict[Any, float]
    ) -> List[Dict[str, Any]]:
        """Get top merchants by spending, in TWD."""

        merchant_totals: Dict[str, float] = {}

        for txn in transactions:
            if txn.type == TransactionType.EXPENSE and txn.merchant_name:
                merchant_totals[txn.merchant_name] = (
                    merchant_totals.get(txn.merchant_name, 0) + amounts[txn.id]
                )

        # Sort and take top 10
        sorted_merchants = sorted(
            merchant_totals.items(), key=lambda x: x[1], reverse=True
        )[:10]

        return [
            {"name": merchant, "amount": round(amount, 2)}
            for merchant, amount in sorted_merchants
        ]

    def _generate_spending_insights(
        self,
        total_expenses: float,
        total_income: float,
        savings_rate: float,
        category_breakdown: List[CategoryBreakdown],
    ) -> List[SpendingInsight]:
        """Generate spending insights and recommendations"""

        insights = []

        # Savings rate insights
        if savings_rate < 0:
            insights.append(
                SpendingInsight(
                    type="alert",
                    title="Spending Exceeds Income",
                    description=f"Your spending is {abs(savings_rate):.1f}% more than your income. Consider reducing expenses.",
                    impact="high",
                )
            )
        elif savings_rate < 10:
            insights.append(
                SpendingInsight(
                    type="warning",
                    title="Low Savings Rate",
                    description=f"Your savings rate is {savings_rate:.1f}%. Try to save at least 20% of your income.",
                    impact="medium",
                )
            )
        elif savings_rate >= 30:
            insights.append(
                SpendingInsight(
                    type="success",
                    title="Excellent Savings Rate",
                    description=f"You're saving {savings_rate:.1f}% of your income. Keep up the great work!",
                    impact="positive",
                )
            )

        # Top spending category
        if category_breakdown:
            top_category = category_breakdown[0]
            if top_category.percentage > 40:
                insights.append(
                    SpendingInsight(
                        type="info",
                        title=f"High {top_category.category} Spending",
                        description=f"{top_category.category} accounts for {top_category.percentage:.1f}% of your expenses.",
                        impact="medium",
                    )
                )

        return insights

    async def _get_comparison_period(
        self, user_id: str, date_from: date, date_to: date
    ) -> ComparisonPeriod:
        """Get comparison data from previous period"""

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        days_diff = (date_to - date_from).days + 1
        prev_date_to = date_from - timedelta(days=1)
        prev_date_from = prev_date_to - timedelta(days=days_diff - 1)

        # The previous window's own currencies, not this one's: an account that
        # bought in USD last month and not this one still needs the rate.
        rates = await self._twd_rates(user_uuid, prev_date_from, prev_date_to)
        amount_twd = in_twd(Transaction.amount, Transaction.currency, rates)

        stmt = select(
            func.sum(
                case((Transaction.type == TransactionType.INCOME, amount_twd), else_=0)
            ).label("income"),
            func.sum(
                case((Transaction.type == TransactionType.EXPENSE, amount_twd), else_=0)
            ).label("expenses"),
        ).where(
            and_(
                Transaction.user_id == user_uuid,
                Transaction.transaction_date >= prev_date_from,
                Transaction.transaction_date <= prev_date_to,
                _real_transactions(),
            )
        )

        result = await self.db.execute(stmt)
        row = result.first()

        if row:
            prev_income = float(row.income) if row.income else 0
            prev_expenses = float(row.expenses) if row.expenses else 0
            return ComparisonPeriod(
                income=round(prev_income, 2),
                expenses=round(prev_expenses, 2),
                net_savings=round(prev_income - prev_expenses, 2),
            )

        return ComparisonPeriod(income=0, expenses=0, net_savings=0)

    async def _load_holdings_twd(
        self, portfolios: List[Portfolio]
    ) -> List[Dict[str, Any]]:
        """
        Load all active holdings for the given portfolios and convert their
        values to TWD so every downstream calculation uses the same currency
        as the portfolio page.
        """
        exchange_service = get_exchange_rate_service(self.db)
        fallback_rates: Dict[str, Decimal] = {
            "USD": Decimal("31.5"),
            "EUR": Decimal("34.0"),
            "JPY": Decimal("0.21"),
            "CNY": Decimal("4.4"),
        }

        # Collect all holdings first
        raw: List[PortfolioHolding] = []
        for portfolio in portfolios:
            stmt = select(PortfolioHolding).where(
                and_(
                    PortfolioHolding.portfolio_id == portfolio.id,
                    PortfolioHolding.is_active == True,
                )
            )
            result = await self.db.execute(stmt)
            raw.extend(result.scalars().all())

        # Pre-fetch exchange rates for every non-TWD currency in one pass
        unique_currencies = {
            (h.currency or "TWD").upper()
            for h in raw
            if (h.currency or "TWD").upper() != "TWD"
        }
        rates: Dict[str, Decimal] = {}
        for currency in unique_currencies:
            rate = await exchange_service.get_exchange_rate(currency, "TWD")
            rates[currency] = rate if rate else fallback_rates.get(currency, Decimal("1"))

        enriched: List[Dict[str, Any]] = []
        for h in raw:
            currency = (h.currency or "TWD").upper()
            rate = rates.get(currency, Decimal("1"))
            raw_value = Decimal(str(h.total_value or 0))
            raw_cost = Decimal(str(h.total_cost or 0))
            enriched.append({
                "holding": h,
                "value_twd": float(raw_value * rate),
                "cost_twd": float(raw_cost * rate),
            })

        return enriched

    async def get_goals_report(
        self, user_id: str, date_from: date, date_to: date, detailed: bool = True,
        portfolio_total_twd: Optional[float] = None,
    ) -> GoalsReport:
        """Generate goals tracking report.

        ``detailed=False`` skips the per-category summary; all totals, on-track
        counts and insight inputs are still computed.

        ``portfolio_total_twd``, when given, is used as the TWD portfolio total
        instead of loading every holding to compute it.
        """

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Query all goals for user
        stmt = select(Goal).where(Goal.user_id == user_uuid)
        result = await self.db.execute(stmt)
        goals = result.scalars().all()

        # Portfolio total (TWD) for retirement goal progress — mirrors goals page.
        if portfolio_total_twd is None:
            portfolio_stmt = select(Portfolio).where(
                and_(Portfolio.user_id == user_uuid, Portfolio.is_active == True)
            )
            portfolio_result = await self.db.execute(portfolio_stmt)
            portfolios = portfolio_result.scalars().all()
            portfolio_total_twd = 0.0
            if portfolios:
                holdings_twd = await self._load_holdings_twd(portfolios)
                portfolio_total_twd = sum(item["value_twd"] for item in holdings_twd)

        credited_goal_id = _portfolio_credited_goal_id(goals)

        def effective_current(goal: Goal) -> float:
            raw = float(goal.current_amount)
            if goal.id == credited_goal_id:
                return max(raw, portfolio_total_twd)
            return raw

        # Calculate summary stats
        total_goals = len(goals)
        active_goals = sum(1 for g in goals if g.status == GoalStatus.ACTIVE)
        completed_goals = sum(1 for g in goals if g.status == GoalStatus.COMPLETED)

        total_target = sum(float(g.target_amount) for g in goals)
        total_current = sum(effective_current(g) for g in goals)
        overall_progress = (
            (total_current / total_target * 100) if total_target > 0 else 0
        )

        # Calculate individual goal progress
        goal_progress = []
        goals_on_track = 0
        goals_behind = 0

        for goal in goals:
            if goal.status != GoalStatus.ACTIVE:
                continue

            target = float(goal.target_amount)
            current = effective_current(goal)
            progress_pct = (current / target * 100) if target > 0 else 0

            # Calculate if on track
            on_track = True
            monthly_required = 0.0
            days_remaining = None

            if goal.target_date:
                target_date_only = (
                    goal.target_date.date()
                    if isinstance(goal.target_date, datetime)
                    else goal.target_date
                )
                days_remaining = (target_date_only - business_today()).days

                if days_remaining > 0:
                    remaining_amount = target - current
                    months_remaining = days_remaining / 30.0
                    monthly_required = (
                        remaining_amount / months_remaining
                        if months_remaining > 0
                        else remaining_amount
                    )

                    # Check if on track (simplified)
                    if progress_pct < 50 and months_remaining < 6:
                        on_track = False

            if on_track:
                goals_on_track += 1
            else:
                goals_behind += 1

            goal_progress.append(
                GoalProgress(
                    id=str(goal.id),
                    title=goal.title,
                    category=goal.category.value,
                    target_amount=target,
                    current_amount=current,
                    progress_percentage=round(progress_pct, 2),
                    status=goal.status.value,
                    target_date=(
                        goal.target_date.isoformat() if goal.target_date else None
                    ),
                    days_remaining=days_remaining,
                    on_track=on_track,
                    monthly_required=round(monthly_required, 2),
                )
            )

        # Category summary — standalone-only
        category_summary = (
            await self._get_goal_category_summary(goals, portfolio_total_twd)
            if detailed
            else []
        )

        # Generate insights
        insights = self._generate_goals_insights(
            goals_on_track, goals_behind, overall_progress, goal_progress
        )

        return GoalsReport(
            total_goals=total_goals,
            active_goals=active_goals,
            completed_goals=completed_goals,
            total_target_amount=round(total_target, 2),
            total_current_amount=round(total_current, 2),
            overall_progress=round(overall_progress, 2),
            goals_on_track=goals_on_track,
            goals_behind=goals_behind,
            goal_progress=goal_progress,
            category_summary=category_summary,
            insights=insights,
        )

    async def _get_goal_category_summary(
        self, goals: List[Goal], portfolio_total_twd: float = 0.0
    ) -> List[GoalCategorySchema]:
        """Summarize goals by category"""

        category_data: Dict[str, Dict[str, Any]] = {}
        credited_goal_id = _portfolio_credited_goal_id(goals)

        for goal in goals:
            category = goal.category.value
            if category not in category_data:
                category_data[category] = {
                    "count": 0,
                    "total_target": 0,
                    "total_current": 0,
                }

            raw_current = float(goal.current_amount)
            # The same goal the totals above credit: checking the category alone
            # here left a renamed retirement goal at NT$0 in its category row,
            # and crediting every match counted the portfolio once per goal.
            effective = (
                max(raw_current, portfolio_total_twd)
                if goal.id == credited_goal_id
                else raw_current
            )

            category_data[category]["count"] += 1
            category_data[category]["total_target"] += float(goal.target_amount)
            category_data[category]["total_current"] += effective

        # Convert to list
        result = []
        for category, data in category_data.items():
            avg_progress = (
                (data["total_current"] / data["total_target"] * 100)
                if data["total_target"] > 0
                else 0
            )

            result.append(
                GoalCategorySchema(
                    category=category,
                    count=data["count"],
                    total_target=round(data["total_target"], 2),
                    total_current=round(data["total_current"], 2),
                    average_progress=round(avg_progress, 2),
                )
            )

        return result

    def _generate_goals_insights(
        self,
        goals_on_track: int,
        goals_behind: int,
        overall_progress: float,
        goal_progress: List[GoalProgress],
    ) -> List[SpendingInsight]:
        """Generate goals insights"""

        insights = []

        # Overall progress
        if overall_progress >= 75:
            insights.append(
                SpendingInsight(
                    type="success",
                    title="Excellent Goal Progress",
                    description=f"You've achieved {overall_progress:.1f}% of your financial goals. Keep it up!",
                    impact="positive",
                )
            )
        elif overall_progress < 25:
            insights.append(
                SpendingInsight(
                    type="info",
                    title="Early in Goal Journey",
                    description=f"You're at {overall_progress:.1f}% progress. Stay consistent to reach your goals.",
                    impact="neutral",
                )
            )

        # Goals behind schedule
        if goals_behind > 0:
            insights.append(
                SpendingInsight(
                    type="warning",
                    title=f"{goals_behind} Goal{'s' if goals_behind > 1 else ''} Behind Schedule",
                    description="Consider increasing contributions to goals that are falling behind.",
                    impact="medium",
                )
            )

        # All goals on track
        if goals_on_track > 0 and goals_behind == 0:
            insights.append(
                SpendingInsight(
                    type="success",
                    title="All Goals On Track",
                    description=f"All {goals_on_track} active goal{'s are' if goals_on_track > 1 else ' is'} on track. Great job!",
                    impact="positive",
                )
            )

        return insights
