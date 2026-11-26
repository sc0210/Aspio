"""Recurring-transaction cron entrypoint.

Posts every recurring rule that has fallen due, including occurrences missed
while nothing ran. Idempotent: a processed rule's next occurrence moves past
today, so a second run the same day finds nothing.

The in-process scheduler runs this daily (app/core/scheduler.py). Where the
scheduler is off, run this script from cron once a day instead.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/run_recurring_transactions.py
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from app.core.scheduler import process_recurring_transactions  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

if __name__ == "__main__":
    asyncio.run(process_recurring_transactions())
