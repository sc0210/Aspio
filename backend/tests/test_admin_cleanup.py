"""run_cleanup / run_cleanup_preview: what they delete, and that the demo user is never touched.

The stale-currency-rate statement is Postgres-only (ctid, DISTINCT ON), so a thin
wrapper answers just that one; every other statement runs for real on SQLite.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.modules.admin.services import AdminMonitoringService
from app.modules.loans.models import DebtAccount, LoanAccountType
from app.modules.notifications.models import (
    Notification, NotificationPriority, NotificationStatus, NotificationType,
)
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.modules.users.init_demo_user import DEMO_EMAIL
from app.modules.users.models import User, UserRole, UserStatus

pytestmark = [pytest.mark.asyncio, pytest.mark.database]
OLD = datetime.now(timezone.utc) - timedelta(days=60)


class PgStub:
    """Delegates to a real session but fakes the Postgres-only currency_rates SQL."""

    def __init__(self, session, stale=3):
        self._s, self._stale, self.stale_sql = session, stale, []

    def __getattr__(self, name):
        return getattr(self._s, name)

    async def execute(self, stmt, *a, **kw):
        if "currency_rates" in str(stmt):
            self.stale_sql.append(str(stmt).split()[0].upper())
            return SimpleNamespace(scalar_one=lambda: self._stale, rowcount=self._stale)
        return await self._s.execute(stmt, *a, **kw)


def user(email):
    return User(id=uuid4(), email=email, name=email, hashed_password="x", is_active=True, is_verified=True,
                role=UserRole.USER, status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="UTC",
                experience_points=0, level=1)


def txn(u, cat, deleted):
    return Transaction(id=uuid4(), user_id=u.id, amount=Decimal("1"), type=TransactionType.EXPENSE,
                       wallet_type=TransactionWalletType.LIFE, category_id=cat.id, is_deleted=deleted,
                       transaction_date=date(2026, 1, 1), description="x")


def loan(u, deleted):
    return DebtAccount(id=uuid4(), user_id=u.id, name="L", account_type=LoanAccountType.PERSONAL_LOAN,
                       principal_amount=Decimal("1"), current_balance=Decimal("1"), interest_rate=Decimal("1"),
                       minimum_payment=Decimal("1"), payment_due_day=1, start_date=date(2026, 1, 1), is_deleted=deleted)


def note(u, status, created):
    return Notification(id=uuid4(), user_id=u.id, type=NotificationType.PAYMENT_DUE,
                        priority=NotificationPriority.LOW, status=status, title="t", message="m",
                        created_at=created)


async def count(session, model):
    return (await session.execute(select(func.count()).select_from(model))).scalar_one()


@pytest_asyncio.fixture
async def world(async_session, test_category):
    real, demo = user("real@example.com"), user(DEMO_EMAIL)
    async_session.add_all([real, demo])
    await async_session.flush()
    async_session.add_all([
        txn(real, test_category, True), txn(real, test_category, False), txn(demo, test_category, True),
        loan(real, True), loan(real, False), loan(demo, True),
        note(real, NotificationStatus.READ, OLD), note(real, NotificationStatus.SENT, OLD),
        note(real, NotificationStatus.READ, datetime.now(timezone.utc)),   # too recent
        note(real, NotificationStatus.PENDING, OLD),                       # unread: keep
        note(demo, NotificationStatus.READ, OLD),                          # demo: keep
    ])
    await async_session.commit()
    return real, demo


async def test_preview_counts_only_what_cleanup_would_remove(async_session, world):
    out = await AdminMonitoringService(PgStub(async_session)).run_cleanup_preview()
    assert out["soft_deleted_transactions"] == 1 and out["soft_deleted_loans"] == 1
    assert out["old_notifications"] == 2 and out["stale_currency_rates"] == 3
    assert out["demo_user_protected"] == DEMO_EMAIL and out["notification_cutoff_days"] == 30
    assert await count(async_session, Transaction) == 3  # a preview deletes nothing


async def test_cleanup_deletes_stale_rows_and_spares_everything_else(async_session, world):
    stub = PgStub(async_session)
    out = await AdminMonitoringService(stub).run_cleanup()
    assert (out["soft_deleted_transactions"], out["soft_deleted_loans"], out["old_notifications"]) == (1, 1, 2)
    assert out["stale_currency_rates"] == 3 and stub.stale_sql == ["DELETE"]
    assert out["price_cache_cleared"] is True and out["line_profile_cache_cleared"] is True

    live = (await async_session.execute(select(Transaction.is_deleted, Transaction.user_id))).all()
    real, demo = world
    assert sorted((d, u == demo.id) for d, u in live) == [(False, False), (True, True)]  # real's live row + demo's deleted row
    assert await count(async_session, DebtAccount) == 2
    kept = (await async_session.execute(select(Notification.status))).scalars().all()
    assert sorted(s.value for s in kept) == sorted(["read", "pending", "read"])


async def test_cleanup_is_idempotent(async_session, world):
    svc = AdminMonitoringService(PgStub(async_session, stale=0))
    await svc.run_cleanup()
    again = await svc.run_cleanup()
    assert (again["soft_deleted_transactions"], again["soft_deleted_loans"], again["old_notifications"]) == (0, 0, 0)


async def test_works_without_a_demo_user(async_session, test_user, test_category):
    async_session.add_all([txn(test_user, test_category, True), loan(test_user, True)])
    await async_session.commit()
    out = await AdminMonitoringService(PgStub(async_session, stale=0)).run_cleanup()
    assert out["soft_deleted_transactions"] == 1 and out["soft_deleted_loans"] == 1
