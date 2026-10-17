"""
SQLAlchemy models for the LINE Bot shared-expense feature.

LineGroup        — maps a LINE group/room ID to a named expense group.
LineGroupMember  — which Aspiro users have linked and joined a group.
LineUserLink     — maps a LINE user ID to an Aspiro user account.
LineLinkToken    — short-lived token used during the account-linking OAuth flow.
SharedExpense    — a single expense recorded in a group (who paid, how much).
ExpenseSplit     — per-member share of a SharedExpense.
"""

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database.base import BaseModel


class LineGroup(BaseModel):
    """Maps a LINE group/room chat to a named expense-splitting group."""

    __tablename__ = "line_groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    line_group_id: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="TWD")
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    members: Mapped[list["LineGroupMember"]] = relationship(
        "LineGroupMember", back_populates="group", cascade="all, delete-orphan"
    )
    expenses: Mapped[list["SharedExpense"]] = relationship(
        "SharedExpense", back_populates="group", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("idx_line_groups_created_by", "created_by"),)

    def __repr__(self) -> str:
        return f"<LineGroup(line_group_id={self.line_group_id!r}, name={self.name!r})>"


class LineGroupMember(BaseModel):
    """Tracks which Aspiro users have joined a LINE expense group."""

    __tablename__ = "line_group_members"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("line_groups.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    line_user_id: Mapped[str] = mapped_column(String(64), nullable=False)

    group: Mapped["LineGroup"] = relationship("LineGroup", back_populates="members")
    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]

    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_line_group_member"),
        Index("idx_line_group_members_group", "group_id"),
        Index("idx_line_group_members_user", "user_id"),
        Index("idx_line_group_members_line_user", "line_user_id"),
    )

    def __repr__(self) -> str:
        return f"<LineGroupMember(group={self.group_id}, user={self.user_id})>"


class LineUserLink(BaseModel):
    """Maps a LINE user ID to an Aspiro user account after OAuth confirmation."""

    __tablename__ = "line_user_links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    line_user_id: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    display_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]

    __table_args__ = (Index("idx_line_user_links_user_id", "user_id"),)

    def __repr__(self) -> str:
        return f"<LineUserLink(line_user_id={self.line_user_id!r}, user={self.user_id})>"


class LineLinkToken(BaseModel):
    """Short-lived token issued when a LINE user runs /link.

    The frontend visits /link-line?token=<uuid>, the user logs into Aspiro
    (or is already logged in), then the frontend calls POST /line-bot/link-confirm
    with this token + their JWT. The backend resolves the token → line_user_id
    and creates a LineUserLink.
    """

    __tablename__ = "line_link_tokens"

    token: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    line_user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("idx_line_link_tokens_user_used", "line_user_id", "used"),
        Index("idx_line_link_tokens_expires_at", "expires_at"),
    )

    def __repr__(self) -> str:
        return f"<LineLinkToken(token={self.token}, line_user_id={self.line_user_id!r}, used={self.used})>"


class SharedExpense(BaseModel):
    """A single expense entry recorded in a LINE expense group."""

    __tablename__ = "shared_expenses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("line_groups.id", ondelete="CASCADE"), nullable=False
    )
    payer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="TWD")
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    group: Mapped["LineGroup"] = relationship("LineGroup", back_populates="expenses")
    payer: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
    splits: Mapped[list["ExpenseSplit"]] = relationship(
        "ExpenseSplit", back_populates="expense", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_shared_expense_positive"),
        Index("idx_shared_expenses_group", "group_id"),
        Index("idx_shared_expenses_payer", "payer_id"),
        Index("idx_shared_expenses_created_at", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<SharedExpense(id={self.id}, group={self.group_id}, "
            f"amount={self.amount}, desc={self.description!r})>"
        )


class ExpenseSplit(BaseModel):
    """Per-member share of a SharedExpense."""

    __tablename__ = "expense_splits"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    expense_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("shared_expenses.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # ratio stored for future custom-split support (default 1 = equal share)
    ratio: Mapped[Decimal] = mapped_column(Numeric(10, 6), nullable=False, default=Decimal("1"))
    settled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    settled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    expense: Mapped["SharedExpense"] = relationship("SharedExpense", back_populates="splits")
    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]

    __table_args__ = (
        UniqueConstraint("expense_id", "user_id", name="uq_expense_split_member"),
        Index("idx_expense_splits_expense", "expense_id"),
        Index("idx_expense_splits_user", "user_id"),
        Index("idx_expense_splits_settled", "user_id", "settled"),
    )

    def __repr__(self) -> str:
        return (
            f"<ExpenseSplit(expense={self.expense_id}, user={self.user_id}, "
            f"amount={self.amount}, settled={self.settled})>"
        )


class LineBotActivity(BaseModel):
    """Audit log of user interactions with the LINE bot."""

    __tablename__ = "line_bot_activities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("idx_line_bot_activities_user_created", "user_id", "created_at"),
    )


class LineProcessedEvent(BaseModel):
    """Idempotency marker — one row per handled LINE webhook event.

    LINE may re-deliver a webhook batch (network hiccups, its own retries), and
    handling isn't idempotent: a redelivered ``/add`` or ``/txn`` would be
    recorded twice. Before handling an event its ``webhookEventId`` is inserted
    here; a primary-key conflict means it was already processed, so it's skipped.
    Rows are pruned after a short retention (LINE never re-delivers old events).
    """

    __tablename__ = "line_processed_events"

    event_id: Mapped[str] = mapped_column(String(100), primary_key=True)

    __table_args__ = (
        Index("idx_line_processed_events_created_at", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<LineProcessedEvent(event_id={self.event_id!r})>"
