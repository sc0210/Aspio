"""Cash set aside for goals, and what is left to spend in the Life Wallet.

A goal never holds money of its own. Reserving moves nothing: the cash stays in
the Life Wallet (so Life, Total Asset and Net Worth are untouched) and the goal
records a claim on it (goal_contributions, kind=reserve/release). Spending that
money is an ordinary Life Wallet expense that carries the goal's id, which moves
the goal's money from "reserved" to "spent" without a second drop in Life's
available figure.

    reserved(goal) = Σ reserve/release rows + Σ signed TWD of its linked transactions
    spent(goal)    = Σ its linked expenses, in TWD
    legacy(goal)   = progress recorded before reservations existed (holds no cash)
    progress       = reserved + spent + legacy = Σ every contribution row

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

from app.modules.transactions.models import Transaction, TransactionWalletType
from app.modules.transactions.repositories import TransactionRepository

from .models import ContributionKind, Goal, GoalContribution, GoalStatus

ZERO = Decimal("0")
CENT = Decimal("0.01")


@dataclass(frozen=True)
class GoalMoney:
    reserved: Decimal = ZERO
    spent: Decimal = ZERO
    legacy: Decimal = ZERO


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
    db: AsyncSession, user_id, goal_ids: Optional[Iterable] = None
) -> Dict[UUID, GoalMoney]:
    """Reserved, spent and legacy money per goal (TWD), for one user's goals."""
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
        bucket = legacy if kind == ContributionKind.LEGACY.value else reserved
        bucket[goal_id] = bucket.get(goal_id, ZERO) + total

    # Linked transactions, over the same rows every balance counts. Signed: an
    # expense spends the reserve, an income (none yet) would return to it.
    repo = TransactionRepository(db)
    conditions = [*repo.counted_conditions(uid), Transaction.goal_id.isnot(None)]
    if ids is not None:
        conditions.append(Transaction.goal_id.in_(ids))
    signed = await repo.signed_amount_twd(conditions)
    flows = (
        select(Transaction.goal_id, func.coalesce(func.sum(signed), 0))
        .where(and_(*conditions))
        .group_by(Transaction.goal_id)
    )
    for goal_id, total in (await db.execute(flows)).all():
        total = Decimal(str(total))
        reserved[goal_id] = reserved.get(goal_id, ZERO) + total
        spent[goal_id] = spent.get(goal_id, ZERO) - total

    # Whole cents, like every amount a user can type: a foreign-currency expense
    # converts to fractions of a cent, and "release all" must match to the cent.
    def cents(bucket: Dict[UUID, Decimal], goal_id: UUID) -> Decimal:
        return bucket.get(goal_id, ZERO).quantize(CENT, rounding=ROUND_HALF_UP)

    return {
        goal_id: GoalMoney(
            reserved=cents(reserved, goal_id),
            spent=cents(spent, goal_id),
            legacy=cents(legacy, goal_id),
        )
        for goal_id in {*reserved, *spent, *legacy}
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


async def life_cash(db: AsyncSession, user_id) -> LifeCash:
    """The Life Wallet balance and how much of it goals hold (TWD)."""
    uid = _uuid(user_id)
    balances = await TransactionRepository(db).cash_balances_twd(uid)
    return LifeCash(
        balance=balances.get(TransactionWalletType.LIFE, ZERO),
        reserved=await reserved_total(db, uid),
    )


async def lock_user_goals(db: AsyncSession, user_id) -> None:
    """Lock every goal of the user until commit, in one fixed order.

    Available is shared by all of a user's goals, so two reservations (or a
    reservation and a goal-funded expense) checked at once could each see the
    same free cash. Every path that checks reserved cash takes this first.
    """
    await db.execute(
        select(Goal.id).where(Goal.user_id == _uuid(user_id)).order_by(Goal.id).with_for_update()
    )


__all__ = ["GoalMoney", "LifeCash", "goal_money", "life_cash", "lock_user_goals", "reserved_total"]
