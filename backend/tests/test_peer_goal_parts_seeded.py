"""Shared goals and their two parts against real rows.

test_peer_service_unit.py covers the mapping with mocked rows; this checks what
the mocks cannot: each side's amount is that partner's personal goal (seen
swapped from the other side), the target is the sum of the two parts, and only
the two partners can reach the goal.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.modules.goals.schemas import GoalContributionCreate
from app.modules.goals.service import GoalService
from app.modules.peers.models import GoalStatus, PeerConnection, PeerStatus
from app.modules.peers.schemas import LinkGoalIn, SharedGoalCreate
from app.modules.peers.service import PeerService
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.modules.users.models import User, UserRole, UserStatus

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _user(name):
    return User(
        id=uuid.uuid4(), email=f"{name}@example.com", name=name, username=name,
        is_active=True, role=UserRole.USER, status=UserStatus.ACTIVE,
    )


@pytest_asyncio.fixture
async def pair(async_session, test_category):
    alice, bob, carol = _user("alice"), _user("bob"), _user("carol")
    async_session.add_all([alice, bob, carol])
    await async_session.flush()
    for person in (alice, bob):  # Life cash to set aside
        async_session.add(Transaction(
            user_id=person.id, type=TransactionType.INCOME, wallet_type=TransactionWalletType.LIFE,
            amount=Decimal("5000"), currency="TWD", description="Salary",
            transaction_date=date(2026, 1, 1), category_id=test_category.id,
        ))
    conn = PeerConnection(
        id=uuid.uuid4(), requester_id=alice.id, receiver_id=bob.id, status=PeerStatus.ACCEPTED,
    )
    async_session.add(conn)
    await async_session.commit()
    service = PeerService(async_session)
    goal = await service.create_goal(
        alice.id, SharedGoalCreate(connection_id=conn.id, title="Trip", my_target=Decimal("600"))
    )
    return {"alice": alice, "bob": bob, "carol": carol, "conn": conn, "goal_id": uuid.UUID(str(goal.id)), "svc": service}


async def _set_aside(session, svc, user, goal_id, amount):
    part = await svc.link_goal(user.id, goal_id)
    await GoalService(session).reserve(part.id, user.id, GoalContributionCreate(amount=Decimal(str(amount))))
    return part


async def test_each_side_is_that_partners_goal(pair, async_session):
    svc, alice, bob, goal_id = pair["svc"], pair["alice"], pair["bob"], pair["goal_id"]
    await svc.link_goal(bob.id, goal_id, LinkGoalIn(target_amount=Decimal("400")))
    await _set_aside(async_session, svc, alice, goal_id, 250)
    await _set_aside(async_session, svc, bob, goal_id, 200)

    goal = await svc.get_goal(alice.id, goal_id)
    assert (goal.your_amount, goal.peer_amount) == (250, 200)
    assert (goal.your_target, goal.peer_target, goal.target_amount) == (600, 400, 1000)
    # Seen from the other side, the two swap.
    seen_by_bob = await svc.get_goal(bob.id, goal_id)
    assert (seen_by_bob.your_amount, seen_by_bob.peer_amount) == (200, 250)
    assert (seen_by_bob.your_target, seen_by_bob.peer_target) == (400, 600)


async def test_goal_completes_at_the_sum_and_keeps_counting(pair, async_session):
    """Saving past the target is allowed; the goal stays completed and the extra still counts."""
    svc, alice, bob, goal_id = pair["svc"], pair["alice"], pair["bob"], pair["goal_id"]
    await svc.link_goal(bob.id, goal_id, LinkGoalIn(target_amount=Decimal("400")))
    await _set_aside(async_session, svc, alice, goal_id, 600)
    assert (await svc.get_goal(alice.id, goal_id)).status == GoalStatus.active   # bob's part is empty
    await _set_aside(async_session, svc, bob, goal_id, 401)

    goal = await svc.get_goal(alice.id, goal_id)
    assert (goal.status, goal.total_amount) == (GoalStatus.completed, 1001)


async def test_outsiders_cannot_see_the_goal(pair):
    svc, carol, goal_id = pair["svc"], pair["carol"], pair["goal_id"]
    for call in (svc.get_goal(carol.id, goal_id), svc.side_history(carol.id, goal_id), svc.link_goal(carol.id, goal_id)):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == 404


async def test_goals_need_an_accepted_connection(pair, async_session):
    svc, alice, carol = pair["svc"], pair["alice"], pair["carol"]
    pending = PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=carol.id, status=PeerStatus.PENDING)
    async_session.add(pending)
    await async_session.commit()

    with pytest.raises(HTTPException) as exc:
        await svc.create_goal(alice.id, SharedGoalCreate(connection_id=pending.id, title="x", my_target=Decimal("1")))
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        await svc.create_goal(carol.id, SharedGoalCreate(connection_id=pair["conn"].id, title="x", my_target=Decimal("1")))
    assert exc.value.status_code == 404


async def test_listings_from_each_side(pair):
    svc, alice, bob, carol = pair["svc"], pair["alice"], pair["bob"], pair["carol"]

    [from_alice] = await svc.list_connections(alice.id)
    [from_bob] = await svc.list_connections(bob.id)
    assert (from_alice.direction, from_alice.other_user.username) == ("sent", "bob")
    assert (from_bob.direction, from_bob.other_user.username) == ("received", "alice")

    assert [g.title for g in await svc.list_goals(bob.id)] == ["Trip"]
    assert await svc.list_goals(carol.id) == []
