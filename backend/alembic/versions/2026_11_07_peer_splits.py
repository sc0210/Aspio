"""Bill splitting between peers: preferences, splits, shares, ledger link

Revision ID: 2026_11_07_peer_splits
Revises: 2026_11_06_saving_records_rls
Create Date: 2026-11-07

- peer_connection_prefs: one person's settings for one connection (split_policy:
  off / approve_each / auto_accept), keyed by (connection, user) so a re-invite
  that swaps requester and receiver can't mix the two people up.
- peer_splits + peer_split_shares: a bill and each person's share of it.
- transactions.peer_split_share_id: the ledger row for a share (SET NULL).

RLS is enabled with no policy on the three new tables, like every table here:
the backend connects as a superuser and bypasses it.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "2026_11_07_peer_splits"
down_revision = "2026_11_06_saving_records_rls"
branch_labels = None
depends_on = None

_TABLES = ("peer_connection_prefs", "peer_splits", "peer_split_shares")


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("peer_connection_prefs"):
        op.create_table(
            "peer_connection_prefs",
            sa.Column("connection_id", UUID(as_uuid=True),
                      sa.ForeignKey("peer_connections.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("split_policy", sa.String(16), nullable=False, server_default="approve_each"),
            *_timestamps(),
        )

    if not insp.has_table("peer_splits"):
        op.create_table(
            "peer_splits",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("connection_id", UUID(as_uuid=True),
                      sa.ForeignKey("peer_connections.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("payer_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("description", sa.String(200), nullable=False),
            sa.Column("total_amount", sa.Numeric(15, 2), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="TWD"),
            sa.Column("category_id", UUID(as_uuid=True),
                      sa.ForeignKey("transaction_categories.id", ondelete="SET NULL"), nullable=True),
            sa.Column("split_date", sa.Date, nullable=False),
            sa.Column("method", sa.String(10), nullable=False, server_default="equal"),
            sa.Column("status", sa.String(10), nullable=False, server_default="proposed"),
            *_timestamps(),
            sa.CheckConstraint("total_amount > 0", name="peer_split_positive_total"),
        )
        op.create_index("idx_peer_splits_connection", "peer_splits", ["connection_id"])

    if not insp.has_table("peer_split_shares"):
        op.create_table(
            "peer_split_shares",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("split_id", UUID(as_uuid=True),
                      sa.ForeignKey("peer_splits.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("share_amount", sa.Numeric(15, 2), nullable=False),
            sa.Column("status", sa.String(10), nullable=False, server_default="proposed"),
            *_timestamps(),
            sa.UniqueConstraint("split_id", "user_id", name="peer_split_share_once_per_user"),
            sa.CheckConstraint("share_amount >= 0", name="peer_split_share_non_negative"),
        )
        op.create_index("idx_peer_split_shares_user", "peer_split_shares", ["user_id"])

    columns = {c["name"] for c in sa.inspect(bind).get_columns("transactions")}
    if "peer_split_share_id" not in columns:
        op.add_column("transactions", sa.Column(
            "peer_split_share_id", UUID(as_uuid=True),
            sa.ForeignKey("peer_split_shares.id", ondelete="SET NULL"), nullable=True))
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("transactions")}
    if "idx_transactions_peer_split_share" not in indexes:
        op.create_index("idx_transactions_peer_split_share", "transactions", ["peer_split_share_id"])
    # One live ledger row per split share, whatever races (a double Accept).
    if "uq_transactions_live_peer_split_share" not in indexes:
        live = "peer_split_share_id IS NOT NULL AND is_deleted = false"
        op.create_index(
            "uq_transactions_live_peer_split_share", "transactions", ["peer_split_share_id"],
            unique=True, postgresql_where=sa.text(live),
            sqlite_where=sa.text(live.replace("false", "0")),
        )

    if bind.dialect.name == "postgresql":
        for table in _TABLES:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("uq_transactions_live_peer_split_share", table_name="transactions")
    op.drop_index("idx_transactions_peer_split_share", table_name="transactions")
    op.drop_column("transactions", "peer_split_share_id")
    op.drop_table("peer_split_shares")
    op.drop_table("peer_splits")
    op.drop_table("peer_connection_prefs")
