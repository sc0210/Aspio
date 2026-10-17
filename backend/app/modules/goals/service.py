"""
Goals Service

Business logic for managing financial goals.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import case, literal

from .models import (
    Goal,
    GoalMilestone,
    GoalContribution,
    GoalStatus,
    GoalCategory,
    GoalPriority,
)
from .repositories import GoalRepository
from .schemas import (
    GoalCreate,
    GoalUpdate,
    GoalMilestoneCreate,
    GoalContributionCreate,
    GoalSummary,
)

logger = logging.getLogger(__name__)


def _resolve_enum(enum_cls, value):
    """Convert a string value to the corresponding enum member.

    Handles both enum names ('SAVINGS') and values ('savings').
    Returns the enum instance (SQLAlchemy will handle value conversion).
    Returns None if value is None.
    """
    if value is None:
        return None
    if isinstance(value, enum_cls):
        return value  # Already an enum instance

    logger.debug(
        f"Resolving enum {enum_cls.__name__} with value: {value} (type: {type(value)})"
    )

    # Try by value first (frontend sends lowercase values)
    try:
        result = enum_cls(value)
        logger.debug(f"Resolved by value: {result}")
        return result  # Return the enum instance
    except ValueError as e:
        logger.debug(f"Failed to resolve by value: {e}")
        pass

    # Try by name (UPPERCASE)
    try:
        result = enum_cls[value.upper()]
        logger.debug(f"Resolved by name: {result}")
        return result  # Return the enum instance
    except (KeyError, AttributeError) as e:
        logger.debug(f"Failed to resolve by name: {e}")
        pass

    # Log error and return raw value as fallback
    logger.error(f"Failed to resolve enum {enum_cls.__name__} for value: {value}")
    logger.error(f"Available enum values: {[e.value for e in enum_cls]}")
    logger.error(f"Available enum names: {[e.name for e in enum_cls]}")
    return value  # Return raw value as fallback


class GoalService:
    """Service for managing goals"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repository = GoalRepository(session)

    async def create_goal(self, user_id: UUID, goal_data: GoalCreate) -> Goal:
        """Create a new goal"""
        try:
            goal = Goal(
                user_id=user_id,
                title=goal_data.title,
                description=goal_data.description,
                category=_resolve_enum(GoalCategory, goal_data.category),
                priority=_resolve_enum(GoalPriority, goal_data.priority),
                target_amount=goal_data.target_amount,
                current_amount=goal_data.current_amount or Decimal("0.00"),
                currency=goal_data.currency,
                target_date=goal_data.target_date,
                status=GoalStatus.ACTIVE,
            )

            self.repository.add_goal(goal)
            await self.repository.flush()

            # Add milestones if provided
            if goal_data.milestones:
                for milestone_data in goal_data.milestones:
                    milestone = GoalMilestone(
                        goal_id=goal.id,
                        title=milestone_data.title,
                        description=milestone_data.description,
                        amount=milestone_data.amount,
                        target_date=milestone_data.target_date,
                    )
                    self.repository.add_milestone(milestone)

            await self.session.commit()
            await self.repository.refresh(goal, ["milestones", "contributions"])

            logger.info(f"Goal created successfully: {goal.id}")
            return goal

        except Exception as e:
            logger.error(f"Error creating goal: {str(e)}", exc_info=True)
            raise

    async def get_goal(self, goal_id: UUID, user_id: UUID) -> Optional[Goal]:
        """Get a specific goal"""
        return await self.repository.get_goal_by_id(goal_id, user_id)

    async def list_goals(
        self,
        user_id: UUID,
        status: Optional[str] = None,
        category: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Goal], int]:
        """List goals for a user along with the total count matching the filters."""
        conditions = [Goal.user_id == user_id]

        if status:
            conditions.append(Goal.status == _resolve_enum(GoalStatus, status))
        if category:
            conditions.append(Goal.category == _resolve_enum(GoalCategory, category))

        # Sort by business priority (high → medium → low) then by target date.
        # GoalPriority is a string enum ("high", "medium", "low"); a plain .desc()
        # sorts lexicographically, giving the wrong order ("medium" > "low" > "high").
        # A CASE expression maps each value to an integer rank instead.
        priority_order = case(
            (Goal.priority == GoalPriority.HIGH, literal(1)),
            (Goal.priority == GoalPriority.MEDIUM, literal(2)),
            else_=literal(3),
        )

        goals = await self.repository.list_goals_for_user(
            user_id,
            conditions,
            priority_order,
            skip=skip,
            limit=limit,
        )
        total = await self.repository.count_goals_for_user(conditions)
        return goals, total

    async def update_goal(
        self, goal_id: UUID, user_id: UUID, goal_data: GoalUpdate
    ) -> Optional[Goal]:
        """Update a goal"""
        goal = await self.get_goal(goal_id, user_id)
        if not goal:
            logger.warning(f"Goal {goal_id} not found for user {user_id}")
            return None

        update_data = goal_data.model_dump(exclude_unset=True)

        # Convert enum string values to proper enum members
        enum_fields = {
            "category": GoalCategory,
            "priority": GoalPriority,
            "status": GoalStatus,
        }
        for field, enum_cls in enum_fields.items():
            if field in update_data and update_data[field] is not None:
                update_data[field] = _resolve_enum(enum_cls, update_data[field])

        for key, value in update_data.items():
            setattr(goal, key, value)

        # Auto-complete if target reached
        if (
            goal.current_amount >= goal.target_amount
            and goal.status == GoalStatus.ACTIVE
        ):
            goal.status = GoalStatus.COMPLETED
            goal.completed_at = datetime.now(timezone.utc)
            # Notify the user their goal is complete (best-effort).
            try:
                from app.modules.notifications.services import create_notification
                from app.modules.notifications.models import (
                    NotificationType as _NType,
                    NotificationPriority as _NPri,
                )
                await create_notification(
                    self.session,
                    user_id=goal.user_id,
                    type=_NType.ACHIEVEMENT_UNLOCKED,
                    priority=_NPri.HIGH,
                    title="🎯 Goal reached!",
                    message=f"You completed your goal “{goal.title}”!",
                    related_entity_type="goal",
                    related_entity_id=goal.id,
                )
            except Exception:
                import logging
                logging.getLogger(__name__).warning(
                    "Failed to create goal-completion notification", exc_info=True
                )

        await self.session.commit()
        await self.repository.refresh(goal, ["milestones", "contributions"])
        return goal

    async def delete_goal(self, goal_id: UUID, user_id: UUID) -> bool:
        """Delete a goal"""
        goal = await self.get_goal(goal_id, user_id)
        if not goal:
            return False

        await self.repository.delete_goal(goal)
        await self.session.commit()
        return True

    async def add_contribution(
        self, goal_id: UUID, user_id: UUID, contribution_data: GoalContributionCreate
    ) -> Optional[GoalContribution]:
        """Add a contribution to a goal"""
        goal = await self.get_goal(goal_id, user_id)
        if not goal:
            return None

        contribution = GoalContribution(
            goal_id=goal_id,
            amount=contribution_data.amount,
            contribution_date=contribution_data.contribution_date or datetime.now(timezone.utc),
            notes=contribution_data.notes,
            transaction_id=contribution_data.transaction_id,
        )

        # Update goal's current amount
        goal.current_amount += contribution_data.amount

        # Check if goal is completed
        if (
            goal.current_amount >= goal.target_amount
            and goal.status == GoalStatus.ACTIVE
        ):
            goal.status = GoalStatus.COMPLETED
            goal.completed_at = datetime.now(timezone.utc)

        # Check and complete milestones
        await self._check_milestones(goal)

        self.repository.add_contribution(contribution)
        await self.session.commit()
        await self.repository.refresh(contribution)

        return contribution

    async def _check_milestones(self, goal: Goal):
        """Check and auto-complete milestones based on current amount"""
        for milestone in goal.milestones:
            if not milestone.is_completed and goal.current_amount >= milestone.amount:
                milestone.is_completed = True
                milestone.completed_at = datetime.now(timezone.utc)

    async def get_summary(self, user_id: UUID) -> GoalSummary:
        """Get goals summary using a single DB aggregation query (was: load all + Python loops)."""
        row = await self.repository.get_summary_row(user_id)

        total_target = Decimal(str(row.total_target)) if row else Decimal("0")
        total_current = Decimal(str(row.total_current)) if row else Decimal("0")
        overall_progress = Decimal("0.00")
        if total_target > 0:
            overall_progress = (total_current / total_target * 100).quantize(Decimal("0.01"))

        return GoalSummary(
            total_goals=int(row.total) if row else 0,
            active_goals=int(row.active) if row else 0,
            completed_goals=int(row.completed) if row else 0,
            total_target_amount=total_target,
            total_current_amount=total_current,
            overall_progress=overall_progress,
        )


def get_goal_service(session: AsyncSession) -> GoalService:
    """Dependency injection for goal service"""
    return GoalService(session)
