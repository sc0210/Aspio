"""Split an existing expense: peer_splits.source_transaction_id

Revision ID: 2026_11_07_split_source_transaction
Revises: 2026_11_07_peer_settlements
Create Date: 2026-11-07

Marks a split made from an expense already in the payer's ledger, so withdrawing
it hands that expense back whole instead of deleting it. No new table, no RLS.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "2026_11_07_split_source_transaction"
down_revision = "2026_11_07_peer_settlements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "source_transaction_id" not in {c["name"] for c in sa.inspect(bind).get_columns("peer_splits")}:
        op.add_column("peer_splits", sa.Column(
            "source_transaction_id", UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("peer_splits", "source_transaction_id")
