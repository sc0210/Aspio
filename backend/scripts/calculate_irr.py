"""Recompute every open lot's stored IRR from the lot's own numbers.

Until 2026-10-08 a lot's IRR was an XIRR over its symbol's whole ledger —
every buy of every lot ever created, closed re-import duplicates included —
against that one lot's value. It stored -60% on lots up 88%, and /lifecycle
averaged those into a "realized return" of ~101%. `lot_irr` now uses the lot's
cost on its purchase day against its value today, and none under a year.

Read first:
    python scripts/calculate_irr.py --dry-run          # what would change, writes nothing
    python scripts/calculate_irr.py                    # every user
    python scripts/calculate_irr.py <user_id>          # one user
"""

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.base import import_all_models  # noqa: E402

import_all_models()

from sqlalchemy import select  # noqa: E402

from app.core.database import async_session  # noqa: E402
from app.modules.portfolio.irr_update_service import IRRUpdateService  # noqa: E402
from app.modules.portfolio.models import PortfolioHolding  # noqa: E402
from app.modules.portfolio.return_calculator import lot_irr  # noqa: E402


def _pct(x):
    return "none" if x is None else f"{float(x) * 100:+.1f}%"


async def run(user_id: str | None, dry_run: bool) -> None:
    async with async_session() as session:
        stmt = select(PortfolioHolding).where(PortfolioHolding.is_active == True)  # noqa: E712
        if user_id:
            stmt = stmt.where(PortfolioHolding.user_id == UUID(user_id))
        lots = (await session.execute(stmt)).scalars().all()

        changes = []
        for lot in lots:
            new = lot_irr(lot.total_cost, lot.total_value, lot.purchase_date)
            old = lot.irr
            if (old is None) != (new is None) or (old is not None and abs(float(old) - float(new)) > 1e-6):
                changes.append((lot, old, new))

        print(f"open lots: {len(lots)}   IRR would change on: {len(changes)}")
        worst = sorted(
            changes,
            key=lambda c: abs(float(c[1] or 0) - float(c[2] or 0)),
            reverse=True,
        )[:12]
        for lot, old, new in worst:
            print(f"  {lot.symbol:10} {str(lot.purchase_date)[:10]}  {_pct(old):>10} -> {_pct(new)}")

        if dry_run:
            print("dry run — nothing written")
            return

        users = sorted({lot.user_id for lot in lots})
        service = IRRUpdateService(session)
        for uid in users:
            summary = await service.update_all_holdings_irr(uid)
            print(f"user {uid}: {summary}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("user_id", nargs="?", help="limit to one user (default: every user)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.user_id, args.dry_run))
