"""Spending-alert cron entrypoint.

Scans users with recent expense activity and creates a spending alert when their
month-to-date expenses exceed their recent monthly average. Idempotent (once per
user per month) — safe to run daily.

In local Docker the in-process APScheduler runs this automatically (see
app/core/scheduler.py). In production the scheduler is gated OFF, so this script
is the cron entrypoint (run it from cron once a day).

Usage:
    cd backend && source .venv/bin/activate
    python scripts/run_spending_alerts.py
    python scripts/run_spending_alerts.py --threshold 1.2   # 20% over average
"""

import argparse
import asyncio
import logging
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from app.database.session import AsyncSessionLocal  # noqa: E402
from app.modules.transactions.spending_alerts import (  # noqa: E402
    DEFAULT_THRESHOLD,
    generate_spending_alerts,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("run_spending_alerts")


async def main(threshold: Decimal) -> None:
    async with AsyncSessionLocal() as session:
        created = await generate_spending_alerts(session, threshold=threshold)
        await session.commit()
    logger.info("Done: created %d spending alert(s)", created)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send budget / spending alerts")
    parser.add_argument(
        "--threshold",
        type=Decimal,
        default=DEFAULT_THRESHOLD,
        help="Fire when month-to-date spend exceeds this multiple of the "
        f"trailing average (default {DEFAULT_THRESHOLD})",
    )
    args = parser.parse_args()
    asyncio.run(main(args.threshold))
