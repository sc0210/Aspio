"""Add partial indexes for soft-deleted transactions

Revision ID: 2026_05_06_partial_indexes
Revises: remove_invest_wallet
Create Date: 2026-05-06

Replace the full-table is_deleted index with targeted partial indexes that
only cover active (non-deleted) rows. Every query already filters
`is_deleted = FALSE`, so a partial index is smaller and faster than the
previous full-column index.
"""

from alembic import op

revision = "2026_05_06_partial_indexes"
down_revision = "remove_invest_wallet"
branch_labels = None
depends_on = None


def upgrade():
    # Drop the generic full-table soft-delete index
    op.drop_index("idx_transactions_soft_delete", table_name="transactions", if_exists=True)

    # Partial index: primary lookup pattern (user + date, active rows only)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_transactions_user_date_active
        ON transactions (user_id, transaction_date DESC)
        WHERE is_deleted = FALSE
    """)

    # Partial index: wallet type filtering (active rows only)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_transactions_user_wallet_active
        ON transactions (user_id, wallet_type)
        WHERE is_deleted = FALSE
    """)

    # Partial index: category breakdown queries (active rows only)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_transactions_user_category_active
        ON transactions (user_id, category_id, transaction_date DESC)
        WHERE is_deleted = FALSE
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_transactions_user_date_active")
    op.execute("DROP INDEX IF EXISTS idx_transactions_user_wallet_active")
    op.execute("DROP INDEX IF EXISTS idx_transactions_user_category_active")

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_transactions_soft_delete
        ON transactions (is_deleted)
    """)
