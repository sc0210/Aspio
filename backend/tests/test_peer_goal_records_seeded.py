"""Shared goals and their saving records against real rows.

test_peer_service_unit.py covers each branch with a mocked session; this checks
the invariant the mocks cannot: after every add / edit / delete, each side's
amount on the goal equals the sum of that side's records, and the goal
completes once the two together reach the target.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.modules.peers.models import GoalStatus, PeerConnection, PeerStatus
from app.modules.peers.schemas import SavingRecordCreate, SavingRecordUpdate, SharedGoalCreate
from app.modules.peers.service import PeerService
from app.modules.users.models import User, UserRole, UserStatus

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _user(name):
    return User(
        id=uuid.uuid4(), email=f"{name}@example.com", name=name, username=name,
        is_active=True, role=UserRole.USER, status=UserStatus.ACTIVE,
    )


@pytest_asyncio.fixture
async def pair(async_session):
    alice, bob, carol = _user("alice"), _user("bob"), _user("carol")
    async_session.add_all([alice, bob, carol])
    await async_session.flush()
    conn = PeerConnection(
        id=uuid.uuid4(), requester_id=alice.id, receiver_id=bob.id, status=PeerStatus.ACCEPTED,
    )
    async_session.add(conn)
    await async_session.commit()
    service = PeerService(async_session)
    goal = await service.create_goal(
        alice.id, SharedGoalCreate(connection_id=conn.id, title="Trip", target_amount=Decimal("1000"))
    )
    return {"alice": alice, "bob": bob, "carol": carol, "conn": conn, "goal_id": uuid.UUID(str(goal.id)), "svc": service}


def rec(amount, day=1, note=None):
    return SavingRecordCreate(amount=Decimal(str(amount)), record_date=date(2026, 10, day), note=note)


async def test_totals_follow_records_through_add_edit_delete(pair):
    svc, alice, bob, goal_id = pair["svc"], pair["alice"], pair["bob"], pair["goal_id"]

    a1 = await svc.add_record(alice.id, goal_id, rec(100, note="first"))
    await svc.add_record(alice.id, goal_id, rec(150, day=2))
    await svc.add_record(bob.id, goal_id, rec(200))

    goal = await svc.get_goal(alice.id, goal_id)
    assert (goal.your_amount, goal.peer_amount) == (250, 200)
    # Seen from the other side, the two amounts swap.
    seen_by_bob = await svc.get_goal(bob.id, goal_id)
    assert (seen_by_bob.your_amount, seen_by_bob.peer_amount) == (200, 250)

    await svc.update_record(alice.id, goal_id, uuid.UUID(a1.id), SavingRecordUpdate(amount=Decimal("50"), note="fixed"))
    assert (await svc.get_goal(alice.id, goal_id)).your_amount == 200

    await svc.delete_record(alice.id, goal_id, uuid.UUID(a1.id))
    assert (await svc.get_goal(alice.id, goal_id)).your_amount == 150

    records = await svc.list_records(bob.id, goal_id)
    assert sorted(r.amount for r in records) == [150.0, 200.0]
    assert {r.user_name for r in records} == {"alice", "bob"}


async def test_goal_completes_at_target_and_then_rejects_records(pair):
    svc, alice, bob, goal_id = pair["svc"], pair["alice"], pair["bob"], pair["goal_id"]
    await svc.add_record(alice.id, goal_id, rec(600))
    await svc.add_record(bob.id, goal_id, rec(400))

    goal = await svc.get_goal(alice.id, goal_id)
    assert goal.status == GoalStatus.completed

    with pytest.raises(HTTPException) as exc:
        await svc.add_record(alice.id, goal_id, rec(1))
    assert exc.value.status_code == 400


async def test_only_the_owner_edits_or_deletes_a_record(pair):
    svc, alice, bob, goal_id = pair["svc"], pair["alice"], pair["bob"], pair["goal_id"]
    mine = await svc.add_record(alice.id, goal_id, rec(100))
    rid = uuid.UUID(mine.id)

    for call in (
        svc.update_record(bob.id, goal_id, rid, SavingRecordUpdate(amount=Decimal("1"))),
        svc.delete_record(bob.id, goal_id, rid),
    ):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == 403

    for call in (
        svc.update_record(alice.id, goal_id, uuid.uuid4(), SavingRecordUpdate(note="x")),
        svc.delete_record(alice.id, goal_id, uuid.uuid4()),
    ):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == 404


async def test_outsiders_cannot_see_the_goal(pair):
    svc, carol, goal_id = pair["svc"], pair["carol"], pair["goal_id"]
    for call in (svc.get_goal(carol.id, goal_id), svc.list_records(carol.id, goal_id), svc.add_record(carol.id, goal_id, rec(1))):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == 404


async def test_goals_need_an_accepted_connection(pair, async_session):
    svc, alice, carol = pair["svc"], pair["alice"], pair["carol"]
    pending = PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=carol.id, status=PeerStatus.PENDING)
    async_session.add(pending)
    await async_session.commit()

    with pytest.raises(HTTPException) as exc:
        await svc.create_goal(alice.id, SharedGoalCreate(connection_id=pending.id, title="x", target_amount=Decimal("1")))
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        await svc.create_goal(carol.id, SharedGoalCreate(connection_id=pair["conn"].id, title="x", target_amount=Decimal("1")))
    assert exc.value.status_code == 404


async def test_listings_from_each_side(pair):
    svc, alice, bob, carol = pair["svc"], pair["alice"], pair["bob"], pair["carol"]

    [from_alice] = await svc.list_connections(alice.id)
    [from_bob] = await svc.list_connections(bob.id)
    assert (from_alice.direction, from_alice.other_user.username) == ("sent", "bob")
    assert (from_bob.direction, from_bob.other_user.username) == ("received", "alice")

    assert [g.title for g in await svc.list_goals(bob.id)] == ["Trip"]
    assert await svc.list_goals(carol.id) == []
