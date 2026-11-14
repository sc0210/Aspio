"""A goal's reserved cash can be invested; the goal keeps its money either way.

Promise (app/modules/goals/reservations.py, portfolio add/sell):
  * buying a holding with a goal's money is a Life expense carrying the goal's
    id: reserved drops by the cost, Life's available cash does not move, and the
    lot's market value counts toward the goal;
  * no buy may take more than the goal holds, and a cancelled goal holds nothing;
  * a goal's lot never merges with, or sells as part of, a lot that is not the
    goal's, and its sale proceeds return to the goal's reserve;
  * a fixed deposit (a cash lot) bought with goal money leaves Life too, even in
    the Portfolio wallet, where cash otherwise moves no money;
  * deleting the holding gives the goal its cash back.

Harm when broken: goal money counted twice (in Life's available cash and in the
holding), or a sale of the user's own shares credited to a goal.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.exceptions import BusinessLogicException, ValidationException
from app.modules.goals.reservations import GoalMoney, goal_money, life_cash
from app.modules.goals.schemas import GoalContributionCreate, GoalCreate, GoalUpdate
from app.modules.goals.service import GoalService
from app.modules.portfolio.models import PortfolioHolding
from app.modules.portfolio.routers.holdings import remove_holding, sell_holding, update_holding
from app.modules.portfolio.schemas import HoldingCreate, HoldingUpdate
from app.modules.portfolio.services import get_portfolio_service
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.modules.transactions.repositories import (
    RecurringTransactionRepository,
    TransactionCategoryRepository,
    TransactionRepository,
)
from app.modules.transactions.schemas import TransactionUpdate
from app.modules.transactions.services import TransactionService

D = Decimal
pytestmark = [pytest.mark.asyncio, pytest.mark.database]
DAY = datetime(2026, 3, 2, 4, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _no_price_fetch(monkeypatch):
    """add_holding queues a live quote fetch; tests price lots themselves."""
    import app.core.background_tasks as bg

    async def nothing(*args, **kwargs):
        return None

    monkeypatch.setattr(bg, "run_in_background", nothing)


@pytest_asyncio.fixture
async def funded(async_session, test_user, test_category):
    """test_user with NT$100,000 in Life and a goal holding NT$20,000 of it."""
    async_session.add(Transaction(
        user_id=test_user.id, type=TransactionType.INCOME, wallet_type=TransactionWalletType.LIFE,
        amount=D("100000"), currency="TWD", description="Salary",
        transaction_date=date(2026, 1, 1), category_id=test_category.id,
    ))
    await async_session.commit()
    goals = GoalService(async_session)
    goal = await goals.create_goal(test_user.id, GoalCreate(
        title="House deposit", category="house_down_payment", target_amount=D("1000000"),
    ))
    await goals.reserve(goal.id, test_user.id, GoalContributionCreate(amount=D("20000")))
    return test_user.id, goal.id


def _stock(qty="10", cost="500", goal=None, symbol="0050", type_="stock", **extra):
    return HoldingCreate(
        symbol=symbol, name=extra.pop("name", "Yuanta 50"), type=type_, exchange="TWSE",
        currency="TWD", market="TW", quantity=D(qty), average_cost=D(cost),
        purchase_date=DAY, goal_id=goal, **extra,
    )


async def _buy(session, user, payload):
    holding = await get_portfolio_service(session).add_holding(user, payload)
    return holding.id


async def _money(session, user, goal):
    return (await goal_money(session, user, [goal], with_holdings=True)).get(goal) or GoalMoney()


async def _sell(session, user_id, holding_id, quantity, price):
    from app.modules.users.models import User

    user = await session.get(User, user_id)
    return await sell_holding(
        holding_id=holding_id, quantity=D(quantity), price=D(price), fees=D("0"),
        taxes=D("0"), notes=None, transaction_date=DAY, current_user=user, session=session,
    )


async def test_buying_with_goal_money_moves_it_into_the_holding(async_session, funded):
    user, goal = funded
    before = await life_cash(async_session, user)

    await _buy(async_session, user, _stock(goal=goal))

    after = await life_cash(async_session, user)
    money = await _money(async_session, user, goal)
    assert after.balance == before.balance - D("5000")   # the buy left Life
    assert after.available == before.available            # but not free cash
    assert money.reserved == D("15000")
    assert money.invested == D("5000")
    assert money.at_risk == D("5000")
    assert money.spent == D("0")                          # invested, not spent
    assert money.value == D("20000")


async def test_a_goal_cannot_invest_more_than_it_holds(async_session, funded):
    user, goal = funded
    with pytest.raises(ValidationException, match="reserved for House deposit"):
        await _buy(async_session, user, _stock(qty="41", goal=goal))   # 20,500
    await async_session.rollback()
    lots = (await async_session.execute(
        select(PortfolioHolding).where(PortfolioHolding.user_id == user))).scalars().all()
    assert lots == []


async def test_a_cancelled_goal_cannot_invest(async_session, funded):
    user, goal = funded
    await GoalService(async_session).update_goal(goal, user, GoalUpdate(status="cancelled"))
    with pytest.raises(ValidationException, match="cancelled"):
        await _buy(async_session, user, _stock(goal=goal))


async def test_goal_lots_stay_apart_and_sell_apart(async_session, funded):
    user, goal = funded
    own = await _buy(async_session, user, _stock())
    mine = await _buy(async_session, user, _stock(goal=goal))
    assert own != mine                                   # same day, not merged

    # Selling the goal's shares draws only on the goal's lot, and the proceeds
    # (gain included) return to the goal.
    await _sell(async_session, user, mine, "10", "600")
    money = await _money(async_session, user, goal)
    assert money.reserved == D("21000")                 # 15,000 + 6,000
    assert money.invested == D("0")
    own_lot = await async_session.get(PortfolioHolding, own)
    await async_session.refresh(own_lot)
    assert own_lot.quantity == D("10")

    # Selling the user's own shares never touches the goal.
    await _sell(async_session, user, own, "10", "600")
    assert (await _money(async_session, user, goal)).reserved == D("21000")


async def test_a_fixed_deposit_bought_with_goal_money_leaves_life(async_session, funded):
    user, goal = funded
    before = await life_cash(async_session, user)

    await _buy(async_session, user, _stock(
        qty="8000", cost="1", symbol="TD-SAVINGS", type_="cash", name="1-year time deposit",
    ).model_copy(update={"goal_id": goal}))

    after = await life_cash(async_session, user)
    money = await _money(async_session, user, goal)
    assert after.balance == before.balance - D("8000")
    assert after.available == before.available
    assert money.invested == D("8000")
    assert money.at_risk == D("0")                        # a deposit does not swing
    assert money.value == D("20000")


async def test_deleting_the_holding_gives_the_goal_its_cash_back(async_session, funded):
    from types import SimpleNamespace

    user, goal = funded
    lot = await _buy(async_session, user, _stock(goal=goal))
    # A stand-in user: the handler commits, which would expire a loaded one.
    await remove_holding(holding_id=lot, current_user=SimpleNamespace(id=user),
                         session=async_session)

    money = await _money(async_session, user, goal)
    assert money.reserved == D("20000")
    assert money.invested == D("0")


async def test_the_buy_leg_keeps_its_goal(async_session, funded):
    user, goal = funded
    lot = await _buy(async_session, user, _stock(goal=goal))
    leg = (await async_session.execute(
        select(Transaction).where(Transaction.holding_id == lot))).scalar_one()
    assert leg.goal_id == goal

    txns = TransactionService(
        TransactionRepository(async_session),
        TransactionCategoryRepository(async_session),
        RecurringTransactionRepository(async_session),
    )
    with pytest.raises(BusinessLogicException, match="holding"):
        await txns.update_transaction(str(leg.id), str(user), TransactionUpdate(goal_id=""))


async def test_a_goal_funded_buy_in_the_emergency_wallet_leaves_life_too(async_session, funded):
    user, goal = funded
    before = await life_cash(async_session, user)
    await _buy(async_session, user, _stock(goal=goal).model_copy(update={"wallet_type": "emergency"}))
    after = await life_cash(async_session, user)
    assert after.balance == before.balance - D("5000")
    assert after.available == before.available
    assert (await _money(async_session, user, goal)).reserved == D("15000")


async def test_a_goal_lot_cannot_grow_past_the_goals_reserve(async_session, funded):
    from types import SimpleNamespace

    user, goal = funded
    lot = await _buy(async_session, user, _stock(goal=goal))          # 5,000 of 20,000
    with pytest.raises(ValidationException, match="reserved for House deposit"):
        await update_holding(holding_id=lot, holding_updates=HoldingUpdate(quantity=D("41")),
                             current_user=SimpleNamespace(id=user), session=async_session)
    # 40 shares (20,000) fits: the lot's own 5,000 counts as room.
    await update_holding(holding_id=lot, holding_updates=HoldingUpdate(quantity=D("40")),
                         current_user=SimpleNamespace(id=user), session=async_session)
    assert (await _money(async_session, user, goal)).reserved == D("0")


async def test_a_sales_gain_moves_progress_so_releasing_everything_ends_at_zero(async_session, funded):
    user, goal = funded
    lot = await _buy(async_session, user, _stock(goal=goal))          # 10 @ 500
    await _sell(async_session, user, lot, "10", "600")                  # +1,000

    goals = GoalService(async_session)
    money = await _money(async_session, user, goal)
    assert money.reserved == D("21000")
    stored = await goals.get_goal(goal, user)
    await async_session.refresh(stored)
    assert stored.current_amount == D("21000")                         # progress = the money

    await goals.release(goal, user, GoalContributionCreate(amount=D("21000")))
    stored = await goals.get_goal(goal, user)
    await async_session.refresh(stored)
    assert stored.current_amount == D("0")


async def test_a_goals_sale_proceeds_cannot_leave_life(async_session, funded):
    user, goal = funded
    lot = await _buy(async_session, user, _stock(goal=goal))
    await _sell(async_session, user, lot, "10", "600")
    proceeds = (await async_session.execute(select(Transaction).where(
        Transaction.goal_id == goal, Transaction.type == TransactionType.INCOME))).scalar_one()
    proceeds_id = str(proceeds.id)  # a refusal rolls back, which expires the row

    txns = TransactionService(
        TransactionRepository(async_session),
        TransactionCategoryRepository(async_session),
        RecurringTransactionRepository(async_session),
    )
    # Reserved goal cash must be Life cash: moved to Emergency, the goal would
    # hold money Life does not have.
    with pytest.raises(ValidationException):
        await txns.update_transaction(proceeds_id, str(user),
                                      TransactionUpdate(wallet_type="emergency"))
    # Its own fields still edit.
    await txns.update_transaction(proceeds_id, str(user),
                                  TransactionUpdate(description="0050 sold for the deposit"))
