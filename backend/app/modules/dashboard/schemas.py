"""
Pydantic schemas for dashboard endpoints in the Aspiro personal finance application.
Defines request/response models for dashboard data and analytics.
"""

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, model_validator
from enum import Enum


class PeriodEnum(str, Enum):
    """Supported time periods for analytics"""

    SEVEN_DAYS = "7d"
    FOURTEEN_DAYS = "14d"
    MONTH = "month"  # Current calendar month
    THIRTY_DAYS = "30d"
    NINETY_DAYS = "90d"
    SIX_MONTHS = "6m"
    ONE_YEAR = "1y"
    YEAR_TO_DATE = "ytd"  # Jan 1 of current year → today


class SpendingCategoryResponse(BaseModel):
    """Response model for spending by category"""

    name: str = Field(..., description="Category name")
    amount: Decimal = Field(..., description="Total amount spent in this category")
    percentage: float = Field(..., description="Percentage of total spending")
    color: str = Field(default="#6B7280", description="Color for chart display")
    transaction_count: Optional[int] = Field(
        default=0, description="Number of transactions"
    )
    currency: str = Field(default="USD", description="Currency code")


class SpendingByCategoryResponse(BaseModel):
    """Response model for spending breakdown by category"""

    categories: List[SpendingCategoryResponse] = Field(default_factory=list)
    total_amount: Decimal = Field(..., description="Total amount across all categories")
    period: str = Field(..., description="Time period analyzed")
    currency: str = Field(default="USD", description="Currency code")
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class DashboardStatsResponse(BaseModel):
    """Response model for dashboard statistics with three-wallet system"""

    # Three Wallet System
    life_wallet: Decimal = Field(
        default=0,
        description="Life wallet balance (daily living)",
        serialization_alias="life_wallet",
    )
    portfolio_wallet: Decimal = Field(
        default=0,
        description="Portfolio wallet (invested assets value)",
        serialization_alias="portfolio_wallet",
    )
    emergency_wallet: Decimal = Field(
        default=0,
        description="Emergency wallet balance (emergency fund)",
        serialization_alias="emergency_wallet",
    )

    # Aggregated totals (see docs/FINANCIAL_TERMINOLOGY.md)
    total_asset: Decimal = Field(
        default=0,
        description="Total asset = SUM of ALL 3 wallets (complete financial picture). Shows everything user owns.",
        serialization_alias="total_asset",
    )
    total_debt: Decimal = Field(
        default=0,
        description="Total liabilities = SUM of all active loan current_balances.",
        serialization_alias="total_debt",
    )
    investment_total: Decimal = Field(
        default=0,
        description="Investment total = portfolio wallet ONLY (actively invested money). Shows stocks/ETFs/crypto value.",
        serialization_alias="investment_total",
    )

    # Legacy fields (for backward compatibility - prefer using total_asset and investment_total)
    total_balance: Decimal = Field(
        default=0,
        description="⚠️ LEGACY: Total account balance (equals life_wallet). Use life_wallet instead.",
    )
    net_worth: Decimal = Field(
        default=0,
        description="True net worth = total_asset − total_debt (assets minus liabilities).",
    )
    portfolio_value: Decimal = Field(
        default=0, description="Total portfolio value (legacy)"
    )

    # Period statistics
    total_income: Decimal = Field(default=0, description="Total income for period")
    total_expenses: Decimal = Field(default=0, description="Total expenses for period")
    savings_rate: float = Field(default=0, description="Savings rate percentage")
    portfolio_change: Decimal = Field(default=0, description="Portfolio change amount")
    monthly_change: Decimal = Field(default=0, description="Monthly change amount")
    upcoming_bills: int = Field(default=0, description="Number of upcoming bills — not yet implemented, always 0")
    investment_return: float = Field(
        default=0, description="Investment return percentage"
    )
    credit_utilization: float = Field(
        default=0, description="Credit utilization percentage — not yet implemented, always 0"
    )
    emergency_fund_months: float = Field(
        default=0, description="Emergency fund coverage in months — not yet implemented, always 0"
    )
    period: str = Field(..., description="Time period for stats")
    currency: str = Field(default="USD", description="Currency code")
    last_updated: datetime = Field(default_factory=datetime.utcnow)

    @model_validator(mode="before")
    @classmethod
    def clean_nan_decimals(cls, data: Any) -> Any:
        """Clean NaN/inf decimal and float values before validation"""
        import math

        if not isinstance(data, dict):
            if hasattr(data, "__dict__"):
                data = data.__dict__.copy()
            else:
                return data

        # All decimal fields that might have NaN
        decimal_fields = [
            "life_wallet",
            "portfolio_wallet",
            "emergency_wallet",
            "total_asset",
            "total_debt",
            "investment_total",
            "total_balance",
            "net_worth",
            "portfolio_value",
            "total_income",
            "total_expenses",
            "portfolio_change",
            "monthly_change",
        ]

        # Float fields that might have NaN/Inf
        float_fields = [
            "savings_rate",
            "portfolio_growth",
            "investment_return",
            "credit_utilization",
            "emergency_fund_months",
        ]

        # Clean decimal fields
        for field in decimal_fields:
            if field in data and data[field] is not None:
                value = data[field]
                if isinstance(value, Decimal):
                    if not value.is_finite():
                        data[field] = Decimal("0")
                else:
                    try:
                        dec_value = Decimal(str(value))
                        if not dec_value.is_finite():
                            data[field] = Decimal("0")
                    except Exception:
                        data[field] = Decimal("0")

        # Clean float fields
        for field in float_fields:
            if field in data and data[field] is not None:
                try:
                    float_val = float(data[field])
                    if not math.isfinite(float_val):
                        data[field] = 0.0
                except Exception:
                    data[field] = 0.0

        return data


class ActivityType(str, Enum):
    """Types of dashboard activities"""

    TRANSACTION = "transaction"
    GOAL_PROGRESS = "goal_progress"
    INVESTMENT = "investment"
    ACHIEVEMENT = "achievement"
    BUDGET_ALERT = "budget_alert"


class RecentActivityResponse(BaseModel):
    """Response model for recent activity items"""

    id: str = Field(..., description="Activity identifier")
    type: ActivityType = Field(..., description="Type of activity")
    title: str = Field(..., description="Activity title")
    amount: Optional[Decimal] = Field(None, description="Associated amount")
    change: Optional[float] = Field(None, description="Change percentage")
    progress: Optional[float] = Field(None, description="Progress percentage")
    time: str = Field(..., description="Relative time (e.g., '2 hours ago')")
    category: Optional[str] = Field(None, description="Activity category")
    description: Optional[str] = Field(None, description="Activity description")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MonthlyTrendDataPoint(BaseModel):
    """Data point for monthly trends"""

    date: str = Field(..., description="Date in YYYY-MM format")
    month: str = Field(..., description="Month name (e.g., 'January 2024')")
    income: Decimal = Field(default=0, description="Income for the month")
    expenses: Decimal = Field(default=0, description="Expenses for the month")
    net_savings: Decimal = Field(default=0, description="Net savings for the month")
    transaction_count: Optional[int] = Field(
        default=0, description="Number of transactions"
    )

    @model_validator(mode="before")
    def clean_nan_decimals(cls, data: Any) -> Any:
        """Clean NaN/Inf decimal values before validation"""
        if not isinstance(data, dict):
            return data

        decimal_fields = ["income", "expenses", "net_savings"]

        for field in decimal_fields:
            if field in data and data[field] is not None:
                value = data[field]
                if isinstance(value, Decimal):
                    if not value.is_finite():
                        data[field] = Decimal("0")
                else:
                    try:
                        dec_value = Decimal(str(value))
                        if not dec_value.is_finite():
                            data[field] = Decimal("0")
                    except Exception:
                        data[field] = Decimal("0")

        return data


class MonthlyTrendResponse(BaseModel):
    """Response model for monthly trend data"""

    trends: List[MonthlyTrendDataPoint] = Field(default_factory=list)
    period: str = Field(..., description="Period analyzed (e.g., '6 months')")
    currency: str = Field(default="USD", description="Currency code")
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class HistoricalTrendDataPoint(BaseModel):
    """Data point for historical financial trends"""

    date: str = Field(..., description="Date in YYYY-MM-DD format")
    income: Decimal = Field(default=0, description="Income for the day")
    expenses: Decimal = Field(default=0, description="Expenses for the day")
    balance: Decimal = Field(default=0, description="Cash balance at end of day")
    net_worth: Decimal = Field(
        default=0, description="Net worth (balance + portfolio) at end of day"
    )
    portfolio_value: Optional[Decimal] = Field(
        default=0, description="Portfolio value at end of day"
    )

    @model_validator(mode="before")
    @classmethod
    def clean_nan_decimals(cls, data: Any) -> Any:
        """Clean NaN/inf decimal values before validation"""
        if not isinstance(data, dict):
            if hasattr(data, "__dict__"):
                data = data.__dict__.copy()
            else:
                return data

        decimal_fields = [
            "income",
            "expenses",
            "balance",
            "net_worth",
            "portfolio_value",
        ]

        for field in decimal_fields:
            if field in data and data[field] is not None:
                value = data[field]
                if isinstance(value, Decimal):
                    if not value.is_finite():
                        data[field] = Decimal("0")
                else:
                    try:
                        dec_value = Decimal(str(value))
                        if not dec_value.is_finite():
                            data[field] = Decimal("0")
                    except Exception:
                        data[field] = Decimal("0")

        return data


class HistoricalTrendResponse(BaseModel):
    """Response model for historical financial trend data"""

    data_points: List[HistoricalTrendDataPoint] = Field(default_factory=list)
    period: str = Field(..., description="Time period analyzed")
    start_date: date = Field(..., description="Start date of the period")
    end_date: date = Field(..., description="End date of the period")
    currency: str = Field(default="USD", description="Currency code")
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class WalletTrendDataPoint(BaseModel):
    """Data point for daily wallet balances"""

    date: str = Field(..., description="Date in YYYY-MM-DD format")
    life_wallet: Decimal = Field(default=0, description="Life wallet balance")
    portfolio_wallet: Decimal = Field(
        default=0, description="Portfolio wallet balance"
    )
    emergency_wallet: Decimal = Field(default=0, description="Emergency wallet balance")
    total_asset: Decimal = Field(default=0, description="Total asset value")
    investment_total: Decimal = Field(
        default=0, description="Investment total (portfolio wallet value)"
    )
    debt_balance: Decimal = Field(default=0, description="Total outstanding loan balance")
    debt_by_loan: Dict[str, Decimal] = Field(
        default_factory=dict,
        description=(
            "Outstanding balance per loan id on this date. The total above cannot "
            "be split after the fact, and a consumer interested in a subset of "
            "loans — the lifecycle page tracks only the ones borrowed to invest — "
            "would otherwise have to re-derive it from a contractual schedule."
        ),
    )

    @model_validator(mode="before")
    def clean_nan_decimals(cls, data: Any) -> Any:
        """Clean NaN/Inf decimal values before validation"""
        if not isinstance(data, dict):
            return data

        decimal_fields = [
            "life_wallet",
            "portfolio_wallet",
            "emergency_wallet",
            "total_asset",
            "investment_total",
            "debt_balance",
        ]

        for field in decimal_fields:
            if field in data and data[field] is not None:
                value = data[field]
                if isinstance(value, Decimal):
                    if not value.is_finite():
                        data[field] = Decimal("0")
                else:
                    try:
                        dec_value = Decimal(str(value))
                        if not dec_value.is_finite():
                            data[field] = Decimal("0")
                    except Exception:
                        data[field] = Decimal("0")

        return data


class WalletTrendResponse(BaseModel):
    """Response model for wallet trend data"""

    data_points: List[WalletTrendDataPoint] = Field(default_factory=list)
    baseline: Optional[WalletTrendDataPoint] = Field(
        default=None,
        description=(
            "Balances at the close of the day BEFORE start_date — where the "
            "period opened. Without it a caller computing last - first over "
            "data_points measures one day less than the period it asked for: "
            "N points span N-1 days, so whatever moved on the first day is "
            "silently dropped. That is what made the dashboard's 'this month' "
            "portfolio delta disagree with the P&L calendar beside it, which "
            "does count the 1st. Kept out of data_points so charts still draw "
            "exactly the window that was requested."
        ),
    )
    period: str = Field(..., description="Time period analyzed")
    start_date: date = Field(..., description="Start date of the period")
    end_date: date = Field(..., description="End date of the period")
    currency: str = Field(default="TWD", description="Currency code")
    last_updated: datetime = Field(default_factory=datetime.utcnow)


# Note: Validators removed to avoid circular import issues
