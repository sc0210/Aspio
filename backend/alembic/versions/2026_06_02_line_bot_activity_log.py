"""Add line_bot_activities table for activity feed

Revision ID: 2026_06_02_line_bot_activity_log
Revises: 2026_06_02_line_link_token_indexes
Create Date: 2026-06-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_06_02_line_bot_activity_log"
down_revision = "2026_06_02_line_link_token_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        "idx_line_bot_activities_user_created",
        "line_bot_activities",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_line_bot_activities_user_created",
        table_name="line_bot_activities",
    )
    op.drop_table("line_bot_activities")
