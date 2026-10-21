"""
Pydantic schemas for the LINE Bot module.

Covers:
  - LINE Messaging API webhook payload shapes
  - API request/response schemas for account linking and expense queries
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# LINE Webhook payload models
# ---------------------------------------------------------------------------


class LineMessageSource(BaseModel):
    type: str  # "user", "group", "room"
    userId: Optional[str] = None
    groupId: Optional[str] = None
    roomId: Optional[str] = None

    @property
    def chat_id(self) -> Optional[str]:
        """Return the group/room ID if present, else None (DM)."""
        return self.groupId or self.roomId

    @property
    def is_group(self) -> bool:
        return self.type in ("group", "room")


class LineMessage(BaseModel):
    id: str
    type: str
    text: Optional[str] = None


class LinePostback(BaseModel):
    data: str
    params: Optional[dict] = None


class LineEvent(BaseModel):
    type: str
    webhookEventId: Optional[str] = None  # stable per-event id used for dedup
    replyToken: Optional[str] = None
    source: LineMessageSource
    timestamp: int
    message: Optional[LineMessage] = None
    postback: Optional[LinePostback] = None

    model_config = {"extra": "allow"}


class LineWebhookPayload(BaseModel):
    destination: str
    events: List[LineEvent]


# ---------------------------------------------------------------------------
# API schemas (REST endpoints called by the frontend)
# ---------------------------------------------------------------------------


class LinkConfirmRequest(BaseModel):
    """Frontend calls this after Google login to complete the LINE link."""
    token: UUID = Field(..., description="Token from the /link LINE command")


class LinkPreviewResponse(BaseModel):
    """Which LINE account a link token would attach, shown before the user confirms."""
    line_display_name: Optional[str] = None
    picture_url: Optional[str] = None
    expires_at: datetime


class LinkConfirmResponse(BaseModel):
    line_user_id: str
    display_name: Optional[str]
    linked_at: datetime


class LinkStatusResponse(BaseModel):
    linked: bool
    line_user_id: Optional[str] = None
    display_name: Optional[str] = None
    line_display_name: Optional[str] = None
    picture_url: Optional[str] = None
    linked_at: Optional[datetime] = None


class LiffSessionRequest(BaseModel):
    """LIFF app exchanges its LINE ID token for an Aspiro session."""
    id_token: str = Field(..., description="ID token from liff.getIDToken()")


class LiffSessionResponse(BaseModel):
    """If the LINE user is already linked, returns an Aspiro access token;
    otherwise linked=False so the LIFF app shows the account-link CTA."""
    linked: bool
    access_token: Optional[str] = None
    display_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Expense / balance schemas (used by the REST read endpoints)
# ---------------------------------------------------------------------------


class GroupOut(BaseModel):
    id: UUID
    line_group_id: str
    name: Optional[str]
    currency: str
    member_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class SplitOut(BaseModel):
    user_id: UUID
    amount: Decimal
    ratio: Decimal = Decimal("1")
    settled: bool
    settled_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ExpenseOut(BaseModel):
    id: UUID
    group_id: UUID
    payer_id: UUID
    amount: Decimal
    currency: str
    description: str
    note: Optional[str]
    created_at: datetime
    splits: List[SplitOut] = []

    model_config = {"from_attributes": True}


class BalanceEntry(BaseModel):
    """Net balance between two users in a group (positive = owed_by owes owed_to)."""
    owed_by: UUID
    owed_to: UUID
    amount: Decimal
    currency: str


class GroupBalanceResponse(BaseModel):
    group_id: UUID
    currency: str
    balances: List[BalanceEntry]
    member_names: dict[str, str] = {}  # UUID str → display_name


class MemberOut(BaseModel):
    user_id: UUID
    display_name: Optional[str]
    line_user_id: str


class LineBotActivityOut(BaseModel):
    id: UUID
    event_type: str
    description: str
    amount: Optional[float] = None
    currency: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Group write schemas (used by the authenticated REST mutation endpoints)
# ---------------------------------------------------------------------------


class SplitInput(BaseModel):
    """One member's explicit share of an expense (custom split)."""
    user_id: UUID
    amount: Decimal = Field(..., gt=0, description="This member's share, > 0")


class ExpenseCreateRequest(BaseModel):
    """POST /line-bot/groups/{group_id}/expenses request body.

    - ``payer_id`` defaults to the current user's group membership when omitted.
    - When ``splits`` is omitted the amount is split equally across all members.
    - When ``splits`` is provided it must cover the full ``amount`` and reference
      only members of the group (custom split).
    """
    amount: Decimal = Field(..., gt=0, description="Total expense amount, > 0")
    description: str = Field(..., min_length=1, max_length=200)
    payer_id: Optional[UUID] = None
    note: Optional[str] = Field(default=None, max_length=500)
    splits: Optional[List[SplitInput]] = None


class ExpenseUpdateRequest(BaseModel):
    """PATCH /line-bot/groups/{group_id}/expenses/{expense_id} request body.

    Every field is optional; omitted fields are left unchanged. When ``amount``
    or ``splits`` change, the per-member splits are recomputed consistently.
    """
    amount: Optional[Decimal] = Field(default=None, gt=0)
    description: Optional[str] = Field(default=None, min_length=1, max_length=200)
    payer_id: Optional[UUID] = None
    note: Optional[str] = Field(default=None, max_length=500)
    splits: Optional[List[SplitInput]] = None


class SettleRequest(BaseModel):
    """POST /line-bot/groups/{group_id}/settle request body.

    Settles a debt where ``owed_by`` owes ``owed_to``. ``amount`` defaults to
    the full outstanding balance between the pair when omitted.
    """
    owed_by: UUID
    owed_to: UUID
    amount: Optional[Decimal] = Field(default=None, gt=0)


class SettleResponse(BaseModel):
    owed_by: UUID
    owed_to: UUID
    amount_settled: Decimal
    currency: str
