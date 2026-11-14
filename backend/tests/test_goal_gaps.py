"""Goal money follow-ups (2026-11-15).

  * a goal lot sold after the exchange rate moved books its gain against what
    the goal actually paid, so "release everything" ends at exactly 0;
  * a partner's reservation that completes a shared goal stores it as reached
    and sends the "reached" alert, as a saving record does;
  * an emergency-fund goal follows the Emergency Wallet, and refuses to reserve
    Life cash (that money belongs in the Emergency Wallet).
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.exceptions import BusinessLogicException
from app.modules.goals.reservations import goal_money
from app.modules.goals.schemas import GoalContributionCreate, GoalCreate
from app.modules.goals.service import GoalService
from app.modules.portfolio.routers.holdings import sell_holding
from app.modules.portfolio.schemas import HoldingCreate
from app.modules.portfolio.services import PortfolioService, get_portfolio_service
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.modules.users.models import User, UserRole, UserStatus
from app.modules.users.security import jwt_manager

D = Decimal
pytestmark = [pytest.mark.asyncio, pytest.mark.database]
BUY_DAY = datetime(2026, 3, 2, 4, 0, tzinfo=timezone.utc)
SELL_DAY = datetime(2026, 6, 2, 4, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _no_price_fetch(monkeypatch):
    import app.core.background_tasks as bg

    async def nothing(*args, **kwargs):
        return None

    monkeypatch.setattr(bg, "run_in_background", nothing)


def _income(user_id, category_id, amount, wallet=TransactionWalletType.LIFE):
    return Transaction(
        user_id=user_id, type=TransactionType.INCOME, wallet_type=wallet, amount=D(amount),
        currency="TWD", description="Salary", transaction_date=date(2026, 1, 1), category_id=category_id,
    )


async def test_a_usd_goal_lot_books_its_gain_against_what_the_goal_paid(async_session, test_user, test_category, monkeypatch):
    # USD/TWD 30 when bought, 32 when sold: the lot's price did not move, so
    # the whole gain is the rate, measured against the 30,000 the goal paid.
    async def to_twd(self, amount, currency, on_day=None):
        if (currency or "TWD").upper() == "TWD":
            return D(amount), "TWD"
        rate = D("30") if on_day is not None and on_day < SELL_DAY.date() else D("32")
        return D(amount) * rate, "TWD"

    monkeypatch.setattr(PortfolioService, "_to_twd", to_twd)
    async_session.add(_income(test_user.id, test_category.id, "100000"))
    await async_session.commit()
    user = test_user.id
    goals = GoalService(async_session)
    goal = (await goals.create_goal(user, GoalCreate(title="Tokyo flat", category="savings", target_amount=D("1000000")))).id
    await goals.reserve(goal, user, GoalContributionCreate(amount=D("50000")))

    lot = (await get_portfolio_service(async_session).add_holding(user, HoldingCreate(
        symbol="VTI", name="Vanguard Total", type="etf", exchange="NYSE", currency="USD", market="US",
        quantity=D("10"), average_cost=D("100"), purchase_date=BUY_DAY, goal_id=goal,
    ))).id
    await sell_holding(holding_id=lot, quantity=D("10"), price=D("100"), fees=D("0"), taxes=D("0"),
                       notes=None, transaction_date=SELL_DAY, current_user=SimpleNamespace(id=user),
                       session=async_session)

    money = (await goal_money(async_session, user, [goal])).get(goal)
    assert money.reserved == D("52000")                 # 50,000 − 30,000 + 32,000
    stored = await goals.get_goal(goal, user)
    await async_session.refresh(stored)
    assert stored.current_amount == D("52000")         # the 2,000 rate gain, exactly

    await goals.release(goal, user, GoalContributionCreate(amount=D("52000")))
    stored = await goals.get_goal(goal, user)
    await async_session.refresh(stored)
    assert stored.current_amount == D("0")


@pytest_asyncio.fixture
async def partner(async_session, test_user):
    test_user.username = "tester"
    user = User(id=uuid4(), email="partner@example.com", name="Partner", username="partner",
                hashed_password="x", is_active=True, is_verified=True, role=UserRole.USER,
                status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="UTC",
                experience_points=0, level=1)
    async_session.add(user)
    await async_session.commit()
    return {"Authorization": "Bearer " + jwt_manager.create_access_token({"sub": str(user.id), "email": user.email})}


def _ok(response, code=200):
    assert response.status_code == code, (response.request.url, response.status_code, response.text[:300])
    body = response.json()
    return body.get("data") if isinstance(body, dict) and "success" in body else body


async def test_a_reservation_that_completes_a_shared_goal_says_so(
        authenticated_client, seed_categories, partner, async_session, test_user):
    from app.modules.notifications.models import Notification
    from app.modules.peers.models import SharedGoal

    client = authenticated_client
    connection = _ok(client.post("/api/v1/peers/invite", json={"username": "partner"}), 201)["id"]
    _ok(client.patch(f"/api/v1/peers/{connection}/respond", json={"action": "accept"}, headers=partner))
    _ok(client.post("/api/v1/transactions/", json={
        "type": "income", "wallet_type": "life", "amount": "50000", "currency": "TWD",
        "description": "Salary", "transaction_date": "2026-01-01", "category_name": "Salary"}), 201)
    shared = _ok(client.post("/api/v1/peers/goals", json={
        "connection_id": connection, "title": "Wedding", "target_amount": "30000"}), 201)["id"]
    _ok(client.post(f"/api/v1/peers/goals/{shared}/records", json={
        "amount": "10000", "record_date": "2026-02-01"}, headers=partner), 201)
    mine = _ok(client.post(f"/api/v1/peers/goals/{shared}/link-goal"))

    _ok(client.post(f"/api/v1/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    status = (await async_session.execute(select(SharedGoal.status).where(SharedGoal.id == UUID(shared)))).scalar_one()
    assert status == "completed"
    reached = (await async_session.execute(select(Notification.user_id).where(
        Notification.title == "Shared goal reached!"))).scalars().all()
    assert len(reached) == 2 and test_user.id in reached


async def test_an_emergency_fund_goal_follows_the_emergency_wallet(async_session, test_user, test_category):
    async_session.add(_income(test_user.id, test_category.id, "50000"))
    async_session.add(_income(test_user.id, test_category.id, "30000", TransactionWalletType.EMERGENCY))
    await async_session.commit()
    goals = GoalService(async_session)
    goal = (await goals.create_goal(test_user.id, GoalCreate(
        title="Six months", category="emergency_fund", target_amount=D("180000")))).id

    loaded = await goals.get_goal(goal, test_user.id)
    await goals.attach_money([loaded], test_user.id)
    assert loaded.tracks_emergency is True
    assert loaded.value_amount == D("30000")

    with pytest.raises(BusinessLogicException, match="Emergency Wallet"):
        await goals.reserve(goal, test_user.id, GoalContributionCreate(amount=D("1000")))


async def _goal_with_cash(async_session, test_user, test_category, reserve="50000"):
    async_session.add(_income(test_user.id, test_category.id, "100000"))
    await async_session.commit()
    goals = GoalService(async_session)
    goal = (await goals.create_goal(test_user.id, GoalCreate(title="Flat", category="savings", target_amount=D("1000000")))).id
    await goals.reserve(goal, test_user.id, GoalContributionCreate(amount=D(reserve)))
    return goals, goal


async def _progress(goals, async_session, user, goal):
    stored = await goals.get_goal(goal, user)
    await async_session.refresh(stored)
    return stored.current_amount


async def test_a_resized_twd_goal_lot_sells_with_no_phantom_gain(async_session, test_user, test_category):
    from app.modules.portfolio.routers.holdings import update_holding
    from app.modules.portfolio.schemas import HoldingUpdate

    user = test_user.id
    goals, goal = await _goal_with_cash(async_session, test_user, test_category)
    lot = (await get_portfolio_service(async_session).add_holding(user, HoldingCreate(
        symbol="0050", name="Yuanta 50", type="etf", exchange="TWSE", currency="TWD", market="TW",
        quantity=D("10"), average_cost=D("100"), purchase_date=BUY_DAY, goal_id=goal,
    ))).id
    await update_holding(holding_id=lot, holding_updates=HoldingUpdate(quantity=D("20")),
                         current_user=SimpleNamespace(id=user), session=async_session)
    await sell_holding(holding_id=lot, quantity=D("20"), price=D("100"), fees=D("0"), taxes=D("0"),
                       notes=None, transaction_date=SELL_DAY, current_user=SimpleNamespace(id=user),
                       session=async_session)
    assert await _progress(goals, async_session, user, goal) == D("50000")   # sold at cost: no gain


async def test_a_sale_whose_fees_eat_the_proceeds_still_matches_the_goals_money(async_session, test_user, test_category):
    user = test_user.id
    goals, goal = await _goal_with_cash(async_session, test_user, test_category)
    lot = (await get_portfolio_service(async_session).add_holding(user, HoldingCreate(
        symbol="0050", name="Yuanta 50", type="etf", exchange="TWSE", currency="TWD", market="TW",
        quantity=D("10"), average_cost=D("100"), purchase_date=BUY_DAY, goal_id=goal,
    ))).id
    await sell_holding(holding_id=lot, quantity=D("10"), price=D("1"), fees=D("50"), taxes=D("0"),
                       notes=None, transaction_date=SELL_DAY, current_user=SimpleNamespace(id=user),
                       session=async_session)
    money = (await goal_money(async_session, user, [goal])).get(goal)
    assert money.reserved == D("49000")                                     # nothing came back
    assert await _progress(goals, async_session, user, goal) == D("49000")   # the 1,000 is lost


async def test_an_emergency_fund_completes_on_the_wallet_it_follows(async_session, test_user, test_category):
    from app.modules.goals.models import GoalStatus

    async_session.add(_income(test_user.id, test_category.id, "200000", TransactionWalletType.EMERGENCY))
    await async_session.commit()
    goals = GoalService(async_session)
    goal = (await goals.create_goal(test_user.id, GoalCreate(
        title="Six months", category="emergency_fund", target_amount=D("180000")))).id

    listed, _ = await goals.list_goals(test_user.id)
    assert [g.status for g in listed if g.id == goal] == [GoalStatus.COMPLETED]


async def test_cancelling_a_linked_goal_reopens_the_shared_goal(
        authenticated_client, seed_categories, partner, async_session):
    from app.modules.peers.models import SharedGoal

    client = authenticated_client
    connection = _ok(client.post("/api/v1/peers/invite", json={"username": "partner"}), 201)["id"]
    _ok(client.patch(f"/api/v1/peers/{connection}/respond", json={"action": "accept"}, headers=partner))
    _ok(client.post("/api/v1/transactions/", json={
        "type": "income", "wallet_type": "life", "amount": "50000", "currency": "TWD",
        "description": "Salary", "transaction_date": "2026-01-01", "category_name": "Salary"}), 201)
    shared = _ok(client.post("/api/v1/peers/goals", json={
        "connection_id": connection, "title": "Wedding", "target_amount": "20000"}), 201)["id"]
    mine = _ok(client.post(f"/api/v1/peers/goals/{shared}/link-goal"))
    _ok(client.post(f"/api/v1/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    _ok(client.put(f"/api/v1/goals/{mine['id']}", json={"status": "cancelled"}))

    status = (await async_session.execute(select(SharedGoal.status).where(SharedGoal.id == UUID(shared)))).scalar_one()
    assert status == "active"
