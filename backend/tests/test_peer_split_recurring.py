"""
Repeating bills split with a partner: a recurring expense of the payer's whose
every posted occurrence is split, by the same path as "Split with partner".
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.peers.models import PeerSplit
from app.modules.peers.schemas import RecurringSplitCreate
from app.modules.peers.service import PeerService
from app.modules.peers.splits import SplitService
from app.modules.transactions.models import RecurringTransaction, Transaction
from app.modules.transactions.repositories import (
    RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
)
from app.modules.transactions.services import RecurringTransactionService, TransactionService
from test_peer_splits import _rows, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _rent(c, **kw):
    body = dict(connection_id=c["conn"].id, description="Rent", total_amount=Decimal("30000"),
                category_id=c["food"].id, start_date=date(2026, 9, 5))
    body.update(kw)
    return RecurringSplitCreate(**body)


async def _run(session, until):
    repo = RecurringTransactionRepository(session)
    svc = RecurringTransactionService(repo, TransactionService(
        TransactionRepository(session), TransactionCategoryRepository(session), repo))
    return await svc.process_due_transactions(max_date=until)


async def _splits(session):
    return (await session.execute(select(PeerSplit).order_by(PeerSplit.split_date))).scalars().all()


async def test_each_occurrence_is_split(async_session, couple):
    c = couple
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, split_policy="auto_accept")
    out = await c["svc"].create_recurring(c["alice"].id, _rent(c))
    assert (out.partner_name, out.my_share, out.partner_share, out.next_occurrence) == (
        "bob", 15000.0, 15000.0, "2026-09-05")

    result = await _run(async_session, date(2026, 11, 7))
    assert result["created"] == 3  # Sep, Oct, Nov
    splits = await _splits(async_session)
    assert [(s.split_date.isoformat(), s.status) for s in splits] == [
        ("2026-09-05", "active"), ("2026-10-05", "active"), ("2026-11-05", "active")]
    assert await _rows(async_session, c["alice"]) == [Decimal("15000")] * 3
    assert await _rows(async_session, c["bob"]) == [Decimal("15000")] * 3


async def test_occurrences_wait_for_the_partner_like_any_split(async_session, couple):
    c = couple
    await c["svc"].create_recurring(c["alice"].id, _rent(c, start_date=date(2026, 11, 1)))
    await _run(async_session, date(2026, 11, 7))
    [split] = await _splits(async_session)
    assert split.status == "proposed"
    assert await _rows(async_session, c["alice"]) == [Decimal("30000")]  # whole until Bob accepts
    assert await _rows(async_session, c["bob"]) == []


async def test_a_split_that_fails_still_posts_the_bill(async_session, couple):
    c = couple
    alice_id = c["alice"].id  # the failed split rolls back, expiring loaded rows
    await c["svc"].create_recurring(alice_id, _rent(c, start_date=date(2026, 10, 1)))
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, split_policy="off")  # after it was set up
    result = await _run(async_session, date(2026, 11, 7))
    # Both months post and the rule moves on, though neither could be split.
    assert (result["created"], result["failed"]) == (2, 0)
    assert await _splits(async_session) == []
    rows = (await async_session.execute(select(Transaction.amount).where(
        Transaction.user_id == alice_id))).scalars().all()
    assert sorted(rows) == [Decimal("30000")] * 2
    rule = (await async_session.execute(select(RecurringTransaction))).scalars().one()
    assert rule.next_occurrence == date(2026, 12, 1)


async def test_removing_the_partner_turns_splitting_off(async_session, couple):
    c = couple
    out = await c["svc"].create_recurring(c["alice"].id, _rent(c, start_date=date(2026, 11, 1)))
    await PeerService(async_session).remove_connection(c["conn"].id, c["alice"].id)
    rule = await async_session.get(RecurringTransaction, uuid.UUID(out.id), populate_existing=True)
    assert (rule.split_connection_id, rule.is_active) == (None, True)  # still posts, unsplit
    assert await SplitService(async_session).list_recurring(c["alice"].id) == []
    await _run(async_session, date(2026, 11, 7))
    assert await _splits(async_session) == []
    assert await _rows(async_session, c["alice"]) == [Decimal("30000")]


async def test_a_fixed_share_is_kept_on_every_occurrence(async_session, couple):
    c = couple
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, split_policy="auto_accept")
    out = await c["svc"].create_recurring(c["alice"].id, _rent(
        c, start_date=date(2026, 11, 1), method="fixed", my_amount=Decimal("18000")))
    assert (out.my_share, out.partner_share) == (18000.0, 12000.0)
    await _run(async_session, date(2026, 11, 7))
    assert await _rows(async_session, c["bob"]) == [Decimal("12000")]


async def test_setting_up_and_stopping(async_session, couple):
    c = couple
    with pytest.raises(HTTPException) as err:  # too big a share
        await c["svc"].create_recurring(c["alice"].id, _rent(c, method="fixed", my_amount=Decimal("30001")))
    assert err.value.status_code == 422
    with pytest.raises(HTTPException) as err:  # not her partner
        await c["svc"].create_recurring(c["eve"].id, _rent(c))
    assert err.value.status_code == 404

    out = await c["svc"].create_recurring(c["alice"].id, _rent(c, start_date=date(2026, 12, 1)))
    with pytest.raises(HTTPException) as err:
        await c["svc"].stop_recurring(c["bob"].id, uuid.UUID(out.id))
    assert err.value.status_code == 404
    await c["svc"].stop_recurring(c["alice"].id, uuid.UUID(out.id))
    assert await c["svc"].list_recurring(c["alice"].id) == []
    assert (await _run(async_session, date(2026, 12, 31)))["created"] == 0


async def test_recurring_routes_resolve_over_http(authenticated_client):
    r = authenticated_client.get("/api/v1/peers/splits/recurring")
    assert r.status_code == 200 and r.json()["data"] == []
    assert authenticated_client.post(f"/api/v1/peers/splits/recurring/{uuid.uuid4()}/stop").status_code == 404
