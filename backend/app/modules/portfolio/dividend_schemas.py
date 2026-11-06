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
