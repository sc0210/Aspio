"""Move Portfolio-wallet cash into the Life Wallet.

The wallet model is **Life / Portfolio (invested assets only) / Emergency** — the
Portfolio wallet must never hold cash. Two earlier code paths violated that by
parking cash as ``CASH-*`` ``portfolio_holdings`` rows in the Portfolio wallet:
the old sell flow (credited proceeds to an in-portfolio cash holding) and the
"transfer to portfolio" branch. Both inflated the Portfolio total and never
returned cash to the Life Wallet. Both are now fixed in code; this revision
repairs the rows they left behind.

For each ACTIVE ``type='cash'`` holding in the ``portfolio`` wallet it:
  1. creates a Life-Wallet INCOME transaction for the holding's value (→ TWD), and
  2. deactivates the holding (quantity / value zeroed, ``is_active=False``).

Emergency-wallet cash is untouched. Idempotent — migrated holdings become
inactive, so a re-run selects nothing.

``scripts/migrate_portfolio_cash_to_life.py`` mirrors this as a manual,
dry-run-able preview (it uses *live* FX; this migration uses a fixed snapshot so
it stays reproducible).

Implementation note: tables are reflected from the live schema (not imported from
ORM models) so the migration keeps matching the table as it exists at THIS
revision, regardless of later model changes.
"""

import uuid
from datetime import datetime, timezone, date
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision = "2026_06_27_portfolio_cash_to_life"
down_revision = "2026_06_22_line_group_currency_twd"
branch_labels = None
depends_on = None

# Static TWD conversion snapshot. A migration must be reproducible, so it does
# NOT consult live FX rates. Mirrors PortfolioService._to_twd's fallback table.
_TO_TWD = {
    "TWD": Decimal("1"),
    "USD": Decimal("31.5"),
    "EUR": Decimal("34.0"),
    "JPY": Decimal("0.21"),
    "HKD": Decimal("4.05"),
    "SGD": Decimal("23.5"),
    "CNY": Decimal("4.4"),
}


def upgrade() -> None:
    bind = op.get_bind()
    meta = sa.MetaData()
    holdings = sa.Table("portfolio_holdings", meta, autoload_with=bind)
    transactions = sa.Table("transactions", meta, autoload_with=bind)
    categories = sa.Table("transaction_categories", meta, autoload_with=bind)

    rows = bind.execute(
        sa.select(
            holdings.c.id,
            holdings.c.user_id,
            holdings.c.symbol,
            holdings.c.currency,
            holdings.c.total_value,
            holdings.c.quantity,
        ).where(
            holdings.c.type == "cash",
            holdings.c.wallet_type == "portfolio",
            holdings.c.is_active.is_(True),
        )
    ).fetchall()

    if not rows:
        return

    now = datetime.now(timezone.utc)

    # Ensure an INCOME "Transfer" category exists to attach the new transactions to.
    cat_id = bind.execute(
        sa.select(categories.c.id)
        .where(categories.c.name == "Transfer", categories.c.type == "INCOME")
        .limit(1)
    ).scalar()
    if cat_id is None:
        cat_id = uuid.uuid4()
        bind.execute(
            categories.insert().values(
                id=cat_id,
                name="Transfer",
                type="INCOME",
                color="#6B7280",
                icon="🔄",
                description="Money transfers between wallets",
                is_default=False,
                is_active=True,
                is_system=True,
                usage_count=0,
                created_at=now,
                updated_at=now,
            )
        )

    today = date.today()
    for r in rows:
        amount = Decimal(
            str(r.total_value if r.total_value is not None else (r.quantity or 0))
        )
        rate = _TO_TWD.get((r.currency or "TWD").upper(), Decimal("1"))
        twd = (amount * rate).quantize(Decimal("0.01"))

        bind.execute(
            transactions.insert().values(
                id=uuid.uuid4(),
                user_id=r.user_id,
                type="INCOME",
                wallet_type="life",
                category_id=cat_id,
                amount=twd,
                currency="TWD",
                description="Migrated Portfolio cash → Life Wallet",
                notes=f"Data migration: {r.symbol} ({amount} {r.currency})",
                transaction_date=today,
                status="COMPLETED",
                auto_categorized=False,
                reviewed_by_user=False,
                tax_deductible=False,
                business_expense=False,
                is_deleted=False,
                created_at=now,
                updated_at=now,
            )
        )
        bind.execute(
            holdings.update()
            .where(holdings.c.id == r.id)
            .values(
                is_active=False,
                quantity=Decimal("0"),
                total_value=Decimal("0"),
                total_cost=Decimal("0"),
                updated_at=now,
            )
        )


def downgrade() -> None:
    # One-way data backfill. The original per-holding portfolio cash is not
    # recoverable from the created Life transactions, so downgrade is a no-op.
    pass
