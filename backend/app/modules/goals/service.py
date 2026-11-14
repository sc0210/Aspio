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

from app.core.exceptions import BusinessLogicException, ValidationException

from .models import (
    ContributionKind,
    Goal,
    GoalMilestone,
    GoalContribution,
    GoalStatus,
    GoalCategory,
    GoalPriority,
)
from .repositories import GoalRepository
from .reservations import GoalMoney, LifeCash, goal_money, life_cash, lock_user_goals
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

    async def create_goal(
        self, user_id: UUID, goal_data: GoalCreate, *, shared_goal_id: Optional[UUID] = None
    ) -> Goal:
        """Create a new goal (``shared_goal_id``: backing a side of a shared goal)."""
        try:
            goal = Goal(
                shared_goal_id=shared_goal_id,
                user_id=user_id,
                title=goal_data.title,
                description=goal_data.description,
                category=_resolve_enum(GoalCategory, goal_data.category),
                priority=_resolve_enum(GoalPriority, goal_data.priority),
                target_amount=goal_data.target_amount,
                current_amount=Decimal("0.00"),
                currency="TWD",
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

            # Cash already saved for the goal is reserved out of Life, like
            # any later contribution: it has to be there to be set aside.
            if goal_data.current_amount and goal_data.current_amount > 0:
                await self.repository.refresh(goal, ["milestones"])
                await self._reserve(
                    goal, goal_data.current_amount, None, "Already saved when the goal was created"
                )

            await self.session.commit()
            await self.repository.refresh(goal, ["milestones", "contributions"])
            await self.attach_money([goal], user_id)

            logger.info(f"Goal created successfully: {goal.id}")
            return goal

        except Exception as e:
            logger.error(f"Error creating goal: {str(e)}", exc_info=True)
            await self.session.rollback()
            raise

    async def get_goal(self, goal_id: UUID, user_id: UUID) -> Optional[Goal]:
        """Get a specific goal"""
        return await self.repository.get_goal_by_id(goal_id, user_id)

    async def attach_money(self, goals: List[Goal], user_id: UUID) -> List[Goal]:
        """Set reserved/spent/legacy (TWD) on each goal for GoalResponse."""
        money = await goal_money(self.session, user_id, [g.id for g in goals], with_holdings=True)
        for goal in goals:
            m = money.get(goal.id) or GoalMoney()
            goal.reserved_amount = m.reserved
            goal.spent_amount = m.spent
            goal.legacy_amount = m.legacy
            goal.invested_amount = m.invested
            goal.at_risk_amount = m.at_risk
            goal.value_amount = m.value
        return goals

    async def life_cash(self, user_id: UUID) -> LifeCash:
        """The Life Wallet balance, what goals hold of it and what is left."""
        return await life_cash(self.session, user_id)

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
        await self.attach_money(goals, user_id)
        return goals, total

    async def update_goal(
        self, goal_id: UUID, user_id: UUID, goal_data: GoalUpdate
    ) -> Optional[Goal]:
        """Update a goal"""
        update_data = goal_data.model_dump(exclude_unset=True)
        # Cancelling releases the goal's cash, and a new target or status
        # re-judges completion from its progress, so these read the goal under
        # the same lock as a reserve or release (see _locked_goal); otherwise a
        # concurrent reserve's progress could be judged, and written, stale.
        if {"status", "target_amount"} & update_data.keys():
            goal = await self._locked_goal(goal_id, user_id)
        else:
            goal = await self.get_goal(goal_id, user_id)
        if not goal:
            logger.warning(f"Goal {goal_id} not found for user {user_id}")
            return None

        # Convert enum string values to proper enum members
        enum_fields = {
            "category": GoalCategory,
            "priority": GoalPriority,
            "status": GoalStatus,
        }
        for field, enum_cls in enum_fields.items():
            if field in update_data and update_data[field] is not None:
                update_data[field] = _resolve_enum(enum_cls, update_data[field])

        cancelling = (
            update_data.get("status") == GoalStatus.CANCELLED
            and goal.status != GoalStatus.CANCELLED
        )

        for key, value in update_data.items():
            setattr(goal, key, value)

        # A cancelled goal gives its cash back to Life: nothing is set aside
        # for a goal that is no longer pursued.
        if cancelling:
            # No longer pursued, so no longer anyone's side of a shared goal; the
            # user may link a new goal to it.
            goal.shared_goal_id = None
            held = (await goal_money(self.session, user_id, [goal.id])).get(goal.id)
            if held and held.reserved > 0:
                await self._record(goal, ContributionKind.RELEASE, -held.reserved, None,
                             "Released when the goal was cancelled")

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
        await self.attach_money([goal], user_id)
        return goal

    async def delete_goal(self, goal_id: UUID, user_id: UUID) -> bool:
        """Delete a goal"""
        goal = await self.get_goal(goal_id, user_id)
        if not goal:
            return False

        await self.repository.delete_goal(goal)
        await self.session.commit()
        return True

    async def reserve(
        self, goal_id: UUID, user_id: UUID, data: GoalContributionCreate
    ) -> Optional[GoalContribution]:
        """Set Life Wallet cash aside for a goal. No transaction, no wallet move."""
        goal = await self._locked_goal(goal_id, user_id)
        if not goal:
            return None
        try:
            contribution = await self._reserve(goal, data.amount, data.contribution_date, data.notes)
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.repository.refresh(contribution)
        return contribution

    # The old name: POST /goals/{id}/contributions reserves.
    add_contribution = reserve

    async def release(
        self, goal_id: UUID, user_id: UUID, data: GoalContributionCreate
    ) -> Optional[GoalContribution]:
        """Hand reserved cash back to the Life Wallet's available money."""
        goal = await self._locked_goal(goal_id, user_id)
        if not goal:
            return None
        try:
            held = (await goal_money(self.session, user_id, [goal.id])).get(goal.id)
            reserved = held.reserved if held else Decimal("0")
            if data.amount > reserved:
                raise ValidationException(
                    f"Only NT${reserved:,.0f} is reserved for {goal.title}",
                    details={"reserved": str(reserved), "amount": str(data.amount)},
                )
            contribution = await self._record(
                goal, ContributionKind.RELEASE, -data.amount, data.contribution_date, data.notes
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.repository.refresh(contribution)
        return contribution

    async def record_sale_gain(
        self, goal_id: UUID, user_id: UUID, amount: Decimal, when: datetime, notes: str
    ) -> None:
        """Move a goal's progress by a sale's realized gain or loss (caller commits).

        The proceeds already returned to the reserve; this keeps progress (Σ
        rows) equal to the money the goal has, so releasing it all ends at 0.
        """
        goal = await self._locked_goal(goal_id, user_id)
        if goal is not None:
            await self._record(goal, ContributionKind.GAIN, amount.quantize(Decimal("0.01")), when, notes)

    async def _locked_goal(self, goal_id: UUID, user_id: UUID) -> Optional[Goal]:
        """The goal, read after its owner's goals are locked.

        Loading it first would let two quick moves both add to the same stale
        progress figure and lose one of them.
        """
        await lock_user_goals(self.session, user_id)
        return await self.get_goal(goal_id, user_id)

    async def _reserve(
        self, goal: Goal, amount: Decimal, when: Optional[datetime], notes: Optional[str]
    ) -> GoalContribution:
        """Check the cash is free and record the reservation (caller commits)."""
        if goal.status == GoalStatus.CANCELLED:
            raise BusinessLogicException("A cancelled goal cannot hold money")
        await lock_user_goals(self.session, goal.user_id)
        cash = await life_cash(self.session, goal.user_id)
        if amount > cash.available:
            raise ValidationException(
                f"Only NT${max(cash.available, Decimal('0')):,.0f} of your Life Wallet is free to set aside",
                details={"available": str(cash.available), "amount": str(amount)},
            )
        return await self._record(goal, ContributionKind.RESERVE, amount, when, notes)

    async def _record(
        self,
        goal: Goal,
        kind: ContributionKind,
        amount: Decimal,
        when: Optional[datetime],
        notes: Optional[str],
    ) -> GoalContribution:
        """Stage one signed contribution row and move the goal's progress with it."""
        contribution = GoalContribution(
            goal_id=goal.id,
            kind=kind.value,
            amount=amount,
            contribution_date=when or datetime.now(timezone.utc),
            notes=notes,
        )
        self.repository.add_contribution(contribution)
        # Progress is every contribution row (reservations.py). Re-read the sum
        # rather than adding to the loaded figure, so the column cannot drift
        # from the rows whatever ran before.
        goal.current_amount = await self.repository.contribution_total(goal.id)
        if goal.current_amount >= goal.target_amount and goal.status == GoalStatus.ACTIVE:
            goal.status = GoalStatus.COMPLETED
            goal.completed_at = datetime.now(timezone.utc)
        elif goal.current_amount < goal.target_amount and goal.status == GoalStatus.COMPLETED:
            # Releasing below the target reopens it.
            goal.status = GoalStatus.ACTIVE
            goal.completed_at = None
        self._check_milestones_sync(goal)
        return contribution

    async def _check_milestones(self, goal: Goal):
        self._check_milestones_sync(goal)

    @staticmethod
    def _check_milestones_sync(goal: Goal):
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
