"""Taiwan CAPE inputs cron entrypoint.

Fills tw_market_valuations from TWSE and DGBAS (app/modules/market). Idempotent:
once backfilled, a run costs three paced TWSE requests. The first run backfills
from 2005, about an hour; each month commits on its own, so an interrupted run
keeps its progress and the next carries on.

Local Docker runs this daily in-process (app/core/scheduler.py, 08:30 UTC).
Where the scheduler is off, run this from cron once a day after 16:30 TST.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/run_tw_market_sync.py
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from app.core.scheduler import sync_tw_market  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

if __name__ == "__main__":
    print(asyncio.run(sync_tw_market()))
