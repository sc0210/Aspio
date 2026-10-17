"""
Repository layer for goals database operations in the Aspiro personal finance application.

Handles all raw database interactions for goals, milestones and contributions using
SQLAlchemy 2.0 async patterns. Business logic (gamification rules, milestone/streak
calculations, enum resolution, status transitions) lives in the service layer.

Convention: repository methods persist via ``flush()`` and never ``commit()``.
The service layer owns transaction boundaries and is responsible for committing.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import (
    Goal,
    GoalMilestone,
    GoalContribution,
    GoalStatus,
)


class GoalRepository:
    """Repository for goal, milestone and contribution database operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Goals
    # ------------------------------------------------------------------

    def add_goal(self, goal: Goal) -> Goal:
        """Stage a new goal in the session (no flush/commit)."""
        self.db.add(goal)
        return goal

    async def flush(self) -> None:
        """Flush pending changes to the database without committing."""
        await self.db.flush()

    async def refresh(self, instance, attribute_names: Optional[List[str]] = None) -> None:
        """Refresh an instance, optionally loading specific relationships."""
        await self.db.refresh(instance, attribute_names)

    async def get_goal_by_id(self, goal_id: UUID, user_id: UUID) -> Optional[Goal]:
        """Get a single goal for a user, eager-loading milestones and contributions."""
        query = (
            select(Goal)
            .where(and_(Goal.id == goal_id, Goal.user_id == user_id))
            .options(selectinload(Goal.milestones), selectinload(Goal.contributions))
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_goals_for_user(
        self,
        user_id: UUID,
        conditions: list,
        priority_order,
        skip: int = 0,
        limit: int = 50,
    ) -> List[Goal]:
        """List goals for a user with pre-built filter conditions and ordering.

        ``conditions`` and ``priority_order`` are constructed by the service so that
        all business rules (enum resolution, priority ranking) stay in the service.
        """
        query = (
            select(Goal)
            .where(and_(*conditions))
            .options(selectinload(Goal.milestones), selectinload(Goal.contributions))
            .order_by(priority_order, Goal.target_date.asc())
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def count_goals_for_user(self, conditions: list) -> int:
        """Count goals matching the same pre-built filter conditions as the list query."""
        result = await self.db.execute(
            select(func.count(Goal.id)).where(and_(*conditions))
        )
        return int(result.scalar_one())

    async def delete_goal(self, goal: Goal) -> None:
        """Delete a goal (cascade removes milestones/contributions)."""
        await self.db.delete(goal)

    async def get_summary_row(self, user_id: UUID):
        """Return a single aggregated summary row for a user's goals."""
        result = await self.db.execute(
            select(
                func.count(Goal.id).label("total"),
                func.coalesce(
                    func.sum(case((Goal.status == GoalStatus.ACTIVE, 1), else_=0)), 0
                ).label("active"),
                func.coalesce(
                    func.sum(case((Goal.status == GoalStatus.COMPLETED, 1), else_=0)), 0
                ).label("completed"),
                func.coalesce(
                    func.sum(
                        case(
                            (Goal.status == GoalStatus.ACTIVE, Goal.target_amount),
                            else_=0,
                        )
                    ),
                    0,
                ).label("total_target"),
                func.coalesce(
                    func.sum(
                        case(
                            (Goal.status == GoalStatus.ACTIVE, Goal.current_amount),
                            else_=0,
                        )
                    ),
                    0,
                ).label("total_current"),
            ).where(Goal.user_id == user_id)
        )
        return result.first()

    # ------------------------------------------------------------------
    # Milestones
    # ------------------------------------------------------------------

    def add_milestone(self, milestone: GoalMilestone) -> GoalMilestone:
        """Stage a new milestone in the session (no flush/commit)."""
        self.db.add(milestone)
        return milestone

    # ------------------------------------------------------------------
    # Contributions
    # ------------------------------------------------------------------

    def add_contribution(self, contribution: GoalContribution) -> GoalContribution:
        """Stage a new contribution in the session (no flush/commit)."""
        self.db.add(contribution)
        return contribution
