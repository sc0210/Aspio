"""Drop daily_wallet_snapshots

Revision ID: 2026_10_28_drop_daily_wallet_snapshots
Revises: 2026_10_22_username_lower_unique
Create Date: 2026-10-28

The table backed a nightly-snapshot fast path for dashboard trends. That path
was removed rather than repaired: the live computation is a prefix sum over the
charted window (~13ms for the largest account), and the fast path's coverage
guard silently fell through whenever the nightly job missed a day. The job went
with it, so nothing has read or written the table since; its rows are frozen
derived data (every value is recomputable from transactions and holdings).

The downgrade recreates the empty table, not its rows.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_10_28_drop_daily_wallet_snapshots.sql on the host
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "2026_10_28_drop_daily_wallet_snapshots"
down_revision = "2026_10_22_username_lower_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF EXISTS: a database bootstrapped outside Alembic may never have had it.
    op.execute("DROP TABLE IF EXISTS daily_wallet_snapshots")


def downgrade() -> None:
    # Same shape as 2026_07_04_daily_wallet_snapshots created.
    op.create_table(
        "daily_wallet_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("life_balance", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("portfolio_value", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("emergency_value", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("debt_balance", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("net_worth", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="TWD"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "user_id", "snapshot_date", name="uq_daily_wallet_snapshots_user_date"
        ),
    )
