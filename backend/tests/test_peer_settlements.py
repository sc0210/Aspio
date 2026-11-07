"""
Settling up between peers.

A settlement only lowers the balance accepted splits leave; it writes no ledger
rows, since each ledger already holds only its owner's share. The person owed
can record a repayment at once; the person who owes needs it confirmed.
"""

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.peers.schemas import SettlementCreate
from app.modules.peers.service import PeerService
from app.modules.peers.splits import SplitService
from test_peer_splits import _bill, _rows, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _owed_to_alice(c):
    """Alice paid a 1000 dinner split 50/50: Bob owes her 500."""
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    return sid


def _pay(c, direction, amount, **kw):
    return SettlementCreate(connection_id=c["conn"].id, direction=direction, amount=Decimal(amount), **kw)


async def _net(svc, user_id):
    return {b.connection_id: {x.currency: x.net for x in b.balances} for b in await svc.balances(user_id)}


async def test_the_person_owed_records_a_repayment_at_once(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    alice_id, bob_id, conn = c["alice"].id, c["bob"].id, str(c["conn"].id)
    out = await c["svc"].create_settlement(alice_id, _pay(c, "they_paid_me", "200"))
    assert (out.status, out.i_paid) == ("confirmed", False)
    assert (await _net(c["svc"], alice_id))[conn] == {"TWD": 300}
    assert (await _net(c["svc"], bob_id))[conn] == {"TWD": -300}
    # No ledger rows move: each ledger still holds only its owner's share.
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]


async def test_paying_back_needs_the_other_to_confirm(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    alice_id, bob_id, conn = c["alice"].id, c["bob"].id, str(c["conn"].id)
    sent = await c["svc"].create_settlement(bob_id, _pay(c, "i_paid_them", "500"))
    assert (sent.status, sent.i_paid) == ("proposed", True)
    assert (await _net(c["svc"], alice_id))[conn] == {"TWD": 500}  # not yet

    with pytest.raises(HTTPException) as err:  # bob can't confirm his own claim
        await c["svc"].respond_settlement(bob_id, uuid.UUID(sent.id), "confirm")
    assert err.value.status_code == 403

    await c["svc"].respond_settlement(alice_id, uuid.UUID(sent.id), "confirm")
    assert (await _net(c["svc"], alice_id))[conn] == {}  # all square


async def test_a_declined_repayment_leaves_the_balance(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    sent = await c["svc"].create_settlement(c["bob"].id, _pay(c, "i_paid_them", "500"))
    out = await c["svc"].respond_settlement(c["alice"].id, uuid.UUID(sent.id), "decline")
    assert out.status == "declined"
    assert (await _net(c["svc"], c["alice"].id))[str(c["conn"].id)] == {"TWD": 500}


async def test_cannot_settle_more_than_is_owed(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    for who, direction in ((c["alice"].id, "they_paid_me"), (c["bob"].id, "i_paid_them")):
        with pytest.raises(HTTPException) as err:
            await c["svc"].create_settlement(who, _pay(c, direction, "500.01"))
        assert err.value.status_code == 409
    # Nor the wrong way round: alice owes bob nothing.
    with pytest.raises(HTTPException) as err:
        await c["svc"].create_settlement(c["alice"].id, _pay(c, "i_paid_them", "1"))
    assert err.value.status_code == 409


async def test_confirming_rechecks_what_is_still_owed(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    sent = await c["svc"].create_settlement(c["bob"].id, _pay(c, "i_paid_them", "500"))
    await c["svc"].create_settlement(c["alice"].id, _pay(c, "they_paid_me", "500"))  # cash, recorded by her
    with pytest.raises(HTTPException) as err:
        await c["svc"].respond_settlement(c["alice"].id, uuid.UUID(sent.id), "confirm")
    assert err.value.status_code == 409


async def test_only_the_person_paid_can_undo_a_confirmed_repayment(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    alice_id, bob_id = c["alice"].id, c["bob"].id
    st = await c["svc"].create_settlement(alice_id, _pay(c, "they_paid_me", "500"))
    with pytest.raises(HTTPException) as err:
        await c["svc"].void_settlement(bob_id, uuid.UUID(st.id))
    assert err.value.status_code == 403
    assert (await c["svc"].void_settlement(alice_id, uuid.UUID(st.id))).status == "voided"
    assert (await _net(c["svc"], alice_id))[str(c["conn"].id)] == {"TWD": 500}


async def test_the_sender_withdraws_an_unconfirmed_repayment(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    sent = await c["svc"].create_settlement(c["bob"].id, _pay(c, "i_paid_them", "100"))
    with pytest.raises(HTTPException) as err:  # alice answers it instead
        await c["svc"].void_settlement(c["alice"].id, uuid.UUID(sent.id))
    assert err.value.status_code == 403
    assert (await c["svc"].void_settlement(c["bob"].id, uuid.UUID(sent.id))).status == "voided"
    with pytest.raises(HTTPException) as err:
        await c["svc"].respond_settlement(c["alice"].id, uuid.UUID(sent.id), "confirm")
    assert err.value.status_code == 409


async def test_a_former_partner_balance_can_be_settled(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    alice_id = c["alice"].id
    await PeerService(async_session).remove_connection(c["conn"].id, alice_id)
    svc = SplitService(async_session)
    await svc.create_settlement(alice_id, _pay(c, "they_paid_me", "500"))
    assert await svc.balances(alice_id) == []  # the former partner drops off once square


async def test_outsiders_cannot_see_or_touch_settlements(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    st = await c["svc"].create_settlement(c["bob"].id, _pay(c, "i_paid_them", "100"))
    for call in (lambda: c["svc"].respond_settlement(c["eve"].id, uuid.UUID(st.id), "confirm"),
                 lambda: c["svc"].void_settlement(c["eve"].id, uuid.UUID(st.id)),
                 lambda: c["svc"].create_settlement(c["eve"].id, _pay(c, "they_paid_me", "1"))):
        with pytest.raises(HTTPException) as err:
            await call()
        assert err.value.status_code == 404
    assert await c["svc"].list_settlements(c["eve"].id) == []


async def test_listing_shows_each_side_its_own_view(async_session, couple):
    c = couple
    await _owed_to_alice(c)
    await c["svc"].create_settlement(c["bob"].id, _pay(c, "i_paid_them", "100", note=" Venmo "))
    [mine] = await c["svc"].list_settlements(c["bob"].id)
    [theirs] = await c["svc"].list_settlements(c["alice"].id)
    assert (mine.i_paid, mine.created_by_me, mine.partner_name, mine.note) == (True, True, "alice", "Venmo")
    assert (theirs.i_paid, theirs.created_by_me, theirs.partner_name) == (False, False, "bob")


async def test_settlement_routes_resolve_over_http(authenticated_client):
    """Registered before /splits/{split_id}, so "settlements" isn't read as an id."""
    r = authenticated_client.get("/api/v1/peers/splits/settlements")
    assert r.status_code == 200, r.text[:200]
    assert r.json()["data"] == []
    r = authenticated_client.post(f"/api/v1/peers/splits/settlements/{uuid.uuid4()}/void")
    assert r.status_code == 404
