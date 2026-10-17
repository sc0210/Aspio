"""
Goals Database Models

Models for tracking financial goals and milestones.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    String,
    Numeric,
    ForeignKey,
    Enum as SQLEnum,
    Index,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database.base import Base
import enum


class GoalCategory(str, enum.Enum):
    """Goal categories"""

    EMERGENCY_FUND = "emergency_fund"
    RETIREMENT = "retirement"
    HOUSE_DOWN_PAYMENT = "house_down_payment"
    EDUCATION = "education"
    VACATION = "vacation"
    DEBT_PAYOFF = "debt_payoff"
    INVESTMENT = "investment"
    SAVINGS = "savings"
    OTHER = "other"


class GoalPriority(str, enum.Enum):
    """Goal priorities"""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class GoalStatus(str, enum.Enum):
    """Goal status"""

    ACTIVE = "active"
    COMPLETED = "completed"
    PAUSED = "paused"
    CANCELLED = "cancelled"


# Backwards-compatible alias — tests and older code that import GoalType map to GoalCategory
GoalType = GoalCategory


class Goal(Base):
    """Financial goals model"""

    __tablename__ = "goals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Goal details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(
        SQLEnum(GoalCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GoalCategory.SAVINGS,
    )
    priority = Column(
        SQLEnum(GoalPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GoalPriority.MEDIUM,
    )
    status = Column(
        SQLEnum(GoalStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GoalStatus.ACTIVE,
    )

    # Financial details
    target_amount = Column(Numeric(20, 2), nullable=False)
    current_amount = Column(Numeric(20, 2), nullable=False, default=Decimal("0.00"))
    currency = Column(String(3), nullable=False, default="USD")

    # Timeline
    target_date = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Additional data
    extra_data = Column(JSONB, nullable=False, default=dict)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    # Note: User model doesn't have goals back_populates, so we comment this out to avoid warnings
    # user = relationship("User", back_populates="goals")
    milestones = relationship(
        "GoalMilestone", back_populates="goal", cascade="all, delete-orphan"
    )
    contributions = relationship(
        "GoalContribution", back_populates="goal", cascade="all, delete-orphan"
    )

    # Indexes
    __table_args__ = (
        Index("idx_goals_user_status", "user_id", "status"),
        Index("idx_goals_user_category", "user_id", "category"),
        Index("idx_goals_target_date", "target_date"),
    )

    @property
    def progress_percentage(self) -> Decimal:
        """Calculate progress percentage"""
        if self.target_amount <= 0:
            return Decimal("0.00")
        return (self.current_amount / self.target_amount * 100).quantize(
            Decimal("0.01")
        )

    @property
    def remaining_amount(self) -> Decimal:
        """Calculate remaining amount to goal"""
        return max(Decimal("0.00"), self.target_amount - self.current_amount)


class GoalMilestone(Base):
    """Goal milestones model"""

    __tablename__ = "goal_milestones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    goal_id = Column(
        UUID(as_uuid=True),
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Milestone details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    amount = Column(Numeric(20, 2), nullable=False)
    target_date = Column(DateTime(timezone=True), nullable=True)

    # Status
    is_completed = Column(Boolean, nullable=False, default=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Additional data
    extra_data = Column(JSONB, nullable=False, default=dict)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    goal = relationship("Goal", back_populates="milestones")

    # Indexes
    __table_args__ = (
        Index("idx_milestones_goal_completed", "goal_id", "is_completed"),
    )


class GoalContribution(Base):
    """Goal contributions model"""

    __tablename__ = "goal_contributions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    goal_id = Column(
        UUID(as_uuid=True),
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Contribution details
    amount = Column(Numeric(20, 2), nullable=False)
    contribution_date = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    notes = Column(Text, nullable=True)

    # Link to transaction if applicable
    transaction_id = Column(UUID(as_uuid=True), nullable=True)

    # Additional data
    extra_data = Column(JSONB, nullable=False, default=dict)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    goal = relationship("Goal", back_populates="contributions")

    # Indexes
    __table_args__ = (
        Index("idx_contributions_goal_date", "goal_id", "contribution_date"),
    )
