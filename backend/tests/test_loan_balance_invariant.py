"""The loan-balance promise, checked over generated sequences of real API operations.

Promise: a loan's current_balance equals its principal_amount minus the payment recorded
by each live expense linked to it (principal_portion when the payment was capped, else
amount), and the loan reads paid_off exactly when that balance is 0.

Harm when broken: the Loans page, the debt total and net worth show a debt that is too
high or too low, and payoff projections are built on it.

Hypothesis drives TransactionService (the code behind POST/PUT/DELETE /transactions)
with sequences of the operations the API allows on a linked expense: create (expense or
income, linked or not), change the amount, relink or unlink, delete. After every step it
reads the rows back and checks the promise.

Read a failure as API requests: `ops=[('create', 'expense', 100, 'A'), ('amount', 0, 400)]`
is "pay 100 on loan A, then edit that payment to 400". A sequence the API cannot produce
is a modeling error in this file; one it can is a bug in TransactionService.
"""

import asyncio
import os
from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from hypothesis import HealthCheck, event, given, settings
from hypothesis import strategies as st
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.sql import sqltypes

from app.core.database import Base
from app.modules.loans.models import DebtAccount, LoanAccountType, LoanStatus
from app.modules.transactions.models import Transaction, TransactionCategory, TransactionType
from app.modules.transactions.repositories import (
    RecurringTransactionRepository,
    TransactionCategoryRepository,
    TransactionRepository,
)
from app.modules.transactions.schemas import TransactionCreate, TransactionUpdate
from app.modules.transactions.services import TransactionService
from app.modules.users.models import User, UserRole, UserStatus

# Small principals next to the amounts, so sequences reach capped final payments,
# paid-off loans and refused payments within a few steps.
PRINCIPALS = {"A": Decimal("500"), "B": Decimal("2500")}
AMOUNTS = [Decimal(a) for a in ("100", "400", "700", "1000", "1300")]
LOAN = st.sampled_from(["A", "B", None])
AMOUNT = st.sampled_from(AMOUNTS)
ROW = st.integers(min_value=0, max_value=7)

OPERATION = st.one_of(
    st.tuples(st.just("create"), st.sampled_from(["expense", "income"]), AMOUNT, LOAN),
    st.tuples(st.just("amount"), ROW, AMOUNT),
    st.tuples(st.just("link"), ROW, LOAN),
    st.tuples(st.just("delete"), ROW),
)
SEQUENCE = st.lists(OPERATION, min_size=1, max_size=14)

# States a run must reach, or a pass says nothing about the paths that can drift.
MUST_REACH = {
    "capped final payment",
    "refused: payment to a paid-off loan",
    "loan A paid off",
    "amount applied to an existing row",
    "link applied to an existing row",
}
REACHED = Counter()


def _reached(label: str) -> None:
    event(label)
    REACHED[label] += 1


@dataclass
class World:
    session: AsyncSession
    service: TransactionService
    user_id: str
    category_id: str
    loans: dict  # "A" | "B" -> loan UUID
    rows: list  # live transaction ids, in creation order


async def _database():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        user = User(
            id=uuid4(), email="loan-invariant@example.com", name="Loan Invariant",
            hashed_password="x", is_active=True, is_verified=True, role=UserRole.USER,
            status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="Asia/Taipei",
            experience_points=0, level=1,
        )
        category = TransactionCategory(
            id=uuid4(), name="Loan Payment", name_en="Loan Payment", type=TransactionType.EXPENSE,
            color="#000000", icon="x", description="x", keywords=[], is_default=False,
            is_active=True, is_system=False,
        )
        session.add_all([user, category])
        await session.commit()
        ids = (str(user.id), str(category.id))
    return engine, maker, ids


async def _fresh_world(maker, user_id, category_id) -> World:
    session = maker()
    await session.execute(delete(Transaction))
    await session.execute(delete(DebtAccount))
    loans = {}
    for name, principal in PRINCIPALS.items():
        loan = DebtAccount(
            id=uuid4(), user_id=UUID(user_id), name=f"Loan {name}", account_type=LoanAccountType.PERSONAL_LOAN,
            principal_amount=principal, current_balance=principal, interest_rate=Decimal("3"),
            minimum_payment=Decimal("100"), payment_due_day=5, start_date=date(2026, 1, 1),
            is_deleted=False,
        )
        session.add(loan)
        loans[name] = loan.id
    await session.commit()
    service = TransactionService(
        TransactionRepository(session), TransactionCategoryRepository(session),
        RecurringTransactionRepository(session),
    )
    return World(session, service, user_id, category_id, loans, [])


async def _apply(world: World, op) -> None:
    """One API-shaped operation. A refusal (a payment to a paid-off loan) is allowed."""
    kind = op[0]
    if kind == "create":
        _, type_, amount, loan = op
        data = TransactionCreate(
            type=TransactionType(type_), amount=amount, currency="TWD", description="pay",
            transaction_date=date(2026, 10, 31), category_id=world.category_id,
            loan_id=str(world.loans[loan]) if loan else None,
        )
        try:
            created = await world.service.create_transaction(data, world.user_id)
        except ValueError:
            _reached("refused: payment to a paid-off loan")
            return
        if created["transaction"].principal_portion:
            _reached("capped final payment")
        world.rows.append(str(created["transaction"].id))
        return
    if not world.rows:
        return
    row = world.rows[op[1] % len(world.rows)]
    if kind == "amount":
        update = TransactionUpdate(amount=op[2])
    elif kind == "link":
        update = TransactionUpdate(loan_id=str(world.loans[op[2]]) if op[2] else "")
    else:
        await world.service.delete_transaction(row, world.user_id)
        world.rows.remove(row)
        return
    try:
        await world.service.update_transaction(row, world.user_id, update)
    except ValueError:
        _reached(f"refused: {kind} onto a paid-off loan")
        return
    _reached(f"{kind} applied to an existing row")


async def _violations(world: World) -> list:
    """Every way the stored state breaks the promise, in the code's terms. Empty = holds."""
    world.session.expire_all()
    found = []
    for name, loan_id in world.loans.items():
        loan = (await world.session.execute(select(DebtAccount).where(DebtAccount.id == loan_id))).scalar_one()
        linked = (await world.session.execute(
            select(Transaction).where(
                Transaction.loan_id == loan_id,
                Transaction.type == TransactionType.EXPENSE,
                Transaction.is_deleted == False,  # noqa: E712
            )
        )).scalars().all()
        recorded = sum((Decimal(str(t.principal_portion or t.amount)) for t in linked), Decimal("0"))
        expected = loan.principal_amount - recorded
        if loan.current_balance != expected:
            found.append(
                f"loan {name}: current_balance {loan.current_balance} but principal "
                f"{loan.principal_amount} minus linked payments {recorded} is {expected}"
            )
        paid_off = loan.status == LoanStatus.PAID_OFF
        if paid_off and loan.current_balance == 0:
            _reached(f"loan {name} paid off")
        if paid_off != (loan.current_balance == 0):
            found.append(f"loan {name}: status {loan.status.value} with current_balance {loan.current_balance}")
    return found


def _postgres_like_uuid_binding(original):
    """Accept a UUID string on SQLite, as asyncpg does in production.

    The update path binds loan_id as the string the API received. PostgreSQL takes it;
    SQLite's Uuid processor calls .hex on it and raises. Without this the check would
    test SQLite's typing, not the loan logic.
    """
    def bind_processor(self, dialect):
        process = original(self, dialect)
        if process is None or dialect.name != "sqlite":
            return process
        return lambda value: process(UUID(value) if isinstance(value, str) else value)
    return bind_processor


def _run(check):
    """Run `check(loop, maker, ids)` on one database in one event loop, SQLite adapted."""
    original = sqltypes.Uuid.bind_processor
    sqltypes.Uuid.bind_processor = _postgres_like_uuid_binding(original)
    loop = asyncio.new_event_loop()
    try:
        engine, maker, ids = loop.run_until_complete(_database())
        try:
            check(loop, maker, ids)
        finally:
            loop.run_until_complete(engine.dispose())
    finally:
        loop.close()
        sqltypes.Uuid.bind_processor = original


# Fixed examples by default, so CI and a rerun see the same 200 and a result reproduces.
# LOAN_INVARIANT_EXPLORE=1 draws fresh random ones (and more of them) to look further.
EXPLORE = os.environ.get("LOAN_INVARIANT_EXPLORE") == "1"
SETTINGS = settings(
    max_examples=1000 if EXPLORE else 200,
    derandomize=not EXPLORE,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


def test_loan_balance_matches_its_linked_payments():
    def check(loop, maker, ids):
        @SETTINGS
        @given(SEQUENCE)
        def sequence_keeps_the_promise(ops):
            async def go():
                world = await _fresh_world(maker, *ids)
                try:
                    for step, op in enumerate(ops, start=1):
                        await _apply(world, op)
                        broken = await _violations(world)
                        assert not broken, f"after step {step} {op}: {broken}"
                finally:
                    await world.session.close()
            loop.run_until_complete(go())

        REACHED.clear()
        sequence_keeps_the_promise()
        print("reached:", dict(REACHED))
        assert MUST_REACH <= REACHED.keys(), f"never reached {MUST_REACH - REACHED.keys()}"

    _run(check)


def test_a_failed_balance_write_leaves_no_drift():
    """The same promise when writing the loan balance fails mid-request (a dropped
    database connection, a crash). The request errors and its session rolls back; the
    promise must still hold. It did not while the row and the balance were separate
    commits: a failed balance write left a linked payment that never moved its loan."""
    def check(loop, maker, ids):
        @SETTINGS
        @given(SEQUENCE, st.integers(min_value=1, max_value=6))
        def failure_keeps_the_promise(ops, fail_at):
            async def go():
                world = await _fresh_world(maker, *ids)
                writes = 0
                write_balance = world.service._apply_loan_payment

                async def failing_on_one_write(*args, **kwargs):
                    nonlocal writes
                    writes += 1
                    if writes == fail_at:
                        raise ConnectionError("database lost while writing the loan balance")
                    return await write_balance(*args, **kwargs)

                world.service._apply_loan_payment = failing_on_one_write
                try:
                    for step, op in enumerate(ops, start=1):
                        try:
                            await _apply(world, op)
                        except ConnectionError:
                            await world.session.rollback()
                        broken = await _violations(world)
                        assert not broken, f"after step {step} {op} (balance write {fail_at} failed): {broken}"
                finally:
                    await world.session.close()
            loop.run_until_complete(go())

        failure_keeps_the_promise()

    _run(check)
