"""Two requests moving one loan's balance at once, on real Postgres.

SQLite ignores SELECT ... FOR UPDATE, so the rest of the suite cannot see any of this.
Promise: every writer locks loans (by id) before the transaction row, so concurrent
requests apply in turn, read what the other one stored, and never deadlock.

Run against a Postgres server you can create databases on. The test makes its own
database there and drops it afterwards:

    ASPIRO_PG_LOCK_TEST_URL=postgresql+asyncpg://user:pass@host:5432/postgres \\
        python -m pytest tests/test_loan_row_lock_postgres.py -m integration -o "addopts="
"""

import asyncio
import os
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("ASPIRO_PG_LOCK_TEST_URL", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio,
    pytest.mark.skipif(not URL.startswith("postgresql"), reason="needs ASPIRO_PG_LOCK_TEST_URL"),
]

PRINCIPAL = Decimal("5000")
# How long a second writer gets to slip past a lock it should be waiting on.
WINDOW = 0.4


@pytest_asyncio.fixture
async def world():
    import asyncpg

    import app.main  # noqa: F401  registers every model
    from app.core.database import Base
    from app.modules.loans.models import DebtAccount, LoanAccountType
    from app.modules.transactions.models import Currency, TransactionCategory, TransactionType
    from app.modules.users.models import User, UserRole, UserStatus

    name = f"aspiro_lock_{uuid4().hex[:8]}"
    server = make_url(URL)
    admin = server.set(drivername="postgresql").render_as_string(hide_password=False)

    async def admin_exec(sql):
        conn = await asyncpg.connect(admin)
        try:
            await conn.execute(sql)
        finally:
            await conn.close()

    await admin_exec(f"CREATE DATABASE {name}")
    engine = create_async_engine(server.set(database=name), connect_args={"statement_cache_size": 0})
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as s:
            user = User(id=uuid4(), email="lock@example.com", name="Lock", hashed_password="x",
                        is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
                        preferred_currency="TWD", timezone="Asia/Taipei", experience_points=0, level=1)
            cats = [TransactionCategory(id=uuid4(), name=f"Cat {i}", name_en=f"Cat {i}",
                                        type=TransactionType.EXPENSE, color="#000000", icon="x",
                                        description="x", keywords=[], is_default=False,
                                        is_active=True, is_system=False) for i in range(2)]
            twd = Currency(code="TWD", name="New Taiwan Dollar", symbol="NT$", exchange_rate_usd=Decimal("0.031"))
            s.add_all([user, *cats, twd])
            await s.flush()
            loans = []
            for label in ("A", "B"):
                loan = DebtAccount(id=uuid4(), user_id=user.id, name=f"Loan {label}",
                                   account_type=LoanAccountType.PERSONAL_LOAN, principal_amount=PRINCIPAL,
                                   current_balance=PRINCIPAL, interest_rate=Decimal("3"),
                                   minimum_payment=Decimal("100"), payment_due_day=5,
                                   start_date=date(2026, 1, 1), is_deleted=False)
                s.add(loan)
                loans.append(str(loan.id))
            await s.commit()
        yield maker, str(user.id), [str(c.id) for c in cats], loans
    finally:
        await engine.dispose()
        await admin_exec(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def _txn_service(s):
    from app.modules.transactions.repositories import (
        RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
    )
    from app.modules.transactions.services import TransactionService

    return TransactionService(TransactionRepository(s), TransactionCategoryRepository(s),
                              RecurringTransactionRepository(s))


async def _pay(maker, uid, cid, loan_id, amount):
    from app.modules.transactions.models import TransactionType
    from app.modules.transactions.schemas import TransactionCreate

    async with maker() as s:
        created = await _txn_service(s).create_transaction(TransactionCreate(
            type=TransactionType.EXPENSE, amount=Decimal(amount), currency="TWD", description="pay",
            transaction_date=date(2026, 10, 31), category_id=cid, loan_id=loan_id), uid)
        return str(created["transaction"].id)


async def _balance(maker, loan_id):
    from app.modules.loans.models import DebtAccount

    async with maker() as s:
        return (await s.execute(
            select(DebtAccount.current_balance).where(DebtAccount.id == UUID(loan_id))
        )).scalar_one()


def _slow_balance_writes(monkeypatch):
    """Widen the read-to-write window inside a request, the way a slow one would."""
    from app.modules.transactions.services import TransactionService

    original = TransactionService._apply_loan_payment

    async def slow(self, *a, **k):
        await asyncio.sleep(WINDOW)
        return await original(self, *a, **k)

    monkeypatch.setattr(TransactionService, "_apply_loan_payment", slow)


async def test_concurrent_payments_in_different_categories_all_land(world, monkeypatch):
    maker, uid, cids, (loan_a, _) = world
    _slow_balance_writes(monkeypatch)
    await asyncio.gather(*(_pay(maker, uid, cids[i % 2], loan_a, "100") for i in range(4)))
    assert await _balance(maker, loan_a) == PRINCIPAL - 400


async def test_loans_page_payment_waits_for_a_transaction_edit(world):
    from app.modules.loans.schemas import LoanPaymentCreate
    from app.modules.loans.service import LoanService
    from app.modules.transactions.schemas import TransactionUpdate

    maker, uid, cids, (loan_a, _) = world
    row = await _pay(maker, uid, cids[0], loan_a, "1000")
    async with maker() as a, maker() as b:
        await _txn_service(a)._get_loan(loan_a, uid)  # A holds the loan mid-request
        record = asyncio.create_task(LoanService(b).record_payment(UUID(uid), UUID(loan_a), LoanPaymentCreate(
            payment_date=date(2026, 10, 31), total_amount=Decimal("300"),
            principal_portion=Decimal("300"), interest_portion=Decimal("0"))))
        await asyncio.sleep(WINDOW)
        assert not record.done(), "the Loans page wrote the balance while an edit held the loan"
        await _txn_service(a).update_transaction(row, uid, TransactionUpdate(amount=Decimal("2000")))
        await record
    assert await _balance(maker, loan_a) == PRINCIPAL - 2000 - 300


async def test_two_edits_of_one_payment_reverse_what_is_stored(world):
    """The second edit must reverse the first edit's amount, not the one it read at the start."""
    from app.modules.transactions.schemas import TransactionUpdate

    maker, uid, cids, (loan_a, _) = world
    row = await _pay(maker, uid, cids[0], loan_a, "1000")
    async with maker() as a, maker() as b:
        await _txn_service(a)._get_loan(loan_a, uid)  # A holds the loan mid-request
        second = asyncio.create_task(
            _txn_service(b).update_transaction(row, uid, TransactionUpdate(amount=Decimal("1500"))))
        await asyncio.sleep(WINDOW)
        assert not second.done()
        await _txn_service(a).update_transaction(row, uid, TransactionUpdate(amount=Decimal("2000")))
        await second
    assert await _balance(maker, loan_a) == PRINCIPAL - 1500


async def test_crossing_relinks_do_not_deadlock(world, monkeypatch):
    from app.modules.transactions.schemas import TransactionUpdate

    maker, uid, cids, (loan_a, loan_b) = world
    x = await _pay(maker, uid, cids[0], loan_a, "100")
    y = await _pay(maker, uid, cids[1], loan_b, "200")
    _slow_balance_writes(monkeypatch)

    async def relink(row, loan_id):
        async with maker() as s:
            await _txn_service(s).update_transaction(row, uid, TransactionUpdate(loan_id=loan_id))

    await asyncio.gather(relink(x, loan_b), relink(y, loan_a))  # a deadlock raises here
    assert await _balance(maker, loan_a) == PRINCIPAL - 200
    assert await _balance(maker, loan_b) == PRINCIPAL - 100


async def test_deleting_one_payment_from_both_pages_restores_it_once(world, monkeypatch):
    from app.modules.loans.service import LoanService

    maker, uid, cids, (loan_a, _) = world
    row = await _pay(maker, uid, cids[0], loan_a, "700")
    _slow_balance_writes(monkeypatch)

    async def from_transactions():
        async with maker() as s:
            await _txn_service(s).delete_transaction(row, uid)

    async def from_loans_page():
        async with maker() as s:
            try:
                await LoanService(s).delete_payment(UUID(uid), UUID(loan_a), UUID(row))
            except ValueError:
                pass  # the other page deleted it first: "Payment not found"

    await asyncio.gather(from_transactions(), from_loans_page())  # a deadlock raises here
    assert await _balance(maker, loan_a) == PRINCIPAL
