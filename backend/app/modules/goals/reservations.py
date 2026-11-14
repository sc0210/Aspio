"""Cash set aside for goals, and what is left to spend in the Life Wallet.

A goal never holds money of its own. Reserving moves nothing: the cash stays in
the Life Wallet (so Life, Total Asset and Net Worth are untouched) and the goal
records a claim on it (goal_contributions, kind=reserve/release). Spending that
money is an ordinary Life Wallet expense that carries the goal's id, which moves
the goal's money from "reserved" to "spent" without a second drop in Life's
available figure.

    reserved(goal) = Σ reserve/release rows + Σ signed TWD of its linked transactions
    spent(goal)    = Σ its linked expenses, in TWD (not the holdings it bought)
    legacy(goal)   = progress recorded before reservations existed (holds no cash)
    progress       = Σ every contribution row: reserve/release, legacy, and the
                     realized gain or loss of each sale of the goal's lots (kind
                     gain), which keeps it equal to the money the goal has
    invested(goal) = market value, in TWD, of the active lots its money bought
    value          = reserved + spent + legacy + invested (progress at market value)

Investing goal money (portfolio_holdings.goal_id) is a Life expense carrying the
goal's id, like paying from it, so reserved drops by the cost and Life's
available cash does not move; the lot's market value is the goal's instead. A
sale's proceeds carry the id back, so the reserve grows by what the lot fetched.

    Life available = Life balance − Σ reserved over the user's goals

Every figure is derived from rows, so editing or deleting a linked expense
corrects the goal by itself.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Iterable, Optional
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.portfolio.models import PortfolioHolding
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.utils.fx_sql import in_twd, twd_rates_for
from app.modules.transactions.repositories import TransactionRepository

from .models import ContributionKind, Goal, GoalContribution, GoalStatus

ZERO = Decimal("0")
CENT = Decimal("0.01")


# Lots whose value does not swing with a market: a goal due soon may hold these.
STEADY_TYPES = frozenset({"cash", "lending", "cpf"})


@dataclass(frozen=True)
class GoalMoney:
    reserved: Decimal = ZERO
    spent: Decimal = ZERO
    legacy: Decimal = ZERO
    # Market value of the goal's active lots, and the part of it in lots that
    # move with a market (stocks, funds, crypto), all in TWD.
    invested: Decimal = ZERO
    at_risk: Decimal = ZERO

    @property
    def value(self) -> Decimal:
        """Progress at market value: cash held, spent, tracked and invested."""
        return self.reserved + self.spent + self.legacy + self.invested


@dataclass(frozen=True)
class LifeCash:
    balance: Decimal
    reserved: Decimal

    @property
    def available(self) -> Decimal:
        return self.balance - self.reserved


def _uuid(value) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


async def goal_money(
    db: AsyncSession, user_id, goal_ids: Optional[Iterable] = None, *, with_holdings: bool = False
) -> Dict[UUID, GoalMoney]:
    """Reserved, spent and legacy money per goal (TWD), for one user's goals.

    ``with_holdings`` adds the market value of the goals' lots (invested,
    at_risk): a price and FX lookup that the cash checks, run under the goals'
    lock, do not need.
    """
    uid = _uuid(user_id)
    ids = None if goal_ids is None else [_uuid(g) for g in goal_ids]
    if ids is not None and not ids:
        return {}

    contributions = (
        select(
            GoalContribution.goal_id,
            GoalContribution.kind,
            func.coalesce(func.sum(GoalContribution.amount), 0),
        )
        .join(Goal, Goal.id == GoalContribution.goal_id)
        .where(Goal.user_id == uid)
        .group_by(GoalContribution.goal_id, GoalContribution.kind)
    )
    if ids is not None:
        contributions = contributions.where(GoalContribution.goal_id.in_(ids))

    reserved: Dict[UUID, Decimal] = {}
    spent: Dict[UUID, Decimal] = {}
    legacy: Dict[UUID, Decimal] = {}
    for goal_id, kind, total in (await db.execute(contributions)).all():
        total = Decimal(str(total))
        if kind == ContributionKind.GAIN.value:
            continue  # progress only: the sale's proceeds already hold the cash
        bucket = legacy if kind == ContributionKind.LEGACY.value else reserved
        bucket[goal_id] = bucket.get(goal_id, ZERO) + total

    # Linked transactions, over the same rows every balance counts. Signed: an
    # expense spends the reserve, an income (none yet) would return to it.
    repo = TransactionRepository(db)
    conditions = [*repo.counted_conditions(uid), Transaction.goal_id.isnot(None)]
    if ids is not None:
        conditions.append(Transaction.goal_id.in_(ids))
    signed = await repo.signed_amount_twd(conditions)
    # Spent is what left for good: a goal expense that bought no holding. A
    # holding's buy leg and a sale's proceeds only move money between the
    # goal's cash and its investments.
    is_spend = and_(Transaction.holding_id.is_(None), Transaction.type != TransactionType.INCOME)
    flows = (
        select(Transaction.goal_id, is_spend, func.coalesce(func.sum(signed), 0))
        .where(and_(*conditions))
        .group_by(Transaction.goal_id, is_spend)
    )
    for goal_id, spend, total in (await db.execute(flows)).all():
        total = Decimal(str(total))
        reserved[goal_id] = reserved.get(goal_id, ZERO) + total
        if spend:
            spent[goal_id] = spent.get(goal_id, ZERO) - total

    # What the goal's money bought, at today's value. total_value is in the
    # lot's own currency (see portfolio services), so it is converted here.
    lots = [
        PortfolioHolding.user_id == uid,
        PortfolioHolding.is_active.is_(True),
        PortfolioHolding.goal_id.isnot(None),
    ]
    if ids is not None:
        lots.append(PortfolioHolding.goal_id.in_(ids))
    currencies = (await db.execute(
        select(PortfolioHolding.currency).where(and_(*lots)).distinct()
    )).scalars().all() if with_holdings else []
    invested: Dict[UUID, Decimal] = {}
    at_risk: Dict[UUID, Decimal] = {}
    if with_holdings and currencies:
        value = in_twd(PortfolioHolding.total_value, PortfolioHolding.currency,
                       await twd_rates_for(db, currencies))
        steady = PortfolioHolding.type.in_(sorted(STEADY_TYPES))
        rows = await db.execute(
            select(PortfolioHolding.goal_id, steady, func.coalesce(func.sum(value), 0))
            .where(and_(*lots))
            .group_by(PortfolioHolding.goal_id, steady)
        )
        for goal_id, is_steady, total in rows.all():
            total = Decimal(str(total))
            invested[goal_id] = invested.get(goal_id, ZERO) + total
            if not is_steady:
                at_risk[goal_id] = at_risk.get(goal_id, ZERO) + total

    # Whole cents, like every amount a user can type: a foreign-currency expense
    # converts to fractions of a cent, and "release all" must match to the cent.
    def cents(bucket: Dict[UUID, Decimal], goal_id: UUID) -> Decimal:
        return bucket.get(goal_id, ZERO).quantize(CENT, rounding=ROUND_HALF_UP)

    return {
        goal_id: GoalMoney(
            reserved=cents(reserved, goal_id),
            spent=cents(spent, goal_id),
            legacy=cents(legacy, goal_id),
            invested=cents(invested, goal_id),
            at_risk=cents(at_risk, goal_id),
        )
        for goal_id in {*reserved, *spent, *legacy, *invested}
    }


async def reserved_total(db: AsyncSession, user_id) -> Decimal:
    """How much Life Wallet cash the user's goals hold, in TWD."""
    # A cancelled goal holds nothing: cancelling releases its cash, and an
    # expense of it deleted later must not quietly take Life cash back.
    open_ids = (await db.execute(
        select(Goal.id).where(Goal.user_id == _uuid(user_id), Goal.status != GoalStatus.CANCELLED)
    )).scalars().all()
    money = await goal_money(db, user_id, open_ids)
    # A goal can only dip below zero through an FX move on a foreign-currency
    # expense; it never frees cash for another goal.
    return sum((max(ZERO, m.reserved) for m in money.values()), ZERO)


async def emergency_balance(db: AsyncSession, user_id) -> Decimal:
    """The Emergency Wallet in TWD: its cash plus holdings parked there.

    What an emergency-fund goal tracks: that money is set aside by living in
    the Emergency Wallet (a Life → Emergency transfer), not by reserving Life
    cash. The same figure as the dashboard's Emergency wallet.
    """
    uid = _uuid(user_id)
    cash = (await TransactionRepository(db).cash_balances_twd(uid)).get(
        TransactionWalletType.EMERGENCY, ZERO
    )
    from app.modules.portfolio.models import HoldingWalletType

    lots = [
        PortfolioHolding.user_id == uid,
        PortfolioHolding.is_active.is_(True),
        PortfolioHolding.wallet_type == HoldingWalletType.EMERGENCY,
    ]
    currencies = (await db.execute(
        select(PortfolioHolding.currency).where(and_(*lots)).distinct()
    )).scalars().all()
    held = ZERO
    if currencies:
        value = in_twd(PortfolioHolding.total_value, PortfolioHolding.currency,
                       await twd_rates_for(db, currencies))
        held = Decimal(str(await db.scalar(select(func.coalesce(func.sum(value), 0)).where(and_(*lots)))))
    return (Decimal(str(cash)) + held).quantize(CENT, rounding=ROUND_HALF_UP)


async def life_cash(db: AsyncSession, user_id) -> LifeCash:
    """The Life Wallet balance and how much of it goals hold (TWD)."""
    uid = _uuid(user_id)
    balances = await TransactionRepository(db).cash_balances_twd(uid)
    return LifeCash(
        balance=balances.get(TransactionWalletType.LIFE, ZERO),
        reserved=await reserved_total(db, uid),
    )


async def assert_goal_can_cover(
    db: AsyncSession, user_id, goal_id, need: Decimal, *,
    already: Decimal = ZERO, otherwise: str = "leave the goal off",
) -> Goal:
    """The goal, after refusing ``need`` (TWD) beyond what it holds.

    The one rule for paying from a goal, whether an expense or a holding: the
    user's goals are locked first (see lock_user_goals), and ``already`` is what
    the row being edited takes from the goal now, so it counts as room.
    """
    from app.core.exceptions import ValidationException

    from .repositories import GoalRepository

    uid, gid = _uuid(user_id), _uuid(goal_id)
    await lock_user_goals(db, uid)
    goal = await GoalRepository(db).get_goal_by_id(gid, uid)
    if goal is None:
        raise ValidationException("Goal not found", details={"goal_id": str(gid)})
    if goal.status == GoalStatus.CANCELLED:
        raise ValidationException("A cancelled goal holds no money")
    held = (await goal_money(db, uid, [gid])).get(gid)
    room = (held.reserved if held else ZERO) + already
    if need > room:
        raise ValidationException(
            f"Only NT${max(room, ZERO):,.0f} is reserved for {goal.title}. "
            f"Reserve more on Goals first, or {otherwise}.",
            details={"reserved": str(room), "amount": str(need)},
        )
    return goal


async def lock_user_goals(db: AsyncSession, user_id) -> None:
    """Lock every goal of the user until commit, in one fixed order.

    Available is shared by all of a user's goals, so two reservations (or a
    reservation and a goal-funded expense) checked at once could each see the
    same free cash. Every path that checks reserved cash takes this first.
    """
    await db.execute(
        select(Goal.id).where(Goal.user_id == _uuid(user_id)).order_by(Goal.id).with_for_update()
    )


__all__ = ["STEADY_TYPES", "GoalMoney", "assert_goal_can_cover", "emergency_balance", "LifeCash", "goal_money", "life_cash", "lock_user_goals", "reserved_total"]
