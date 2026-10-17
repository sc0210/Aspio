"""
Goals Pydantic Schemas

Validation schemas for goals API endpoints.
"""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator, field_serializer
from pydantic.types import UUID4
from enum import Enum


class GoalMilestoneBase(BaseModel):
    """Base milestone schema"""

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    amount: Decimal = Field(..., ge=0)
    target_date: Optional[datetime] = Field(None, serialization_alias="targetDate")


class GoalMilestoneCreate(GoalMilestoneBase):
    """Create milestone schema"""

    pass


class GoalMilestoneResponse(GoalMilestoneBase):
    """Milestone response schema"""

    id: UUID4
    goal_id: UUID4 = Field(serialization_alias="goalId")
    is_completed: bool = Field(serialization_alias="isCompleted")
    completed_at: Optional[datetime] = Field(None, serialization_alias="completedAt")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class GoalBase(BaseModel):
    """Base goal schema"""

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    category: str
    priority: str = "medium"
    target_amount: Decimal = Field(
        ..., ge=0, validation_alias="targetAmount", serialization_alias="targetAmount"
    )
    currency: str = Field("USD", min_length=3, max_length=3)
    target_date: Optional[datetime] = Field(
        None, validation_alias="targetDate", serialization_alias="targetDate"
    )

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("target_date", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        """Convert empty string to None, and normalize date-only strings to datetime"""
        if v == "" or v is None:
            return None
        # Normalize YYYY-MM-DD to full ISO datetime so Pydantic can parse it
        if isinstance(v, str) and len(v) == 10:
            return f"{v}T00:00:00"
        return v

    @field_validator("description", mode="before")
    @classmethod
    def empty_description_to_none(cls, v):
        """Convert empty string to None for description"""
        if v == "":
            return None
        return v


class GoalCreate(GoalBase):
    """Create goal schema"""

    current_amount: Optional[Decimal] = Field(
        Decimal("0.00"),
        ge=0,
        validation_alias="currentAmount",
        serialization_alias="currentAmount",
    )
    milestones: Optional[List[GoalMilestoneCreate]] = []

    model_config = ConfigDict(populate_by_name=True)


class GoalUpdate(BaseModel):
    """Update goal schema"""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    target_amount: Optional[Decimal] = Field(
        None, ge=0, validation_alias="targetAmount", serialization_alias="targetAmount"
    )
    current_amount: Optional[Decimal] = Field(
        None,
        ge=0,
        validation_alias="currentAmount",
        serialization_alias="currentAmount",
    )
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    target_date: Optional[datetime] = Field(
        None, validation_alias="targetDate", serialization_alias="targetDate"
    )

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("target_date", mode="before")
    @classmethod
    def normalize_target_date(cls, v):
        """Accept empty string as None; normalize YYYY-MM-DD to full ISO datetime."""
        if v == "" or v is None:
            return None
        if isinstance(v, str) and len(v) == 10:
            return f"{v}T00:00:00"
        return v


class GoalResponse(GoalBase):
    """Goal response schema"""

    id: UUID4
    user_id: UUID4 = Field(serialization_alias="userId")
    current_amount: Decimal = Field(serialization_alias="currentAmount")
    progress_percentage: Decimal = Field(serialization_alias="progressPercentage")
    remaining_amount: Decimal = Field(serialization_alias="remainingAmount")
    status: str
    started_at: datetime = Field(serialization_alias="startedAt")
    completed_at: Optional[datetime] = Field(None, serialization_alias="completedAt")
    milestones: List[GoalMilestoneResponse] = []
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @field_serializer("category", "priority", "status")
    def serialize_enum(self, value: Any) -> str:
        """Convert enum instances to string values for JSON serialization"""
        if isinstance(value, Enum):
            return value.value
        return str(value) if value else value


class GoalSummary(BaseModel):
    """Goal summary for dashboard"""

    total_goals: int = Field(serialization_alias="totalGoals")
    active_goals: int = Field(serialization_alias="activeGoals")
    completed_goals: int = Field(serialization_alias="completedGoals")
    total_target_amount: Decimal = Field(serialization_alias="totalTargetAmount")
    total_current_amount: Decimal = Field(serialization_alias="totalCurrentAmount")
    overall_progress: Decimal = Field(serialization_alias="overallProgress")

    model_config = ConfigDict(populate_by_name=True)


class GoalContributionCreate(BaseModel):
    """Create contribution schema"""

    amount: Decimal = Field(..., ge=0)
    contribution_date: Optional[datetime] = Field(
        None,
        validation_alias="contributionDate",
        serialization_alias="contributionDate",
    )
    notes: Optional[str] = Field(None, max_length=10000)
    transaction_id: Optional[UUID4] = Field(None, serialization_alias="transactionId")

    model_config = ConfigDict(populate_by_name=True)


class GoalContributionResponse(BaseModel):
    """Contribution response schema"""

    id: UUID4
    goal_id: UUID4 = Field(serialization_alias="goalId")
    amount: Decimal
    contribution_date: datetime = Field(serialization_alias="contributionDate")
    notes: Optional[str] = Field(None, max_length=10000)
    transaction_id: Optional[UUID4] = Field(None, serialization_alias="transactionId")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
