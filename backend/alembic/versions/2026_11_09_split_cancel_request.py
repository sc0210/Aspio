"""The non-payer asks to cancel a split: peer_split_amendments.kind

Revision ID: 2026_11_09_split_cancel_request
Revises: 2026_11_08_recurring_splits
Create Date: 2026-11-09

kind is 'change' (every existing row) or 'cancel': a request the payer accepts
to close the split back onto themselves. No new table, no RLS.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_11_09_split_cancel_request"
down_revision = "2026_11_08_recurring_splits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("peer_split_amendments")}
    if "kind" not in existing:
        op.add_column("peer_split_amendments",
                      sa.Column("kind", sa.String(10), nullable=False, server_default="change"))


def downgrade() -> None:
    op.drop_column("peer_split_amendments", "kind")
