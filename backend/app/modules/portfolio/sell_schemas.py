"""
Sell transaction schemas for portfolio holdings.
"""

from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field
from pydantic.types import UUID4


class SellHoldingResponse(BaseModel):
    """Response schema for sell transaction"""

    transaction_id: UUID4 = Field(..., description="ID of the created transaction")
    holding_id: UUID4 = Field(..., description="ID of the holding sold")
    symbol: str = Field(..., description="Symbol of the asset sold")
    quantity_sold: Decimal = Field(..., description="Quantity sold")
    sale_price: Decimal = Field(..., description="Price per unit")
    total_proceeds: Decimal = Field(
        ..., description="Total proceeds (quantity * price)"
    )
    fees: Decimal = Field(..., description="Transaction fees")
    taxes: Decimal = Field(..., description="Taxes on sale")
    net_proceeds: Decimal = Field(..., description="Net proceeds after fees and taxes")
    realized_gain_loss: Decimal = Field(
        ..., description="Realized gain/loss on this sale"
    )
    realized_gain_loss_percentage: Decimal = Field(
        ..., description="Realized gain/loss percentage"
    )
    remaining_quantity: Decimal = Field(
        ..., description="Remaining quantity in holding after sale"
    )
    cash_wallet_balance: Decimal = Field(
        ..., description="Net proceeds credited to the Life Wallet from this sale"
    )
    transaction_date: datetime = Field(..., description="Date of transaction")

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "transaction_id": "123e4567-e89b-12d3-a456-426614174001",
                "holding_id": "123e4567-e89b-12d3-a456-426614174000",
                "symbol": "AAPL",
                "quantity_sold": 10,
                "sale_price": 150.50,
                "total_proceeds": 1505.00,
                "fees": 5.99,
                "taxes": 0.00,
                "net_proceeds": 1499.01,
                "realized_gain_loss": 299.01,
                "realized_gain_loss_percentage": 24.92,
                "remaining_quantity": 40,
                "cash_wallet_balance": 15499.01,
                "transaction_date": "2025-12-09T10:30:00Z",
            }
        },
    }


