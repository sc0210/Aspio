"""One-shot portfolio price update, for a host that runs no in-process scheduler.

Why this exists
---------------
Where ``ENABLE_SCHEDULER=false`` — any host too memory-tight to load
pandas/finlab/yfinance inside the web process — the per-market price jobs never
run and portfolio prices go stale. This standalone entrypoint runs the SAME job
function (``update_all_users_prices``) in an ephemeral container that loads the
heavy libs once and exits, leaving the web process untouched.

The Pi runs the scheduler in-process and therefore does NOT need this; it stays
for memory-capped hosts and for running a market's update by hand.

It mirrors scheduler.py's three price jobs exactly (symbol-first batch update:
each unique symbol is fetched once, not once per holding).

Usage
-----
    python scripts/run_price_update_job.py [TW|US|CRYPTO|ALL]     # default ALL

As cron entries, matching scheduler.py's times:
    TW     : python scripts/run_price_update_job.py TW       0 6 * * *      (14:00 TST, after TW close)
    US     : python scripts/run_price_update_job.py US       30 21 * * *    (16:30 EST, after US close)
    CRYPTO : python scripts/run_price_update_job.py CRYPTO   0 8,20 * * *   (every 12h; crypto is 24/7)
Run from ``backend`` with the app's env (needs ``DATABASE_URL``). A single ``ALL``
run a couple of times a day works too — it just fetches every market each run.
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from app.core.scheduler import update_all_users_prices  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
)

VALID_MARKETS = {"TW", "US", "CRYPTO", "ALL"}


if __name__ == "__main__":
    market = (sys.argv[1] if len(sys.argv) > 1 else "ALL").upper()
    if market not in VALID_MARKETS:
        sys.exit(
            f"invalid market {market!r}; expected one of {sorted(VALID_MARKETS)}"
        )
    # update_all_users_prices logs a summary line and swallows per-symbol
    # failures, so one bad symbol can't fail the whole cron run.
    asyncio.run(update_all_users_prices(market))
