"""
Rows inside one day come back in the order they were entered.

The list sorts by transaction_date, and a day of a trip holds a dozen rows with
the same date. The only tiebreaker used to be the primary key — a random uuid4 —
so a day read in an arbitrary order: dinner above brunch, the airport snack in
the middle. created_at is now the tiebreaker (oldest first), with the id kept
last so pagination stays deterministic.

Run against the real query on SQLite, with ids chosen to sort the OPPOSITE way
from entry order, so passing cannot be an accident of uuid luck. (Every id has a
letter in it: SQLite's column affinity stores an all-digit hex string as a number.)
"""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.transactions.models import Transaction
from app.modules.transactions.repositories import TransactionRepository

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

DAY = date(2026, 10, 1)
NEXT_DAY = date(2026, 10, 2)
T0 = datetime(2026, 10, 1, 1, 0, 0)


async def _add(session, user, category, label, on, entered_minutes, id_hex):
    row = Transaction(
        id=uuid.UUID(id_hex),
        user_id=user.id,
        category_id=category.id,
        type="expense",
        wallet_type="life",
        amount=Decimal("100"),
        currency="TWD",
        description=label,
        transaction_date=on,
        status="completed",
    )
    row.created_at = T0 + timedelta(minutes=entered_minutes)
    session.add(row)
    return row


@pytest_asyncio.fixture
async def trip(async_session, test_user, test_category):
    # Entered brunch -> shopping -> dinner, with ids scrambled against that: by id
    # ascending it is dinner, brunch, shopping; descending, shopping, brunch,
    # dinner. Neither is entry order, so only created_at can produce it.
    await _add(async_session, test_user, test_category, "brunch", DAY, 0, "8a" * 16)
    await _add(async_session, test_user, test_category, "shopping", DAY, 30, "fa" * 16)
    await _add(async_session, test_user, test_category, "dinner", DAY, 60, "1a" * 16)
    await _add(async_session, test_user, test_category, "next morning", NEXT_DAY, 90, "5a" * 16)
    await async_session.commit()
    return test_user


async def _labels(session, user, **kwargs):
    rows, _ = await TransactionRepository(session).get_all(str(user.id), **kwargs)
    return [r.description for r in rows]


async def test_newest_day_first_and_each_day_in_entry_order(async_session, trip):
    assert await _labels(async_session, trip, sort_order="desc") == [
        "next morning",
        "brunch",
        "shopping",
        "dinner",
    ]


async def test_oldest_day_first_keeps_entry_order_inside_the_day(async_session, trip):
    assert await _labels(async_session, trip, sort_order="asc") == [
        "brunch",
        "shopping",
        "dinner",
        "next morning",
    ]


async def test_pages_split_a_day_without_repeating_or_dropping_rows(async_session, trip):
    first = await _labels(async_session, trip, sort_order="desc", page=1, limit=2)
    second = await _labels(async_session, trip, sort_order="desc", page=2, limit=2)
    assert first + second == ["next morning", "brunch", "shopping", "dinner"]


async def test_rows_entered_at_the_same_instant_still_have_a_total_order(
    async_session, test_user, test_category
):
    # Same day, same created_at: the id decides, so the result never wobbles.
    for id_hex, label in (("2a" * 16, "b"), ("1a" * 16, "a"), ("3a" * 16, "c")):
        await _add(async_session, test_user, test_category, label, DAY, 0, id_hex)
    await async_session.commit()

    assert await _labels(async_session, test_user, sort_order="desc") == ["a", "b", "c"]
