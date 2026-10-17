"""
Pydantic v2 schemas for the peers module.

Request schemas:  PeerInviteRequest, PeerRespondRequest,
                  SharedGoalCreate, SharedGoalContributionUpdate
Response schemas: UserSearchResult, PeerConnectionOut,
                  WalletTotals, PeerStatCard,
                  CompareChartPoint, CompareDataResponse,
                  SharedGoalOut
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Shared / nested schemas
# ---------------------------------------------------------------------------


class UserSearchResult(BaseModel):
    """Public profile returned by the user-search endpoint."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: Optional[str] = None
    name: str
    avatar_url: Optional[str] = None


class WalletTotals(BaseModel):
    """Aggregated wallet balances for a single user."""

    model_config = ConfigDict(from_attributes=True)

    portfolio_total: float = Field(
        default=0.0,
        description="Sum of all active non-cash portfolio holdings (current_value)",
    )
    emergency_total: float = Field(
        default=0.0,
        description="Sum of all active non-cash emergency fund holdings (current_value)",
    )
    cash_total: float = Field(
        default=0.0,
        description="Sum of cash holding quantities across all wallet types",
    )
    life_total: float = Field(
        default=0.0,
        description="Life wallet balance from transaction net (income - expenses)",
    )
    debt_total: float = Field(
        default=0.0,
        description="Outstanding balance of active loans",
    )
    net_worth: float = Field(
        default=0.0,
        description="portfolio_total + emergency_total + cash_total + life_total - debt_total",
    )


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class PeerInviteRequest(BaseModel):
    """Body for POST /peers/invite"""

    username: str = Field(
        ...,
        min_length=1,
        max_length=30,
        description="Username of the user to invite",
    )


class PeerRespondRequest(BaseModel):
    """Body for PATCH /peers/{connection_id}/respond"""

    action: Literal["accept", "decline"]


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class PeerConnectionOut(BaseModel):
    """Peer connection detail returned to the client."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    other_user: UserSearchResult
    status: str
    direction: Literal["sent", "received"]
    created_at: datetime


class PeerStatCard(BaseModel):
    """A single user's stat card for the compare-data view."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    username: Optional[str] = None
    name: str
    avatar_url: Optional[str] = None
    is_self: bool
    wallet_totals: WalletTotals


class CompareChartPoint(BaseModel):
    """One data-point on the comparison chart.

    ``extra="allow"`` is set so that per-user UUID fields can be injected
    dynamically (e.g. ``{"date": "2026-05-23", "<user_uuid>": 42000.0}``).
    """

    model_config = ConfigDict(extra="allow")

    date: str


class CompareDataResponse(BaseModel):
    """Full payload for GET /peers/compare-data"""

    users: list[PeerStatCard]
    chart: list[CompareChartPoint]


# ---------------------------------------------------------------------------
# Shared goal schemas
# ---------------------------------------------------------------------------


class SharedGoalCreate(BaseModel):
    """Body for POST /peers/goals"""

    connection_id: UUID
    title: str = Field(..., min_length=1, max_length=100)
    target_amount: Decimal = Field(..., gt=0, description="Total savings target (> 0)")
    target_date: Optional[date] = None


class SharedGoalContributionUpdate(BaseModel):
    """Body for PATCH /peers/goals/{goal_id}/contribution"""

    amount: Decimal = Field(..., ge=0, description="New absolute contribution amount (>= 0)")


class SharedGoalOut(BaseModel):
    """Shared goal returned to the client.

    Amounts are expressed as floats for easy JSON consumption.
    your_amount / peer_amount are resolved relative to the calling user so
    the frontend never needs to know who is requester vs receiver.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    connection_id: str
    title: str
    target_amount: float
    target_date: Optional[str]   # ISO date string ("YYYY-MM-DD") or None
    status: str

    # Per-participant amounts (perspective of the calling user)
    your_amount: float
    peer_amount: float

    # Display names and IDs for the frontend
    your_name: str
    peer_name: str
    your_user_id: str
    peer_user_id: str

    # Derived totals (computed by the service layer)
    total_amount: float         # your_amount + peer_amount
    progress_pct: float         # min(total_amount / target_amount * 100, 100)
    is_creator: bool            # whether the calling user created this goal

    created_at: str             # ISO datetime string


# ---------------------------------------------------------------------------
# Saving record schemas
# ---------------------------------------------------------------------------


class SavingRecordCreate(BaseModel):
    """Body for POST /peers/goals/{goal_id}/records"""

    amount: Decimal = Field(..., gt=0, description="Amount saved (must be > 0)")
    record_date: date
    note: Optional[str] = Field(None, max_length=200)


class SavingRecordUpdate(BaseModel):
    """Body for PATCH /peers/goals/{goal_id}/records/{record_id}"""

    amount: Optional[Decimal] = Field(None, gt=0)
    record_date: Optional[date] = None
    note: Optional[str] = Field(None, max_length=200)


class SavingRecordOut(BaseModel):
    """Saving record returned to the client."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    goal_id: str
    user_id: str
    user_name: str
    amount: float
    record_date: str    # ISO date "YYYY-MM-DD"
    note: Optional[str]
    created_at: str     # ISO datetime string
