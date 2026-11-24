"""Drop line_bot_activities: the LINE bot no longer logs each command

Revision ID: 2026_11_24_drop_line_bot_activities
Revises: 2026_11_23_drop_unused_tables
Create Date: 2026-11-24

The log's only reader, GET /line-bot/activity, had no caller and was removed, so
the bot stopped writing it. It held command history ("Logged: lunch 120"), not
records: the transactions and splits themselves are untouched. Dropped even
with rows.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_11_24_drop_line_bot_activities"
down_revision = "2026_11_23_drop_unused_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS line_bot_activities")


def downgrade() -> None:
    # Recreated empty, as 2026_06_02_line_bot_activity_log made it.
    op.create_table(
        "line_bot_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("currency", sa.String(10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "idx_line_bot_activities_user_created", "line_bot_activities", ["user_id", "created_at"]
    )
