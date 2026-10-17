"""Add daily_wallet_snapshots table for dashboard trend reads.

Revision ID: 2026_07_04_daily_wallet_snapshots
Revises: 2026_06_27_portfolio_cash_to_life
Create Date: 2026-07-04

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_07_04_daily_wallet_snapshots.sql on Supabase
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "2026_07_04_daily_wallet_snapshots"
down_revision = "2026_06_27_portfolio_cash_to_life"
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_table("daily_wallet_snapshots")
