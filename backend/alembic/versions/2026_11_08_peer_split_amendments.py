"""Change an accepted split with the partner's approval: peer_split_amendments

Revision ID: 2026_11_08_peer_split_amendments
Revises: 2026_11_08_peer_prefs_notifications
Create Date: 2026-11-08

One proposed change per split (partial unique index), applied to the split and
both ledger rows only when the other person accepts. RLS enabled with no policy,
like every table here (the backend bypasses it).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "2026_11_08_peer_split_amendments"
down_revision = "2026_11_08_peer_prefs_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("peer_split_amendments"):
        op.create_table(
            "peer_split_amendments",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("split_id", UUID(as_uuid=True),
                      sa.ForeignKey("peer_splits.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proposed_by", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("total_amount", sa.Numeric(15, 2), nullable=False),
            sa.Column("payer_share", sa.Numeric(15, 2), nullable=False),
            sa.Column("other_share", sa.Numeric(15, 2), nullable=False),
            sa.Column("method", sa.String(10), nullable=False, server_default="equal"),
            sa.Column("description", sa.String(200), nullable=False),
            sa.Column("status", sa.String(10), nullable=False, server_default="proposed"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("total_amount > 0", name="peer_split_amendment_positive_total"),
            sa.CheckConstraint("payer_share >= 0 AND other_share >= 0",
                               name="peer_split_amendment_shares_non_negative"),
            sa.CheckConstraint("payer_share + other_share = total_amount",
                               name="peer_split_amendment_shares_sum"),
        )
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("peer_split_amendments")}
    if "idx_peer_split_amendments_split" not in indexes:
        op.create_index("idx_peer_split_amendments_split", "peer_split_amendments", ["split_id"])
    if "uq_peer_split_amendments_open" not in indexes:
        op.create_index("uq_peer_split_amendments_open", "peer_split_amendments", ["split_id"], unique=True,
                        postgresql_where=sa.text("status = 'proposed'"),
                        sqlite_where=sa.text("status = 'proposed'"))
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE public.peer_split_amendments ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("peer_split_amendments")
