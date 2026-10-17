"""One-shot historical-price sync, as a cron entrypoint.

Mirrors scheduler.py's ``daily_historical_sync`` job
(``sync_historical_data_for_all_users``), which doesn't run in prod because the
in-process APScheduler is disabled (``ENABLE_SCHEDULER=false``) to keep
pandas/finlab out of the 512 MB web dyno. Keeping recent historical prices fresh
feeds the nightly wallet-snapshot job (run just after) and the portfolio charts.

Usage
-----
    python scripts/run_historical_sync_job.py [DAYS]     # default 7

Cron setup:
    python scripts/run_historical_sync_job.py    cron  0 22 * * *    (22:00 UTC, after both markets close)
Root directory: backend. Shares the web service's env (needs ``DATABASE_URL``).
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from app.core.scheduler import sync_historical_data_for_all_users  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
)


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    # sync_historical_data_for_all_users logs a summary and swallows failures.
    asyncio.run(sync_historical_data_for_all_users(days=days))
