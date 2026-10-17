"""add_performance_indexes: pg_trgm extension, GIN index for text search, partial index for active soft-deleted rows

Revision ID: add_performance_indexes_2026
Revises: 295c9b452280
Create Date: 2026-04-04

Adds:
- pg_trgm extension (required for similarity() text search in search_similar_transactions)
- GIN trigram index on transactions.description (fast similarity/ILIKE search)
- GIN trigram index on transactions.merchant_name (fast ILIKE filter)
- Partial index on transactions(user_id, transaction_date) WHERE is_deleted = false
  (avoids carrying is_deleted in every covering index; most queries only look at live rows)
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "add_performance_indexes_2026"
down_revision: Union[str, None] = "295c9b452280"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pg_trgm extension (required for similarity() and GIN trgm indexes)
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # GIN trigram index on description — makes similarity() and ILIKE fast
    op.execute(
        """
        CREATE INDEX  IF NOT EXISTS idx_transactions_description_trgm
        ON transactions USING gin (description gin_trgm_ops)
        """
    )

    # GIN trigram index on merchant_name — used in ILIKE filter queries
    op.execute(
        """
        CREATE INDEX  IF NOT EXISTS idx_transactions_merchant_trgm
        ON transactions USING gin (merchant_name gin_trgm_ops)
        WHERE merchant_name IS NOT NULL
        """
    )

    # Partial index on (user_id, transaction_date) for live rows only
    # Replaces the need to include is_deleted=false in every composite index predicate
    op.execute(
        """
        CREATE INDEX  IF NOT EXISTS idx_transactions_live_user_date
        ON transactions (user_id, transaction_date DESC)
        WHERE is_deleted = false
        """
    )

    # Partial index for the common dashboard query pattern:
    # user + date + type + status, live rows only
    op.execute(
        """
        CREATE INDEX  IF NOT EXISTS idx_transactions_live_dashboard
        ON transactions (user_id, transaction_date DESC, type, status)
        WHERE is_deleted = false
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX  IF EXISTS idx_transactions_live_dashboard")
    op.execute("DROP INDEX  IF EXISTS idx_transactions_live_user_date")
    op.execute("DROP INDEX  IF EXISTS idx_transactions_merchant_trgm")
    op.execute("DROP INDEX  IF EXISTS idx_transactions_description_trgm")
    # Note: we intentionally leave pg_trgm enabled on downgrade
    # as other parts of the schema may depend on it
