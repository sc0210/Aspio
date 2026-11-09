"""
Changing an accepted split: one person proposes, the other must accept. Only
then do the split and both ledger rows take the new figures; the balance follows.
"""

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.peers.models import PeerSplitAmendment
from app.modules.peers.schemas import SplitAmend
from app.modules.peers.service import PeerService
from app.modules.peers.splits import SplitService
from test_peer_splits import _bill, _rows, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _active(c):
    """Alice paid a 1000 dinner, split 50/50; Bob accepted. Bob owes 500."""
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    return sid


async def _owed(c, user):
    return {b.partner_name: {x.currency: x.net for x in b.balances} for b in await c["svc"].balances(user.id)}


async def test_a_change_applies_only_when_the_other_accepts(async_session, couple):
    c = couple
    sid = await _active(c)
    # Bob: the bill was 1200, not 1000, and he takes 400 of it.
    out = await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(
        total_amount=Decimal("1200"), method="fixed", my_amount=Decimal("400"), description="Dinner + drinks"))
    pending = out.pending_amendment
    assert (pending.proposed_by_me, pending.total_amount, pending.my_share, pending.partner_share) == (
        True, 1200.0, 400.0, 800.0)
    # Nothing moved yet.
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]

    alice_view = await c["svc"].get_split(c["alice"].id, sid)
    assert (alice_view.pending_amendment.proposed_by_me, alice_view.pending_amendment.my_share) == (False, 800.0)
    accepted = await c["svc"].respond_amendment(c["alice"].id, sid, "accept")
    assert (accepted.total_amount, accepted.my_share, accepted.partner_share, accepted.description,
            accepted.pending_amendment) == (1200.0, 800.0, 400.0, "Dinner + drinks", None)
    # Both ledgers hold the new shares, and they still add up to the bill.
    assert await _rows(async_session, c["alice"]) == [Decimal("800")]
    assert await _rows(async_session, c["bob"]) == [Decimal("400")]
    assert (await _owed(c, c["alice"]))["bob"] == {"TWD": 400}


async def test_declined_or_withdrawn_changes_nothing(async_session, couple):
    c = couple
    sid = await _active(c)
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(total_amount=Decimal("900")))
    with pytest.raises(HTTPException) as err:  # her own proposal: Bob answers it
        await c["svc"].respond_amendment(c["alice"].id, sid, "accept")
    assert err.value.status_code == 403
    assert (await c["svc"].respond_amendment(c["bob"].id, sid, "decline")).pending_amendment is None

    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(total_amount=Decimal("900")))
    with pytest.raises(HTTPException) as err:
        await c["svc"].withdraw_amendment(c["bob"].id, sid)
    assert err.value.status_code == 403
    assert (await c["svc"].withdraw_amendment(c["alice"].id, sid)).pending_amendment is None
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    assert (await _owed(c, c["alice"]))["bob"] == {"TWD": 500}


async def test_one_open_change_at_a_time_and_not_a_no_op(async_session, couple):
    c = couple
    sid = await _active(c)
    with pytest.raises(HTTPException) as err:
        await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(total_amount=Decimal("1000")))
    assert err.value.status_code == 422
    await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(total_amount=Decimal("1100")))
    with pytest.raises(HTTPException) as err:
        await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(total_amount=Decimal("1300")))
    assert err.value.status_code == 409


async def test_only_a_split_you_are_on(async_session, couple):
    c = couple
    proposed = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    with pytest.raises(HTTPException) as err:  # not on the split
        await c["svc"].propose_amendment(c["eve"].id, proposed, SplitAmend(total_amount=Decimal("900")))
    assert err.value.status_code == 404


async def test_closing_the_split_drops_its_open_change(async_session, couple):
    c = couple
    sid = await _active(c)
    await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(total_amount=Decimal("1100")))
    await c["svc"].cancel(c["alice"].id, sid)
    rows = (await async_session.execute(
        PeerSplitAmendment.__table__.select().where(PeerSplitAmendment.split_id == sid))).all()
    assert [r.status for r in rows] == ["withdrawn"]

    sid2 = await _active(c)
    await c["svc"].propose_amendment(c["bob"].id, sid2, SplitAmend(total_amount=Decimal("1100")))
    await PeerService(async_session).remove_connection(c["conn"].id, c["alice"].id)
    with pytest.raises(HTTPException):
        await SplitService(async_session).respond_amendment(c["alice"].id, sid2, "accept")
    assert (await SplitService(async_session).list_splits(c["alice"].id))[0].pending_amendment is None


async def test_a_zero_share_gains_a_row_when_changed(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c, method="fixed", my_amount=Decimal("1000")))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    assert await _rows(async_session, c["bob"]) == []  # his share was 0
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1000"), description="Dinner, shared after all"))
    await c["svc"].respond_amendment(c["bob"].id, sid, "accept")
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    # The row it gained carries the new description, like Alice's existing one.
    from sqlalchemy import select
    from app.modules.transactions.models import Transaction
    descriptions = (await async_session.execute(select(Transaction.description).where(
        Transaction.is_deleted == False))).scalars().all()  # noqa: E712
    assert set(descriptions) == {"Dinner, shared after all"}


async def test_a_share_that_stays_zero_gets_no_row(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c, method="fixed", my_amount=Decimal("1000")))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1200"), method="fixed", my_amount=Decimal("1200")))
    await c["svc"].respond_amendment(c["bob"].id, sid, "accept")
    assert await _rows(async_session, c["bob"]) == []
    assert await _rows(async_session, c["alice"]) == [Decimal("1200")]


async def test_a_share_moved_to_zero_loses_its_row(async_session, couple):
    c = couple
    sid = await _active(c)
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1000"), method="fixed", my_amount=Decimal("1000")))
    await c["svc"].respond_amendment(c["bob"].id, sid, "accept")
    assert await _rows(async_session, c["bob"]) == []
    assert await _rows(async_session, c["alice"]) == [Decimal("1000")]
    assert (await _owed(c, c["alice"]))["bob"] == {}


async def test_amend_routes_resolve_over_http(authenticated_client):
    sid = uuid.uuid4()
    assert authenticated_client.post(f"/api/v1/peers/splits/{sid}/amend", json={"total_amount": 10}).status_code == 404
    assert authenticated_client.post(f"/api/v1/peers/splits/{sid}/amendment/withdraw").status_code == 404
    assert authenticated_client.post(f"/api/v1/peers/splits/{sid}/cancel-request").status_code == 404


# ---------------------------------------------------------------------------
# A split not yet answered: the creator edits it directly
# ---------------------------------------------------------------------------

async def test_the_creator_edits_an_unanswered_split_and_the_accept_uses_it(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    out = await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1200"), method="fixed", my_amount=Decimal("900"), description="Dinner + drinks"))
    assert (out.status, out.total_amount, out.my_share, out.partner_share, out.description,
            out.pending_amendment) == ("proposed", 1200.0, 900.0, 300.0, "Dinner + drinks", None)
    # She paid: her row carries the whole (new) bill until Bob answers.
    assert await _rows(async_session, c["alice"]) == [Decimal("1200")]
    assert await _rows(async_session, c["bob"]) == []

    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    assert await _rows(async_session, c["alice"]) == [Decimal("900")]
    assert await _rows(async_session, c["bob"]) == [Decimal("300")]
    assert (await _owed(c, c["alice"]))["bob"] == {"TWD": 300}


async def test_a_non_payer_creators_row_follows_their_share(async_session, couple):
    c = couple
    # Bob paid; Alice records it and owes her half, which is already in her ledger.
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c, payer="partner"))).id)
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1000"), method="fixed", my_amount=Decimal("0")))
    assert await _rows(async_session, c["alice"]) == []
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1000"), method="fixed", my_amount=Decimal("400")))
    assert await _rows(async_session, c["alice"]) == [Decimal("400")]


async def test_only_the_creator_edits_and_not_a_no_op(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    with pytest.raises(HTTPException) as err:  # Bob answers it instead
        await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(total_amount=Decimal("900")))
    assert err.value.status_code == 403
    with pytest.raises(HTTPException) as err:
        await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(total_amount=Decimal("1000")))
    assert err.value.status_code == 422


async def test_a_withdrawn_or_declined_split_cannot_be_edited(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "decline", None, "life")
    with pytest.raises(HTTPException) as err:
        await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(total_amount=Decimal("900")))
    assert err.value.status_code == 409


# ---------------------------------------------------------------------------
# The non-payer asks the payer to cancel
# ---------------------------------------------------------------------------

async def test_the_payer_accepting_a_cancel_request_closes_the_split(async_session, couple):
    c = couple
    sid = await _active(c)
    out = await c["svc"].request_cancel(c["bob"].id, sid)
    assert (out.pending_amendment.kind, out.pending_amendment.proposed_by_me) == ("cancel", True)
    # Nothing moves until Alice answers.
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]

    done = await c["svc"].respond_amendment(c["alice"].id, sid, "accept")
    assert (done.status, done.pending_amendment) == ("voided", None)
    # Alice carries the whole bill again, Bob's share is gone, nothing is owed.
    assert await _rows(async_session, c["alice"]) == [Decimal("1000")]
    assert await _rows(async_session, c["bob"]) == []
    assert (await _owed(c, c["alice"]))["bob"] == {}
    statuses = (await async_session.execute(
        PeerSplitAmendment.__table__.select().where(PeerSplitAmendment.split_id == sid))).all()
    assert [r.status for r in statuses] == ["accepted"]


async def test_a_declined_or_withdrawn_cancel_request_changes_nothing(async_session, couple):
    c = couple
    sid = await _active(c)
    await c["svc"].request_cancel(c["bob"].id, sid)
    out = await c["svc"].respond_amendment(c["alice"].id, sid, "decline")
    assert (out.status, out.pending_amendment) == ("active", None)

    await c["svc"].request_cancel(c["bob"].id, sid)
    assert (await c["svc"].withdraw_amendment(c["bob"].id, sid)).pending_amendment is None
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    assert (await _owed(c, c["alice"]))["bob"] == {"TWD": 500}


async def test_only_the_non_payer_asks_and_one_open_at_a_time(async_session, couple):
    c = couple
    sid = await _active(c)
    with pytest.raises(HTTPException) as err:  # Alice paid: she cancels herself
        await c["svc"].request_cancel(c["alice"].id, sid)
    assert err.value.status_code == 403
    await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(total_amount=Decimal("1100")))
    with pytest.raises(HTTPException) as err:
        await c["svc"].request_cancel(c["bob"].id, sid)
    assert err.value.status_code == 409
    proposed = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    with pytest.raises(HTTPException) as err:  # not accepted yet: Bob declines instead
        await c["svc"].request_cancel(c["bob"].id, proposed)
    assert err.value.status_code == 409


async def test_the_payer_cancelling_drops_an_open_cancel_request(async_session, couple):
    c = couple
    sid = await _active(c)
    await c["svc"].request_cancel(c["bob"].id, sid)
    out = await c["svc"].cancel(c["alice"].id, sid)
    assert (out.status, out.pending_amendment) == ("voided", None)
    assert await _rows(async_session, c["alice"]) == [Decimal("1000")]
