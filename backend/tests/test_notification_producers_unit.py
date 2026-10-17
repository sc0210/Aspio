"""Payment-due reminders and spending alerts, against the in-memory DB."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.modules.loans.models import DebtAccount, LoanAccountType, LoanStatus
from app.modules.loans.reminders import DEFAULT_DAYS_AHEAD, _format_amount, generate_payment_due_reminders
from app.modules.notifications.models import Notification, NotificationPriority, NotificationType
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.modules.transactions.spending_alerts import generate_spending_alerts

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

TODAY = date(2026, 10, 15)


def loan(user, *, due_day, balance="1000", status=LoanStatus.ACTIVE, deleted=False, name="Mortgage"):
    return DebtAccount(
        id=uuid4(), user_id=user.id, name=name, account_type=LoanAccountType.PERSONAL_LOAN,
        principal_amount=Decimal("5000"), current_balance=Decimal(balance),
        interest_rate=Decimal("2"), minimum_payment=Decimal("12500"), payment_due_day=due_day,
        start_date=date(2025, 1, 1), status=status, is_deleted=deleted)


async def notes(session):
    return (await session.execute(select(Notification))).scalars().all()


def test_amount_formatting():
    assert _format_amount(Decimal("12500"), "TWD") == "TWD 12,500"
    assert _format_amount("oops", "TWD") == "TWD oops"


class TestPaymentDue:
    @pytest.mark.xfail(strict=True, reason="_next_payment_date treats a payment due today as next month's, "
                      "so the days_until == 0 'today' reminder can never fire")
    async def test_due_today_is_high_priority(self, async_session, test_user):
        async_session.add(loan(test_user, due_day=15))
        await async_session.commit()
        assert await generate_payment_due_reminders(async_session, reference_date=TODAY) == 1
        (n,) = await notes(async_session)
        assert n.priority == NotificationPriority.HIGH and "today" in n.title
        assert n.data["due_date"] == "2026-10-15" and n.related_entity_type == "loan"

    async def test_two_days_out_is_medium_and_pluralised(self, async_session, test_user):
        async_session.add(loan(test_user, due_day=17))
        await async_session.commit()
        await generate_payment_due_reminders(async_session, reference_date=TODAY)
        (n,) = await notes(async_session)
        assert n.priority == NotificationPriority.MEDIUM and "in 2 days" in n.title

    async def test_one_day_out_is_singular_and_high(self, async_session, test_user):
        async_session.add(loan(test_user, due_day=16))
        await async_session.commit()
        await generate_payment_due_reminders(async_session, reference_date=TODAY)
        (n,) = await notes(async_session)
        assert "in 1 day" in n.title and "days" not in n.title and n.priority == NotificationPriority.HIGH

    async def test_outside_window_is_skipped(self, async_session, test_user):
        async_session.add(loan(test_user, due_day=15 + DEFAULT_DAYS_AHEAD + 2))
        await async_session.commit()
        assert await generate_payment_due_reminders(async_session, reference_date=TODAY) == 0

    async def test_paid_off_deleted_and_inactive_loans_are_ignored(self, async_session, test_user):
        async_session.add_all([
            loan(test_user, due_day=17, balance="0", name="zero"),
            loan(test_user, due_day=17, deleted=True, name="deleted"),
            loan(test_user, due_day=17, status=LoanStatus.PAID_OFF, name="paid"),
            loan(test_user, due_day=17, name="live"),  # positive control: same day, passes every filter
        ])
        await async_session.commit()
        assert await generate_payment_due_reminders(async_session, reference_date=TODAY) == 1
        (n,) = await notes(async_session)
        assert n.message.startswith("live:")

    async def test_running_twice_does_not_duplicate(self, async_session, test_user):
        async_session.add(loan(test_user, due_day=17))
        await async_session.commit()
        assert await generate_payment_due_reminders(async_session, reference_date=TODAY) == 1
        assert await generate_payment_due_reminders(async_session, reference_date=TODAY) == 0
        assert len(await notes(async_session)) == 1

    async def test_next_cycle_reminds_again(self, async_session, test_user):
        async_session.add(loan(test_user, due_day=17))
        await async_session.commit()
        await generate_payment_due_reminders(async_session, reference_date=TODAY)
        assert await generate_payment_due_reminders(async_session, reference_date=date(2026, 11, 15)) == 1


class TestSpendingAlerts:
    async def _spend(self, session, user, category, when, amount):
        session.add(Transaction(
            id=uuid4(), user_id=user.id, amount=Decimal(amount), type=TransactionType.EXPENSE,
            wallet_type=TransactionWalletType.LIFE, category_id=category.id,
            transaction_date=when, description="x"))

    async def _history(self, session, user, category, per_month="3000"):
        for m in (7, 8, 9):
            await self._spend(session, user, category, date(2026, m, 10), per_month)

    async def test_alert_when_over_average(self, async_session, test_user, test_category):
        await self._history(async_session, test_user, test_category)  # avg 3000
        await self._spend(async_session, test_user, test_category, date(2026, 10, 5), "4500")
        await async_session.commit()
        assert await generate_spending_alerts(async_session, reference_date=TODAY) == 1
        (n,) = await notes(async_session)
        assert n.data["month"] == "2026-10" and n.data["pct_over"] == 50
        assert n.related_entity_type == "spending_alert"

    async def test_no_alert_when_under_average(self, async_session, test_user, test_category):
        await self._history(async_session, test_user, test_category)
        await self._spend(async_session, test_user, test_category, date(2026, 10, 5), "100")
        await async_session.commit()
        assert await generate_spending_alerts(async_session, reference_date=TODAY) == 0

    async def test_no_history_means_no_baseline_and_no_alert(self, async_session, test_user, test_category):
        await self._spend(async_session, test_user, test_category, date(2026, 10, 5), "99999")
        await async_session.commit()
        assert await generate_spending_alerts(async_session, reference_date=TODAY) == 0

    async def test_once_per_month(self, async_session, test_user, test_category):
        await self._history(async_session, test_user, test_category)
        await self._spend(async_session, test_user, test_category, date(2026, 10, 5), "4500")
        await async_session.commit()
        assert await generate_spending_alerts(async_session, reference_date=TODAY) == 1
        assert await generate_spending_alerts(async_session, reference_date=TODAY) == 0

    async def test_threshold_is_a_multiple_of_the_average(self, async_session, test_user, test_category):
        await self._history(async_session, test_user, test_category)
        await self._spend(async_session, test_user, test_category, date(2026, 10, 5), "4500")
        await async_session.commit()
        assert await generate_spending_alerts(async_session, reference_date=TODAY, threshold=Decimal("2")) == 0
