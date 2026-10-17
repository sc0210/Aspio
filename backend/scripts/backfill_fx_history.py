"""Backfill the daily USD/TWD rate into `historical_prices` for time-weighted return.

TWR values a USD holding in TWD at *that day's* rate, from the series stored
under symbol `TWD=X` (Yahoo's USD→TWD: how many TWD one dollar buys). Without
it, every day falls back to today's rate and the return silently leaves out the
currency move. The performance tracker reports those fallbacks in
`data_quality.fx_fallback_valuations`.

Idempotent: bulk_upsert_prices UPSERTs on (symbol, date).

Usage (inside the backend container, or anywhere DATABASE_URL points at the DB):
    python scripts/backfill_fx_history.py [DAYS] [--dry-run]

DAYS defaults to 1200 (back past the oldest lot, 2023-06). Weekends have no
bar; TWR carries the last rate forward, which is what the market did.
"""

import argparse
import asyncio
import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.base import import_all_models  # noqa: E402

import_all_models()

from app.core.database import async_session  # noqa: E402
from app.modules.portfolio.historical_price_repository import (  # noqa: E402
    HistoricalPriceRepository,
)
from app.modules.portfolio.market_data_service import get_market_data_service  # noqa: E402
from app.modules.portfolio.performance_tracker import FX_SERIES  # noqa: E402
from app.utils.market_sessions import session_closed  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_fx")


def _bar_date(bar) -> date:
    d = bar["date"]
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d)[:10])


async def run(days: int, dry_run: bool) -> int:
    service = get_market_data_service()
    written = 0
    async with async_session() as session:
        repo = HistoricalPriceRepository(session)
        for currency, symbol in FX_SERIES.items():
            fetched = [b for b in await service.get_historical_data(symbol, "FX", days) if b.get("close")]
            # A bar whose London day isn't over yet is a provisional rate, not a close.
            bars = [b for b in fetched if session_closed("FX", _bar_date(b))]
            if not fetched:
                logger.error(f"{symbol}: provider returned nothing — nothing written")
                continue
            if not bars:
                logger.info(f"{symbol}: {len(fetched)} provisional bar(s) skipped; nothing final to write yet")
                continue
            first, last = _bar_date(bars[0]), _bar_date(bars[-1])
            logger.info(f"{symbol} ({currency}→TWD): {len(bars)} bars, {first} → {last}")
            if dry_run:
                continue
            written += await repo.bulk_upsert_prices([
                {
                    "symbol": symbol,
                    "market": "FX",
                    "date": _bar_date(b),
                    "open": b.get("open"),
                    "high": b.get("high"),
                    "low": b.get("low"),
                    "close": b["close"],
                    "volume": b.get("volume") or 0,
                    "source": b.get("source", "backfill_fx"),
                    "currency": "TWD",
                }
                for b in bars
            ])
    logger.info(f"rows written: {written}")
    return written


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("days", nargs="?", type=int, default=1200)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.days, args.dry_run))
