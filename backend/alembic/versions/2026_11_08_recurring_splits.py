"""Repeating bills split with a partner: split columns on recurring_transactions

Revision ID: 2026_11_08_recurring_splits
Revises: 2026_11_08_peer_split_amendments
Create Date: 2026-11-08

split_connection_id (SET NULL), split_method, split_my_percent, split_my_amount.
Each occurrence a rule with a connection posts is split with that partner. No
new table, no RLS.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "2026_11_08_recurring_splits"
down_revision = "2026_11_08_peer_split_amendments"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("split_connection_id", lambda: sa.Column(
        "split_connection_id", UUID(as_uuid=True),
        sa.ForeignKey("peer_connections.id", ondelete="SET NULL"), nullable=True)),
    ("split_method", lambda: sa.Column("split_method", sa.String(10), nullable=True)),
    ("split_my_percent", lambda: sa.Column("split_my_percent", sa.Numeric(5, 2), nullable=True)),
    ("split_my_amount", lambda: sa.Column("split_my_amount", sa.Numeric(15, 2), nullable=True)),
)


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("recurring_transactions")}
    for name, column in _COLUMNS:
        if name not in existing:
            op.add_column("recurring_transactions", column())


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column("recurring_transactions", name)
