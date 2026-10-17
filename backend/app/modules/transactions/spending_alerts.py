"""Budget / spending-alert producer.

The app has no per-category budget config, so this uses a config-free heuristic:
alert a user once per month when their month-to-date expenses exceed their recent
monthly average (trailing 3 completed months). It answers "am I spending more
than usual this month?" without any setup.

Runs as a daily batch job (not on the transaction-create hot path) so it never
slows writes, and de-dupes to at most one alert per user per month.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Transaction, TransactionType
from app.modules.transactions.repositories import TransactionRepository
from app.modules.notifications.models import (
    Notification,
    NotificationType,
    NotificationPriority,
)
from app.modules.notifications.services import create_notification
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)

# Fire when month-to-date spend exceeds this multiple of the trailing average.
# 1.0 == "already spent more this month than a typical recent month".
DEFAULT_THRESHOLD = Decimal("1.0")


async def generate_spending_alerts(
    session: AsyncSession,
    *,
    reference_date: Optional[date] = None,
    threshold: Decimal = DEFAULT_THRESHOLD,
) -> int:
    """Create spending-alert notifications for users over their recent average.

    Flush-only (via ``create_notification``); the caller owns the commit.
    Returns the number of notifications created.
    """
    today = reference_date or business_today()
    month_start = today.replace(day=1)
    month_key = today.strftime("%Y-%m")
    prev3_start = month_start - relativedelta(months=3)
    prev3_end = month_start - timedelta(days=1)

    # Candidate users: anyone with expense activity in the trailing window.
    user_rows = await session.execute(
        select(Transaction.user_id)
        .where(
            Transaction.type == TransactionType.EXPENSE,
            Transaction.is_deleted == False,  # noqa: E712
            Transaction.transaction_date >= prev3_start,
        )
        .distinct()
    )
    user_ids = [r[0] for r in user_rows.all()]

    repo = TransactionRepository(session)
    created = 0
    for uid in user_ids:
        # De-dupe: at most one spending alert per user per calendar month.
        existing = (
            await session.execute(
                select(Notification).where(
                    Notification.user_id == uid,
                    Notification.type == NotificationType.TRANSACTION_REMINDER,
                    Notification.related_entity_type == "spending_alert",
                )
            )
        ).scalars().all()
        if any((n.data or {}).get("month") == month_key for n in existing):
            continue

        mtd = (await repo.get_summary(str(uid), month_start, today))["total_expenses"]
        prev = (await repo.get_summary(str(uid), prev3_start, prev3_end))["total_expenses"]
        avg = (prev / 3) if prev else Decimal("0")
        if avg <= 0:
            continue

        if mtd > avg * threshold:
            pct_over = int((mtd / avg - 1) * 100)
            await create_notification(
                session,
                user_id=uid,
                type=NotificationType.TRANSACTION_REMINDER,
                priority=NotificationPriority.MEDIUM,
                title="📊 Spending above your usual",
                message=(
                    f"You've spent {mtd:,.0f} so far this month — {pct_over}% above "
                    f"your recent monthly average of {avg:,.0f}."
                ),
                action_url="/transactions",
                related_entity_type="spending_alert",
                data={
                    "month": month_key,
                    "spent": str(mtd),
                    "avg": str(avg.quantize(Decimal("1"))),
                    "pct_over": pct_over,
                },
            )
            created += 1

    logger.info(
        "Spending alerts: %d candidate users, %d notifications created",
        len(user_ids),
        created,
    )
    return created
