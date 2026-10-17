"""DB storage cleanup: drop unused columns and portfolio_analytics table

Revision ID: 2026_05_22_db_storage_cleanup
Revises: 2026_05_22_add_portfolio_holding_indexes
Create Date: 2026-05-22

Removes columns that are either derived (change, change_percent), never queried
(quality_score, shares_outstanding, bid_rate, ask_rate), or duplicate
(fetched_at duplicated created_at).  Drops the portfolio_analytics table which
is never populated by any active endpoint.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_05_22_db_storage_cleanup"
down_revision = "2026_05_22_add_portfolio_holding_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- market_data: drop derived/unused columns --------------------------------
    op.drop_column("market_data", "change")
    op.drop_column("market_data", "change_percent")
    op.drop_column("market_data", "quality_score")
    op.drop_column("market_data", "shares_outstanding")

    # -- currency_rates: drop spread columns ------------------------------------
    op.drop_column("currency_rates", "bid_rate")
    op.drop_column("currency_rates", "ask_rate")

    # -- historical_prices: drop fetched_at (duplicate of created_at) ----------
    op.drop_column("historical_prices", "fetched_at")

    # -- portfolio_analytics: drop indexes/constraints then the table -----------
    op.drop_index("idx_analytics_portfolio_period", table_name="portfolio_analytics")
    op.drop_index("idx_analytics_user_period", table_name="portfolio_analytics")
    op.drop_index("idx_analytics_calculated_at", table_name="portfolio_analytics")
    op.drop_constraint(
        "uq_analytics_portfolio_period", "portfolio_analytics", type_="unique"
    )
    op.drop_table("portfolio_analytics")


def downgrade() -> None:
    # -- Recreate portfolio_analytics table -------------------------------------
    op.create_table(
        "portfolio_analytics",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("portfolio_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "period_type",
            sa.Enum(
                "daily",
                "weekly",
                "monthly",
                "quarterly",
                "yearly",
                "all_time",
                name="period_type_enum",
            ),
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_return", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("total_return_percentage", sa.Numeric(8, 4), nullable=False, server_default="0"),
        sa.Column("annualized_return", sa.Numeric(8, 4), nullable=True),
        sa.Column("volatility", sa.Numeric(8, 4), nullable=True),
        sa.Column("sharpe_ratio", sa.Numeric(8, 4), nullable=True),
        sa.Column("max_drawdown", sa.Numeric(8, 4), nullable=True),
        sa.Column("value_at_risk", sa.Numeric(15, 2), nullable=True),
        sa.Column("beta", sa.Numeric(8, 4), nullable=True),
        sa.Column("alpha", sa.Numeric(8, 4), nullable=True),
        sa.Column("correlation", sa.Numeric(8, 4), nullable=True),
        sa.Column("diversification_score", sa.Numeric(8, 4), nullable=True),
        sa.Column("concentration_risk", sa.Numeric(8, 4), nullable=True),
        sa.Column("dividend_yield", sa.Numeric(8, 4), nullable=True),
        sa.Column("total_dividends", sa.Numeric(15, 2), nullable=True),
        sa.Column("turnover_ratio", sa.Numeric(8, 4), nullable=True),
        sa.Column("number_of_trades", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("currency_exposure", sa.JSON(), nullable=True),
        sa.Column("sector_allocation", sa.JSON(), nullable=True),
        sa.Column("asset_allocation", sa.JSON(), nullable=True),
        sa.Column("region_allocation", sa.JSON(), nullable=True),
        sa.Column("benchmark_symbol", sa.String(20), nullable=True),
        sa.Column("benchmark_return", sa.Numeric(8, 4), nullable=True),
        sa.Column("excess_return", sa.Numeric(8, 4), nullable=True),
        sa.Column("item_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "calculated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["portfolio_id"], ["portfolios.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "portfolio_id",
            "period_type",
            "period_start",
            "period_end",
            name="uq_analytics_portfolio_period",
        ),
    )
    op.create_index(
        "idx_analytics_portfolio_period",
        "portfolio_analytics",
        ["portfolio_id", "period_type", "period_start"],
    )
    op.create_index(
        "idx_analytics_user_period",
        "portfolio_analytics",
        ["user_id", "period_type"],
    )
    op.create_index(
        "idx_analytics_calculated_at",
        "portfolio_analytics",
        ["calculated_at"],
    )

    # -- historical_prices: restore fetched_at ----------------------------------
    op.add_column(
        "historical_prices",
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    # -- currency_rates: restore spread columns ---------------------------------
    op.add_column(
        "currency_rates",
        sa.Column("bid_rate", sa.Numeric(12, 6), nullable=True),
    )
    op.add_column(
        "currency_rates",
        sa.Column("ask_rate", sa.Numeric(12, 6), nullable=True),
    )

    # -- market_data: restore dropped columns -----------------------------------
    op.add_column(
        "market_data",
        sa.Column("quality_score", sa.Numeric(3, 2), nullable=True),
    )
    op.add_column(
        "market_data",
        sa.Column("shares_outstanding", sa.Numeric(20, 0), nullable=True),
    )
    op.add_column(
        "market_data",
        sa.Column("change", sa.Numeric(12, 4), nullable=True),
    )
    op.add_column(
        "market_data",
        sa.Column("change_percent", sa.Numeric(8, 4), nullable=True),
    )
