"""Tests for GoalService — the real one.

Replaces test_goals_gamification.py, which imported GamificationService,
UserStreak, AchievementBadge and friends from app.modules.goals. None of those
exist: gamification was built under app/modules/users/ instead, and the goals
package has service.py (singular), not services.py. The whole module was
therefore skipped by an ImportError guard reading "not yet implemented" — 17
tests that could never run, while `app/modules/goals/service.py` sat at 18%
coverage and looked tested because two goals test files existed.

Gamification itself is covered by tests/test_user_gamification.py against the
service that actually ships. What was missing is the goals business logic, so
that is what this covers: creation, milestones, contributions, auto-completion,
user scoping, and the summary aggregation.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.modules.goals.models import GoalCategory, GoalPriority, GoalStatus
from app.modules.goals.schemas import (
    GoalContributionCreate,
    GoalCreate,
    GoalMilestoneCreate,
    GoalUpdate,
)
from app.modules.goals.service import GoalService


def _goal_payload(**overrides):
    data = dict(
        title="Emergency Fund",
        description="six months of expenses",
        category=GoalCategory.EMERGENCY_FUND.value,
        priority=GoalPriority.HIGH.value,
        target_amount=Decimal("1000.00"),
        currency="TWD",
        target_date=datetime.now(timezone.utc) + timedelta(days=180),
    )
    data.update(overrides)
    return GoalCreate(**data)


@pytest.fixture
def service(async_session):
    return GoalService(async_session)


@pytest.mark.asyncio
async def test_create_goal_defaults_to_active_with_zero_progress(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())

    assert goal.id is not None
    assert goal.user_id == test_user.id
    assert goal.status is GoalStatus.ACTIVE
    assert goal.current_amount == Decimal("0.00")
    assert goal.target_amount == Decimal("1000.00")
    assert goal.currency == "TWD"


@pytest.mark.asyncio
async def test_create_goal_persists_milestones(service, test_user):
    goal = await service.create_goal(
        test_user.id,
        _goal_payload(
            milestones=[
                GoalMilestoneCreate(title="Quarter", amount=Decimal("250.00")),
                GoalMilestoneCreate(title="Half", amount=Decimal("500.00")),
            ]
        ),
    )

    assert sorted(m.title for m in goal.milestones) == ["Half", "Quarter"]
    assert all(m.is_completed is False for m in goal.milestones)


@pytest.mark.asyncio
async def test_contribution_advances_progress(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())

    contribution = await service.add_contribution(
        goal.id, test_user.id, GoalContributionCreate(amount=Decimal("300.00"))
    )

    assert contribution is not None
    assert contribution.amount == Decimal("300.00")

    refreshed = await service.get_goal(goal.id, test_user.id)
    assert refreshed.current_amount == Decimal("300.00")
    assert refreshed.status is GoalStatus.ACTIVE


@pytest.mark.asyncio
async def test_goal_auto_completes_when_target_is_reached(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())

    await service.add_contribution(
        goal.id, test_user.id, GoalContributionCreate(amount=Decimal("1000.00"))
    )

    refreshed = await service.get_goal(goal.id, test_user.id)
    assert refreshed.status is GoalStatus.COMPLETED
    assert refreshed.completed_at is not None


@pytest.mark.asyncio
async def test_overshooting_the_target_still_completes_once(service, test_user):
    """Paying in more than the target must not wedge the goal or double-complete."""
    goal = await service.create_goal(test_user.id, _goal_payload())

    await service.add_contribution(
        goal.id, test_user.id, GoalContributionCreate(amount=Decimal("1500.00"))
    )
    refreshed = await service.get_goal(goal.id, test_user.id)
    first_completed_at = refreshed.completed_at

    # A further contribution on an already-complete goal keeps accumulating but
    # must not reset completion.
    await service.add_contribution(
        goal.id, test_user.id, GoalContributionCreate(amount=Decimal("10.00"))
    )
    refreshed = await service.get_goal(goal.id, test_user.id)

    assert refreshed.status is GoalStatus.COMPLETED
    assert refreshed.completed_at == first_completed_at
    assert refreshed.current_amount == Decimal("1510.00")


@pytest.mark.asyncio
async def test_milestones_complete_as_the_balance_passes_them(service, test_user):
    goal = await service.create_goal(
        test_user.id,
        _goal_payload(
            milestones=[
                GoalMilestoneCreate(title="Quarter", amount=Decimal("250.00")),
                GoalMilestoneCreate(title="Half", amount=Decimal("500.00")),
            ]
        ),
    )

    await service.add_contribution(
        goal.id, test_user.id, GoalContributionCreate(amount=Decimal("300.00"))
    )

    refreshed = await service.get_goal(goal.id, test_user.id)
    done = {m.title: m.is_completed for m in refreshed.milestones}
    assert done == {"Quarter": True, "Half": False}


@pytest.mark.asyncio
async def test_contribution_to_another_users_goal_is_refused(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())
    stranger = uuid4()

    assert await service.get_goal(goal.id, stranger) is None
    assert (
        await service.add_contribution(
            goal.id, stranger, GoalContributionCreate(amount=Decimal("50.00"))
        )
        is None
    )

    untouched = await service.get_goal(goal.id, test_user.id)
    assert untouched.current_amount == Decimal("0.00")


@pytest.mark.asyncio
async def test_update_goal_changes_fields(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())

    updated = await service.update_goal(
        goal.id, test_user.id, GoalUpdate(title="Renamed", priority="low")
    )

    assert updated is not None
    assert updated.title == "Renamed"
    assert updated.priority is GoalPriority.LOW


@pytest.mark.asyncio
async def test_delete_goal_is_scoped_to_the_owner(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())

    assert await service.delete_goal(goal.id, uuid4()) is False
    assert await service.get_goal(goal.id, test_user.id) is not None

    assert await service.delete_goal(goal.id, test_user.id) is True
    assert await service.get_goal(goal.id, test_user.id) is None


@pytest.mark.asyncio
async def test_summary_counts_all_goals_but_sums_only_active_amounts(
    service, test_user
):
    """Counts cover every goal; the money totals cover ACTIVE goals only.

    That asymmetry is deliberate — get_summary_row wraps both amount sums in
    `case((status == ACTIVE, ...), else_=0)`, so the totals answer "how much am
    I still working toward" rather than "how much have I ever targeted". Pinned
    here because it is surprising enough to look like a bug and get "fixed".
    """
    await service.create_goal(test_user.id, _goal_payload(title="A"))
    second = await service.create_goal(
        test_user.id, _goal_payload(title="B", target_amount=Decimal("500.00"))
    )
    await service.add_contribution(
        second.id, test_user.id, GoalContributionCreate(amount=Decimal("500.00"))
    )

    summary = await service.get_summary(test_user.id)

    assert summary.total_goals == 2
    assert summary.active_goals == 1
    assert summary.completed_goals == 1

    # Only goal A (still active, untouched) contributes to the money totals.
    assert summary.total_target_amount == Decimal("1000.00")
    assert summary.total_current_amount == Decimal("0.00")
    assert summary.overall_progress == Decimal("0.00")


@pytest.mark.asyncio
async def test_summary_progress_is_a_percentage_of_active_targets(service, test_user):
    goal = await service.create_goal(test_user.id, _goal_payload())
    await service.add_contribution(
        goal.id, test_user.id, GoalContributionCreate(amount=Decimal("250.00"))
    )

    summary = await service.get_summary(test_user.id)

    assert summary.total_current_amount == Decimal("250.00")
    assert summary.overall_progress == Decimal("25.00")


@pytest.mark.asyncio
async def test_summary_with_no_goals_does_not_divide_by_zero(service, test_user):
    summary = await service.get_summary(test_user.id)

    assert summary.total_goals == 0
    assert summary.total_target_amount == Decimal("0")
    assert summary.overall_progress == Decimal("0.00")
