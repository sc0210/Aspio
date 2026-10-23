"""
The demo account's password is published in this repository.

It was re-created on every boot with no way to turn it off, and invites to it
were auto-accepted, so on an internet-facing instance anyone could sign in as
it and read the wallet totals, debt and net worth of every user who had added
it as a peer. It is now opt-in and can never hold a peer connection.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.peers.models import PeerConnection, PeerStatus
from app.modules.peers.service import PeerService
from app.modules.users.init_demo_user import (
    DEMO_EMAIL,
    disable_demo_user,
    init_demo_user,
)
from app.modules.users.models import User, UserStatus


def _user(email: str, username: str) -> User:
    return User(
        id=uuid.uuid4(), email=email, username=username, name=username,
        hashed_password="x", is_active=True, status=UserStatus.ACTIVE,
    )


async def _seed(session):
    demo = _user(DEMO_EMAIL, "demo")
    alice = _user("alice@example.com", "alice")
    session.add_all([demo, alice])
    conn = PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=demo.id, status=PeerStatus.ACCEPTED)
    session.add(conn)
    await session.commit()
    return demo, alice, conn


@pytest.mark.asyncio
async def test_disabled_demo_account_stops_working_and_loses_its_peers(async_session):
    demo, _, conn = await _seed(async_session)

    await disable_demo_user(async_session)

    await async_session.refresh(demo)
    await async_session.refresh(conn)
    assert demo.is_active is False
    assert conn.status == PeerStatus.REMOVED


@pytest.mark.asyncio
async def test_enabled_demo_account_still_has_no_peers(async_session):
    demo, _, conn = await _seed(async_session)

    await init_demo_user(async_session)

    await async_session.refresh(demo)
    await async_session.refresh(conn)
    assert demo.is_active is True
    assert conn.status == PeerStatus.REMOVED


@pytest.mark.asyncio
async def test_invites_to_and_from_the_demo_account_are_refused(async_session):
    demo, alice, conn = await _seed(async_session)
    conn.status = PeerStatus.REMOVED
    bob = _user("bob@example.com", "bob")
    async_session.add(bob)
    await async_session.commit()

    service = PeerService(async_session)
    for requester, receiver in ((bob, "demo"), (demo, "bob")):
        with pytest.raises(HTTPException) as exc:
            await service.send_invite(requester.id, receiver)
        assert exc.value.status_code == 400

    rows = (await async_session.execute(
        select(PeerConnection).where(PeerConnection.status.in_([PeerStatus.PENDING, PeerStatus.ACCEPTED]))
    )).scalars().all()
    assert rows == []
