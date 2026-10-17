"""Removing a peer ends what you share with them.

The shared-goal queries checked only that the user had been part of the
connection, so after "Remove" the ex-peer still listed the goal, read the other
person's saving records and could add their own. Runs the real queries.
"""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.modules.peers.models import PeerConnection, PeerStatus, SharedGoal
from app.modules.peers.repositories import SharedGoalRepository
from app.modules.users.models import User, UserRole, UserStatus

pytestmark = pytest.mark.asyncio


async def _shared_goal(session, owner):
    peer = User(
        id=uuid4(), email="peer@example.com", name="Peer", hashed_password="x",
        is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
        preferred_currency="TWD", timezone="UTC", experience_points=0, level=1,
    )
    conn = PeerConnection(
        id=uuid4(), requester_id=owner.id, receiver_id=peer.id, status=PeerStatus.ACCEPTED,
    )
    goal = SharedGoal(
        id=uuid4(), connection_id=conn.id, title="Trip",
        target_amount=Decimal("1000"), created_by=owner.id,
    )
    session.add_all([peer, conn, goal])
    await session.commit()
    return peer, conn, goal


async def test_accepted_peers_both_see_the_goal(async_session, test_user):
    peer, _, goal = await _shared_goal(async_session, test_user)
    repo = SharedGoalRepository(async_session)

    for user in (test_user, peer):
        assert [g.id for g, _ in await repo.list_active_for_participant(user.id)] == [goal.id]
        assert await repo.get_with_connection(goal.id, user.id) is not None


async def test_after_removal_neither_side_reaches_the_goal(async_session, test_user):
    peer, conn, goal = await _shared_goal(async_session, test_user)
    conn.status = PeerStatus.REMOVED
    await async_session.commit()
    repo = SharedGoalRepository(async_session)

    for user in (test_user, peer):
        assert await repo.list_active_for_participant(user.id) == []
        assert await repo.get_with_connection(goal.id, user.id) is None


async def test_reconnecting_brings_the_goal_back(async_session, test_user):
    """send_invite reuses the removed row, so accepting again restores the goal."""
    peer, conn, goal = await _shared_goal(async_session, test_user)
    conn.status = PeerStatus.REMOVED
    await async_session.commit()
    conn.status = PeerStatus.ACCEPTED
    await async_session.commit()

    repo = SharedGoalRepository(async_session)
    assert await repo.get_with_connection(goal.id, peer.id) is not None
