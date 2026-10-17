"""The goals report recognises a retirement goal the way the /goals page does.

A retirement goal's progress is the portfolio, not its stored current_amount
(which stays at NT$0). The report matched on category alone, so a goal titled
"Retirement Fund" that kept an earlier category — house_down_payment, from
before it was renamed — sat at 0% on /review's goals card while /goals, which
also matches on the title, credited it the portfolio.
"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.modules.goals.models import GoalCategory, GoalStatus
from app.modules.reports.services import ReportsService, _is_retirement_goal, _portfolio_credited_goal_id


def _goal(title, category, current="0", target="10000000"):
    return SimpleNamespace(
        id=uuid4(),
        title=title,
        category=category,
        status=GoalStatus.ACTIVE,
        current_amount=Decimal(current),
        target_amount=Decimal(target),
        target_date=None,
    )


def _service_with(goals):
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = goals
    db.execute = AsyncMock(return_value=result)
    return ReportsService(db)


@pytest.mark.parametrize("title, category, expected", [
    ("Retirement Fund", "house_down_payment", True),   # renamed, category kept
    ("早日財務自由", "general", True),
    ("退休金", "education", True),
    ("FIRE by 45", "general", True),
    ("Anything", "retirement", True),
    ("House down payment", "house_down_payment", False),
    ("Emergency cushion", "emergency_fund", False),
    # FIRE is the acronym, not the word: these are not retirement goals, and a
    # match would credit each one the entire portfolio.
    ("Fireplace renovation", "house_down_payment", False),
    ("Fire insurance fund", "general", False),
])
def test_retirement_goals_are_matched_like_the_goals_page(title, category, expected):
    assert _is_retirement_goal(_goal(title, category)) is expected


@pytest.mark.asyncio
async def test_a_renamed_retirement_goal_is_credited_the_portfolio():
    # The report reads category.value further on, so these carry the real enum.
    svc = _service_with([_goal("Retirement Fund", GoalCategory("house_down_payment"))])

    report = await svc.get_goals_report(
        str(uuid4()), date(2026, 8, 1), date(2026, 8, 31), portfolio_total_twd=7_000_000.0
    )

    assert report.total_current_amount == pytest.approx(7_000_000)
    assert report.overall_progress == pytest.approx(70)


@pytest.mark.asyncio
async def test_other_goals_still_use_their_own_saved_amount():
    svc = _service_with([_goal("House", GoalCategory("house_down_payment"), current="500000", target="2000000")])

    report = await svc.get_goals_report(
        str(uuid4()), date(2026, 8, 1), date(2026, 8, 31), portfolio_total_twd=7_000_000.0
    )

    assert report.total_current_amount == pytest.approx(500_000)
    assert report.overall_progress == pytest.approx(25)


@pytest.mark.asyncio
async def test_the_category_summary_credits_a_renamed_retirement_goal_too():
    # The headline and the category row come from two functions; checking the
    # category alone in the second left this goal at NT$0 in its row.
    svc = _service_with([_goal("Retirement Fund", GoalCategory("house_down_payment"))])

    report = await svc.get_goals_report(
        str(uuid4()), date(2026, 8, 1), date(2026, 8, 31), portfolio_total_twd=7_000_000.0
    )

    row = next(c for c in report.category_summary if c.category == "house_down_payment")
    assert row.total_current == pytest.approx(7_000_000)
    assert row.average_progress == pytest.approx(70)


@pytest.mark.asyncio
async def test_two_retirement_goals_share_one_portfolio_rather_than_counting_it_twice():
    category = GoalCategory("house_down_payment")
    smaller = _goal("Retirement Fund", category, target="10000000")
    larger = _goal("FIRE by 45", category, target="20000000")
    svc = _service_with([smaller, larger])

    report = await svc.get_goals_report(
        str(uuid4()), date(2026, 8, 1), date(2026, 8, 31), portfolio_total_twd=7_000_000.0
    )

    # Once, toward the larger target; the other goal keeps its own saved NT$0.
    assert report.total_current_amount == pytest.approx(7_000_000)
    assert report.overall_progress == pytest.approx(23.33, abs=0.01)  # 7M of 30M, reported to the cent
    row = next(c for c in report.category_summary if c.category == "house_down_payment")
    assert row.total_current == pytest.approx(7_000_000)


def test_the_credit_goes_to_the_largest_active_retirement_goal():
    category = GoalCategory("house_down_payment")
    finished = _goal("Retirement (old plan)", category, target="50000000")
    finished.status = GoalStatus.COMPLETED
    current = _goal("FIRE by 45", category, target="10000000")
    house = _goal("House", category, target="90000000")

    assert _portfolio_credited_goal_id([finished, current, house]) == current.id
    # With no active match, the largest match still gets it.
    assert _portfolio_credited_goal_id([finished]) == finished.id
    assert _portfolio_credited_goal_id([house]) is None
