"""Shared live quotes: one row per security

Revision ID: 2026_11_03_security_quotes
Revises: 2026_10_28_drop_daily_wallet_snapshots
Create Date: 2026-11-03

Live prices lived only as copies on every user's lot, so freshness had to be
guessed from the lots (one user's refresh, or a new lot, decided for everyone)
and a lot added after a refresh sat at its purchase price. `security_quotes`
holds the latest quote per symbol; the lot columns stay as copies written with it.

Seeded from the freshest priced lot of each symbol, so freshness carries over.
RLS is enabled with no policy, like every table here: the backend connects as a
superuser and bypasses it, and direct API access is denied.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_11_03_security_quotes.sql on the host
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_11_03_security_quotes"
down_revision = "2026_10_28_drop_daily_wallet_snapshots"
branch_labels = None
depends_on = None

# Holdings no feed prices (portfolio/manual_pricing.MANUALLY_PRICED_TYPES).
_MANUAL = "('cash', 'crypto', 'cryptocurrency', 'lending')"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # A dev backend creates missing tables from the models at startup
    # (SKIP_DB_SCHEMA_INIT off), so the table can already be there, empty.
    if not inspector.has_table("security_quotes"):
        op.create_table(
            "security_quotes",
            sa.Column("symbol", sa.String(20), primary_key=True),
            sa.Column("market", sa.String(10), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="TWD"),
            sa.Column("price", sa.Numeric(20, 10), nullable=False),
            sa.Column("previous_close", sa.Numeric(20, 10)),
            sa.Column("quote_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
        )
    existing_indexes = {i["name"] for i in sa.inspect(bind).get_indexes("security_quotes")}
    if "idx_security_quotes_quote_time" not in existing_indexes:
        op.create_index("idx_security_quotes_quote_time", "security_quotes", ["quote_time"])

    if bind.dialect.name == "postgresql":
        op.execute(f"""
            INSERT INTO security_quotes (symbol, market, currency, price, previous_close, quote_time)
            SELECT DISTINCT ON (symbol) symbol, market, currency, current_price, previous_close,
                   last_price_update_at
            FROM portfolio_holdings
            WHERE is_active AND last_price_update_at IS NOT NULL AND current_price > 0
              AND lower(type::text) NOT IN {_MANUAL}
            ORDER BY symbol, last_price_update_at DESC
            ON CONFLICT (symbol) DO NOTHING
        """)
        op.execute("ALTER TABLE security_quotes ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("idx_security_quotes_quote_time", table_name="security_quotes")
    op.drop_table("security_quotes")
