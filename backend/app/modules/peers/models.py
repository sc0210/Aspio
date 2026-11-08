"""
SQLAlchemy models for peer connections and shared savings goals.

PeerConnection  — directional invite record: requester → receiver.
                  Once accepted, both users can view comparison data and
                  create shared savings goals together.
SharedGoal      — joint savings goal tied to an accepted peer connection.
                  Each side tracks its own contribution (requester_amount /
                  receiver_amount); the goal auto-completes when the sum
                  reaches target_amount.
"""

import enum
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database.base import BaseModel


class PeerStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REMOVED = "removed"


class PeerConnection(BaseModel):
    """Directional peer connection between two users."""

    __tablename__ = "peer_connections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    requester_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    receiver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Status is stored as VARCHAR(20) in the DB — the ORM maps it via the
    # PeerStatus enum so we get type-safe access while keeping raw SQL simple.
    status: Mapped[PeerStatus] = mapped_column(
        String(20), nullable=False, default=PeerStatus.PENDING
    )

    # Relationships (lazy-loaded; no back_populates to avoid circular imports)
    requester: Mapped["User"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[requester_id]
    )
    receiver: Mapped["User"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[receiver_id]
    )

    # Shared savings goals attached to this connection
    goals: Mapped[list["SharedGoal"]] = relationship(
        "SharedGoal",
        back_populates="connection",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("requester_id != receiver_id", name="no_self_connection"),
        UniqueConstraint("requester_id", "receiver_id", name="unique_pair"),
        Index("idx_peer_conn_requester", "requester_id"),
        Index("idx_peer_conn_receiver", "receiver_id"),
        Index("idx_peer_conn_status", "requester_id", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<PeerConnection(id={self.id}, "
            f"requester={self.requester_id}, "
            f"receiver={self.receiver_id}, "
            f"status={self.status})>"
        )


# ---------------------------------------------------------------------------
# Shared savings goals
# ---------------------------------------------------------------------------


class GoalStatus(str, enum.Enum):
    """Lifecycle states for a SharedGoal."""

    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class SharedGoal(BaseModel):
    """Joint savings goal linked to an accepted peer connection.

    requester_amount  — cumulative contribution from the connection's requester.
    receiver_amount   — cumulative contribution from the connection's receiver.

    When (requester_amount + receiver_amount) >= target_amount the service
    layer automatically transitions status to 'completed'.
    """

    __tablename__ = "shared_goals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("peer_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    target_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False
    )
    target_date: Mapped[Optional[str]] = mapped_column(Date, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[GoalStatus] = mapped_column(
        String(20), nullable=False, default=GoalStatus.active
    )
    # Per-side contributions
    requester_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    receiver_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )

    # Relationship back to the owning PeerConnection
    connection: Mapped["PeerConnection"] = relationship(
        "PeerConnection", back_populates="goals"
    )

    __table_args__ = (
        Index("idx_shared_goals_connection_id", "connection_id"),
        Index("idx_shared_goals_created_by", "created_by"),
    )

    def __repr__(self) -> str:
        return (
            f"<SharedGoal(id={self.id}, "
            f"connection={self.connection_id}, "
            f"title={self.title!r}, "
            f"status={self.status})>"
        )


# ---------------------------------------------------------------------------
# Saving records — per-deposit audit trail for shared goals
# ---------------------------------------------------------------------------


class SavingRecord(BaseModel):
    """Individual saving deposit for a SharedGoal.

    Each row represents a single deposit made by one participant.
    The service layer recalculates requester_amount / receiver_amount on
    the parent SharedGoal whenever a record is added, updated, or deleted.
    """

    __tablename__ = "saving_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("shared_goals.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    record_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    __table_args__ = (
        CheckConstraint("amount > 0", name="saving_record_positive_amount"),
        Index("idx_saving_records_goal_id", "goal_id"),
        Index("idx_saving_records_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<SavingRecord(id={self.id}, "
            f"goal_id={self.goal_id}, "
            f"user_id={self.user_id}, "
            f"amount={self.amount}, "
            f"record_date={self.record_date})>"
        )


# ---------------------------------------------------------------------------
# Split bills between two peers
#
# Share basis: each person's ledger holds only their own share of a bill, as an
# ordinary expense, so every total, review and dashboard figure counts it
# correctly with no aggregation changes. The partner's row exists only once
# they accept. What one owes the other is derived from accepted splits (never
# stored); settling up is recorded separately and writes no transaction.
# ---------------------------------------------------------------------------


class SplitPolicy(str, enum.Enum):
    """How a person handles split proposals from one partner."""

    OFF = "off"                    # the partner can't propose splits
    APPROVE_EACH = "approve_each"  # each proposal waits for an accept (default)
    AUTO_ACCEPT = "auto_accept"    # proposals are accepted on arrival


class PeerConnectionPref(BaseModel):
    """One person's settings for one connection.

    Keyed by (connection, user), never by requester/receiver side: re-inviting
    after a remove swaps those sides, which once credited each person with the
    other's goal savings.
    """

    __tablename__ = "peer_connection_prefs"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("peer_connections.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    split_policy: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SplitPolicy.APPROVE_EACH.value
    )
    # Bell notifications about bills and repayments with this partner. Off mutes
    # them only: proposals still wait in the Shared spending inbox.
    split_notifications: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


class SplitMethod(str, enum.Enum):
    EQUAL = "equal"
    PERCENT = "percent"
    FIXED = "fixed"


class SplitStatus(str, enum.Enum):
    PROPOSED = "proposed"   # waiting for the partner
    ACTIVE = "active"       # the partner accepted
    DECLINED = "declined"   # the partner declined; the creator keeps their row
    VOIDED = "voided"       # the creator withdrew it before an answer


class ShareStatus(str, enum.Enum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DECLINED = "declined"


class PeerSplit(BaseModel):
    """A bill shared between the two people on a connection."""

    __tablename__ = "peer_splits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("peer_connections.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    payer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TWD")
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transaction_categories.id", ondelete="SET NULL"), nullable=True
    )
    split_date: Mapped[date] = mapped_column(Date, nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False, default=SplitMethod.EQUAL.value)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=SplitStatus.PROPOSED.value)
    # Set when the split was made from an expense already in the payer's ledger
    # ("Split this"): that row is the payer's, so closing the split must hand it
    # back whole, never delete it.
    source_transaction_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        # transactions -> shares -> splits -> transactions is a cycle: use_alter
        # lets metadata order the tables. Named as Postgres names it, which is
        # what the migration and prod SQL create.
        ForeignKey("transactions.id", ondelete="SET NULL", use_alter=True,
                   name="peer_splits_source_transaction_id_fkey"),
        nullable=True,
    )

    shares: Mapped[list["PeerSplitShare"]] = relationship(
        "PeerSplitShare", back_populates="split", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint("total_amount > 0", name="peer_split_positive_total"),
        Index("idx_peer_splits_connection", "connection_id"),
    )


class PeerSplitShare(BaseModel):
    """One person's part of a split. transaction_id is their ledger row, if any."""

    __tablename__ = "peer_split_shares"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    split_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("peer_splits.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    share_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=ShareStatus.PROPOSED.value)

    split: Mapped["PeerSplit"] = relationship("PeerSplit", back_populates="shares")

    __table_args__ = (
        UniqueConstraint("split_id", "user_id", name="peer_split_share_once_per_user"),
        CheckConstraint("share_amount >= 0", name="peer_split_share_non_negative"),
        Index("idx_peer_split_shares_user", "user_id"),
    )


class SettlementStatus(str, enum.Enum):
    PROPOSED = "proposed"    # the person who owes said they paid; waiting for the other
    CONFIRMED = "confirmed"  # counts against the balance
    DECLINED = "declined"    # the person owed said it didn't arrive
    VOIDED = "voided"        # withdrawn (proposed) or undone (confirmed)


class PeerSettlement(BaseModel):
    """Money one person paid the other back, against what accepted splits left
    them owing. It writes no ledger rows: each ledger already holds only its
    owner's share, so the repayment is already accounted for."""

    __tablename__ = "peer_settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("peer_connections.id", ondelete="CASCADE"), nullable=False
    )
    from_user_id: Mapped[uuid.UUID] = mapped_column(  # who paid back (owed)
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    to_user_id: Mapped[uuid.UUID] = mapped_column(  # who was paid (was owed)
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TWD")
    settled_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=SettlementStatus.PROPOSED.value)

    __table_args__ = (
        CheckConstraint("amount > 0", name="peer_settlement_positive_amount"),
        CheckConstraint("from_user_id <> to_user_id", name="peer_settlement_two_people"),
        Index("idx_peer_settlements_connection", "connection_id"),
        Index("idx_peer_settlements_from_user", "from_user_id"),
        Index("idx_peer_settlements_to_user", "to_user_id"),
    )
