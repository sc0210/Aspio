"""Goals reserve Life Wallet cash; they never move it.

Promise (app/modules/goals/reservations.py):
  * reserving or releasing writes no transaction, so the Life balance — and with
    it Total Asset and Net Worth — never changes because of a goal;
  * Life available = Life balance − what goals hold, and no reservation may take
    more than is available;
  * an expense paid from a goal spends that goal's reserve (never more than it
    holds), so Life's available figure does not drop a second time;
  * editing, unlinking or deleting that expense gives the money back to the goal;
  * a goal's progress (current_amount) is every contribution row, legacy included,
    and spending does not lower it.

Harm when broken: Life shows money as free to spend that is promised to a goal,
or a goal shows money that was spent elsewhere.
"""

from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.core.exceptions import BusinessLogicException, ValidationException
from app.modules.goals.models import ContributionKind, GoalContribution, GoalStatus
from app.modules.goals.reservations import GoalMoney, goal_money, life_cash
from app.modules.goals.schemas import GoalContributionCreate, GoalCreate, GoalUpdate
from app.modules.goals.service import GoalService
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.modules.transactions.repositories import (
    RecurringTransactionRepository,
    TransactionCategoryRepository,
    TransactionRepository,
)
from app.modules.transactions.schemas import TransactionCreate, TransactionUpdate
from app.modules.transactions.services import TransactionService
from app.modules.users.models import User, UserRole, UserStatus

D = Decimal


@pytest_asyncio.fixture
async def funded(async_session, test_user, test_category):
    """test_user with NT$10,000 in Life and NT$3,000 in Emergency."""
    for wallet, amount in ((TransactionWalletType.LIFE, "10000"), (TransactionWalletType.EMERGENCY, "3000")):
        async_session.add(Transaction(
            user_id=test_user.id, type=TransactionType.INCOME, wallet_type=wallet,
            amount=D(amount), currency="TWD", description="Salary",
            transaction_date=date(2026, 1, 1), category_id=test_category.id,
        ))
    await async_session.commit()
    # Ids, not ORM rows: a refused request rolls the session back, which expires
    # every loaded row, and reading one afterwards would need IO outside await.
    return test_user.id


@pytest_asyncio.fixture
async def cat(test_category):
    return str(test_category.id)


@pytest.fixture
def goals(async_session):
    return GoalService(async_session)


@pytest.fixture
def txns(async_session):
    return TransactionService(
        TransactionRepository(async_session),
        TransactionCategoryRepository(async_session),
        RecurringTransactionRepository(async_session),
    )


async def _goal(goals, user, target="5000", **extra):
    goal = await goals.create_goal(user, GoalCreate(
        title=extra.pop("title", "Japan trip"), category="vacation",
        target_amount=D(target), **extra,
    ))
    return goal.id


async def _reserve(goals, user, goal, amount):
    return await goals.reserve(goal, user, GoalContributionCreate(amount=D(amount)))


async def _pay(txns, user, cat, amount, goal=None, wallet="life", type_="expense"):
    result = await txns.create_transaction(TransactionCreate(
        type=type_, wallet_type=wallet, amount=D(amount), currency="TWD",
        description="Flights", transaction_date=date(2026, 2, 1),
        category_id=cat, goal_id=str(goal) if goal else None,
    ), str(user))
    return str(result["transaction"].id)


async def _state(db, user, goal):
    cash = await life_cash(db, user)
    money = (await goal_money(db, user, [goal])).get(goal) or GoalMoney()
    return cash, money


# ── reserve / release ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reserving_moves_no_money_and_lowers_available(async_session, goals, funded):
    goal = await _goal(goals, funded)
    rows_before = (await TransactionRepository(async_session).cash_balances_twd(funded))

    await _reserve(goals, funded, goal, "4000")

    cash, money = await _state(async_session, funded, goal)
    assert cash.balance == D("10000")          # Life (and Total Asset) untouched
    assert cash.reserved == D("4000")
    assert cash.available == D("6000")
    assert money.reserved == D("4000")
    assert (await TransactionRepository(async_session).cash_balances_twd(funded)) == rows_before
    refreshed = await goals.get_goal(goal, funded)
    assert refreshed.current_amount == D("4000")


@pytest.mark.asyncio
async def test_cannot_reserve_more_than_is_available(async_session, goals, funded):
    trip = await _goal(goals, funded)
    house = await _goal(goals, funded, title="House", target="100000")
    await _reserve(goals, funded, trip, "4000")

    # Emergency money is not Life money: only 6,000 is free.
    with pytest.raises(ValidationException):
        await _reserve(goals, funded, house, "6000.01")
    await _reserve(goals, funded, house, "6000")

    cash, _ = await _state(async_session, funded, house)
    assert cash.available == D("0")


@pytest.mark.asyncio
async def test_initial_amount_on_create_is_a_checked_reservation(async_session, goals, funded):
    with pytest.raises(ValidationException):
        await _goal(goals, funded, current_amount=D("20000"))

    goal = await _goal(goals, funded, current_amount=D("2500"))
    cash, money = await _state(async_session, funded, goal)
    assert (await goals.get_goal(goal, funded)).current_amount == D("2500")
    assert money.reserved == D("2500")
    assert cash.available == D("7500")


@pytest.mark.asyncio
async def test_release_returns_cash_and_reopens_a_completed_goal(async_session, goals, funded):
    goal = await _goal(goals, funded, target="3000")
    await _reserve(goals, funded, goal, "3000")
    assert (await goals.get_goal(goal, funded)).status is GoalStatus.COMPLETED

    with pytest.raises(ValidationException):
        await goals.release(goal, funded, GoalContributionCreate(amount=D("3000.01")))
    release = await goals.release(goal, funded, GoalContributionCreate(amount=D("1000")))

    assert release.kind == ContributionKind.RELEASE.value
    assert release.amount == D("-1000")
    refreshed = await goals.get_goal(goal, funded)
    assert refreshed.current_amount == D("2000")
    assert refreshed.status is GoalStatus.ACTIVE
    assert refreshed.completed_at is None
    cash, _ = await _state(async_session, funded, goal)
    assert cash.available == D("8000")


@pytest.mark.asyncio
async def test_cancelling_a_goal_releases_what_it_holds(async_session, goals, funded):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")

    await goals.update_goal(goal, funded, GoalUpdate(status="cancelled"))

    cash, money = await _state(async_session, funded, goal)
    assert money.reserved == D("0")
    assert cash.available == D("10000")
    with pytest.raises(BusinessLogicException):
        await _reserve(goals, funded, goal, "1")


@pytest.mark.asyncio
async def test_deleting_a_goal_frees_its_cash(async_session, goals, funded):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")

    await goals.delete_goal(goal, funded)

    assert (await life_cash(async_session, funded)).available == D("10000")


@pytest.mark.asyncio
async def test_legacy_progress_counts_but_holds_no_cash(async_session, goals, funded):
    goal = await _goal(goals, funded)
    async_session.add(GoalContribution(
        goal_id=goal, kind=ContributionKind.LEGACY.value, amount=D("1500"),
    ))
    await async_session.commit()

    cash, money = await _state(async_session, funded, goal)
    assert money.legacy == D("1500")
    assert money.reserved == D("0")
    assert cash.available == D("10000")


# ── paying from a goal ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_paying_from_a_goal_spends_its_reserve_not_available(
    async_session, goals, txns, funded, cat
):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")

    await _pay(txns, funded, cat, "2500", goal)

    cash, money = await _state(async_session, funded, goal)
    assert cash.balance == D("7500")       # a real expense: Life drops
    assert cash.available == D("6000")     # but free cash does not
    assert money.reserved == D("1500")
    assert money.spent == D("2500")
    assert (await goals.get_goal(goal, funded)).current_amount == D("4000")


@pytest.mark.asyncio
async def test_an_unlinked_expense_comes_out_of_available(async_session, goals, txns, funded, cat):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")

    await _pay(txns, funded, cat, "2500")

    cash, money = await _state(async_session, funded, goal)
    assert cash.available == D("3500")
    assert money.reserved == D("4000")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "amount,wallet,type_",
    [("4000.01", "life", "expense"), ("100", "emergency", "expense"), ("100", "life", "income")],
    ids=["more-than-reserved", "not-life", "income"],
)
async def test_a_goal_pays_only_life_expenses_it_can_cover(
    async_session, goals, txns, funded, cat, amount, wallet, type_
):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")

    with pytest.raises(ValidationException):
        await _pay(txns, funded, cat, amount, goal, wallet=wallet, type_=type_)

    _, money = await _state(async_session, funded, goal)
    assert money.reserved == D("4000")


@pytest.mark.asyncio
async def test_another_users_goal_cannot_pay(async_session, goals, txns, funded, cat):
    stranger = User(
        id=uuid4(), email="stranger@example.com", name="S", hashed_password="x",
        is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
    )
    async_session.add(stranger)
    await async_session.commit()
    stranger_id = stranger.id
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")

    with pytest.raises(ValidationException):
        await _pay(txns, stranger_id, cat, "100", goal)


@pytest.mark.asyncio
async def test_editing_a_goal_expense_counts_its_own_spend_as_room(
    async_session, goals, txns, funded, cat
):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")
    row = await _pay(txns, funded, cat, "3000", goal)

    # 3,000 is already spent from the 4,000: raising it to 4,000 fits, 4,001 does not.
    await txns.update_transaction(row, str(funded), TransactionUpdate(amount=D("4000")))
    with pytest.raises(ValidationException):
        await txns.update_transaction(row, str(funded), TransactionUpdate(amount=D("4001")))

    _, money = await _state(async_session, funded, goal)
    assert money.reserved == D("0")
    assert money.spent == D("4000")


@pytest.mark.asyncio
async def test_unlinking_or_deleting_returns_the_money_to_the_goal(
    async_session, goals, txns, funded, cat
):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")
    first = await _pay(txns, funded, cat, "1000", goal)
    second = await _pay(txns, funded, cat, "2000", goal)

    await txns.update_transaction(first, str(funded), TransactionUpdate(goal_id=""))
    await txns.delete_transaction(second, str(funded))

    cash, money = await _state(async_session, funded, goal)
    assert money.reserved == D("4000")
    assert money.spent == D("0")
    # The unlinked 1,000 is still spent — now from free cash.
    assert cash.balance == D("9000")
    assert cash.available == D("5000")


@pytest.mark.asyncio
async def test_linking_an_existing_expense_later(async_session, goals, txns, funded, cat):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "4000")
    row = await _pay(txns, funded, cat, "1500")

    await txns.update_transaction(row, str(funded), TransactionUpdate(goal_id=str(goal)))

    cash, money = await _state(async_session, funded, goal)
    assert money.reserved == D("2500")
    assert cash.available == D("6000")


@pytest.mark.asyncio
async def test_overspending_leaves_available_negative_but_is_not_blocked(
    async_session, goals, txns, funded, cat
):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "8000")

    await _pay(txns, funded, cat, "5000")   # from free cash: only 2,000 was free

    cash, _ = await _state(async_session, funded, goal)
    assert cash.balance == D("5000")
    assert cash.available == D("-3000")


# ── API plumbing ──────────────────────────────────────────────────────────


@pytest.fixture
def api_user():
    return User(
        id=uuid4(), email="goal-api@example.com", name="Goal API", hashed_password="x",
        is_active=True, is_verified=True, status=UserStatus.ACTIVE, role=UserRole.USER,
        preferences={},
    )


@pytest.fixture
def api(api_user, override_get_async_session):
    from app.core.database import get_async_session, get_db
    from app.main import app as fastapi_app
    from app.modules.users.dependencies import get_current_active_user, get_optional_current_user

    fastapi_app.dependency_overrides[get_current_active_user] = lambda: api_user
    fastapi_app.dependency_overrides[get_optional_current_user] = lambda: api_user
    fastapi_app.dependency_overrides[get_async_session] = override_get_async_session
    fastapi_app.dependency_overrides[get_db] = override_get_async_session
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


def _post_txn(api, **body):
    payload = {"type": "income", "wallet_type": "life", "amount": 10000, "currency": "TWD",
               "description": "Salary", "transaction_date": "2026-01-01", "category_name": "Salary"}
    payload.update(body)
    return api.post("/api/v1/transactions/", json=payload)


def test_api_reserve_spend_release_round_trip(api):
    assert _post_txn(api).status_code in (200, 201)
    goal = api.post("/api/v1/goals/", json={
        "title": "Japan trip", "category": "vacation", "targetAmount": 60000, "currency": "TWD",
    }).json()["data"]

    assert api.post(f"/api/v1/goals/{goal['id']}/reserve", json={"amount": 4000}).status_code == 201
    assert api.post(f"/api/v1/goals/{goal['id']}/reserve", json={"amount": 7000}).status_code == 422

    paid = _post_txn(api, type="expense", amount=1500, description="Flights",
                     category_name="Travel", goal_id=goal["id"])
    assert paid.status_code in (200, 201), paid.text
    assert paid.json()["transaction"]["goal_id"] == goal["id"]
    too_much = _post_txn(api, type="expense", amount=99999, description="Hotel",
                         category_name="Travel", goal_id=goal["id"])
    assert too_much.status_code == 422, too_much.text   # the user's message, not a 500

    assert api.post(f"/api/v1/goals/{goal['id']}/release", json={"amount": 500}).status_code == 201

    body = api.get(f"/api/v1/goals/{goal['id']}").json()["data"]
    assert D(str(body["reservedAmount"])) == D("2000")
    assert D(str(body["spentAmount"])) == D("1500")
    assert D(str(body["currentAmount"])) == D("3500")

    cash = api.get("/api/v1/goals/life-cash").json()["data"]
    assert D(str(cash["lifeBalance"])) == D("8500")
    assert D(str(cash["reserved"])) == D("2000")
    assert D(str(cash["available"])) == D("6500")


def test_api_goals_are_kept_in_twd(api):
    response = api.post("/api/v1/goals/", json={
        "title": "Trip", "category": "vacation", "targetAmount": 1000, "currency": "USD",
    })
    assert response.status_code == 422


# ── review fixes ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_cancelled_goal_holds_nothing_even_after_its_expense_is_deleted(async_session, goals, txns, funded, cat):
    goal = await _goal(goals, funded, target="20000")
    await _reserve(goals, funded, goal, "10000")
    paid = await _pay(txns, funded, cat, "4000", goal=goal)
    await goals.update_goal(goal, funded, GoalUpdate(status="cancelled"))

    # Deleting the expense puts 4,000 back on the goal's rows, but a cancelled
    # goal is not pursued, so Life keeps it free.
    await txns.delete_transaction(paid, str(funded))
    cash, _ = await _state(async_session, funded, goal)
    assert cash.reserved == D("0")
    assert cash.available == cash.balance


@pytest.mark.asyncio
async def test_renaming_a_goal_paid_row_does_not_recheck_the_reserve(async_session, goals, txns, funded, cat):
    goal = await _goal(goals, funded)
    await _reserve(goals, funded, goal, "3000")
    paid = await _pay(txns, funded, cat, "3000", goal=goal)
    # What an exchange-rate rise does to a foreign-currency row: the goal now
    # holds a little less than the row's own spend.
    async_session.add(GoalContribution(goal_id=goal, kind=ContributionKind.RELEASE.value,
                                       amount=D("-1"), contribution_date=date(2026, 2, 2)))
    await async_session.commit()

    # The edit form resends every field; unchanged values must not be refused
    # (an exchange-rate move could otherwise make the row uneditable).
    await txns.update_transaction(paid, str(funded), TransactionUpdate(
        description="Flights to Osaka", amount=D("3000"), currency="TWD",
        type="expense", wallet_type="life", goal_id=str(goal),
    ))
    _, money = await _state(async_session, funded, goal)
    assert money.spent == D("3000")


def test_a_reservation_is_whole_cents():
    from pydantic import ValidationError

    GoalContributionCreate(amount=D("12.34"))
    with pytest.raises(ValidationError):
        GoalContributionCreate(amount=D("0.004"))


@pytest.mark.asyncio
async def test_progress_is_the_rows_even_if_the_stored_figure_drifted(async_session, goals, funded):
    from sqlalchemy import update

    from app.modules.goals.models import Goal

    goal = await _goal(goals, funded, target="100000")
    await _reserve(goals, funded, goal, "1000")
    # What a lost update would leave behind.
    await async_session.execute(update(Goal).where(Goal.id == goal).values(current_amount=D("1")))
    await async_session.commit()

    await _reserve(goals, funded, goal, "500")
    refreshed = await goals.get_goal(goal, funded)
    await async_session.refresh(refreshed)
    assert refreshed.current_amount == D("1500")


@pytest.mark.asyncio
async def test_progress_counts_the_new_row_when_the_session_does_not_autoflush(async_session, goals, funded):
    # The app's sessions are autoflush=False (core/database.py); the test
    # session's default hid a progress of 0 after a reservation.
    async_session.sync_session.autoflush = False
    goal = await _goal(goals, funded, target="100000")
    await _reserve(goals, funded, goal, "2500")
    refreshed = await goals.get_goal(goal, funded)
    await async_session.refresh(refreshed)
    assert refreshed.current_amount == D("2500")
