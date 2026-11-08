"""
Muting a partner's split notifications: the bell stays quiet, nothing else
changes. Proposals still wait in Shared spending, repayments still count.
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.modules.notifications.models import Notification
from app.modules.peers.schemas import PeerPrefsUpdate, SettlementCreate
from test_peer_splits import _bill, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _bell(session, user):
    return (await session.execute(select(Notification).where(Notification.user_id == user.id))).scalars().all()


async def test_muted_partner_rings_no_bell_but_the_proposal_still_waits(async_session, couple):
    c = couple
    alice_id, bob_id = c["alice"].id, c["bob"].id
    out = await c["svc"].set_prefs(bob_id, c["conn"].id, notify=False)
    assert (out.notify, out.split_policy) == (False, "approve_each")  # the policy is untouched

    split = await c["svc"].create_split(alice_id, _bill(c))
    assert await _bell(async_session, c["bob"]) == []
    inbox = [s for s in await c["svc"].list_splits(bob_id) if s.status == "proposed" and not s.created_by_me]
    assert [s.id for s in inbox] == [split.id]

    # Alice didn't mute Bob: his answer still reaches her.
    await c["svc"].respond(bob_id, uuid.UUID(split.id), "accept", None, "life")
    assert [n.data["action"] for n in await _bell(async_session, c["alice"])] == ["peer_split_accepted"]


async def test_mute_covers_repayments_and_can_be_undone(async_session, couple):
    c = couple
    alice_id, bob_id = c["alice"].id, c["bob"].id
    sid = uuid.UUID((await c["svc"].create_split(alice_id, _bill(c))).id)
    await c["svc"].respond(bob_id, sid, "accept", None, "life")
    await c["svc"].set_prefs(alice_id, c["conn"].id, notify=False)
    await c["svc"].create_settlement(bob_id, SettlementCreate(
        connection_id=c["conn"].id, direction="i_paid_them", amount=Decimal("100")))
    assert [n.data["action"] for n in await _bell(async_session, c["alice"])] == ["peer_split_accepted"]

    await c["svc"].set_prefs(alice_id, c["conn"].id, notify=True)
    await c["svc"].create_settlement(bob_id, SettlementCreate(
        connection_id=c["conn"].id, direction="i_paid_them", amount=Decimal("100")))
    assert [n.data["action"] for n in await _bell(async_session, c["alice"])][-1] == "peer_settlement_proposed"


async def test_changing_one_setting_keeps_the_other(async_session, couple):
    c = couple
    bob_id = c["bob"].id
    await c["svc"].set_prefs(bob_id, c["conn"].id, split_policy="auto_accept")
    out = await c["svc"].set_prefs(bob_id, c["conn"].id, notify=False)
    assert (out.split_policy, out.notify) == ("auto_accept", False)
    assert (await c["svc"].get_prefs(bob_id, c["conn"].id)).notify is False


def test_an_empty_update_is_refused():
    with pytest.raises(ValueError):
        PeerPrefsUpdate()


async def test_prefs_route_takes_notify(authenticated_client):
    r = authenticated_client.patch(f"/api/v1/peers/{uuid.uuid4()}/prefs", json={"notify": False})
    assert r.status_code == 404, r.text[:200]  # validated, then no such connection
    assert authenticated_client.patch(f"/api/v1/peers/{uuid.uuid4()}/prefs", json={}).status_code == 422
