"""
Pydantic schemas for reports endpoints.
Response models for the spending, monthly-trend and goals reports.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict


def to_camel(string: str) -> str:
    """Convert snake_case to camelCase"""
    components = string.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


# ============================================================================
# Spending Report Schemas
# ============================================================================


class CategoryBreakdown(BaseModel):
    """Category spending breakdown"""

    category: str
    amount: float
    percentage: float
    transaction_count: int
    color: Optional[str] = None

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


class MonthlyTrend(BaseModel):
    """Monthly spending trend"""

    month: str  # Format: "2024-01"
    amount: float
    income: float
    expenses: float
    net: float

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


class SpendingInsight(BaseModel):
    """Spending insight or recommendation"""

    type: str  # "alert", "warning", "info", "success"
    title: str
    description: str
    impact: Optional[str] = None

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


class ComparisonPeriod(BaseModel):
    """The previous window's totals, for a month-over-month figure.

    A model rather than the `Dict[str, float]` this used to be. The alias
    generator renames *fields*, and never looks inside a dict — so the field
    arrived as `comparisonPeriod` carrying a `net_savings` key, and every
    frontend reading the documented `netSavings` got undefined. The Spending
    tab's "net savings vs previous period" change was blank from the day it
    shipped, while `income` and `expenses` beside it worked, because those are
    single words and snake_case and camelCase spell them the same.
    """

    income: float
    expenses: float
    net_savings: float

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


class SpendingReport(BaseModel):
    """Comprehensive spending analysis report"""

    total_income: float
    total_expenses: float
    net_savings: float
    savings_rate: float
    average_daily_spending: float
    category_breakdown: List[CategoryBreakdown]
    # Income by category, in the same shape as the spending breakdown above.
    income_breakdown: List[CategoryBreakdown] = []
    monthly_trends: List[MonthlyTrend]
    top_merchants: List[Dict[str, Any]]
    insights: List[SpendingInsight]
    comparison_period: Optional[ComparisonPeriod] = None

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


# ============================================================================
# Goals Report Schemas
# ============================================================================


class GoalProgress(BaseModel):
    """Individual goal progress"""

    id: str
    title: str
    category: str
    target_amount: float
    current_amount: float
    progress_percentage: float
    status: str
    target_date: Optional[str] = None
    days_remaining: Optional[int] = None
    on_track: bool
    monthly_required: float

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


class GoalCategory(BaseModel):
    """Goal category summary"""

    category: str
    count: int
    total_target: float
    total_current: float
    average_progress: float

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )


class GoalsReport(BaseModel):
    """Comprehensive goals tracking report"""

    total_goals: int
    active_goals: int
    completed_goals: int
    total_target_amount: float
    total_current_amount: float
    overall_progress: float
    goals_on_track: int
    goals_behind: int
    goal_progress: List[GoalProgress]
    category_summary: List[GoalCategory]
    insights: List[SpendingInsight]

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, alias_generator=to_camel
    )
