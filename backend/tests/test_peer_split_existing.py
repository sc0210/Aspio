"""
"Split this": splitting an expense already in the payer's ledger.

That row becomes the payer's share row, so it is never deleted: it stays whole
while the partner decides, shrinks to the payer's share on accept, and comes back
whole and unlinked if the split is withdrawn, declined or cancelled.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.peers.models import PeerSplit
from app.modules.peers.schemas import SplitAmend, SplitFromTransaction
from app.core.exceptions import BusinessLogicException
from app.modules.peers.service import PeerService
from app.modules.transactions.models import (
    Transaction, TransactionStatus, TransactionType, TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository
from test_peer_splits import _rows, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _expense(session, c, *, user="alice", amount="1000", **extra):
    row = await TransactionRepository(session).create({
        "type": extra.pop("type", TransactionType.EXPENSE),
        "wallet_type": extra.pop("wallet_type", TransactionWalletType.LIFE),
        "amount": Decimal(amount), "currency": "TWD", "description": "Groceries",
        "transaction_date": date(2026, 11, 5),
        "category_id": extra.pop("category_id", c["food"].id), **extra,
    }, str(c[user].id))
    return row.id


def _body(c, txn_id, **kw):
    return SplitFromTransaction(transaction_id=txn_id, connection_id=c["conn"].id, **kw)


async def _row(session, txn_id):
    return await session.get(Transaction, txn_id, populate_existing=True)


async def test_the_expense_becomes_the_payers_share(async_session, couple):
    c = couple
    txn_id = await _expense(async_session, c)
    out = await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
    assert (out.status, out.total_amount, out.split_date, out.description) == (
        "proposed", 1000.0, "2026-11-05", "Groceries")
    assert out.my_transaction_id == str(txn_id)
    assert (await _row(async_session, txn_id)).amount == Decimal("1000")  # whole until they answer
    assert await _rows(async_session, c["bob"]) == []

    await c["svc"].respond(c["bob"].id, uuid.UUID(out.id), "accept", None, "life")
    assert (await _row(async_session, txn_id)).amount == Decimal("500")
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]  # no second row
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]


@pytest.mark.parametrize("close", ["withdraw", "decline", "cancel"])
async def test_closing_hands_the_expense_back_whole(async_session, couple, close):
    c = couple
    txn_id = await _expense(async_session, c)
    sid = uuid.UUID((await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))).id)
    if close == "withdraw":
        await c["svc"].void(c["alice"].id, sid)
    elif close == "decline":
        await c["svc"].respond(c["bob"].id, sid, "decline", None, "life")
    else:
        await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
        await c["svc"].cancel(c["alice"].id, sid)
    row = await _row(async_session, txn_id)
    assert (row.is_deleted, row.amount, row.peer_split_share_id) == (False, Decimal("1000"), None)
    assert await _rows(async_session, c["bob"]) == []


async def test_auto_accept_splits_it_at_once(async_session, couple):
    c = couple
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, "auto_accept")
    txn_id = await _expense(async_session, c, amount="900", wallet_type=TransactionWalletType.EMERGENCY)
    out = await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id, method="fixed", my_amount=Decimal("600")))
    assert (out.status, out.my_share, out.partner_share) == ("active", 600.0, 300.0)
    row = await _row(async_session, txn_id)
    assert (row.amount, row.wallet_type) == (Decimal("600"), TransactionWalletType.EMERGENCY)


@pytest.mark.parametrize("extra, message", [
    ({"type": TransactionType.INCOME}, "Only an expense"),
    ({"transfer_group_id": uuid.uuid4()}, "transfer"),
    ({"loan_id": uuid.uuid4()}, "loan"),
    ({"holding_id": uuid.uuid4()}, "holding"),
    ({"status": TransactionStatus.PENDING}, "completed"),
])
async def test_rows_that_cannot_be_split(async_session, couple, extra, message):
    c = couple
    if extra.get("type") == TransactionType.INCOME:
        extra["category_id"] = c["salary"].id
    txn_id = await _expense(async_session, c, **extra)
    with pytest.raises(HTTPException) as err:
        await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
    assert err.value.status_code == 409 and message in err.value.detail
    assert (await async_session.execute(select(PeerSplit))).scalars().all() == []


async def test_an_expense_is_split_only_once(async_session, couple):
    c = couple
    txn_id = await _expense(async_session, c)
    await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
    with pytest.raises(HTTPException) as err:
        await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
    assert err.value.status_code == 409


async def test_only_your_own_live_expense(async_session, couple):
    c = couple
    bobs = await _expense(async_session, c, user="bob")
    gone = await _expense(async_session, c)
    (await _row(async_session, gone)).is_deleted = True
    await async_session.commit()
    for txn_id in (bobs, gone, uuid.uuid4()):
        with pytest.raises(HTTPException) as err:
            await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
        assert err.value.status_code == 404


async def test_a_share_larger_than_the_expense_is_refused(async_session, couple):
    c = couple
    txn_id = await _expense(async_session, c, amount="100")
    with pytest.raises(HTTPException) as err:
        await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id, method="fixed", my_amount=Decimal("100.01")))
    assert err.value.status_code == 422
    assert (await _row(async_session, txn_id)).peer_split_share_id is None


async def test_split_route_resolves_over_http(authenticated_client):
    r = authenticated_client.post("/api/v1/peers/splits/from-transaction",
                                  json={"transaction_id": str(uuid.uuid4()), "connection_id": str(uuid.uuid4())})
    assert r.status_code == 404, r.text[:200]  # no such connection, not a routing miss


async def test_removing_the_partner_leaves_the_expense_whole(async_session, couple):
    c = couple
    txn_id = await _expense(async_session, c)
    await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
    await PeerService(async_session).remove_connection(c["conn"].id, c["alice"].id)
    row = await _row(async_session, txn_id)
    assert (row.is_deleted, row.amount, row.peer_split_share_id) == (False, Decimal("1000"), None)


async def test_an_open_split_row_cannot_be_linked_to_a_loan(async_session, couple):
    from app.modules.transactions.repositories import (
        RecurringTransactionRepository, TransactionCategoryRepository,
    )
    from app.modules.transactions.schemas import TransactionUpdate
    from app.modules.transactions.services import TransactionService

    c = couple
    txn_id = await _expense(async_session, c)
    await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))
    txs = TransactionService(TransactionRepository(async_session), TransactionCategoryRepository(async_session),
                             RecurringTransactionRepository(async_session))
    alice = str(c["alice"].id)
    with pytest.raises(BusinessLogicException) as err:
        await txs.update_transaction(str(txn_id), alice, TransactionUpdate(loan_id=str(uuid.uuid4())))
    assert "loan_id" in err.value.details["fields"]
    # Resending no loan (as an edit form does) is not a change.
    await txs.update_transaction(str(txn_id), alice, TransactionUpdate(loan_id=None, description="Weekly groceries"))
    assert (await _row(async_session, txn_id)).description == "Weekly groceries"



async def test_your_own_expense_cant_be_changed_to_a_zero_share(async_session, couple):
    """It's the expense you recorded: a 0 share would delete it."""
    from app.modules.peers.schemas import SplitAmend

    c = couple
    txn_id = await _expense(async_session, c)
    sid = uuid.UUID((await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    with pytest.raises(HTTPException) as err:  # Bob: "you take none of it"
        await c["svc"].propose_amendment(c["bob"].id, sid, SplitAmend(
            total_amount=Decimal("1000"), method="fixed", my_amount=Decimal("1000")))
    assert err.value.status_code == 422
    row = await _row(async_session, txn_id)
    assert (row.is_deleted, row.amount) == (False, Decimal("500"))


async def test_an_unanswered_split_of_an_expense_keeps_its_total(async_session, couple):
    c = couple
    txn_id = await _expense(async_session, c)
    sid = uuid.UUID((await c["svc"].split_transaction(c["alice"].id, _body(c, txn_id))).id)
    with pytest.raises(HTTPException) as err:
        await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(total_amount=Decimal("900")))
    assert err.value.status_code == 422
    # The division can change; the expense stays whole until Bob answers.
    await c["svc"].propose_amendment(c["alice"].id, sid, SplitAmend(
        total_amount=Decimal("1000"), method="fixed", my_amount=Decimal("700")))
    assert (await _row(async_session, txn_id)).amount == Decimal("1000")
    await c["svc"].void(c["alice"].id, sid)
    row = await _row(async_session, txn_id)
    assert (row.amount, row.peer_split_share_id, row.description) == (Decimal("1000"), None, "Groceries")
