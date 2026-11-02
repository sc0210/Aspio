"""Restate Life Wallet legs of foreign-currency buys at that day's exchange rate.

Before PR #91 a buy's Life Wallet expense was converted with the seeded
`currencies` table (31.25 TWD/USD, never updated), while the holding was valued
at the live rate. Each USD buy therefore moved Total Asset by the difference on
the day it was made, and that gap is still in the ledger. Code since #91 books at
the day's stored TWD=X close; this script brings older legs to the same rule.

It only touches rows it can recompute exactly:
- linked to a holding (`holding_id`), category "Investment Purchase", booked in TWD;
- the holding is in a currency with a stored daily series (USD → TWD=X);
- the leg's own description gives its quantity and price ("Buy VT ×10 @ 98.50 USD");
- a TWD=X close exists on or up to 7 days before the leg's date.

Sale proceeds are listed, never changed: they are not linked to a holding and do
not record their native amount, so there is nothing exact to restate them from.

Dry run by default: prints every change as CSV and writes nothing. With --apply
it updates the amounts in one transaction and writes an undo CSV (id, old amount)
first, so the change can be reversed with a plain UPDATE per row.

    python scripts/restate_fx_bridge_legs.py                 # report only
    python scripts/restate_fx_bridge_legs.py --user EMAIL    # one account
    python scripts/restate_fx_bridge_legs.py --apply --undo-file restate_undo.csv

Run it against a backup-taken database; it is a cash-history change.
"""

import argparse
import asyncio
import csv
import sys
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.base import import_all_models  # noqa: E402

import_all_models()

from sqlalchemy import and_, select  # noqa: E402

from app.core.database import async_session  # noqa: E402
from app.modules.portfolio.models import HistoricalPrice, PortfolioHolding  # noqa: E402
from app.modules.portfolio.performance_tracker import FX_SERIES  # noqa: E402
from app.modules.transactions.models import Transaction, TransactionCategory  # noqa: E402
from app.modules.transactions.router import _parse_buy_description  # noqa: E402
from app.modules.users.models import User  # noqa: E402

MAX_RATE_AGE_DAYS = 7
CENT = Decimal("0.01")


async def _rate_on(session, fx_symbol, day):
    return (await session.execute(
        select(HistoricalPrice.close)
        .where(and_(
            HistoricalPrice.symbol == fx_symbol,
            HistoricalPrice.date <= day,
            HistoricalPrice.date >= day - timedelta(days=MAX_RATE_AGE_DAYS),
        ))
        .order_by(HistoricalPrice.date.desc())
        .limit(1)
    )).scalar_one_or_none()


async def main(args) -> int:
    out = csv.writer(sys.stdout)
    out.writerow(["transaction_id", "date", "symbol", "native", "currency", "rate", "old_twd", "new_twd", "delta"])
    changes = []
    skipped = {"no_rate": 0, "unparsed": 0, "unchanged": 0, "currency_without_series": 0}

    async with async_session() as session:
        stmt = (
            select(Transaction, PortfolioHolding.currency)
            .join(PortfolioHolding, PortfolioHolding.id == Transaction.holding_id)
            .join(TransactionCategory, TransactionCategory.id == Transaction.category_id)
            .where(and_(
                Transaction.is_deleted == False,  # noqa: E712
                Transaction.holding_id.isnot(None),
                TransactionCategory.name == "Investment Purchase",
                Transaction.currency == "TWD",
                PortfolioHolding.currency != "TWD",
            ))
            .order_by(Transaction.transaction_date)
        )
        if args.user:
            stmt = stmt.join(User, User.id == Transaction.user_id).where(User.email == args.user)
        rows = (await session.execute(stmt)).all()

        for txn, holding_currency in rows:
            currency = (holding_currency or "").upper()
            fx_symbol = FX_SERIES.get(currency)
            if not fx_symbol:
                skipped["currency_without_series"] += 1
                continue
            parsed = _parse_buy_description(txn.description or "")
            if not parsed or parsed[3].upper() != currency:
                skipped["unparsed"] += 1
                continue
            _, qty, price, _ = parsed
            rate = await _rate_on(session, fx_symbol, txn.transaction_date)
            if not rate:
                skipped["no_rate"] += 1
                continue
            native = Decimal(str(qty)) * Decimal(str(price))
            new_amount = (native * Decimal(str(rate))).quantize(CENT, ROUND_HALF_UP)
            old_amount = Decimal(str(txn.amount)).quantize(CENT, ROUND_HALF_UP)
            if new_amount == old_amount:
                skipped["unchanged"] += 1
                continue
            changes.append((txn, old_amount, new_amount))
            out.writerow([txn.id, txn.transaction_date, parsed[0], native, currency, rate,
                          old_amount, new_amount, new_amount - old_amount])

        # Listed for a person to look at, never changed (see the module docstring).
        sales = (await session.execute(
            select(Transaction.id, Transaction.transaction_date, Transaction.amount, Transaction.description)
            .join(TransactionCategory, TransactionCategory.id == Transaction.category_id)
            .where(and_(
                Transaction.is_deleted == False,  # noqa: E712
                TransactionCategory.name == "Investment Sale",
            ))
        )).all()

        total = sum((new - old for _, old, new in changes), Decimal("0"))
        print(
            # These are expenses: a larger amount is a lower Life Wallet balance.
            f"\n# {len(changes)} leg(s) to restate: purchase expenses change by {total:+} TWD, "
            f"so the Life Wallet balance changes by {-total:+} TWD; "
            f"skipped {skipped}; {len(sales)} sale-proceeds row(s) left for manual review",
            file=sys.stderr,
        )

        if not args.apply or not changes:
            if changes:
                print("# dry run: nothing written (pass --apply to write)", file=sys.stderr)
            return 0

        undo = Path(args.undo_file)
        with undo.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["transaction_id", "old_amount"])
            for txn, old, _ in changes:
                w.writerow([txn.id, old])
        for txn, _, new in changes:
            txn.amount = new
        await session.commit()
        print(f"# applied; undo values written to {undo}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    parser.add_argument("--user", help="only this account's rows (email)")
    parser.add_argument("--undo-file", default="restate_fx_bridge_legs_undo.csv",
                        help="where --apply writes the previous amounts")
    sys.exit(asyncio.run(main(parser.parse_args())))
