"""
Service layer for dashboard business logic in the Aspiro personal finance application.
Handles dashboard data aggregation, analytics, and caching for optimal performance.
"""

import logging
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from typing import Optional, List, Dict, Any, Tuple
from uuid import UUID

from app.modules.transactions.repositories import (
    TransactionRepository,
    TransactionCategoryRepository,
)
from app.modules.transactions.models import TransactionType
from app.utils.fx_sql import to_twd
from app.modules.portfolio.repositories import PortfolioRepository
from app.modules.users.repositories import UserRepository
from app.database.session import AsyncSession
from app.utils.date_utils import DateRangeCalculator
from .schemas import (
    PeriodEnum,
    SpendingByCategoryResponse,
    SpendingCategoryResponse,
    DashboardStatsResponse,
    RecentActivityResponse,
    MonthlyTrendResponse,
    MonthlyTrendDataPoint,
    HistoricalTrendResponse,
    HistoricalTrendDataPoint,
    WalletTrendResponse,
    WalletTrendDataPoint,
)
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)


def _daily_running_balances(
    opening_balance: Decimal,
    transactions,
    start_date: date,
    end_date: date,
    rates: Dict[str, Decimal],
) -> Dict[str, Decimal]:
    """Running cash balance for each day in ``[start_date, end_date]``.

        balance[D] = opening_balance + sum(signed amounts dated <= D)

    Income adds, everything else (expenses and transfers alike) subtracts.

    ``transactions`` only needs the rows inside the window; history before it
    is folded into ``opening_balance`` by the caller. That is what keeps this
    O(rows_in_window + days) instead of the previous
    O(rows x days_since_oldest_row): the old version replayed every
    transaction forward one day at a time to the end of the range and threw
    away everything that fell outside it.

    ``rates`` (currency to TWD; ``{}`` for a TWD-only account) is required
    rather than optional: the opening balance is always TWD, and a caller that
    left the rates out would chart foreign rows at face value without an error.
    """
    deltas: Dict[date, Decimal] = {}
    for transaction in transactions:
        amount = to_twd(transaction.amount, getattr(transaction, "currency", None), rates)
        if transaction.type != TransactionType.INCOME:
            amount = -amount
        day = transaction.transaction_date
        deltas[day] = deltas.get(day, Decimal("0")) + amount

    balances: Dict[str, Decimal] = {}
    running = opening_balance
    one_day = timedelta(days=1)
    current = start_date
    while current <= end_date:
        delta = deltas.get(current)
        if delta is not None:
            running += delta
        # isoformat() is ~5x faster than strftime("%Y-%m-%d") and this is the
        # hot path for every wallet-trends request.
        balances[current.isoformat()] = running
        current += one_day
    return balances


class DashboardService:
    """Service for dashboard data aggregation and analytics"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.transaction_repo = TransactionRepository(db)
        self.category_repo = TransactionCategoryRepository(db)
        self.portfolio_repo = PortfolioRepository(db)
        self.user_repo = UserRepository(db)

        # Default category colors for consistent UI
        self.category_colors = {
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

    async def get_spending_by_category(
        self,
        user_id: str,
        period: PeriodEnum = PeriodEnum.THIRTY_DAYS,
        force_refresh: bool = False,
    ) -> SpendingByCategoryResponse:
        """Get spending breakdown by category with caching"""

        logger.info(
            f"Fetching spending by category for user {user_id}, period {period.value}"
        )

        # Calculate date range
        date_from, date_to = self._get_date_range(period)

        try:
            # Get category breakdown from repository
            breakdown = await self.transaction_repo.get_category_breakdown(
                user_id=user_id,
                date_from=date_from,
                date_to=date_to,
                transaction_type=TransactionType.EXPENSE,
            )

            # Calculate total amount
            total_amount = sum(item["amount"] for item in breakdown)

            # Transform to response format with colors
            categories = []
            for item in breakdown:
                category_name = item["category_name"]
                color = self.category_colors.get(category_name, "#6B7280")

                categories.append(
                    SpendingCategoryResponse(
                        name=category_name,
                        amount=item["amount"],
                        percentage=round(item["percentage"], 2),
                        color=color,
                        transaction_count=item["transaction_count"],
                        currency=item["currency"],
                    )
                )

            response = SpendingByCategoryResponse(
                categories=categories,
                total_amount=total_amount,
                period=period.value,
                currency="USD",
                last_updated=datetime.now(timezone.utc),
            )

            logger.info(
                f"Successfully fetched {len(categories)} spending categories for user {user_id}"
            )
            return response

        except Exception as e:
            logger.error(
                f"Error fetching spending by category for user {user_id}: {str(e)}"
            )
            # Return empty response on error
            return SpendingByCategoryResponse(
                categories=[],
                total_amount=Decimal("0"),
                period=period.value,
                currency="USD",
                last_updated=datetime.now(timezone.utc),
            )

    async def _calculate_all_wallets(
        self, user_id: str, holdings: Optional[list] = None
    ) -> tuple[Decimal, Decimal, Decimal]:
        """
        Return (life, portfolio, emergency) balances in TWD.

        - Query 1: life + emergency wallets from transactions (INCOME - EXPENSE).
          Cash lives only in the Life/Emergency wallets as transactions (see
          #137) — holdings are never created with wallet_type=emergency
          anymore, so this is the source of truth for the emergency balance.
        - Query 2: portfolio holdings with TWD conversion. Also folds in any
          legacy emergency-wallet holdings from before #137 so historical
          balances for existing users aren't dropped.
        """
        from sqlalchemy import select
        from app.modules.transactions.models import TransactionWalletType
        from app.modules.portfolio.models import PortfolioHolding, HoldingWalletType

        user_uuid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))

        # ── Query 1: life + emergency wallets from transactions ─────────────
        # In TWD, over completed rows: the rule get_summary and the reports use.
        # Summing the raw column counted a US$9,062 purchase as NT$9,062, so the
        # Life wallet and net worth here disagreed with the report's net worth.
        cash = await self.transaction_repo.cash_balances_twd(user_uuid)
        life_wallet = cash.get(TransactionWalletType.LIFE, Decimal("0"))
        emergency_from_transactions = cash.get(TransactionWalletType.EMERGENCY, Decimal("0"))

        # ── Query 2: portfolio holdings with TWD conversion ─────────────────
        from app.utils.exchange_rate_service import ExchangeRateService

        # Reuse caller-provided holdings when available (get_dashboard_stats loads
        # them once and shares with _get_portfolio_summary) to avoid a second
        # identical query per request.
        if holdings is None:
            holdings_result = await self.db.execute(
                select(PortfolioHolding).where(
                    PortfolioHolding.user_id == user_uuid,
                    PortfolioHolding.is_active == True,
                )
            )
            holdings = holdings_result.scalars().all()

        # Pre-fetch all non-TWD exchange rates in one pass (warms the module cache)
        exchange_service = ExchangeRateService(self.db)
        non_twd_currencies = {
            h.currency for h in holdings
            if h.currency and h.currency != "TWD"
        }
        for _currency in non_twd_currencies:
            # One at a time: these share self.db, and a cache miss reads
            # currency_rates on it. ExchangeRateService single-flights the
            # upstream call process-wide, so warming serially costs one API
            # round-trip per distinct currency either way.
            await exchange_service.get_exchange_rate(_currency, "TWD")

        portfolio_wallet = Decimal("0")
        emergency_wallet = emergency_from_transactions

        for h in holdings:
            h_value = h.total_value or Decimal("0")
            if h.currency and h.currency != "TWD" and h_value > 0:
                rate = await exchange_service.get_exchange_rate(h.currency, "TWD")
                if rate:
                    h_value = h_value * rate

            if h.wallet_type == HoldingWalletType.EMERGENCY:
                emergency_wallet += h_value
            else:
                portfolio_wallet += h_value

        logger.info(
            f"Wallets for {user_id}: life={life_wallet}, "
            f"portfolio={portfolio_wallet}, emergency={emergency_wallet}"
        )
        return life_wallet, portfolio_wallet, emergency_wallet

    async def _get_total_debt(self, user_id: str) -> Decimal:
        """Sum current_balance of all active, non-deleted debt accounts."""
        from sqlalchemy import select, func
        from app.modules.loans.models import DebtAccount, LoanStatus

        user_uuid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
        result = await self.db.execute(
            select(func.coalesce(func.sum(DebtAccount.current_balance), 0)).where(
                DebtAccount.user_id == user_uuid,
                DebtAccount.status == LoanStatus.ACTIVE,
                DebtAccount.is_deleted == False,
            )
        )
        return result.scalar_one() or Decimal("0")

    async def get_dashboard_stats(
        self,
        user_id: str,
        period: PeriodEnum = PeriodEnum.THIRTY_DAYS,
        force_refresh: bool = False,
    ) -> DashboardStatsResponse:
        """Get comprehensive dashboard statistics"""

        logger.info(
            f"Fetching dashboard stats for user {user_id}, period {period.value}"
        )

        # Calculate date range
        date_from, date_to = self._get_date_range(period)

        try:
            # Get transaction summary for the selected period (for income/expenses)
            summary = await self.transaction_repo.get_summary(
                user_id=user_id, date_from=date_from, date_to=date_to
            )

            # Get goals summary
            goals_summary = await self._get_goals_summary(user_id)

            # Load active holdings once and share between the portfolio summary and
            # the wallet calc below — both need every active holding + FX, and this
            # used to run the identical query twice per request.
            from uuid import UUID as _UUID
            from app.modules.portfolio.models import PortfolioHolding as _PortfolioHolding
            from sqlalchemy import select as _select
            _uuid = user_id if isinstance(user_id, _UUID) else _UUID(str(user_id))
            _holdings_res = await self.db.execute(
                _select(_PortfolioHolding).where(
                    _PortfolioHolding.user_id == _uuid,
                    _PortfolioHolding.is_active == True,
                )
            )
            shared_holdings = list(_holdings_res.scalars().all())

            # Get portfolio summary (reuses the shared holdings)
            portfolio_summary = await self._get_portfolio_summary(user_id, holdings=shared_holdings)

            # Income/Expenses are for the selected period
            total_income = summary.get("total_income", Decimal("0"))
            total_expenses = summary.get("total_expenses", Decimal("0"))
            # Expenses with the investment purchases taken out — see the query.
            # Only the emergency-fund figure uses this; the savings rate and cash
            # flow still count every outflow, which is what those mean.
            living_expenses = summary.get("living_expenses", total_expenses)

            # Calculate all three wallet balances (transactions query + the shared holdings)
            (
                life_wallet,
                portfolio_wallet,
                emergency_wallet,
            ) = await self._calculate_all_wallets(user_id, holdings=shared_holdings)

            logger.info(
                f"Wallet balances for {user_id}: "
                f"Life={life_wallet}, Portfolio={portfolio_wallet}, "
                f"Emergency={emergency_wallet}"
            )

            # Calculate aggregated totals
            # ==========================================
            # FINANCIAL TERMINOLOGY (see docs/FINANCIAL_TERMINOLOGY.md):
            #
            # Total Asset = Sum of ALL 3 wallets (complete financial picture)
            # Total Debt  = Sum of all active loan balances
            # Net Worth   = Total Asset − Total Debt
            # ==========================================

            # Total Asset = life + portfolio + emergency
            total_asset = life_wallet + portfolio_wallet + emergency_wallet

            logger.info(
                f"Total Asset for {user_id}: "
                f"{life_wallet} + {portfolio_wallet} + {emergency_wallet} = {total_asset}"
            )

            # Total Debt = sum of active loan balances
            total_debt = await self._get_total_debt(user_id)

            # Investment Total = portfolio only (invested assets)
            investment_total = portfolio_wallet

            # True net worth = assets − liabilities
            net_worth = total_asset - total_debt

            # Calculate savings rate
            savings_rate = 0.0
            if total_income > 0:
                savings_rate = float(
                    (total_income - total_expenses) / total_income * 100
                )

            # Legacy fields for backward compatibility
            portfolio_value = portfolio_wallet + emergency_wallet
            total_balance = life_wallet

            response = DashboardStatsResponse(
                # Three wallet system
                life_wallet=life_wallet,
                portfolio_wallet=portfolio_wallet,
                emergency_wallet=emergency_wallet,
                total_asset=total_asset,
                total_debt=total_debt,
                investment_total=investment_total,
                # Legacy fields
                total_balance=total_balance,
                net_worth=net_worth,
                portfolio_value=portfolio_value,
                # Period statistics
                total_income=total_income,
                total_expenses=total_expenses,
                savings_rate=round(savings_rate, 2),
                portfolio_change=portfolio_summary.get("day_change", Decimal("0")),
                monthly_change=total_income - total_expenses,
                upcoming_bills=0,
                investment_return=portfolio_summary.get(
                    "total_gain_loss_percentage", 0.0
                ),
                credit_utilization=0.0,
                emergency_fund_months=self._calc_emergency_fund_months(
                    emergency_wallet, living_expenses, period
                ),
                period=period.value,
                currency="USD",
                last_updated=datetime.now(timezone.utc),
            )

            logger.info(f"Successfully fetched dashboard stats for user {user_id}")
            return response

        except Exception:
            # Propagate so the API returns a real error instead of 200-with-zeros;
            # the frontend can't distinguish "empty account" from "stats broke" otherwise.
            logger.exception(f"Error fetching dashboard stats for user {user_id}")
            raise

    async def get_recent_activity(
        self, user_id: str, limit: int = 10, force_refresh: bool = False
    ) -> List[RecentActivityResponse]:
        """Get recent user activities"""

        logger.info(f"Fetching recent activity for user {user_id}, limit {limit}")

        try:
            activities = []

            # Get recent transactions
            transactions, _ = await self.transaction_repo.get_all(
                user_id=user_id,
                page=1,
                limit=limit,
                sort_by="transaction_date",
                sort_order="desc",
            )

            for transaction in transactions:
                amount = (
                    transaction.amount
                    if transaction.type == TransactionType.INCOME
                    else -transaction.amount
                )
                time_ago = self._get_relative_time(transaction.transaction_date)

                activities.append(
                    RecentActivityResponse(
                        id=str(transaction.id),
                        type="transaction",
                        title=transaction.description,
                        amount=amount,
                        time=time_ago,
                        category=(
                            transaction.category_obj.name
                            if transaction.category_obj
                            else None
                        ),
                        description=f"{transaction.type.value.title()} - {transaction.description}",
                        created_at=transaction.created_at,
                    )
                )

            # Sort by creation time
            activities.sort(key=lambda x: x.created_at, reverse=True)
            activities = activities[:limit]

            logger.info(
                f"Successfully fetched {len(activities)} recent activities for user {user_id}"
            )
            return activities

        except Exception as e:
            logger.error(f"Error fetching recent activity for user {user_id}: {str(e)}")
            return []

    async def get_monthly_trends(
        self, user_id: str, months: int = 6, force_refresh: bool = False
    ) -> MonthlyTrendResponse:
        """Get monthly income/expense trends"""

        logger.info(f"Fetching monthly trends for user {user_id}, months {months}")

        try:
            # Get monthly trends from repository
            trends_data = await self.transaction_repo.get_monthly_trends(
                user_id, months
            )

            # Transform to response format
            trends = []
            for item in trends_data:
                net_savings = item["income"] - item["expenses"]
                month_date = datetime.strptime(item["month"], "%Y-%m")

                trends.append(
                    MonthlyTrendDataPoint(
                        date=item["month"],
                        month=month_date.strftime("%B %Y"),
                        income=item["income"],
                        expenses=item["expenses"],
                        net_savings=net_savings,
                        transaction_count=item["transaction_count"],
                    )
                )

            response = MonthlyTrendResponse(
                trends=trends,
                period=f"{months} months",
                currency="TWD",
                last_updated=datetime.now(timezone.utc),
            )

            logger.info(f"Successfully fetched monthly trends for user {user_id}")
            return response

        except Exception as e:
            logger.error(f"Error fetching monthly trends for user {user_id}: {str(e)}")
            return MonthlyTrendResponse(
                trends=[],
                period=f"{months} months",
                currency="TWD",
                last_updated=datetime.now(timezone.utc),
            )

    def _get_date_range(self, period: PeriodEnum) -> Tuple[date, date]:
        """
        Calculate date range for the given period using standardized date utilities.

        Note: PeriodEnum.MONTH represents "THIS MONTH" (calendar month),
        NOT "last 30 days". Use THIRTY_DAYS for rolling 30-day window.

        Delegates to DateRangeCalculator.get_range_for_dashboard_period, the
        single shared resolver for this vocabulary — other endpoints that
        accept the same period strings (spending/income-by-category) must
        use it too so they can't silently diverge from what /stats shows.
        """
        return DateRangeCalculator.get_range_for_dashboard_period(period.value)

    def _get_relative_time(self, transaction_date: date) -> str:
        """Convert date to relative time string"""
        today = business_today()
        delta = today - transaction_date

        if delta.days == 0:
            return "Today"
        elif delta.days == 1:
            return "Yesterday"
        elif delta.days < 7:
            return f"{delta.days} days ago"
        elif delta.days < 30:
            weeks = delta.days // 7
            return f"{weeks} week{'s' if weeks > 1 else ''} ago"
        elif delta.days < 365:
            months = delta.days // 30
            return f"{months} month{'s' if months > 1 else ''} ago"
        else:
            years = delta.days // 365
            return f"{years} year{'s' if years > 1 else ''} ago"

    def _calc_emergency_fund_months(
        self,
        emergency_wallet: Decimal,
        period_expenses: Decimal,
        period: "PeriodEnum",
    ) -> float:
        """Return how many months the emergency fund covers at current spending rate.

        The window is measured, not looked up. A static period→months table had
        listed three of the eight periods the selector offers and defaulted the
        rest to one month, so the same fund and the same spending rate read six
        times shorter on "6M" than on "30D" — the figure moved when only the
        selector had.

        A table cannot get this right even when complete: "month" and "ytd" are
        to-date windows that grow through the period, and "6m" is anchored to the
        1st of the month six months back, which is 209 days at the end of a long
        August, not 180. Asking `_get_date_range` — the same function that
        selected the expenses — is the only way the numerator and denominator
        describe the same span.
        """
        date_from, date_to = self._get_date_range(period)
        # Both bounds are inclusive — "7d" resolves to a range whose difference
        # is 6 — so the day count needs the +1 that the rest of this file and
        # reports/services.py already apply. Without it every window ran a day
        # short: 3% on 30d, 14% on 7d.
        window_days = max((date_to - date_from).days + 1, 1)
        period_months = Decimal(str(window_days)) / Decimal("30")
        monthly_expenses = Decimal(str(period_expenses)) / period_months
        if monthly_expenses <= 0:
            return 0.0
        return round(float(emergency_wallet / monthly_expenses), 2)

    async def _get_goals_summary(self, user_id: str) -> Dict[str, Any]:
        """Get summary of user's goals - Goals module removed, returning empty data"""
        # Goals module has been removed from the application
        return {
            "active_goals": 0,
            "completed_goals": 0,
            "total_target": Decimal("0"),
            "total_current": Decimal("0"),
        }

    async def _get_portfolio_summary(
        self, user_id: str, holdings: Optional[list] = None
    ) -> Dict[str, Any]:
        """Get summary of user's portfolio"""
        try:
            from uuid import UUID
            from sqlalchemy import select, and_
            from app.modules.portfolio.models import Portfolio, PortfolioHolding

            # user_id might already be a UUID from asyncpg
            user_uuid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))

            # Get all active portfolios for the user
            portfolios_stmt = select(Portfolio).where(
                and_(Portfolio.user_id == user_uuid, Portfolio.is_active == True)
            )
            portfolios_result = await self.db.execute(portfolios_stmt)
            portfolios = portfolios_result.scalars().all()

            if not portfolios:
                return {
                    "total_value": Decimal("0"),
                    "day_change": Decimal("0"),
                    "total_gain_loss_percentage": 0.0,
                }

            # Reuse caller-provided holdings when available (shared with the wallet
            # calc in get_dashboard_stats) instead of re-querying every holding.
            if holdings is None:
                holdings_stmt = select(PortfolioHolding).where(
                    and_(
                        PortfolioHolding.user_id == user_uuid,
                        PortfolioHolding.is_active == True,
                    )
                )
                holdings_result = await self.db.execute(holdings_stmt)
                holdings = holdings_result.scalars().all()

            # Pre-fetch exchange rates for all non-TWD currencies in one pass
            from app.utils.exchange_rate_service import ExchangeRateService
    
            exchange_service = ExchangeRateService(self.db)
            non_twd_currencies = {
                h.currency for h in holdings
                if h.currency and h.currency != "TWD"
            }
            # Serial: shared session (see _calculate_all_wallets).
            for _currency in non_twd_currencies:
                await exchange_service.get_exchange_rate(_currency, "TWD")

            # Calculate aggregated values in TWD
            total_value = Decimal("0")
            total_cost = Decimal("0")
            day_change = Decimal("0")
            # Yesterday's value of only those holdings that actually carry a
            # previous close, so the percentage is measured against the same
            # subset that produced the amount.
            previous_value_basis = Decimal("0")
            top_performers = []

            for holding in holdings:
                h_value = holding.total_value or Decimal("0")
                h_cost = holding.total_cost or Decimal("0")

                # Day change against the provider's own previous close, captured
                # alongside current_price so both describe the same session. A
                # holding not yet repriced has none and contributes nothing —
                # better a smaller true total than a fabricated share of it.
                quantity = holding.quantity or Decimal("0")
                prev_close = holding.previous_close
                h_day_change = Decimal("0")
                h_prev_value = Decimal("0")
                if prev_close and prev_close > 0 and holding.current_price is not None:
                    h_day_change = (holding.current_price - prev_close) * quantity
                    h_prev_value = prev_close * quantity

                # Convert to TWD if the holding is in another currency
                rate = None
                if holding.currency and holding.currency != "TWD" and h_value > 0:
                    rate = await exchange_service.get_exchange_rate(holding.currency, "TWD")
                if rate:
                    h_value = h_value * rate
                    h_cost = h_cost * rate
                    h_day_change = h_day_change * rate
                    h_prev_value = h_prev_value * rate

                total_value += h_value
                total_cost += h_cost
                day_change += h_day_change
                previous_value_basis += h_prev_value

                h_gain_loss = h_value - h_cost
                h_gain_loss_pct = float((h_gain_loss / h_cost) * 100) if h_cost > 0 else 0.0
                top_performers.append({
                    "symbol": holding.symbol,
                    "name": holding.name or holding.symbol,
                    "value": float(h_value),
                    "gainLoss": float(h_gain_loss),
                    "gainLossPercentage": h_gain_loss_pct,
                })

            # Sort by absolute gain/loss descending so the biggest movers appear first
            top_performers.sort(key=lambda x: abs(x["gainLossPercentage"]), reverse=True)

            # Calculate total gain/loss percentage
            total_gain_loss_percentage = 0.0
            total_gain_loss = total_value - total_cost
            if total_cost > 0:
                total_gain_loss_percentage = float((total_gain_loss / total_cost) * 100)

            # Was `total_value * 0.01` — a placeholder that reported a flat +1%
            # every day regardless of the market, left in place while there was
            # no daily price tracking to derive it from. There is now:
            # portfolio_holdings.previous_close is captured with every price
            # update, so this is a real sum.
            day_change_percentage = (
                float((day_change / previous_value_basis) * 100)
                if previous_value_basis > 0
                else 0.0
            )

            return {
                "total_value": total_value,
                "total_gain_loss": total_gain_loss,
                "day_change": day_change,
                "day_change_percentage": day_change_percentage,
                "total_gain_loss_percentage": total_gain_loss_percentage,
                "top_performers": top_performers,
            }
        except Exception as e:
            logger.error(f"Error fetching portfolio summary: {str(e)}")
            logger.exception(e)
            return {
                "total_value": Decimal("0"),
                "total_gain_loss": Decimal("0"),
                "day_change": Decimal("0"),
                "total_gain_loss_percentage": 0.0,
                "top_performers": [],
            }

    async def get_historical_trends(
        self,
        user_id: str,
        period: PeriodEnum = PeriodEnum.THIRTY_DAYS,
        force_refresh: bool = False,
    ) -> HistoricalTrendResponse:
        """Get historical financial trend data for charts with actual portfolio values"""

        logger.info(
            f"Fetching historical trends for user {user_id}, period {period.value}"
        )

        # Calculate date range
        start_date, end_date = self._get_date_range(period)
        days = (end_date - start_date).days + 1

        try:
            # Get all transactions in the date range
            from app.modules.transactions.models import TransactionType
            from sqlalchemy import select, and_, func
            from app.modules.transactions.models import Transaction
            from uuid import UUID

            user_uuid = UUID(user_id)

            # Get transactions ordered by date: completed rows only, as every
            # other total counts them.
            stmt = (
                select(Transaction)
                .where(
                    and_(
                        *self.transaction_repo.counted_conditions(user_uuid),
                        Transaction.transaction_date >= start_date,
                        Transaction.transaction_date <= end_date,
                    )
                )
                .order_by(Transaction.transaction_date.asc())
            )

            result = await self.db.execute(stmt)
            transactions = result.scalars().all()
            # One set of TWD rates for the user's currencies, shared by the
            # opening balance below and the window's per-day sums.
            cash_rates = await self.transaction_repo.twd_rates_for_conditions(
                self.transaction_repo.counted_conditions(user_uuid)
            )

            # Per-day portfolio values, always recomputed — see the note in
            # get_wallet_trends on why the daily_wallet_snapshots fast path was
            # removed rather than repaired.
            portfolio_daily_values = {}
            try:
                from app.modules.portfolio.services import get_portfolio_service
                from app.modules.portfolio.historical_price_service import (
                    get_historical_price_service,
                )

                portfolio_service = get_portfolio_service(self.db)
                portfolio = await portfolio_service.get_default_portfolio(user_uuid)

                if portfolio and portfolio.holdings:
                    # Use the same logic as the daily-performance endpoint
                    hist_price_service = get_historical_price_service(self.db)

                    # Filter tradable holdings
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
                        and not h.symbol.upper().endswith("-SAVINGS")
                        and not h.symbol.upper().endswith("-BUDGET")
                    ]

                    if tradable_holdings:
                        # Batch load historical prices
                        from app.utils.exchange_rate_service import ExchangeRateService

                        exchange_service = ExchangeRateService(self.db)
                        base_currency = (
                            portfolio.currency
                            if hasattr(portfolio, "currency")
                            else "TWD"
                        )

                        # Pre-fetch all unique exchange rates before the date loop
                        _currencies_needed = {
                            h.currency for h in tradable_holdings
                            if h.currency and h.currency != base_currency
                        }
                        # Serial: shared session (see _calculate_all_wallets).
                        for _currency in _currencies_needed:
                            await exchange_service.get_exchange_rate(
                                from_currency=_currency, to_currency=base_currency
                            )

                        last_known_prices = {}

                        # ⚡ OPTIMIZED: Batch load all historical prices in single DB query
                        # Include a 10-day pre-buffer so last_known_prices can be seeded
                        # before the main loop — prevents fallback to live current_price
                        # when start_date falls on a weekend or market holiday.
                        symbols = [h.symbol for h in tradable_holdings]
                        _hist_fetch_start = start_date - timedelta(days=10)
                        all_prices = await hist_price_service.get_batch_price_range(
                            symbols=symbols,
                            start_date=_hist_fetch_start,
                            end_date=end_date,
                        )

                        # Pre-seed last_known_prices from the pre-buffer (newest-to-oldest)
                        for _db in range(1, 11):
                            _pre = (start_date - timedelta(days=_db)).strftime("%Y-%m-%d")
                            for _h in tradable_holdings:
                                if _h.symbol not in last_known_prices:
                                    _e = all_prices.get(_h.symbol, {}).get(_pre)
                                    if _e and _e.get("close"):
                                        last_known_prices[_h.symbol] = Decimal(str(_e["close"]))

                        # Calculate portfolio value for each day
                        current_date = start_date
                        while current_date <= end_date:
                            date_str = current_date.strftime("%Y-%m-%d")
                            daily_value = Decimal("0")

                            for holding in tradable_holdings:
                                # Check if holding was owned on this day
                                purchase_date = (
                                    holding.purchase_date.date()
                                    if isinstance(holding.purchase_date, datetime)
                                    else holding.purchase_date
                                )

                                if purchase_date and purchase_date <= current_date:
                                    # Get price for this day
                                    if (
                                        current_date == end_date
                                        and holding.current_price
                                    ):
                                        price = Decimal(str(holding.current_price))
                                        last_known_prices[holding.symbol] = price
                                    else:
                                        price_data = all_prices.get(
                                            holding.symbol, {}
                                        ).get(date_str)
                                        if price_data and price_data.get("close"):
                                            price = Decimal(str(price_data["close"]))
                                            last_known_prices[holding.symbol] = price
                                        elif holding.symbol in last_known_prices:
                                            price = last_known_prices[holding.symbol]
                                        elif holding.current_price:
                                            price = Decimal(str(holding.current_price))
                                            last_known_prices[holding.symbol] = price
                                        elif holding.average_cost:
                                            price = Decimal(str(holding.average_cost))
                                            last_known_prices[holding.symbol] = price
                                        else:
                                            continue

                                    # Calculate value
                                    holding_value = (
                                        Decimal(str(holding.quantity)) * price
                                    )

                                    # Convert to base currency if needed
                                    holding_currency = (
                                        holding.currency if holding.currency else "USD"
                                    )
                                    if holding_currency != base_currency:
                                        try:
                                            exchange_rate = await exchange_service.get_exchange_rate(
                                                from_currency=holding_currency,
                                                to_currency=base_currency,
                                            )
                                            if exchange_rate:
                                                holding_value = (
                                                    holding_value * exchange_rate
                                                )
                                        except Exception as e:
                                            logger.error(
                                                f"Currency conversion error: {e}"
                                            )

                                    daily_value += holding_value

                            portfolio_daily_values[date_str] = daily_value
                            current_date += timedelta(days=1)

                        logger.info(
                            f"Calculated {len(portfolio_daily_values)} daily portfolio values"
                        )
                    else:
                        logger.info(
                            "No tradable holdings found for portfolio value calculation"
                        )
                else:
                    logger.info("No portfolio or holdings found")

            except Exception as e:
                logger.warning(
                    f"Could not fetch daily portfolio values: {str(e)}, using current value"
                )
                # Fallback to current portfolio value
                portfolio_summary = await self._get_portfolio_summary(user_id)
                current_portfolio_value = portfolio_summary.get(
                    "total_value", Decimal("0")
                )
                current_date = start_date
                while current_date <= end_date:
                    date_str = current_date.strftime("%Y-%m-%d")
                    portfolio_daily_values[date_str] = current_portfolio_value
                    current_date += timedelta(days=1)

            # Get starting balance (all transactions before start_date)

            before_conditions = [
                *self.transaction_repo.counted_conditions(user_uuid),
                Transaction.transaction_date < start_date,
            ]
            stmt_before = select(
                func.sum(await self.transaction_repo.signed_amount_twd(before_conditions, cash_rates))
            ).where(and_(*before_conditions))
            result_before = await self.db.execute(stmt_before)
            starting_balance = result_before.scalar() or Decimal("0")

            # Create a map of dates to data points
            date_map = {}
            current_date = start_date

            # Initialize all dates in range
            while current_date <= end_date:
                date_str = current_date.strftime("%Y-%m-%d")
                date_map[date_str] = {
                    "date": date_str,
                    "income": Decimal("0"),
                    "expenses": Decimal("0"),
                    "balance": starting_balance,
                    "portfolio_value": portfolio_daily_values.get(
                        date_str, Decimal("0")
                    ),
                }
                current_date += timedelta(days=1)

            # Add transaction data to each date
            income_count = 0
            expense_count = 0
            for transaction in transactions:
                date_str = transaction.transaction_date.strftime("%Y-%m-%d")
                if date_str in date_map:
                    amount = to_twd(transaction.amount, transaction.currency, cash_rates)
                    if transaction.type == TransactionType.INCOME:
                        date_map[date_str]["income"] += amount
                        income_count += 1
                    else:
                        date_map[date_str]["expenses"] += amount
                        expense_count += 1

            logger.info(
                f"Processed {len(transactions)} transactions: {income_count} income, {expense_count} expenses"
            )

            # Calculate running balance and net worth for each date
            running_balance = starting_balance
            data_points = []

            for date_str in sorted(date_map.keys()):
                point = date_map[date_str]
                running_balance += point["income"] - point["expenses"]
                portfolio_value = point["portfolio_value"]

                data_points.append(
                    HistoricalTrendDataPoint(
                        date=date_str,
                        income=point["income"],
                        expenses=point["expenses"],
                        balance=running_balance,
                        net_worth=running_balance + portfolio_value,
                        portfolio_value=portfolio_value,
                    )
                )

            response = HistoricalTrendResponse(
                data_points=data_points,
                period=period.value,
                start_date=start_date,
                end_date=end_date,
                currency="TWD",
                last_updated=datetime.now(timezone.utc),
            )

            # Debug: Log sample data points with income/expenses
            sample_points = [p for p in data_points if p.income > 0 or p.expenses > 0][
                :5
            ]
            if sample_points:
                logger.info(f"Sample data points with transactions:")
                for p in sample_points:
                    logger.info(
                        f"  {p.date}: income={p.income}, expenses={p.expenses}, balance={p.balance}"
                    )

            logger.info(
                f"✅ Successfully calculated {len(data_points)} historical trend points with real portfolio values"
            )
            return response

        except Exception as e:
            logger.error(
                f"Error fetching historical trends for user {user_id}: {str(e)}"
            )
            logger.exception(e)
            # Return empty response on error
            return HistoricalTrendResponse(
                data_points=[],
                period=period.value,
                start_date=start_date,
                end_date=end_date,
                currency="TWD",
                last_updated=datetime.now(timezone.utc),
            )

    async def get_wallet_trends(
        self,
        user_id: str,
        period: PeriodEnum = PeriodEnum.THIRTY_DAYS,
        force_refresh: bool = False,
    ) -> WalletTrendResponse:
        """Get daily wallet balance trends for all three wallets"""

        logger.info(f"Fetching wallet trends for user {user_id}, period {period.value}")

        try:
            from sqlalchemy import select, and_
            from app.modules.transactions.models import Transaction

            user_uuid = UUID(user_id)

            # Calculate date range
            date_from, date_to = self._get_date_range(period)
            # Both ends are normalised to plain dates: the day keys are built
            # with date.isoformat(), which on a datetime would yield
            # "…T00:00:00" instead of "YYYY-MM-DD" and silently break every
            # consumer of these maps.
            requested_start = (
                date_from.date() if isinstance(date_from, datetime) else date_from
            )
            end_date = date_to.date() if isinstance(date_to, datetime) else date_to

            # Compute one day earlier than asked. N points span N-1 days, so a
            # caller taking last - first over the window measures a day less
            # than the period it named — the 1st's movement was dropped from
            # "this month" entirely, which is why the dashboard's portfolio
            # delta disagreed with the P&L calendar beside it. The extra day is
            # split back off below as `baseline`, so the charted series is still
            # exactly the requested window.
            start_date = requested_start - timedelta(days=1)

            # There is no snapshot fast path any more: the computation below is
            # a prefix sum over the charted window (~13ms even for the largest
            # account), so precomputing it nightly bought nothing — and its
            # coverage guard silently fell through to this path whenever the
            # job had missed a day, which it had.

            # ========================================
            # 1. Calculate LIFE WALLET (from transactions)
            # ========================================
            from app.modules.transactions.models import TransactionWalletType

            # Everything before the window collapses into one opening balance
            # per wallet, computed in SQL. Loading the user's whole ledger to
            # rebuild it in Python is what made this endpoint scale with
            # account age rather than with the window being charted.
            # In TWD and over completed rows, like every other balance.
            cash_rates = await self.transaction_repo.twd_rates_for_conditions(
                self.transaction_repo.counted_conditions(user_uuid)
            )
            opening_by_wallet = await self.transaction_repo.cash_balances_twd(
                user_uuid, Transaction.transaction_date < start_date, rates=cash_rates
            )

            # ...and only the window's own rows are materialised.
            stmt = (
                select(Transaction)
                .where(
                    and_(
                        *self.transaction_repo.counted_conditions(user_uuid),
                        Transaction.transaction_date >= start_date,
                        Transaction.transaction_date <= end_date,
                    )
                )
                .order_by(Transaction.transaction_date.asc())
            )

            result = await self.db.execute(stmt)
            transactions = result.scalars().all()

            # Filter life wallet transactions
            # Note: Use enum comparison for proper type safety
            life_transactions = [
                t for t in transactions if t.wallet_type == TransactionWalletType.LIFE
            ]
            # Cash lives only in Life/Emergency as transactions (see #137) — the
            # emergency wallet running balance must be derived the same way as
            # life, not just from portfolio_holdings (which no longer ever
            # carries wallet_type=emergency rows).
            emergency_transactions = [
                t for t in transactions if t.wallet_type == TransactionWalletType.EMERGENCY
            ]

            # Calculate daily life / emergency wallet balances as a prefix sum
            # over the window, seeded with the pre-window opening balance.
            life_wallet_balances = _daily_running_balances(
                opening_by_wallet.get(TransactionWalletType.LIFE, Decimal("0")),
                life_transactions,
                start_date,
                end_date,
                rates=cash_rates,
            )

            logger.info(f"Calculated life wallet for {len(life_wallet_balances)} days")

            emergency_wallet_balances = _daily_running_balances(
                opening_by_wallet.get(TransactionWalletType.EMERGENCY, Decimal("0")),
                emergency_transactions,
                start_date,
                end_date,
                rates=cash_rates,
            )

            logger.info(
                f"Calculated emergency wallet for {len(emergency_wallet_balances)} days"
            )

            # ========================================
            # 2. Calculate PORTFOLIO WALLETS (portfolio, emergency)
            # ========================================
            # Get portfolio holdings with daily values
            portfolio_daily_values = {
                "portfolio": {},
                "emergency": {},
            }

            try:
                from app.modules.portfolio.services import get_portfolio_service
                from app.modules.portfolio.historical_price_service import (
                    get_historical_price_service,
                )

                portfolio_service = get_portfolio_service(self.db)
                portfolio = await portfolio_service.get_default_portfolio(user_uuid)

                if portfolio and portfolio.holdings:
                    hist_price_service = get_historical_price_service(self.db)

                    # Filter holdings by wallet type
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

                    # Use enum values for type safety
                    from app.modules.portfolio.models import HoldingWalletType as HWT

                    # Map enum to string keys for the dictionary
                    wallet_type_map = {
                        HWT.PORTFOLIO: "portfolio",
                        HWT.EMERGENCY: "emergency",
                    }

                    holdings_by_wallet = {
                        HWT.PORTFOLIO: [],
                        HWT.EMERGENCY: [],
                    }

                    for holding in portfolio.holdings:
                        if (
                            holding.symbol.upper() not in NON_TRADABLE_SYMBOLS
                            and not holding.symbol.upper().endswith("-SAVINGS")
                            and not holding.symbol.upper().endswith("-BUDGET")
                            and holding.wallet_type in holdings_by_wallet
                        ):
                            holdings_by_wallet[holding.wallet_type].append(holding)

                    # Calculate daily values for each wallet
                    from app.utils.exchange_rate_service import ExchangeRateService

                    exchange_service = ExchangeRateService(self.db)
                    base_currency = "TWD"

                    # Pre-fetch all unique exchange rates across all wallet holdings
                    _all_holdings = [h for hs in holdings_by_wallet.values() for h in hs]
                    _currencies_needed = {
                        h.currency for h in _all_holdings
                        if h.currency and h.currency != base_currency
                    }
                    # Serial: shared session (see _calculate_all_wallets).
                    for _currency in _currencies_needed:
                        await exchange_service.get_exchange_rate(
                            from_currency=_currency, to_currency=base_currency
                        )

                    for wallet_type, holdings in holdings_by_wallet.items():
                        if not holdings:
                            continue

                        # ⚡ OPTIMIZED: Batch load historical prices in single DB query
                        # Include a 10-day pre-buffer so last_known_prices can be seeded
                        # before the loop — prevents fallback to live current_price on
                        # weekends and market holidays.
                        last_known_prices = {}
                        symbols = [h.symbol for h in holdings]
                        _hist_fetch_start = start_date - timedelta(days=10)
                        all_prices = await hist_price_service.get_batch_price_range(
                            symbols=symbols,
                            start_date=_hist_fetch_start,
                            end_date=end_date,
                        )

                        # Pre-seed last_known_prices from the pre-buffer (newest-to-oldest)
                        for _db in range(1, 11):
                            _pre = (start_date - timedelta(days=_db)).strftime("%Y-%m-%d")
                            for _h in holdings:
                                if _h.symbol not in last_known_prices:
                                    _e = all_prices.get(_h.symbol, {}).get(_pre)
                                    if _e and _e.get("close"):
                                        last_known_prices[_h.symbol] = Decimal(str(_e["close"]))

                        # Calculate wallet value for each day
                        current_date = start_date
                        while current_date <= end_date:
                            date_str = current_date.strftime("%Y-%m-%d")
                            daily_value = Decimal("0")

                            for holding in holdings:
                                # Check if holding was owned on this day
                                purchase_date = (
                                    holding.purchase_date.date()
                                    if isinstance(holding.purchase_date, datetime)
                                    else holding.purchase_date
                                )

                                if purchase_date and purchase_date <= current_date:
                                    # Get price for this day
                                    if (
                                        current_date == end_date
                                        and holding.current_price
                                    ):
                                        price = Decimal(str(holding.current_price))
                                        last_known_prices[holding.symbol] = price
                                    else:
                                        price_data = all_prices.get(
                                            holding.symbol, {}
                                        ).get(date_str)
                                        if price_data and price_data.get("close"):
                                            price = Decimal(str(price_data["close"]))
                                            last_known_prices[holding.symbol] = price
                                        elif holding.symbol in last_known_prices:
                                            price = last_known_prices[holding.symbol]
                                        elif holding.current_price:
                                            price = Decimal(str(holding.current_price))
                                        else:
                                            continue

                                    # Calculate value
                                    holding_value = (
                                        Decimal(str(holding.quantity)) * price
                                    )

                                    # Convert to base currency if needed
                                    holding_currency = (
                                        holding.currency if holding.currency else "USD"
                                    )
                                    if holding_currency != base_currency:
                                        try:
                                            exchange_rate = await exchange_service.get_exchange_rate(
                                                from_currency=holding_currency,
                                                to_currency=base_currency,
                                            )
                                            if exchange_rate:
                                                holding_value = (
                                                    holding_value * exchange_rate
                                                )
                                        except Exception as e:
                                            logger.error(
                                                f"Currency conversion error: {e}"
                                            )

                                    daily_value += holding_value

                            # Use the string key for portfolio_daily_values
                            wallet_type_str = wallet_type_map[wallet_type]
                            portfolio_daily_values[wallet_type_str][
                                date_str
                            ] = daily_value
                            current_date += timedelta(days=1)

                        logger.info(
                            f"Calculated {wallet_type.value} wallet for {len(portfolio_daily_values[wallet_type_map[wallet_type]])} days"
                        )

            except Exception as e:
                logger.warning(f"Could not fetch portfolio wallet values: {str(e)}")

            # ========================================
            # 2b. Calculate DEBT BALANCE (loan payment history)
            # ========================================
            from app.modules.loans.models import DebtAccount
            from sqlalchemy import select as sa_select
            from collections import defaultdict

            # All non-deleted loans for this user
            loans_result = await self.db.execute(
                sa_select(DebtAccount).where(
                    DebtAccount.user_id == user_uuid,
                    DebtAccount.is_deleted == False,
                )
            )
            user_loans = loans_result.scalars().all()

            # All expense transactions with a loan_id (payments) up to end_date
            payment_txns_result = await self.db.execute(
                sa_select(Transaction).where(
                    Transaction.user_id == user_uuid,
                    Transaction.loan_id.isnot(None),
                    Transaction.type == TransactionType.EXPENSE,
                    Transaction.is_deleted == False,
                    Transaction.transaction_date <= end_date,
                ).order_by(Transaction.transaction_date.asc())
            )
            payment_txns = payment_txns_result.scalars().all()

            # Build a {loan_id: [sorted payments]} map
            payments_by_loan: dict = defaultdict(list)
            for pt in payment_txns:
                payments_by_loan[pt.loan_id].append(pt)

            # Initialise debt_balances dict with zero for every date in range
            debt_balances: dict = {}
            # Same figures, kept per loan. The total alone cannot answer "how
            # much of this debt was the money I borrowed to invest" — a question
            # the lifecycle page has to answer for a subset of loans the user
            # picks, and which it otherwise has to re-derive client-side from a
            # contractual schedule that drifts on every early or missed payment.
            debt_by_loan: dict = {}
            _init_date = start_date
            while _init_date <= end_date:
                debt_balances[_init_date.strftime("%Y-%m-%d")] = Decimal("0")
                debt_by_loan[_init_date.strftime("%Y-%m-%d")] = {}
                _init_date += timedelta(days=1)

            for loan in user_loans:
                loan_start = (
                    loan.start_date
                    if isinstance(loan.start_date, date)
                    else loan.start_date.date()
                )
                loan_payments = sorted(
                    payments_by_loan.get(loan.id, []),
                    key=lambda t: t.transaction_date,
                )

                principal_paid = Decimal("0")
                payment_idx = 0

                _cur = start_date
                while _cur <= end_date:
                    # Advance payment pointer to include all payments up to _cur
                    while payment_idx < len(loan_payments):
                        pt = loan_payments[payment_idx]
                        pt_date = (
                            pt.transaction_date
                            if isinstance(pt.transaction_date, date)
                            else pt.transaction_date.date()
                        )
                        if pt_date <= _cur:
                            principal_paid += pt.principal_portion or Decimal("0")
                            payment_idx += 1
                        else:
                            break

                    if _cur >= loan_start:
                        balance = max(
                            Decimal("0"),
                            loan.principal_amount - principal_paid,
                        )
                        debt_balances[_cur.strftime("%Y-%m-%d")] += balance
                        debt_by_loan[_cur.strftime("%Y-%m-%d")][str(loan.id)] = balance

                    _cur += timedelta(days=1)

            logger.info(f"Calculated debt balance for {len(debt_balances)} days")

            # ========================================
            # 3. Combine all wallet data
            # ========================================
            data_points = []
            current_date = start_date

            while current_date <= end_date:
                date_str = current_date.strftime("%Y-%m-%d")

                life_wallet = life_wallet_balances.get(date_str, Decimal("0"))
                portfolio_wallet = portfolio_daily_values["portfolio"].get(
                    date_str, Decimal("0")
                )
                emergency_wallet = emergency_wallet_balances.get(
                    date_str, Decimal("0")
                ) + portfolio_daily_values["emergency"].get(date_str, Decimal("0"))

                total_asset = (
                    life_wallet
                    + portfolio_wallet
                    + emergency_wallet
                )
                investment_total = portfolio_wallet

                data_points.append(
                    WalletTrendDataPoint(
                        date=date_str,
                        life_wallet=life_wallet,
                        portfolio_wallet=portfolio_wallet,
                        emergency_wallet=emergency_wallet,
                        total_asset=total_asset,
                        investment_total=investment_total,
                        debt_balance=debt_balances.get(date_str, Decimal("0")),
                        debt_by_loan=debt_by_loan.get(date_str, {}),
                    )
                )

                current_date += timedelta(days=1)

            # The opening day comes back off the front: it is the baseline for
            # a period-over-period delta, not part of the window being charted.
            baseline = data_points[0] if data_points else None
            data_points = data_points[1:]

            response = WalletTrendResponse(
                data_points=data_points,
                baseline=baseline,
                period=period.value,
                start_date=requested_start,
                end_date=end_date,
                currency="TWD",
                last_updated=datetime.now(timezone.utc),
            )

            logger.info(
                f"✅ Successfully calculated {len(data_points)} wallet trend points"
            )
            return response

        except Exception as e:
            logger.error(f"Error fetching wallet trends for user {user_id}: {str(e)}")
            logger.exception(e)
            # Return empty response on error
            return WalletTrendResponse(
                data_points=[],
                period=period.value,
                start_date=start_date,
                end_date=end_date,
                currency="TWD",
                last_updated=datetime.now(timezone.utc),
            )
