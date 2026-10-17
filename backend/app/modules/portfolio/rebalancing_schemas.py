"""
Rebalancing and Asset Allocation Pydantic schemas for Aspiro FastAPI backend.

This module defines schemas for portfolio rebalancing, asset allocation tracking,
and FX accumulation management based on user-defined target allocations.
"""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class AlertType(str, Enum):
    """Alert type enumeration"""

    REBALANCE_REQUIRED = "rebalance_required"
    FX_CONVERT_READY = "fx_convert_ready"
    LOW_CASH = "low_cash"
    CRYPTO_LOCKED = "crypto_locked"
    DEVIATION_WARNING = "deviation_warning"


class ActionType(str, Enum):
    """Recommended action type"""

    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"
    CONVERT_FX = "convert_fx"


# Asset Allocation Target schemas
class AssetAllocationTarget(BaseModel):
    """Schema for user-defined asset allocation targets"""

    asset_symbol: str = Field(
        ..., description="Asset symbol or category (e.g., 0050, VT, CASH, CRYPTO)"
    )
    asset_name: str = Field(..., description="Asset name for display")
    asset_type: str = Field(..., description="Asset type: stock, etf, crypto, cash")
    target_percentage: Decimal = Field(
        ..., ge=0, le=100, description="Target allocation percentage (0-100)"
    )
    deviation_threshold: Decimal = Field(
        default=Decimal("5.0"), description="Alert when deviation exceeds this %"
    )
    rebalance_enabled: bool = Field(
        default=True, description="Enable automatic rebalancing suggestions"
    )

    @field_validator("target_percentage", "deviation_threshold")
    @classmethod
    def round_to_two_decimals(cls, v):
        return v.quantize(Decimal("0.01"))


# Current Asset Allocation schemas
class CurrentAssetAllocation(BaseModel):
    """Schema for current asset allocation status"""

    asset_symbol: str
    asset_name: str
    asset_type: str
    current_value: Decimal = Field(..., description="Current value in base currency")
    current_percentage: Decimal = Field(
        ..., description="Current allocation percentage"
    )
    target_percentage: Optional[Decimal] = Field(
        None, description="Target allocation percentage"
    )
    deviation: Decimal = Field(
        ..., description="Deviation from target (percentage points)"
    )
    delta_amount: Decimal = Field(
        ..., description="Amount to buy(+) or sell(-) to reach target"
    )
    action: ActionType = Field(..., description="Recommended action")
    color_code: str = Field(default="#6B7280", description="UI color indicator")


class AssetAllocationSummary(BaseModel):
    """Schema for complete asset allocation summary"""

    total_portfolio_value: Decimal
    total_target_value: Decimal
    allocations: List[CurrentAssetAllocation]
    in_balance: bool = Field(..., description="Whether portfolio is within thresholds")
    requires_rebalancing: bool
    largest_deviation: Decimal
    last_rebalance_date: Optional[datetime]
    currency: str = "TWD"
    last_updated: datetime


# Rebalancing Plan schemas
class RebalancingTransaction(BaseModel):
    """Schema for a single rebalancing transaction"""

    asset_symbol: str
    asset_name: str
    action: ActionType
    quantity: Optional[Decimal] = None
    amount: Decimal = Field(..., description="Transaction amount in base currency")
    estimated_fees: Decimal = Field(
        default=Decimal("0"), description="Estimated transaction fees"
    )
    priority: int = Field(default=1, description="Priority order (1=highest)")
    notes: Optional[str] = None


class RebalancingPlan(BaseModel):
    """Schema for complete rebalancing plan"""

    plan_id: str = Field(
        default_factory=lambda: f"plan_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    )
    total_portfolio_value: Decimal
    available_funds: Decimal = Field(
        ..., description="Funds available from overweight assets"
    )
    transactions: List[RebalancingTransaction]
    total_buy_amount: Decimal
    total_sell_amount: Decimal
    total_fees: Decimal
    net_cash_after: Decimal
    target_cash_after: Decimal
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None
    currency: str = "TWD"


# FX Accumulation schemas
class FXAccumulation(BaseModel):
    """Schema for FX accumulation tracking"""

    currency: str = Field(..., description="Foreign currency code (e.g., USD)")
    accumulated_amount: Decimal = Field(
        ..., description="Total accumulated in foreign currency"
    )
    accumulated_twd: Decimal = Field(..., description="Value in TWD at current rate")
    conversion_threshold: Decimal = Field(
        default=Decimal("80000"), description="Convert when TWD value >= this"
    )
    current_fx_rate: Decimal
    ready_to_convert: bool
    estimated_conversion_fee: Decimal = Field(default=Decimal("0"))
    last_conversion_date: Optional[datetime]
    next_conversion_target: Decimal


# Rebalancing Alert schemas
class RebalancingAlert(BaseModel):
    """Schema for rebalancing alerts"""

    alert_type: AlertType
    severity: str = Field(..., description="info, warning, error")
    title: str
    message: str
    affected_assets: List[str]
    deviation_percentage: Optional[Decimal] = None
    suggested_action: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Dashboard Enhanced Metrics schemas
class DashboardMetricsEnhanced(BaseModel):
    """Enhanced dashboard metrics including rebalancing data"""

    # Existing metrics
    total_balance: Decimal
    monthly_income: Decimal
    monthly_expenses: Decimal
    net_worth: Decimal
    savings_rate: Decimal
    portfolio_value: Decimal
    portfolio_growth: Decimal

    # New rebalancing metrics
    available_funds: Decimal = Field(
        ..., description="Funds available from overweight assets for rebalancing"
    )
    fx_accumulation_twd: Decimal = Field(
        default=Decimal("0"), description="Total FX accumulation in TWD"
    )
    fx_ready_to_convert: bool = Field(default=False)
    next_rebalance_date: Optional[datetime] = None
    days_since_rebalance: Optional[int] = None
    rebalancing_required: bool = Field(default=False)
    largest_deviation: Decimal = Field(default=Decimal("0"))

    currency: str = "TWD"
    last_updated: datetime


class DashboardRebalancingData(BaseModel):
    """Complete rebalancing data for dashboard"""

    metrics: DashboardMetricsEnhanced
    allocation_summary: AssetAllocationSummary
    rebalancing_plan: Optional[RebalancingPlan]
    fx_accumulation: List[FXAccumulation]
    alerts: List[RebalancingAlert]
