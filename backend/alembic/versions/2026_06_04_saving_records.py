"""Add saving_records table for per-deposit audit trail on shared goals

Revision ID: f1a7c00bbc4c
Revises: 2026_06_02_line_bot_activity_log
Create Date: 2026-06-04

Adds:
  - saving_records table — each row is a single deposit made by one
    participant of a SharedGoal.  The service layer sums these rows to
    recompute requester_amount / receiver_amount on the parent SharedGoal
    after every insert, update, or delete.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f1a7c00bbc4c"
down_revision = "2026_06_02_line_bot_activity_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saving_records",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "goal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("shared_goals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("record_date", sa.Date, nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.CheckConstraint("amount > 0", name="saving_record_positive_amount"),
    )

    op.create_index(
        "idx_saving_records_goal_id",
        "saving_records",
        ["goal_id"],
    )
    op.create_index(
        "idx_saving_records_user_id",
        "saving_records",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_saving_records_user_id", table_name="saving_records")
    op.drop_index("idx_saving_records_goal_id", table_name="saving_records")
    op.drop_table("saving_records")
