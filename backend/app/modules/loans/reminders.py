"""Payment-due reminder producer.

Scans active loans and emits an in-app ``PAYMENT_DUE`` notification when a
payment falls due within a short window. Time-based (there is no user action to
hook), so it runs from the daily scheduler / a cron entrypoint rather than a
request handler.

Idempotent: a loan already reminded for a given due date is skipped, so the job
can safely run every day without spamming the same reminder.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.loans.models import DebtAccount, LoanStatus
from app.modules.loans.service import _next_payment_date
from app.modules.notifications.models import (
    Notification,
    NotificationType,
    NotificationPriority,
)
from app.modules.notifications.services import create_notification
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)

# How many days before the due date we start reminding.
DEFAULT_DAYS_AHEAD = 3


def _format_amount(amount: Decimal, currency: str) -> str:
    """Whole-currency formatting, e.g. 'TWD 12,500'."""
    try:
        return f"{currency} {amount:,.0f}"
    except (ValueError, TypeError):
        return f"{currency} {amount}"


async def generate_payment_due_reminders(
    session: AsyncSession,
    *,
    days_ahead: int = DEFAULT_DAYS_AHEAD,
    reference_date: Optional[date] = None,
) -> int:
    """Create PAYMENT_DUE notifications for loans due within ``days_ahead`` days.

    Flushes each created notification (via ``create_notification``) but does NOT
    commit — the caller owns the transaction boundary. Returns the number of
    notifications created.
    """
    today = reference_date or business_today()

    loans = (
        await session.execute(
            select(DebtAccount).where(
                DebtAccount.is_deleted == False,  # noqa: E712
                DebtAccount.status == LoanStatus.ACTIVE,
                DebtAccount.current_balance > 0,
            )
        )
    ).scalars().all()

    created = 0
    for loan in loans:
        # _next_payment_date(today=X) is strictly after X; asking from yesterday
        # makes a payment due today count as due today, not next month.
        due = _next_payment_date(loan.payment_due_day, today=today - timedelta(days=1))
        days_until = (due - today).days
        if days_until < 0 or days_until > days_ahead:
            continue

        due_iso = due.isoformat()

        # De-dupe: skip if this loan was already reminded for this exact due
        # date. Loans carry only a handful of reminders, so filtering in Python
        # keeps us portable across the JSON/JSONB backends without JSON operators.
        existing = (
            await session.execute(
                select(Notification).where(
                    Notification.type == NotificationType.PAYMENT_DUE,
                    Notification.related_entity_type == "loan",
                    Notification.related_entity_id == loan.id,
                )
            )
        ).scalars().all()
        if any((n.data or {}).get("due_date") == due_iso for n in existing):
            continue

        when = "today" if days_until == 0 else f"in {days_until} day{'s' if days_until != 1 else ''}"
        amount_str = _format_amount(loan.minimum_payment, loan.currency)
        await create_notification(
            session,
            user_id=loan.user_id,
            type=NotificationType.PAYMENT_DUE,
            priority=(
                NotificationPriority.HIGH
                if days_until <= 1
                else NotificationPriority.MEDIUM
            ),
            title=f"💳 Payment due {when}",
            message=f"{loan.name}: {amount_str} due on {due_iso}.",
            action_url="/loans",
            related_entity_type="loan",
            related_entity_id=loan.id,
            data={
                "due_date": due_iso,
                "amount": str(loan.minimum_payment),
                "currency": loan.currency,
                "days_until": days_until,
            },
        )
        created += 1

    logger.info(
        "Payment-due reminders: scanned %d active loans, created %d notifications",
        len(loans),
        created,
    )
    return created
