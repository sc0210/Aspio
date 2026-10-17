"""Remove budgets and goals tables

Revision ID: remove_budgets_goals
Revises: 20251205_critical_indexes
Create Date: 2025-12-13

This migration removes the budgets and goals feature tables and related data.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "remove_budgets_goals"
down_revision = "20251205_critical_indexes"  # Fixed: was 20251205_add_critical_indexes
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Remove budgets and goals tables.
    """
    # Drop indexes first
    op.execute("DROP INDEX IF EXISTS idx_budgets_user_year_month")
    op.execute("DROP INDEX IF EXISTS idx_budgets_user_active")
    op.execute("DROP INDEX IF EXISTS idx_goals_user_id")
    op.execute("DROP INDEX IF EXISTS idx_goals_user_status")
    op.execute("DROP INDEX IF EXISTS idx_goal_contributions_goal_id")

    # Drop tables (in reverse order of dependencies)
    op.drop_table("goal_contributions", if_exists=True)
    op.drop_table("goals", if_exists=True)
    op.drop_table("budget_alerts", if_exists=True)
    op.drop_table("budgets", if_exists=True)


def downgrade() -> None:
    """
    Recreate budgets and goals tables.
    Note: This will not restore data, only table structure.
    """
    # Recreate budgets table
    op.create_table(
        "budgets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("period", sa.String(20), nullable=False, default="monthly"),
        sa.Column("year", sa.Integer, nullable=False),
        sa.Column("month", sa.Integer, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )

    # Recreate goals table
    op.create_table(
        "goals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("target_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("current_amount", sa.Numeric(15, 2), default=0),
        sa.Column("target_date", sa.Date, nullable=True),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("priority", sa.String(20), default="medium"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )

    # Recreate indexes
    op.create_index(
        "idx_budgets_user_year_month", "budgets", ["user_id", "year", "month"]
    )
    op.create_index("idx_budgets_user_active", "budgets", ["user_id", "is_active"])
    op.create_index("idx_goals_user_id", "goals", ["user_id"])
    op.create_index("idx_goals_user_status", "goals", ["user_id", "status"])
