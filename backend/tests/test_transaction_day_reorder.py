"""
A user-set order inside one day (#478): day_position and PUT /transactions/day-order.

Runs the real queries on SQLite. Rows are entered brunch -> shopping -> dinner with
ids scrambled against that (as in test_transaction_day_order.py), so an order that
comes back right cannot be an accident of created_at or of the ids.
"""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.modules.transactions.models import Transaction
from app.modules.transactions.repositories import TransactionRepository
from app.modules.transactions.schemas import DayOrderRequest

pytestmark = [pytest.mark.database]

DAY = date(2026, 10, 1)
NEXT_DAY = date(2026, 10, 2)
T0 = datetime(2026, 10, 1, 1, 0, 0)


def _row(user, category, label, on, entered_minutes, id_hex, amount="100"):
    row = Transaction(
        id=uuid.UUID(id_hex),
        user_id=user.id,
        category_id=category.id,
        type="expense",
        wallet_type="life",
        amount=Decimal(amount),
        currency="TWD",
        description=label,
        transaction_date=on,
        status="completed",
    )
    row.created_at = T0 + timedelta(minutes=entered_minutes)
    return row


@pytest_asyncio.fixture
async def trip(async_session, test_user, test_category):
    rows = {
        "brunch": _row(test_user, test_category, "brunch", DAY, 0, "8a" * 16, "300"),
        "shopping": _row(test_user, test_category, "shopping", DAY, 30, "fa" * 16, "100"),
        "dinner": _row(test_user, test_category, "dinner", DAY, 60, "1a" * 16, "200"),
        "snack": _row(test_user, test_category, "snack", DAY, 90, "4a" * 16, "50"),
        "next": _row(test_user, test_category, "next morning", NEXT_DAY, 120, "5a" * 16),
    }
    async_session.add_all(rows.values())
    await async_session.commit()
    return SimpleNamespace(user=test_user, ids={k: str(v.id) for k, v in rows.items()})


async def _labels(session, user, **kwargs):
    rows, _ = await TransactionRepository(session).get_all(str(user.id), **kwargs)
    return [r.description for r in rows]


async def _reorder(session, trip, *labels, day=DAY):
    return await TransactionRepository(session).set_day_order(
        str(trip.user.id), day, [trip.ids[label] for label in labels]
    )


@pytest.mark.asyncio
async def test_a_reordered_day_comes_back_in_that_order(async_session, trip):
    await _reorder(async_session, trip, "dinner", "snack", "brunch", "shopping")
    assert await _labels(async_session, trip.user, sort_order="desc") == [
        "next morning", "dinner", "snack", "brunch", "shopping",
    ]
    # Days run the other way; the day's own order does not.
    assert await _labels(async_session, trip.user, sort_order="asc") == [
        "dinner", "snack", "brunch", "shopping", "next morning",
    ]


@pytest.mark.asyncio
async def test_a_partial_list_reorders_only_its_own_places(async_session, trip):
    # The client showed only shopping and snack (a filter hid the rest) and swapped
    # them. They trade places; brunch and dinner stay where they were.
    ordered = await _reorder(async_session, trip, "snack", "shopping")
    assert ordered == [trip.ids[k] for k in ("brunch", "snack", "dinner", "shopping")]
    assert (await _labels(async_session, trip.user, sort_order="desc"))[1:] == [
        "brunch", "snack", "dinner", "shopping",
    ]


@pytest.mark.asyncio
async def test_a_row_added_after_the_reorder_goes_to_the_bottom_of_its_day(
    async_session, trip, test_category
):
    await _reorder(async_session, trip, "dinner", "snack", "brunch", "shopping")
    async_session.add(_row(trip.user, test_category, "late taxi", DAY, 5, "6a" * 16))
    await async_session.commit()
    # Entered earlier than everything by created_at, yet below the positioned rows.
    assert await _labels(async_session, trip.user, sort_order="desc") == [
        "next morning", "dinner", "snack", "brunch", "shopping", "late taxi",
    ]


@pytest.mark.asyncio
async def test_day_position_does_not_leak_into_other_sorts(async_session, trip):
    await _reorder(async_session, trip, "snack", "shopping", "dinner", "brunch")
    # By amount the positions mean nothing: 300, 200, 100, 100, 50.
    labels = await _labels(async_session, trip.user, sort_by="amount", sort_order="desc")
    assert labels[:2] == ["brunch", "dinner"] and labels[-1] == "snack"


@pytest.mark.asyncio
async def test_another_days_row_is_refused(async_session, trip):
    with pytest.raises(LookupError):
        await _reorder(async_session, trip, "brunch", "next")


@pytest.mark.asyncio
async def test_someone_elses_row_is_refused(async_session, trip, test_category):
    from app.modules.users.models import User

    other = User(email="other@example.com", name="Other", hashed_password="x")
    async_session.add(other)
    await async_session.flush()
    async_session.add(_row(other, test_category, "not yours", DAY, 0, "9b" * 16))
    await async_session.commit()
    with pytest.raises(LookupError):
        await TransactionRepository(async_session).set_day_order(
            str(trip.user.id), DAY, [trip.ids["brunch"], "9b" * 16]
        )


@pytest.mark.asyncio
async def test_a_deleted_row_is_refused_and_ignored(async_session, trip):
    repo = TransactionRepository(async_session)
    row = await repo.get_by_id(trip.ids["snack"], str(trip.user.id))
    row.is_deleted = True
    await async_session.commit()
    with pytest.raises(LookupError):
        await _reorder(async_session, trip, "snack", "brunch")
    # The live rows still reorder, numbered without the deleted one.
    ordered = await _reorder(async_session, trip, "dinner", "brunch", "shopping")
    assert ordered == [trip.ids[k] for k in ("dinner", "brunch", "shopping")]


@pytest.mark.asyncio
async def test_duplicate_or_malformed_ids_are_refused(async_session, trip):
    with pytest.raises(ValueError):
        await _reorder(async_session, trip, "brunch", "brunch")
    with pytest.raises(ValueError):
        await TransactionRepository(async_session).set_day_order(
            str(trip.user.id), DAY, ["not-a-uuid"]
        )


# --- the endpoint --------------------------------------------------------------------


def test_day_order_route_is_not_swallowed_by_the_id_route():
    # Read from the transactions router itself, not app.routes: what matters is the
    # registration order inside this router (FastAPI matches in that order), and how
    # the app assembles routers differs between environments — app.routes listed no
    # transaction routes at all on CI.
    from app.modules.transactions.router import router

    puts = [r.path for r in router.routes if isinstance(r, APIRoute) and "PUT" in r.methods]
    assert "/day-order" in puts, puts
    assert puts.index("/day-order") < puts.index("/{transaction_id}"), puts


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "status"), [(ValueError("dup"), 422), (LookupError("not yours"), 404)]
)
async def test_endpoint_maps_errors_to_statuses(error, status):
    from app.modules.transactions.router import set_day_order

    class Service:
        async def set_day_order(self, user_id, day, ids):
            raise error

    with pytest.raises(HTTPException) as exc:
        await set_day_order(
            transaction_service=Service(),
            current_user=SimpleNamespace(id=uuid.uuid4()),
            body=DayOrderRequest(date=DAY, ids=["8a" * 16]),
        )
    assert exc.value.status_code == status


@pytest.mark.asyncio
async def test_endpoint_answers_with_the_whole_day():
    from app.modules.transactions.router import set_day_order

    class Service:
        async def set_day_order(self, user_id, day, ids):
            return ["a", "b", "c"]

    response = await set_day_order(
        transaction_service=Service(),
        current_user=SimpleNamespace(id=uuid.uuid4()),
        body=DayOrderRequest(date=DAY, ids=["b"]),
    )
    assert response.success and response.data.ids == ["a", "b", "c"]
    assert response.data.date == DAY


# --- a row moved to another day drops its place in the old one -------------------------


async def _position(session, trip, label):
    row = await TransactionRepository(session).get_by_id(trip.ids[label], str(trip.user.id))
    await session.refresh(row)
    return row.day_position


@pytest.mark.asyncio
async def test_moving_a_row_to_another_day_clears_its_position(async_session, trip):
    await _reorder(async_session, trip, "dinner", "snack", "brunch", "shopping")
    assert await _position(async_session, trip, "dinner") == 1

    await TransactionRepository(async_session).update(
        trip.ids["dinner"], str(trip.user.id), {"transaction_date": NEXT_DAY}
    )

    # Not position 1 of the new day: it rejoins it as an unplaced row, by entry
    # order — dinner was entered before "next morning", so it leads Oct 2.
    assert await _position(async_session, trip, "dinner") is None
    assert await _labels(async_session, trip.user, sort_order="desc") == [
        "dinner", "next morning",          # Oct 2: entry order
        "snack", "brunch", "shopping",     # Oct 1 keeps the rest of its order
    ]


def test_a_date_given_as_a_string_is_compared_as_a_date():
    # SQLite refuses a string for a Date column outright, so check the comparison the
    # helper builds rather than running it: it must compare against a real date.
    from app.modules.transactions.repositories import _forget_day_position_on_move

    data = {"transaction_date": "2026-10-02T00:00:00"}
    _forget_day_position_on_move(data)
    compiled = data["day_position"].compile()
    assert date(2026, 10, 2) in compiled.params.values()


@pytest.mark.asyncio
async def test_an_edit_that_keeps_the_date_keeps_the_position(async_session, trip):
    await _reorder(async_session, trip, "dinner", "snack", "brunch", "shopping")
    repo = TransactionRepository(async_session)
    # Same date resent (the edit form always sends it), and an edit without a date.
    await repo.update(trip.ids["snack"], str(trip.user.id), {"transaction_date": DAY, "description": "snack!"})
    await repo.update(trip.ids["brunch"], str(trip.user.id), {"description": "late brunch"})
    assert await _position(async_session, trip, "snack") == 2
    assert await _position(async_session, trip, "brunch") == 3


@pytest.mark.asyncio
async def test_the_transfer_edit_path_clears_it_too(async_session, trip):
    # update_flush is what a transfer edit uses for both legs.
    await _reorder(async_session, trip, "dinner", "snack", "brunch", "shopping")
    repo = TransactionRepository(async_session)
    await repo.update_flush(trip.ids["shopping"], str(trip.user.id), {"transaction_date": NEXT_DAY})
    await async_session.commit()
    assert await _position(async_session, trip, "shopping") is None
