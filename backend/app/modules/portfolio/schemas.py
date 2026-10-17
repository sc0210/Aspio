"""
Portfolio Pydantic schemas for Aspiro FastAPI backend.

This module defines request/response schemas for portfolio operations,
providing validation and serialization for API endpoints.
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator, computed_field, ConfigDict, AliasChoices
from pydantic.types import UUID4

from .manual_pricing import is_manually_priced
from .symbols import (
    canonical_symbol,
    canonical_symbol_for_asset,
    is_tw_code,
    looks_like_stripped_tw_code,
)


class TransactionType(str):
    BUY = "buy"
    SELL = "sell"
    DIVIDEND = "dividend"
    SPLIT = "split"
    TRANSFER = "transfer"
    FEE = "fee"
    TAX = "tax"
    BONUS = "bonus"
    RIGHTS = "rights"
    SPIN_OFF = "spin_off"
    MERGER = "merger"
    CASH_IN = "cash_in"
    CASH_OUT = "cash_out"


# Base schemas
class BasePortfolioSchema(BaseModel):
    """Base schema for portfolio data"""

    name: str = Field(..., min_length=1, max_length=100, description="Portfolio name")
    description: Optional[str] = Field(
        None, max_length=1000, description="Portfolio description"
    )
    currency: str = Field(
        "USD", min_length=3, max_length=3, description="Base currency"
    )
    is_default: bool = Field(False, description="Whether this is the default portfolio")
    auto_update: bool = Field(True, description="Enable automatic price updates")

    @field_validator("currency")
    @classmethod
    def currency_must_be_uppercase(cls, v):
        if v:
            return v.upper()
        return v


class PortfolioCreate(BasePortfolioSchema):
    """Schema for creating a new portfolio"""

    pass


class PortfolioUpdate(BaseModel):
    """Schema for updating portfolio information"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    is_default: Optional[bool] = None
    auto_update: Optional[bool] = None

    @field_validator("currency")
    @classmethod
    def currency_must_be_uppercase(cls, v):
        if v:
            return v.upper()
        return v


# Holding schemas
class BaseHoldingSchema(BaseModel):
    """Base schema for portfolio holding data"""

    symbol: str = Field(..., min_length=1, max_length=20, description="Security symbol")
    name: str = Field(..., min_length=1, max_length=200, description="Security name")
    type: str = Field(..., description="Asset type")
    exchange: str = Field(..., min_length=1, max_length=10, description="Exchange")
    currency: str = Field("USD", min_length=3, max_length=3, description="Currency")
    market: Optional[str] = Field(
        "US", max_length=10, description="Market identifier (US, TW, SG, etc.)"
    )
    sector: Optional[str] = Field(None, max_length=50, description="Sector")
    region: Optional[str] = Field(
        None, max_length=50, description="Region for regional investments"
    )

    @field_validator("symbol")
    @classmethod
    def symbol_must_be_canonical(cls, v):
        # Symbol-only pass here; the type-aware half runs in the model validator
        # below, which is the first point `type` is available.
        return canonical_symbol(v) if v else v

    @model_validator(mode="after")
    def resolve_symbol_against_asset(self):
        """Finish canonicalising once the asset type and market are known.

        Three things the field validator cannot do on its own:

        * **Crypto.** Every bare crypto base is also a live equity ticker, so the
          pair form is only correct for a holding declared as crypto — renaming a
          REIT position in LTC would price Litecoin against it forever.
        * **Market.** Stripping ".TW" while `market` still defaults to "US" sends
          the bare code to the US provider, which does not know it: the holding
          is created with an empty chart and nothing surfaces.
        * **Excel-stripped codes.** `looks_like_stripped_tw_code` guarded the
          import path only, so the API and the Add Holding form still created the
          unpriceable rows the repair migration exists to fix.
        """
        if not self.symbol:
            return self

        if looks_like_stripped_tw_code(self.symbol):
            raise ValueError(
                f"'{self.symbol}' is not a valid ticker. Taiwan codes are at least "
                f"4 digits (0050, 00713); Excel drops the leading zeros when it "
                f"opens a CSV."
            )

        self.symbol = canonical_symbol_for_asset(self.symbol, getattr(self, "type", None))

        if is_tw_code(self.symbol):
            self.market = "TW"

        return self

    @field_validator("currency")
    @classmethod
    def currency_must_be_uppercase(cls, v):
        if v:
            return v.upper()
        return v

    @field_validator("type")
    @classmethod
    def validate_asset_type(cls, v):
        valid_types = [
            "stock",
            "etf",
            "crypto",
            "cryptocurrency",
            "bond",
            "mutual_fund",
            "reit",
            "commodity",
            "forex",
            "cpf",
            "gold_savings",
            "regional_fund",
            "cash",
            "lending",
        ]
        if v not in valid_types:
            raise ValueError(f"Asset type must be one of: {', '.join(valid_types)}")
        return v


class HoldingCreate(BaseHoldingSchema):
    """Schema for creating a new holding"""

    wallet_type: Optional[str] = Field(
        "portfolio",
        description="Wallet type: portfolio or emergency",
    )
    quantity: Decimal = Field(..., ge=0, description="Number of shares/units")
    average_cost: Decimal = Field(
        ...,
        ge=0,
        description="Average cost per share/unit",
        validation_alias=AliasChoices("average_cost", "averageCost", "price"),
    )
    current_price: Optional[Decimal] = Field(
        None, ge=0, description="Current market price", alias="currentPrice"
    )
    purchase_date: Optional[datetime] = Field(
        None, description="Purchase date for this lot", alias="purchaseDate"
    )
    notes: Optional[str] = Field(
        None, max_length=1000, description="Notes for this holding/lot"
    )

    model_config = ConfigDict(populate_by_name=True)


class HoldingUpdate(BaseModel):
    """Schema for updating holding information"""

    wallet_type: Optional[str] = Field(
        None, description="Wallet type: portfolio or emergency"
    )
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    quantity: Optional[Decimal] = Field(
        None, ge=0, description="Number of shares/units"
    )
    average_cost: Optional[Decimal] = Field(
        None, ge=0, description="Average cost per share/unit", alias="averageCost"
    )
    current_price: Optional[Decimal] = Field(
        None,
        ge=0,
        description=(
            "Price per unit, for holdings no feed prices (see manual_pricing). "
            "Applies to every lot of the symbol in the portfolio."
        ),
        alias="currentPrice",
    )
    purchase_date: Optional[datetime] = Field(
        None, description="Purchase date for this lot", alias="purchaseDate"
    )
    notes: Optional[str] = Field(
        None, max_length=1000, description="Notes for this holding/lot"
    )
    sector: Optional[str] = Field(None, max_length=50)
    region: Optional[str] = Field(None, max_length=50)

    model_config = ConfigDict(populate_by_name=True)


# Transaction schemas
class BaseTransactionSchema(BaseModel):
    """Base schema for portfolio transaction data"""

    type: str = Field(..., description="Transaction type")
    symbol: str = Field(..., min_length=1, max_length=20, description="Security symbol")
    quantity: Decimal = Field(..., ge=0, description="Number of shares/units")
    price: Decimal = Field(..., ge=0, description="Price per share/unit")
    fees: Optional[Decimal] = Field(0, ge=0, description="Transaction fees")
    taxes: Optional[Decimal] = Field(0, ge=0, description="Taxes")
    currency: str = Field("USD", min_length=3, max_length=3, description="Currency")
    transaction_date: datetime = Field(..., description="Transaction date")
    exchange: Optional[str] = Field(None, max_length=10, description="Exchange")
    broker: Optional[str] = Field(None, max_length=50, description="Broker name")
    reference_id: Optional[str] = Field(
        None, max_length=100, description="Broker reference ID"
    )
    notes: Optional[str] = Field(None, max_length=1000, description="Transaction notes")
    # Cost basis fields for sell transactions
    cost_basis_method: Optional[str] = Field(
        None, description="Cost basis method: FIFO, LIFO, AVERAGE, SPECIFIC"
    )
    lot_ids: Optional[List[str]] = Field(
        None, description="Specific lot IDs for SPECIFIC method"
    )
    cost_basis: Optional[Decimal] = Field(
        None, description="Total cost basis for this sale"
    )
    capital_gain: Optional[Decimal] = Field(
        None, description="Capital gain/loss (proceeds - cost basis)"
    )

    @field_validator("symbol")
    @classmethod
    def symbol_must_be_canonical(cls, v):
        """Taiwan spelling only — a transaction carries no asset type.

        In practice this does not split a holding from its own transactions:
        `add_holding` writes the holding's already-resolved symbol onto the
        transaction it records, and the sell path copies `holding.symbol`.
        """
        if not v:
            return v
        if looks_like_stripped_tw_code(v):
            raise ValueError(
                f"'{v}' is not a valid ticker. Taiwan codes are at least 4 digits."
            )
        return canonical_symbol(v)

    @field_validator("currency")
    @classmethod
    def currency_must_be_uppercase(cls, v):
        if v:
            return v.upper()
        return v

    @field_validator("type")
    @classmethod
    def validate_transaction_type(cls, v):
        valid_types = [
            "buy",
            "sell",
            "dividend",
            "split",
            "transfer",
            "fee",
            "tax",
            "bonus",
            "rights",
            "spin_off",
            "merger",
            "cash_in",
            "cash_out",
        ]
        if v not in valid_types:
            raise ValueError(
                f"Transaction type must be one of: {', '.join(valid_types)}"
            )
        return v

    @field_validator("quantity")
    @classmethod
    def validate_quantity_for_type(cls, v, info):
        """Validate quantity based on transaction type"""
        transaction_type = info.data.get("type")
        if transaction_type in ["sell"] and v <= 0:
            raise ValueError("Sell transactions must have positive quantity")
        return v


class TransactionCreate(BaseTransactionSchema):
    """Schema for creating a new transaction"""

    pass


class TransactionUpdate(BaseModel):
    """Schema for updating transaction information"""

    quantity: Optional[Decimal] = Field(None, ge=0)
    price: Optional[Decimal] = Field(None, ge=0)
    fees: Optional[Decimal] = Field(None, ge=0)
    taxes: Optional[Decimal] = Field(None, ge=0)
    transaction_date: Optional[datetime] = None
    broker: Optional[str] = Field(None, max_length=50)
    reference_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)


# Response schemas
class HoldingResponse(BaseModel):
    """Schema for holding response data"""

    id: UUID4
    wallet_type: Optional[str] = Field(
        None,
        description="Wallet type: portfolio or emergency",
        serialization_alias="walletType",
    )
    symbol: str
    name: str
    type: str
    exchange: str
    currency: str
    market: str = Field(
        default="US", description="Market identifier (US, TW, SG, etc.)"
    )
    sector: Optional[str]
    region: Optional[str]
    quantity: Decimal
    average_cost: Decimal = Field(serialization_alias="averageCost")
    current_price: Decimal = Field(serialization_alias="currentPrice")
    total_cost: Decimal = Field(serialization_alias="totalCost")
    total_value: Decimal = Field(serialization_alias="totalValue")
    gain_loss: Decimal = Field(serialization_alias="gainLoss")
    gain_loss_percentage: Decimal = Field(
        serialization_alias="gainLossPercentage", description="Simple ROI"
    )
    irr: Optional[Decimal] = Field(
        None, description="Annualized Internal Rate of Return"
    )
    dividend_yield: Optional[Decimal]
    annual_dividend: Optional[Decimal]
    purchase_date: Optional[datetime] = None
    notes: Optional[str] = None
    is_active: bool
    last_price_update_at: Optional[datetime]
    previous_close: Optional[Decimal] = Field(
        None,
        description="Previous trading day's closing price (used for daily change calculation)",
        serialization_alias="previousClose",
    )
    sparkline_data: Optional[List[float]] = Field(
        default_factory=list,
        description="Historical price data for sparkline (last 30 days)",
        serialization_alias="sparklineData",
    )
    metadata: Dict[str, Any] = Field(default_factory=dict, alias="item_metadata")
    created_at: datetime
    updated_at: datetime

    @computed_field(alias="manuallyPriced")
    @property
    def manually_priced(self) -> bool:
        """No feed prices this holding, so its price is the user's to set."""
        return is_manually_priced(self.symbol, self.type)

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        ser_json_by_alias=True,  # Enable serialization by alias for FastAPI JSON responses
    )

    @model_validator(mode="before")
    @classmethod
    def clean_nan_decimals(cls, data: Any) -> Any:
        """Clean NaN/inf decimal values before validation"""
        if not isinstance(data, dict):
            # If it's a model instance, convert to dict
            if hasattr(data, '__dict__'):
                data = data.__dict__.copy()
            else:
                return data
        
        # Fields to check for NaN/inf values
        decimal_fields = [
            'quantity', 'current_price', 'average_cost', 'total_cost',
            'total_value', 'gain_loss', 'gain_loss_percentage',
            'irr', 'dividend_yield', 'annual_dividend'
        ]
        
        for field in decimal_fields:
            if field in data and data[field] is not None:
                value = data[field]
                # Check if it's a Decimal
                if isinstance(value, Decimal):
                    if not value.is_finite():
                        data[field] = Decimal("0")
                # Or try to convert and check
                else:
                    try:
                        dec_value = Decimal(str(value))
                        if not dec_value.is_finite():
                            data[field] = Decimal("0")
                    except Exception:
                        data[field] = Decimal("0")
        
        return data


class TransactionResponse(BaseModel):
    """Schema for transaction response data"""

    id: UUID4
    type: str
    symbol: str
    exchange: Optional[str]
    quantity: Decimal
    price: Decimal
    total_amount: Decimal
    fees: Decimal
    taxes: Decimal
    currency: str
    transaction_date: datetime
    settlement_date: Optional[datetime]
    broker: Optional[str]
    reference_id: Optional[str]
    order_id: Optional[str]
    notes: Optional[str]
    # Cost basis fields for sell transactions
    cost_basis_method: Optional[str] = None
    lot_ids: Optional[List[str]] = None
    cost_basis: Optional[Decimal] = None
    capital_gain: Optional[Decimal] = None
    metadata: Dict[str, Any] = Field(default_factory=dict, alias="item_metadata")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PortfolioResponse(BaseModel):
    """Schema for portfolio response data"""

    id: UUID4
    name: str
    description: Optional[str]
    currency: str
    is_default: bool
    is_active: bool
    auto_update: bool
    total_value: Decimal = Field(serialization_alias="totalValue")
    total_cost: Decimal = Field(serialization_alias="totalCost")
    total_gain_loss: Decimal = Field(serialization_alias="totalGainLoss")
    total_gain_loss_percentage: Decimal = Field(
        serialization_alias="totalGainLossPercentage"
    )
    last_price_update_at: Optional[datetime]
    last_rebalance_at: Optional[datetime]
    metadata: Dict[str, Any] = Field(default_factory=dict, alias="item_metadata")
    created_at: datetime
    updated_at: datetime
    holdings: List[HoldingResponse] = []

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def clean_nan_decimals(cls, data: Any) -> Any:
        """Clean NaN/inf decimal values before validation"""
        if not isinstance(data, dict):
            if hasattr(data, '__dict__'):
                data = data.__dict__.copy()
            else:
                return data
        
        decimal_fields = [
            'total_value', 'total_cost', 'total_gain_loss', 'total_gain_loss_percentage'
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


class PortfolioSummary(BaseModel):
    """Schema for portfolio summary data"""

    id: UUID4
    name: str
    currency: str
    is_default: bool
    total_value: Decimal = Field(serialization_alias="totalValue")
    total_cost: Decimal = Field(serialization_alias="totalCost")
    total_gain_loss: Decimal = Field(serialization_alias="totalGainLoss")
    total_gain_loss_percentage: Decimal = Field(
        serialization_alias="totalGainLossPercentage"
    )
    holdings_count: int
    last_price_update_at: Optional[datetime]
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Analytics schemas
class AssetAllocation(BaseModel):
    """Schema for asset allocation data"""

    type: str
    percentage: Decimal
    value: Decimal
    color: Optional[str] = None


# Market data schemas
class MarketDataResponse(BaseModel):
    """Schema for market data response"""

    symbol: str
    exchange: str
    price: Decimal
    open_price: Optional[Decimal]
    high_price: Optional[Decimal]
    low_price: Optional[Decimal]
    previous_close: Optional[Decimal]
    volume: Optional[Decimal]
    market_cap: Optional[Decimal]
    currency: str
    data_timestamp: datetime
    source: str

    model_config = ConfigDict(from_attributes=True)


# Bulk operation schemas
class BulkTransactionCreate(BaseModel):
    """Schema for creating multiple transactions"""

    transactions: List[TransactionCreate] = Field(..., min_length=1, max_length=100)


class BulkTransactionResponse(BaseModel):
    """Schema for bulk transaction creation response"""

    success_count: int
    error_count: int
    errors: List[Dict[str, Any]] = []
    created_transactions: List[TransactionResponse] = []


# Portfolio performance schemas
class PerformanceMetrics(BaseModel):
    """Schema for portfolio performance metrics"""

    total_return: Decimal
    total_return_percentage: Decimal
    annualized_return: Optional[Decimal]
    volatility: Optional[Decimal]
    sharpe_ratio: Optional[Decimal]
    max_drawdown: Optional[Decimal]
    best_day: Optional[Decimal]
    worst_day: Optional[Decimal]
    up_days: int
    down_days: int
    win_rate: Optional[Decimal]
    hhi: Optional[float] = None  # Herfindahl-Hirschman Index 0-10000
    beta: Optional[float] = None  # Dimson beta vs `benchmark`
    alpha: Optional[float] = None  # Jensen's alpha vs `benchmark`
    benchmark: Optional[str] = None  # e.g. "TAIEX/VT 62/38", or "SPY" as the fallback


class PortfolioPerformance(BaseModel):
    """Schema for portfolio performance over time"""

    portfolio_id: UUID4
    metrics: PerformanceMetrics
    asset_allocation: List[AssetAllocation]
    top_holdings: List[HoldingResponse]
    recent_transactions: List[TransactionResponse]


class HoldingFilters(BaseModel):
    """Schema for holding filtering"""

    type: Optional[str] = Field(None, alias="type")  # Support query param `type`
    asset_type: Optional[str] = None
    exchange: Optional[str] = None
    sector: Optional[str] = None
    region: Optional[str] = None
    min_value: Optional[Decimal] = None
    max_value: Optional[Decimal] = None


class TransactionFilters(BaseModel):
    """Schema for transaction filtering"""

    type: Optional[str] = None
    symbol: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    min_amount: Optional[Decimal] = None
    max_amount: Optional[Decimal] = None


# Pagination schemas
class PaginatedPortfoliosResponse(BaseModel):
    """Schema for paginated portfolio responses"""

    items: List[PortfolioSummary]
    total: int
    page: int
    size: int
    pages: int


class PaginatedHoldingsResponse(BaseModel):
    """Schema for paginated holdings responses"""

    items: List[HoldingResponse]
    total: int
    page: int
    size: int
    pages: int


class PaginatedTransactionsResponse(BaseModel):
    """Schema for paginated transaction responses"""

    items: List[TransactionResponse]
    total: int
    page: int
    size: int
    pages: int
