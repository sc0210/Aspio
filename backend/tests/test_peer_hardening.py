"""
Regression tests for the peer fixes, against real rows.

- Reconnecting after a remove swapped requester/receiver while goal totals are
  cached per side, so Alice 300 + 100 read as 700.
- A completed goal vanished from the list and never re-opened.
- The 2-peer cap checked only one side at each step and ignored pending invites.
- A declined invite could be re-sent (and re-notified) forever.
- Nobody could edit a goal; nothing notified a partner of anything.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.notifications.models import Notification
from app.modules.peers.models import GoalStatus, PeerConnection, PeerStatus
from app.modules.peers.schemas import SavingRecordCreate, SharedGoalCreate, SharedGoalUpdate
from app.modules.peers.service import PeerService
from app.modules.users.models import User, UserRole, UserStatus

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _user(name):
    return User(id=uuid.uuid4(), email=f"{name}@example.com", name=name, username=name,
                is_active=True, role=UserRole.USER, status=UserStatus.ACTIVE)


def rec(amount):
    return SavingRecordCreate(amount=Decimal(str(amount)), record_date=date(2026, 10, 1))


@pytest_asyncio.fixture
async def people(async_session):
    users = {n: _user(n) for n in ("alice", "bob", "carol", "dave")}
    async_session.add_all(users.values())
    await async_session.commit()
    return users


async def _connect(svc, inviter, invitee):
    conn = await svc.send_invite(inviter.id, invitee.username)
    await svc.respond_to_invite(conn.id, invitee.id, "accept")
    return conn


async def _notes(async_session, user, action):
    rows = (await async_session.execute(select(Notification).where(
        Notification.user_id == user.id))).scalars().all()
    return [n for n in rows if (n.data or {}).get("action") == action]


async def test_reconnecting_with_swapped_sides_keeps_each_persons_total(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    conn = await _connect(svc, alice, bob)  # alice is the requester
    goal = await svc.create_goal(alice.id, SharedGoalCreate(
        connection_id=conn.id, title="Trip", target_amount=Decimal("1000")))
    goal_id = uuid.UUID(str(goal.id))
    await svc.add_record(alice.id, goal_id, rec(300))

    await svc.remove_connection(conn.id, alice.id)
    await _connect(svc, bob, alice)  # bob re-invites: the sides swap
    await svc.add_record(alice.id, goal_id, rec(100))

    seen = await svc.get_goal(alice.id, goal_id)
    assert (seen.your_amount, seen.peer_amount, seen.total_amount) == (400, 0, 400)


async def test_completed_goals_stay_listed_and_reopen_when_the_total_drops(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    conn = await _connect(svc, alice, bob)
    goal_id = uuid.UUID(str((await svc.create_goal(alice.id, SharedGoalCreate(
        connection_id=conn.id, title="Sofa", target_amount=Decimal("500")))).id))

    record = await svc.add_record(bob.id, goal_id, rec(500))
    listed = await svc.list_goals(alice.id)
    assert [(g.title, g.status) for g in listed] == [("Sofa", GoalStatus.completed)]

    await svc.delete_record(bob.id, goal_id, uuid.UUID(record.id))
    assert (await svc.get_goal(alice.id, goal_id)).status == GoalStatus.active


async def test_editing_the_target_reopens_or_completes(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    conn = await _connect(svc, alice, bob)
    goal_id = uuid.UUID(str((await svc.create_goal(alice.id, SharedGoalCreate(
        connection_id=conn.id, title="Car", target_amount=Decimal("1000")))).id))
    await svc.add_record(alice.id, goal_id, rec(600))

    # Either participant may edit, not only the creator.
    edited = await svc.update_goal(bob.id, goal_id, SharedGoalUpdate(title="Car fund", target_amount=Decimal("600")))
    assert (edited.title, edited.status) == ("Car fund", GoalStatus.completed)
    reopened = await svc.update_goal(alice.id, goal_id, SharedGoalUpdate(target_amount=Decimal("2000")))
    assert reopened.status == GoalStatus.active


async def test_the_cap_counts_pending_invites_and_both_sides(async_session, people):
    svc = PeerService(async_session)
    alice, bob, carol, dave = (people[n] for n in ("alice", "bob", "carol", "dave"))

    await svc.send_invite(alice.id, "bob")
    await svc.send_invite(alice.id, "carol")
    with pytest.raises(HTTPException) as exc:  # 2 outstanding already
        await svc.send_invite(alice.id, "dave")
    assert exc.value.status_code == 400

    # Dave fills up with two peers; then nobody can add him.
    await _connect(svc, dave, bob)
    await _connect(svc, dave, carol)
    with pytest.raises(HTTPException) as exc:
        await svc.send_invite(people["alice"].id, "dave")
    assert exc.value.status_code == 400


async def test_accepting_checks_the_inviters_count_too(async_session, people):
    svc = PeerService(async_session)
    alice, bob, carol, dave = (people[n] for n in ("alice", "bob", "carol", "dave"))
    stale = PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=dave.id,
                           status=PeerStatus.PENDING)
    async_session.add(stale)
    await async_session.commit()
    # Alice fills up after sending; Dave's accept must not take her to 3.
    for other in (bob, carol):
        async_session.add(PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=other.id,
                                         status=PeerStatus.ACCEPTED))
    await async_session.commit()

    with pytest.raises(HTTPException) as exc:
        await svc.respond_to_invite(stale.id, dave.id, "accept")
    assert exc.value.status_code == 400


async def test_a_declined_invite_cools_down_before_it_can_be_resent(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    conn = await svc.send_invite(alice.id, "bob")
    await svc.respond_to_invite(conn.id, bob.id, "decline")

    with pytest.raises(HTTPException) as exc:
        await svc.send_invite(alice.id, "bob")
    assert exc.value.status_code == 429

    # The person who declined can still reach out themselves.
    await svc.send_invite(bob.id, "alice")


async def test_the_cooldown_ends(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    conn = await svc.send_invite(alice.id, "bob")
    await svc.respond_to_invite(conn.id, bob.id, "decline")
    row = await async_session.get(PeerConnection, conn.id)
    row.updated_at = datetime.now(timezone.utc) - timedelta(days=8)
    await async_session.commit()

    await svc.send_invite(alice.id, "bob")


async def test_partners_are_notified_with_a_link_to_savings(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    conn = await _connect(svc, alice, bob)
    goal_id = uuid.UUID(str((await svc.create_goal(alice.id, SharedGoalCreate(
        connection_id=conn.id, title="Trip", target_amount=Decimal("100")))).id))
    await svc.add_record(bob.id, goal_id, rec(100))

    invite = await _notes(async_session, bob, "peer_invite")
    accepted = await _notes(async_session, alice, "peer_invite_accepted")
    deposit = await _notes(async_session, alice, "peer_goal_deposit")
    completed = await _notes(async_session, alice, "peer_goal_completed") + \
        await _notes(async_session, bob, "peer_goal_completed")
    assert (len(invite), len(accepted), len(deposit), len(completed)) == (1, 1, 1, 2)
    every = invite + accepted + deposit + completed
    assert {(n.action_url, n.is_actionable) for n in every} == {("/savings", True)}
    assert "net worth" in invite[0].message


@pytest.mark.parametrize("field", ["title", "target_amount"])
async def test_an_explicit_null_is_rejected_not_written(field):
    """Omitted keeps the value; null for these would hit a NOT NULL column (500)."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SharedGoalUpdate(**{field: None})
    assert SharedGoalUpdate(target_date=None).model_dump(exclude_unset=True) == {"target_date": None}


async def test_a_duplicate_invite_is_409_even_at_the_cap(async_session, people):
    svc = PeerService(async_session)
    alice = people["alice"]
    await svc.send_invite(alice.id, "bob")
    await svc.send_invite(alice.id, "carol")  # now at the cap

    with pytest.raises(HTTPException) as exc:
        await svc.send_invite(alice.id, "bob")
    assert exc.value.status_code == 409


async def test_a_removed_pair_at_the_cap_is_refused_and_left_alone(async_session, people):
    svc = PeerService(async_session)
    alice, bob = people["alice"], people["bob"]
    old = await _connect(svc, alice, bob)
    await svc.remove_connection(old.id, alice.id)
    await svc.send_invite(alice.id, "carol")
    await svc.send_invite(alice.id, "dave")  # at the cap with two outstanding

    with pytest.raises(HTTPException) as exc:
        await svc.send_invite(alice.id, "bob")
    assert exc.value.status_code == 400
    row = await async_session.get(PeerConnection, old.id)
    await async_session.refresh(row)
    assert row.status == PeerStatus.REMOVED


async def test_null_goal_fields_are_422_over_http(authenticated_client):
    r = authenticated_client.patch(f"/api/v1/peers/goals/{uuid.uuid4()}", json={"title": None})
    assert r.status_code == 422
