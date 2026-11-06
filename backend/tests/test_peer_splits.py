"""
Bill splitting between peers, against real rows.

The invariant: across the two ledgers the split rows add up to exactly the bill,
and each person's ledger holds only their own share once the partner accepts.
Nothing is written into a partner's ledger before they accept (or chose
auto-accept). The open balance is derived from accepted splits.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

from app.core.exceptions import BusinessLogicException
from app.modules.notifications.models import Notification
from app.modules.peers.models import PeerConnection, PeerStatus
from app.modules.peers.schemas import SplitCreate
from app.modules.peers.splits import SplitService, split_amounts
from app.modules.transactions.schemas import TransactionUpdate
from app.modules.transactions.models import (
    CategoryType, Transaction, TransactionCategory, TransactionWalletType,
)
from app.modules.users.models import User, UserRole, UserStatus

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _user(name):
    return User(id=uuid.uuid4(), email=f"{name}@example.com", name=name, username=name,
                is_active=True, role=UserRole.USER, status=UserStatus.ACTIVE)


@pytest_asyncio.fixture
async def couple(async_session):
    alice, bob, eve = _user("alice"), _user("bob"), _user("eve")
    food = TransactionCategory(id=uuid.uuid4(), name="Food", type=CategoryType.EXPENSE,
                               icon="🍜", color="#ff0000", is_active=True)
    salary = TransactionCategory(id=uuid.uuid4(), name="Pay", type=CategoryType.INCOME,
                                 icon="💰", color="#00ff00", is_active=True)
    async_session.add_all([alice, bob, eve, food, salary])
    await async_session.flush()
    conn = PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=bob.id,
                          status=PeerStatus.ACCEPTED)
    async_session.add(conn)
    await async_session.commit()
    return dict(alice=alice, bob=bob, eve=eve, conn=conn, food=food, salary=salary,
                svc=SplitService(async_session))


def _bill(c, **kw):
    body = dict(connection_id=c["conn"].id, description="Dinner", total_amount=Decimal("1000"),
                split_date=date(2026, 11, 6), category_id=c["food"].id)
    body.update(kw)
    return SplitCreate(**body)


async def _rows(session, user):
    rows = (await session.execute(select(Transaction).where(
        Transaction.user_id == user.id, Transaction.is_deleted == False))).scalars().all()  # noqa: E712
    return sorted(Decimal(r.amount) for r in rows)


class TestSplitArithmetic:
    def test_equal_gives_the_rounding_cent_to_the_payer(self):
        assert split_amounts(Decimal("100.01"), "equal", True, None, None) == (Decimal("50.01"), Decimal("50.00"))
        assert split_amounts(Decimal("100.01"), "equal", False, None, None) == (Decimal("50.00"), Decimal("50.01"))

    def test_percent_and_fixed_always_sum_to_the_total(self):
        mine, theirs = split_amounts(Decimal("999.99"), "percent", True, Decimal("33.33"), None)
        assert mine + theirs == Decimal("999.99")
        assert split_amounts(Decimal("1000"), "fixed", True, None, Decimal("700")) == (Decimal("700.00"), Decimal("300.00"))

    def test_a_fixed_share_over_the_total_is_refused(self):
        with pytest.raises(HTTPException):
            split_amounts(Decimal("100"), "fixed", True, None, Decimal("101"))


async def test_payer_carries_the_bill_until_the_partner_accepts(async_session, couple):
    c = couple
    split = await c["svc"].create_split(c["alice"].id, _bill(c))  # alice paid
    assert (split.status, split.my_share, split.partner_share) == ("proposed", 500, 500)
    assert await _rows(async_session, c["alice"]) == [Decimal("1000")]
    assert await _rows(async_session, c["bob"]) == []  # nothing in bob's ledger yet

    accepted = await c["svc"].respond(c["bob"].id, uuid.UUID(split.id), "accept", None, "emergency")
    assert accepted.status == "active"
    assert await _rows(async_session, c["alice"]) == [Decimal("500")]
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]
    bob_row = (await async_session.execute(select(Transaction).where(Transaction.user_id == c["bob"].id))).scalars().one()
    assert bob_row.wallet_type == TransactionWalletType.EMERGENCY

    [alice_view] = await c["svc"].balances(c["alice"].id)
    [bob_view] = await c["svc"].balances(c["bob"].id)
    assert [(b.currency, b.net) for b in alice_view.balances] == [("TWD", 500)]
    assert [(b.currency, b.net) for b in bob_view.balances] == [("TWD", -500)]


async def test_when_the_partner_paid_each_records_only_their_share(async_session, couple):
    c = couple
    split = await c["svc"].create_split(c["alice"].id, _bill(c, payer="partner", method="fixed",
                                                             my_amount=Decimal("300")))
    assert await _rows(async_session, c["alice"]) == [Decimal("300")]
    await c["svc"].respond(c["bob"].id, uuid.UUID(split.id), "accept", None, "life")
    assert await _rows(async_session, c["bob"]) == [Decimal("700")]
    [alice_view] = await c["svc"].balances(c["alice"].id)
    assert [b.net for b in alice_view.balances] == [-300]  # alice owes bob


async def test_declining_leaves_the_payer_with_the_whole_bill(async_session, couple):
    c = couple
    split = await c["svc"].create_split(c["alice"].id, _bill(c))
    declined = await c["svc"].respond(c["bob"].id, uuid.UUID(split.id), "decline", None, "life")
    assert declined.status == "declined"
    assert await _rows(async_session, c["alice"]) == [Decimal("1000")]
    assert await _rows(async_session, c["bob"]) == []
    [view] = await c["svc"].balances(c["alice"].id)
    assert view.balances == []


async def test_declining_a_bill_the_partner_paid_removes_the_creators_share(async_session, couple):
    c = couple
    split = await c["svc"].create_split(c["alice"].id, _bill(c, payer="partner"))
    await c["svc"].respond(c["bob"].id, uuid.UUID(split.id), "decline", None, "life")
    assert await _rows(async_session, c["alice"]) == []


async def test_auto_accept_writes_the_partners_share_at_once(async_session, couple):
    c = couple
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, "auto_accept")
    split = await c["svc"].create_split(c["alice"].id, _bill(c))
    assert split.status == "active"
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]


async def test_a_partner_who_turned_splits_off_cant_be_sent_one(async_session, couple):
    c = couple
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, "off")
    with pytest.raises(HTTPException) as exc:
        await c["svc"].create_split(c["alice"].id, _bill(c))
    assert exc.value.status_code == 403


async def test_only_the_creator_withdraws_and_only_before_an_answer(async_session, couple):
    c = couple
    split = await c["svc"].create_split(c["alice"].id, _bill(c))
    sid = uuid.UUID(split.id)
    with pytest.raises(HTTPException) as exc:
        await c["svc"].void(c["bob"].id, sid)
    assert exc.value.status_code == 403

    voided = await c["svc"].void(c["alice"].id, sid)
    assert voided.status == "voided"
    assert await _rows(async_session, c["alice"]) == []

    accepted = await c["svc"].create_split(c["alice"].id, _bill(c))
    await c["svc"].respond(c["bob"].id, uuid.UUID(accepted.id), "accept", None, "life")
    with pytest.raises(HTTPException) as exc:
        await c["svc"].void(c["alice"].id, uuid.UUID(accepted.id))
    assert exc.value.status_code == 409


async def test_answering_is_for_the_partner_and_only_once(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    with pytest.raises(HTTPException) as exc:  # the creator can't accept for them
        await c["svc"].respond(c["alice"].id, sid, "accept", None, "life")
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:  # an outsider can't see it at all
        await c["svc"].respond(c["eve"].id, sid, "accept", None, "life")
    assert exc.value.status_code == 404

    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    with pytest.raises(HTTPException) as exc:
        await c["svc"].respond(c["bob"].id, sid, "decline", None, "life")
    assert exc.value.status_code == 409
    assert await _rows(async_session, c["bob"]) == [Decimal("500")]


async def test_a_split_needs_an_expense_category(async_session, couple):
    c = couple
    with pytest.raises(HTTPException) as exc:
        await c["svc"].create_split(c["alice"].id, _bill(c, category_id=c["salary"].id))
    assert exc.value.status_code == 422


async def test_balances_are_kept_per_currency(async_session, couple):
    c = couple
    for kw in ({}, {"currency": "USD", "total_amount": Decimal("40")}):
        split = await c["svc"].create_split(c["alice"].id, _bill(c, **kw))
        await c["svc"].respond(c["bob"].id, uuid.UUID(split.id), "accept", None, "life")
    [view] = await c["svc"].balances(c["alice"].id)
    assert sorted((b.currency, b.net) for b in view.balances) == [("TWD", 500), ("USD", 20)]


async def test_the_partner_is_notified_with_a_link(async_session, couple):
    c = couple
    await c["svc"].create_split(c["alice"].id, _bill(c))
    notes = (await async_session.execute(select(Notification).where(
        Notification.user_id == c["bob"].id))).scalars().all()
    assert [(n.data["action"], n.action_url, n.is_actionable) for n in notes] == [
        ("peer_split_proposed", "/savings?tab=splits", True)]


async def test_an_open_splits_row_keeps_its_money_fields(async_session, couple):
    from app.modules.transactions.repositories import (
        RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
    )
    from app.modules.transactions.services import TransactionService

    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    row = (await async_session.execute(select(Transaction).where(
        Transaction.user_id == c["alice"].id, Transaction.is_deleted == False))).scalars().one()  # noqa: E712
    txs = TransactionService(TransactionRepository(async_session), TransactionCategoryRepository(async_session),
                             RecurringTransactionRepository(async_session))

    with pytest.raises(BusinessLogicException):
        await txs.update_transaction(str(row.id), str(c["alice"].id), TransactionUpdate(amount=Decimal("1")))
    with pytest.raises(BusinessLogicException):
        await txs.delete_transaction(str(row.id), str(c["alice"].id))
    # Its own fields stay editable.
    await txs.update_transaction(str(row.id), str(c["alice"].id),
                                 TransactionUpdate(description="Dinner at Din Tai Fung"))


async def test_after_a_decline_the_row_is_the_payers_own_again(async_session, couple):
    from app.modules.transactions.repositories import (
        RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
    )
    from app.modules.transactions.services import TransactionService

    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "decline", None, "life")
    row = (await async_session.execute(select(Transaction).where(
        Transaction.user_id == c["alice"].id, Transaction.is_deleted == False))).scalars().one()  # noqa: E712
    txs = TransactionService(TransactionRepository(async_session), TransactionCategoryRepository(async_session),
                             RecurringTransactionRepository(async_session))
    assert await txs.delete_transaction(str(row.id), str(c["alice"].id))


async def test_split_routes_resolve_over_http(authenticated_client):
    """Registered before /{connection_id}, so these paths aren't read as an id."""
    for path in ("/api/v1/peers/splits", "/api/v1/peers/splits/balances"):
        r = authenticated_client.get(path)
        assert r.status_code == 200, (path, r.text[:200])
        assert r.json()["data"] == []
    assert authenticated_client.get(f"/api/v1/peers/splits/{uuid.uuid4()}").status_code == 404


async def test_the_payer_can_cancel_an_accepted_split(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")

    with pytest.raises(HTTPException) as exc:  # bob didn't pay: he can't push his share back
        await c["svc"].cancel(c["bob"].id, sid)
    assert exc.value.status_code == 403

    cancelled = await c["svc"].cancel(c["alice"].id, sid)
    assert cancelled.status == "voided"
    assert await _rows(async_session, c["alice"]) == [Decimal("1000")]
    assert await _rows(async_session, c["bob"]) == []
    [view] = await c["svc"].balances(c["alice"].id)
    assert view.balances == []


async def test_a_removed_partner_cant_answer_an_old_proposal(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    c["conn"].status = PeerStatus.REMOVED
    await async_session.commit()
    with pytest.raises(HTTPException) as exc:
        await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")
    assert exc.value.status_code == 404
    assert await _rows(async_session, c["bob"]) == []


async def test_open_proposals_are_capped(async_session, couple, monkeypatch):
    from app.modules.peers import splits as splits_module

    c = couple
    monkeypatch.setattr(splits_module, "MAX_OPEN_PROPOSALS", 2)
    await c["svc"].create_split(c["alice"].id, _bill(c))
    await c["svc"].create_split(c["alice"].id, _bill(c))
    with pytest.raises(HTTPException) as exc:
        await c["svc"].create_split(c["alice"].id, _bill(c))
    assert exc.value.status_code == 409


async def test_a_share_can_never_have_two_live_rows(async_session, couple):
    """The partial unique index backs the row lock: a second live row for the
    same share is refused by the database."""
    from sqlalchemy.exc import IntegrityError

    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    alice_row = (await async_session.execute(select(Transaction).where(
        Transaction.user_id == c["alice"].id))).scalars().one()
    clone = Transaction(id=uuid.uuid4(), user_id=c["alice"].id, type=alice_row.type,
                        wallet_type=alice_row.wallet_type, amount=Decimal("1"), currency="TWD",
                        description="dup", transaction_date=alice_row.transaction_date,
                        category_id=alice_row.category_id,
                        peer_split_share_id=alice_row.peer_split_share_id)
    async_session.add(clone)
    with pytest.raises(IntegrityError):
        await async_session.flush()
    await async_session.rollback()
    assert sid  # the split itself is untouched


def test_the_currency_must_be_a_three_letter_code(couple):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _bill(couple, currency="NT$")


async def test_a_payer_who_didnt_create_the_split_can_cancel_it(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c, payer="partner"))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")  # bob paid, 500 each

    await c["svc"].cancel(c["bob"].id, sid)
    assert await _rows(async_session, c["bob"]) == [Decimal("1000")]
    assert await _rows(async_session, c["alice"]) == []


async def test_open_splits_are_listed_even_past_the_history_cap(async_session, couple, monkeypatch):
    from app.modules.peers import splits as splits_module

    c = couple
    monkeypatch.setattr(splits_module, "LIST_LIMIT", 1)
    open_ = await c["svc"].create_split(c["alice"].id, _bill(c))
    for _ in range(2):
        closed = await c["svc"].create_split(c["alice"].id, _bill(c))
        await c["svc"].void(c["alice"].id, uuid.UUID(closed.id))

    listed = await c["svc"].list_splits(c["alice"].id)
    assert [s.status for s in listed] == ["proposed", "voided"]
    assert listed[0].id == open_.id


@pytest.mark.parametrize("message", [
    'duplicate key value violates unique constraint "uq_transactions_live_peer_split_share"',  # Postgres
    "UNIQUE constraint failed: transactions.peer_split_share_id",  # SQLite
])
async def test_a_lost_accept_race_is_a_409_and_leaves_nothing(async_session, couple, monkeypatch, message):
    from sqlalchemy.exc import IntegrityError

    c = couple
    bob_id = c["bob"].id  # the service's rollback expires the fixture's loaded rows
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)

    async def collide(*args, **kwargs):
        raise IntegrityError("INSERT", {}, Exception(message))

    monkeypatch.setattr(c["svc"], "_accept", collide)
    with pytest.raises(HTTPException) as exc:
        await c["svc"].respond(bob_id, sid, "accept", None, "life")
    assert exc.value.status_code == 409
    rows = (await async_session.execute(select(Transaction).where(
        Transaction.user_id == bob_id, Transaction.is_deleted == False))).scalars().all()  # noqa: E712
    assert rows == []


@pytest.mark.parametrize("message", [
    'insert or update on table "transactions" violates foreign key constraint '
    '"transactions_peer_split_share_id_fkey"',
    'new row for relation "peer_split_shares" violates check constraint "peer_split_share_non_negative"',
    "FOREIGN KEY constraint failed",
])
async def test_other_integrity_errors_are_not_mistaken_for_the_race(async_session, couple, monkeypatch, message):
    from sqlalchemy.exc import IntegrityError

    c = couple
    bob_id = c["bob"].id
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)

    async def broken(*args, **kwargs):
        raise IntegrityError("INSERT", {}, Exception(message))

    monkeypatch.setattr(c["svc"], "_accept", broken)
    with pytest.raises(IntegrityError):
        await c["svc"].respond(bob_id, sid, "accept", None, "life")


async def test_declined_splits_list_with_history_and_by_connection(async_session, couple):
    c = couple
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "decline", None, "life")
    listed = await c["svc"].list_splits(c["alice"].id, c["conn"].id)
    assert [s.status for s in listed] == ["declined"]
    assert await c["svc"].list_splits(c["alice"].id, uuid.uuid4()) == []



async def test_a_closed_splits_surviving_row_is_unlinked(async_session, couple):
    """Declined (payer keeps the bill) and cancelled splits leave a plain expense."""
    c = couple
    declined = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, declined, "decline", None, "life")
    cancelled = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, cancelled, "accept", None, "life")
    await c["svc"].cancel(c["alice"].id, cancelled)

    rows = (await async_session.execute(select(Transaction).where(
        Transaction.user_id == c["alice"].id, Transaction.is_deleted == False))).scalars().all()  # noqa: E712
    assert sorted(r.amount for r in rows) == [Decimal("1000"), Decimal("1000")]
    assert {r.peer_split_share_id for r in rows} == {None}
    # And the split no longer reports a row of its own.
    assert (await c["svc"].get_split(c["alice"].id, declined)).my_transaction_id is None


async def test_removing_a_partner_keeps_the_balance_and_unlocks_rows(async_session, couple):
    from app.modules.peers.service import PeerService
    from app.modules.transactions.repositories import (
        RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
    )
    from app.modules.transactions.services import TransactionService

    c = couple
    alice_id, bob_id = c["alice"].id, c["bob"].id
    active = uuid.UUID((await c["svc"].create_split(alice_id, _bill(c))).id)
    await c["svc"].respond(bob_id, active, "accept", None, "life")
    pending = uuid.UUID((await c["svc"].create_split(alice_id, _bill(c, payer="partner"))).id)

    await PeerService(async_session).remove_connection(c["conn"].id, alice_id)

    # The unanswered proposal closed like a decline: alice's (non-payer) share went.
    assert (await c["svc"].get_split(alice_id, pending)).status == "declined"
    # What bob owes alice is still there to see.
    [view] = await SplitService(async_session).balances(alice_id)
    assert [(b.currency, b.net) for b in view.balances] == [("TWD", 500)]
    # And bob's entry is his to edit or delete now.
    bob_row = (await async_session.execute(select(Transaction).where(
        Transaction.user_id == bob_id, Transaction.is_deleted == False))).scalars().one()  # noqa: E712
    assert bob_row.peer_split_share_id is None
    txs = TransactionService(TransactionRepository(async_session), TransactionCategoryRepository(async_session),
                             RecurringTransactionRepository(async_session))
    assert await txs.delete_transaction(str(bob_row.id), str(bob_id))


async def test_a_removed_partner_with_nothing_owed_drops_off_the_balances(async_session, couple):
    from app.modules.peers.service import PeerService

    c = couple
    await PeerService(async_session).remove_connection(c["conn"].id, c["alice"].id)
    assert await SplitService(async_session).balances(c["alice"].id) == []


async def test_saving_prefs_twice_on_a_fresh_connection(async_session, couple):
    c = couple
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, "auto_accept")
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, "off")
    assert (await c["svc"].get_prefs(c["bob"].id, c["conn"].id)).split_policy == "off"


async def test_the_list_reports_each_rows_id(async_session, couple):
    c = couple
    first = await c["svc"].create_split(c["alice"].id, _bill(c))
    second = await c["svc"].create_split(c["alice"].id, _bill(c))
    listed = {s.id: s.my_transaction_id for s in await c["svc"].list_splits(c["alice"].id)}
    assert listed[first.id] == first.my_transaction_id and listed[first.id] is not None
    assert listed[second.id] == second.my_transaction_id and listed[second.id] != listed[first.id]
