"""Settling up between peers: peer_settlements

Revision ID: 2026_11_07_peer_settlements
Revises: 2026_11_07_peer_splits
Create Date: 2026-11-07

A repayment from one person to the other against what accepted splits left
them owing. No ledger column: settling up writes no transactions.
RLS enabled with no policy, like every table here (the backend bypasses it).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "2026_11_07_peer_settlements"
down_revision = "2026_11_07_peer_splits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("peer_settlements"):
        op.create_table(
            "peer_settlements",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("connection_id", UUID(as_uuid=True),
                      sa.ForeignKey("peer_connections.id", ondelete="CASCADE"), nullable=False),
            sa.Column("from_user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("to_user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("amount", sa.Numeric(15, 2), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="TWD"),
            sa.Column("settled_on", sa.Date, nullable=False),
            sa.Column("note", sa.String(200), nullable=True),
            sa.Column("status", sa.String(10), nullable=False, server_default="proposed"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("amount > 0", name="peer_settlement_positive_amount"),
            sa.CheckConstraint("from_user_id <> to_user_id", name="peer_settlement_two_people"),
        )
    # Balances and the list filter by either person.
    existing = {i["name"] for i in sa.inspect(bind).get_indexes("peer_settlements")}
    for name, column in (("idx_peer_settlements_connection", "connection_id"),
                         ("idx_peer_settlements_from_user", "from_user_id"),
                         ("idx_peer_settlements_to_user", "to_user_id")):
        if name not in existing:
            op.create_index(name, "peer_settlements", [column])
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE public.peer_settlements ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("peer_settlements")
