"""
The in-process scheduler's job list, and the recurring-transaction job.

Recurring rules used to materialise only when an admin hit
POST /transactions/recurring/process-due; no job ran them, so a user's rule
never produced a transaction on its own.
"""

from contextlib import asynccontextmanager
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core import scheduler as scheduler_module
from app.modules.transactions.models import (
    RecurringFrequency, RecurringTransaction, Transaction, TransactionCategory, TransactionType,
)
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.asyncio

EXPECTED_JOBS = {
    "tw_market_price_update", "us_market_price_update", "crypto_price_update",
    "daily_historical_sync", "daily_payment_due_reminders", "daily_spending_alerts",
    "daily_recurring_transactions",
}


async def test_init_scheduler_registers_every_job(monkeypatch):
    monkeypatch.setattr(scheduler_module, "scheduler", None)
    sched = scheduler_module.init_scheduler()
    try:
        assert {job.id for job in sched.get_jobs()} == EXPECTED_JOBS
        recurring = sched.get_job("daily_recurring_transactions")
        assert "hour='16'" in str(recurring.trigger) and "minute='10'" in str(recurring.trigger)
    finally:
        monkeypatch.setattr(scheduler_module, "scheduler", None)


def _use_session(monkeypatch, session):
    @asynccontextmanager
    async def factory():
        yield session

    monkeypatch.setattr(scheduler_module, "async_session", factory)


async def _rule(async_session, user, category, **overrides):
    today = business_today()
    fields = dict(
        id=uuid4(), user_id=user.id, type=TransactionType.EXPENSE, amount=Decimal("1200"),
        currency="TWD", category_id=category.id, description="Gym membership",
        frequency=RecurringFrequency.MONTHLY, interval=1, start_date=today,
        next_occurrence=today, occurrence_count=0, is_active=True, is_paused=False, auto_create=True,
    )
    fields.update(overrides)
    rule = RecurringTransaction(**fields)
    async_session.add(rule)
    await async_session.commit()
    return rule


async def _expense_category(async_session, seed_categories):
    return (await async_session.execute(
        select(TransactionCategory).where(TransactionCategory.type == TransactionType.EXPENSE)
    )).scalars().first()


async def test_a_due_rule_creates_its_transaction_once(monkeypatch, async_session, test_user, seed_categories):
    category = await _expense_category(async_session, seed_categories)
    rule = await _rule(async_session, test_user, category)
    _use_session(monkeypatch, async_session)

    first = await scheduler_module.process_recurring_transactions()
    assert (first["processed"], first["created"], first["failed"]) == (1, 1, 0)

    rows = (await async_session.execute(
        select(Transaction).where(Transaction.user_id == test_user.id))).scalars().all()
    assert [(r.description, r.amount, r.transaction_date) for r in rows] == [
        ("Gym membership", Decimal("1200.00"), business_today())]

    await async_session.refresh(rule)
    assert rule.next_occurrence > business_today()

    # Idempotent within the day: the rule has moved on, so a rerun does nothing.
    second = await scheduler_module.process_recurring_transactions()
    assert (second["processed"], second["created"]) == (0, 0)


async def test_paused_future_and_manual_rules_create_nothing(monkeypatch, async_session, test_user, seed_categories):
    category = await _expense_category(async_session, seed_categories)
    await _rule(async_session, test_user, category, is_paused=True)
    await _rule(async_session, test_user, category, next_occurrence=business_today() + timedelta(days=3))
    manual = await _rule(async_session, test_user, category, auto_create=False)
    _use_session(monkeypatch, async_session)

    result = await scheduler_module.process_recurring_transactions()
    assert result["created"] == 0
    assert (await async_session.execute(
        select(Transaction).where(Transaction.user_id == test_user.id))).scalars().all() == []
    # A manual rule still advances, so it doesn't come due again every day.
    await async_session.refresh(manual)
    assert manual.next_occurrence > business_today()
