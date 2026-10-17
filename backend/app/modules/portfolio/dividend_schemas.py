"""
Pydantic schemas for dividend tracking
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, Field, UUID4, ConfigDict


class DividendBase(BaseModel):
    """Base dividend schema"""

    symbol: str = Field(..., min_length=1, max_length=20)
    name: Optional[str] = None
    payment_date: date
    ex_dividend_date: Optional[date] = None
    record_date: Optional[date] = None
    amount_per_share: Decimal = Field(..., gt=0)
    shares_owned: Decimal = Field(..., gt=0)
    total_amount: Decimal
    currency: str = Field(default="USD", min_length=3, max_length=3)
    tax_withheld: Decimal = Field(default=Decimal("0.00"), ge=0)
    net_amount: Optional[Decimal] = None
    status: str = Field(default="received")  # received, pending, estimated
    notes: Optional[str] = None


class DividendCreate(DividendBase):
    """Schema for creating a dividend"""

    holding_id: Optional[UUID4] = None


class DividendUpdate(BaseModel):
    """Schema for updating a dividend"""

    payment_date: Optional[date] = None
    ex_dividend_date: Optional[date] = None
    record_date: Optional[date] = None
    amount_per_share: Optional[Decimal] = None
    shares_owned: Optional[Decimal] = None
    total_amount: Optional[Decimal] = None
    tax_withheld: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    is_reinvested: Optional[bool] = None


class DividendReinvest(BaseModel):
    """Schema for marking dividend as reinvested"""

    reinvestment_shares: Decimal = Field(..., gt=0)
    reinvestment_price: Decimal = Field(..., gt=0)
    reinvestment_holding_id: Optional[UUID4] = None


class DividendResponse(DividendBase):
    """Schema for dividend response"""

    id: UUID4
    user_id: UUID4
    holding_id: Optional[UUID4] = None
    is_reinvested: bool = False
    reinvestment_holding_id: Optional[UUID4] = None
    reinvestment_shares: Optional[Decimal] = None
    reinvestment_price: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DividendSummary(BaseModel):
    """Schema for dividend summary statistics"""

    total_dividends: Decimal
    total_tax_withheld: Decimal
    net_dividends: Decimal
    dividend_count: int
    reinvested_count: int
    reinvested_amount: Decimal
    symbols: list[str]
    currency: str = "USD"


class DividendHistoryFilter(BaseModel):
    """Schema for filtering dividend history"""

    symbol: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    is_reinvested: Optional[bool] = None
    limit: int = Field(default=100, le=1000)
    offset: int = Field(default=0, ge=0)
