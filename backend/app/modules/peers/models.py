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
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
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
