"""Payment-due reminder cron entrypoint.

Scans active loans and creates in-app PAYMENT_DUE notifications for payments due
within the next few days. Idempotent — safe to run daily.

In local Docker the in-process APScheduler runs this automatically (see
app/core/scheduler.py). In production the scheduler is gated OFF, so this script
is the cron entrypoint (run it from cron once a day).

Usage:
    cd backend && source .venv/bin/activate
    python scripts/run_payment_reminders.py                 # default 3-day window
    python scripts/run_payment_reminders.py --days-ahead 5
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from app.core.database import async_session  # noqa: E402
from app.modules.loans.reminders import (  # noqa: E402
    DEFAULT_DAYS_AHEAD,
    generate_payment_due_reminders,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("run_payment_reminders")


async def main(days_ahead: int) -> None:
    async with async_session() as session:
        created = await generate_payment_due_reminders(session, days_ahead=days_ahead)
        await session.commit()
    logger.info("Done: created %d payment-due notification(s)", created)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send loan payment-due reminders")
    parser.add_argument(
        "--days-ahead",
        type=int,
        default=DEFAULT_DAYS_AHEAD,
        help=f"Remind for payments due within N days (default {DEFAULT_DAYS_AHEAD})",
    )
    args = parser.parse_args()
    asyncio.run(main(args.days_ahead))
