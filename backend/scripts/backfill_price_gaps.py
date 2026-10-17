"""Fill holes in `historical_prices` for every held symbol (open, or --include-closed).

The nightly sync (``run_historical_sync_job.py``) only looks back a few days,
so any session a provider dropped stays missing forever. Those holes are not
cosmetic: previous close, day change, sparklines, performance history and the
dashboard trends are all read off this table, and a gap silently turns a
one-day move into a multi-day one. 0050 read +1.14% on 2026-08-14 because
2026-08-13 was absent and the lookup fell back to 08-12's close.

Routing mirrors the live fetch chain, but reaches straight for the source that
actually has the data rather than trying the fast ones first:

    TW ticker   -> TWSE STOCK_DAY (the exchange's own report, complete)
    everything  -> Yahoo daily history over the whole window

Idempotent: bulk_upsert_prices UPSERTs on (symbol, date), so re-running only
rewrites rows with the same values. Safe to run repeatedly.

Usage
-----
    python scripts/backfill_price_gaps.py [DAYS] [--dry-run] [--symbol SYM] [--include-closed]

    DAYS             lookback window, default 180
    --dry-run        report the gaps and what would be fetched, write nothing
    --symbol         restrict to one symbol (repeatable). Give it the stored
                     spelling: a Taiwan ticker is canonicalised for you, but a
                     crypto base is not (the CLI has no asset type), so pass
                     BTC-USD rather than BTC.
    --include-closed cover sold-out symbols too, not just open positions
"""

import argparse
import asyncio
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.base import import_all_models  # noqa: E402

import_all_models()  # register every mapper before any query runs

from sqlalchemy import select  # noqa: E402

from app.core.database import async_session  # noqa: E402
from app.modules.portfolio.historical_price_repository import (  # noqa: E402
    HistoricalPriceRepository,
)
from app.modules.portfolio.market_data_service import (  # noqa: E402
    get_market_data_service,
    resolve_symbol_market,
)
from app.modules.portfolio.symbols import (  # noqa: E402
    canonical_symbol,
    to_bare_tw_symbol,
    to_yahoo_tw_symbol,
)
from app.modules.portfolio.models import PortfolioHolding  # noqa: E402
from app.utils.market_sessions import session_closed  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("backfill_price_gaps")

# Mirrors the exclusions the sync job applies — these never have a market price.
NON_TRADABLE_SYMBOLS = {
    "SAVINGS", "TWD-SAVINGS", "CPF-OA", "ANNUAL-BUDGET", "CRYPTO", "CASH",
    "EMERGENCY-FUND", "BUDGET",
}
CURRENCY_BY_MARKET = {"TW": "TWD", "US": "USD", "CRYPTO": "USD", "SG": "SGD"}


def _is_tradable(symbol: str, holding_type: str) -> bool:
    upper = symbol.upper()
    if holding_type and holding_type.lower() == "cash":
        return False
    return not (
        upper in NON_TRADABLE_SYMBOLS
        or upper.startswith(("CASH-", "EMERGENCY-"))
        or upper.endswith(("-SAVINGS", "-BUDGET", "-LEND"))
    )


def _bar_date(bar: dict):
    """Providers disagree on the date format — TWSE gives "2026-08-04", Yahoo
    gives "2026-08-04T00:00:00-04:00". Take the calendar date from either."""
    try:
        return date.fromisoformat(str(bar.get("date", ""))[:10])
    except ValueError:
        return None


def _business_days(start: date, end: date) -> set:
    """Weekdays in range. Holidays are not known here, so an unfilled holiday
    simply stays reported as a gap — harmless, since we only ever add rows the
    provider actually returns."""
    days, cursor = set(), start
    while cursor <= end:
        if cursor.weekday() < 5:
            days.add(cursor)
        cursor += timedelta(days=1)
    return days


async def _load_symbols(session, only: list, include_closed: bool = False) -> dict:
    query = select(
        PortfolioHolding.symbol,
        PortfolioHolding.market,
        PortfolioHolding.type,
    ).distinct()
    # A sold position still has to be priced for the window it was held in:
    # time-weighted return values the portfolio on every day of the period, and
    # a symbol with no history over the weeks it was owned drops out of the
    # valuation silently rather than erroring.
    if not include_closed:
        query = query.where(PortfolioHolding.is_active == True)  # noqa: E712

    rows = (await session.execute(query)).fetchall()

    markets: dict = {}
    for row in rows:
        if not _is_tradable(row.symbol, row.type):
            continue
        if only and row.symbol.upper() not in only:
            continue
        markets.setdefault(row.symbol, set()).add(row.market)

    return {
        symbol: resolve_symbol_market(symbol, candidates)
        for symbol, candidates in markets.items()
    }


async def _fetch_window(service, symbol: str, market: str, days: int) -> list:
    """Whole-window bars from the source most likely to be complete."""
    if market == "TW" and to_bare_tw_symbol(symbol).isdigit():
        bars = await service._get_twse_historical(symbol, days)
        if bars:
            return bars
        logger.warning(f"  TWSE returned nothing for {symbol}, trying Yahoo")
        return await service._get_yahoo_historical(to_yahoo_tw_symbol(symbol), days)

    return await service._get_yahoo_historical(symbol, days)


async def backfill(
    days: int, dry_run: bool, only: list, include_closed: bool = False
) -> dict:
    stats = {"symbols": 0, "gaps_found": 0, "rows_written": 0, "still_missing": 0}
    end = date.today()
    start = end - timedelta(days=days)
    service = get_market_data_service()

    async with async_session() as session:
        repo = HistoricalPriceRepository(session)
        symbol_markets = await _load_symbols(session, only, include_closed)
        stats["symbols"] = len(symbol_markets)
        logger.info(
            f"Scanning {len(symbol_markets)} symbols over {start} → {end} "
            f"({'dry run' if dry_run else 'writing'})"
        )

        expected = _business_days(start, end)

        for symbol, market in sorted(symbol_markets.items()):
            # get_price_history yields ORM rows (get_batch_price_history yields
            # dicts) — take the attribute, not a key.
            existing = {
                p.date for p in await repo.get_price_history(symbol, start, end)
            }
            missing = expected - existing
            if not missing:
                logger.info(f"{symbol:10} complete")
                continue

            stats["gaps_found"] += len(missing)
            logger.info(
                f"{symbol:10} {len(missing):3} missing weekdays "
                f"(have {len(existing)}) — market={market}"
            )
            if dry_run:
                continue

            bars = await _fetch_window(service, symbol, market, days)
            # Skip a bar for a session still in progress: it is the last trade so
            # far, not a close (the regular sync applies the same rule).
            fillable = [b for b in bars if _bar_date(b) in missing and session_closed(market, _bar_date(b))]
            if not fillable:
                logger.warning(f"{symbol:10} provider had none of the gaps")
                stats["still_missing"] += len(missing)
                continue

            written = await repo.bulk_upsert_prices([
                {
                    "symbol": symbol,
                    "market": market,
                    "date": _bar_date(b),
                    "open": b.get("open"),
                    "high": b.get("high"),
                    "low": b.get("low"),
                    "close": b["close"],
                    "volume": b.get("volume"),
                    "source": b.get("source", "backfill"),
                    "currency": CURRENCY_BY_MARKET.get(market, "USD"),
                }
                for b in fillable
            ])
            stats["rows_written"] += written
            stats["still_missing"] += len(missing) - len(fillable)
            logger.info(f"{symbol:10} filled {written} (of {len(missing)} gaps)")

    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("days", nargs="?", type=int, default=180)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--symbol", action="append", default=[])
    parser.add_argument(
        "--include-closed",
        action="store_true",
        help="also cover symbols with no open position (needed for TWR over a "
             "window that contains a lot which was since sold)",
    )
    args = parser.parse_args()

    # Canonicalise the filter the same way stored symbols are, or the Yahoo
    # spelling — the form BENCHMARK_MAP and most docs use — matches nothing and
    # the run reports "0 gaps found" with exit 0, which reads as "no holes".
    result = asyncio.run(
        backfill(
            args.days,
            args.dry_run,
            [canonical_symbol(s) for s in args.symbol],
            args.include_closed,
        )
    )
    logger.info(
        "Backfill complete: "
        f"{result['symbols']} symbols, {result['gaps_found']} gaps found, "
        f"{result['rows_written']} rows written, "
        f"{result['still_missing']} still missing (holidays or genuinely absent)"
    )
