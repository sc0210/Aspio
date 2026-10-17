"""Add missing portfolio and holding indexes

Revision ID: 2026_05_22_add_portfolio_holding_indexes
Revises: 2026_05_17_add_indexes_fk
Create Date: 2026-05-22

Adds:
- portfolios: composite (is_default, updated_at) for default-sorted queries
- portfolio_holdings: (currency) for dashboard exchange-rate grouping
- portfolio_holdings: (symbol, is_active) for scheduler batch price lookups
"""

from alembic import op

revision = "2026_05_22_add_portfolio_holding_indexes"
down_revision = "2026_05_17_add_indexes_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_portfolios_default_updated",
        "portfolios",
        ["is_default", "updated_at"],
    )
    op.create_index(
        "idx_holdings_currency",
        "portfolio_holdings",
        ["currency"],
    )
    op.create_index(
        "idx_holdings_symbol_active",
        "portfolio_holdings",
        ["symbol", "is_active"],
    )


def downgrade() -> None:
    op.drop_index("idx_holdings_symbol_active", table_name="portfolio_holdings")
    op.drop_index("idx_holdings_currency", table_name="portfolio_holdings")
    op.drop_index("idx_portfolios_default_updated", table_name="portfolios")
