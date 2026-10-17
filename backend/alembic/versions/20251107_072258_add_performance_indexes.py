"""Add performance indexes for portfolio holdings and soft-deleted records

Revision ID: 20251107_072258
Revises: 002_allow_multiple_lots_per_symbol
Create Date: 2025-11-07 07:22:58

This migration adds:
1. Indexes for portfolio holdings to fix sequential scans
2. Partial indexes for soft-deleted records to improve query performance

These are pure optimization changes with zero impact on application logic or API responses.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251107_072258"
down_revision = "002_multiple_lots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add performance indexes"""

    # ========================================
    # 1. Portfolio Holdings Performance Indexes
    # ========================================

    # Index for holdings aggregation by portfolio (active holdings only)
    # Fixes: Sequential scans when loading portfolio with holdings
    # Usage: SELECT * FROM portfolio_holdings WHERE portfolio_id = X AND is_active = true
    op.create_index(
        "idx_holdings_portfolio_active",
        "portfolio_holdings",
        ["portfolio_id", "is_active"],
        postgresql_where=sa.text("is_active = true"),
        unique=False,
    )

    # Index for multi-lot holdings queries (supports new purchase_date tracking)
    # Fixes: Queries that need to show holdings grouped by symbol with dates
    # Usage: SELECT * FROM portfolio_holdings WHERE portfolio_id = X AND symbol = 'AAPL' AND is_active = true ORDER BY purchase_date DESC
    op.create_index(
        "idx_holdings_portfolio_symbol_active_date",
        "portfolio_holdings",
        ["portfolio_id", "symbol", "is_active", sa.text("purchase_date DESC")],
        postgresql_where=sa.text("is_active = true"),
        unique=False,
    )

    # Index for user-wide portfolio queries
    # Fixes: Dashboard queries that need all holdings for a user across portfolios
    # Usage: SELECT * FROM portfolio_holdings WHERE user_id = X AND is_active = true ORDER BY updated_at DESC
    op.create_index(
        "idx_holdings_user_active_updated",
        "portfolio_holdings",
        ["user_id", "is_active", sa.text("updated_at DESC")],
        unique=False,
    )

    # ========================================
    # 2. Partial Indexes for Soft-Deleted Records
    # ========================================

    # Transactions: Index for active (non-deleted, completed) transactions
    # Fixes: Most queries filter by is_deleted = false AND status = 'completed'
    # Usage: Dashboard, transaction list, analytics - all use active transactions only
    op.create_index(
        "idx_transactions_active_user_date",
        "transactions",
        ["user_id", sa.text("transaction_date DESC")],
        postgresql_where=sa.text("is_deleted = false AND status = 'completed'"),
        unique=False,
    )

    # Transactions: Index for active transactions by category (for category breakdowns)
    # Usage: Category spending analysis, budget tracking
    op.create_index(
        "idx_transactions_active_category_date",
        "transactions",
        ["category_id", sa.text("transaction_date DESC")],
        postgresql_where=sa.text("is_deleted = false"),
        unique=False,
    )

    # Portfolio Holdings: Index for active holdings (most queries only care about active)
    # Note: This complements the portfolio_active index above
    # Usage: Any query that lists or aggregates holdings
    op.create_index(
        "idx_holdings_active_only",
        "portfolio_holdings",
        ["user_id", "portfolio_id", sa.text("updated_at DESC")],
        postgresql_where=sa.text("is_active = true"),
        unique=False,
    )

    # Goals: Index for active goals by user
    # Fixes: Dashboard goal widgets, goal list page
    # Usage: SELECT * FROM goals WHERE user_id = X AND status = 'active'
    op.create_index(
        "idx_goals_active_user_priority",
        "goals",
        ["user_id", "priority", sa.text("target_date ASC")],
        postgresql_where=sa.text("status = 'active'"),
        unique=False,
    )

    print("✓ Added 7 performance indexes")
    print("  - 3 indexes for portfolio holdings (fixes sequential scans)")
    print("  - 4 partial indexes for soft-deleted/active records")
    print("  - No application code changes required")
    print("  - Zero frontend impact")


def downgrade() -> None:
    """Remove performance indexes"""

    # Remove indexes in reverse order
    op.drop_index("idx_goals_active_user_priority", table_name="goals")
    op.drop_index("idx_holdings_active_only", table_name="portfolio_holdings")
    op.drop_index("idx_transactions_active_category_date", table_name="transactions")
    op.drop_index("idx_transactions_active_user_date", table_name="transactions")
    op.drop_index("idx_holdings_user_active_updated", table_name="portfolio_holdings")
    op.drop_index(
        "idx_holdings_portfolio_symbol_active_date", table_name="portfolio_holdings"
    )
    op.drop_index("idx_holdings_portfolio_active", table_name="portfolio_holdings")

    print("✓ Removed 7 performance indexes")
