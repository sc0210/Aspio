"""Mute split notifications per partner: peer_connection_prefs.split_notifications

Revision ID: 2026_11_08_peer_prefs_notifications
Revises: 2026_11_07_split_source_transaction
Create Date: 2026-11-08

One person's choice for one partner: bell notifications about bills and
repayments with them, on (the default) or off. No new table, no RLS.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_11_08_peer_prefs_notifications"
down_revision = "2026_11_07_split_source_transaction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("peer_connection_prefs")}
    if "split_notifications" not in columns:
        op.add_column("peer_connection_prefs", sa.Column(
            "split_notifications", sa.Boolean(), nullable=False, server_default=sa.text("true")))


def downgrade() -> None:
    op.drop_column("peer_connection_prefs", "split_notifications")
