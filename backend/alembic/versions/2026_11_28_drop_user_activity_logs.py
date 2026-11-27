"""Drop user_activity_logs: nothing read it

Revision ID: 2026_11_28_drop_user_activity_logs
Revises: 2026_11_27_unique_user_achievement
Create Date: 2026-11-28

Its only writer left was PUT /users/me/regional-preferences, which logged a
"regional_preferences_updated" event that nothing ever read. The preferences
themselves live on the users row and are untouched, so the event log is
dropped even with rows.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_11_28_drop_user_activity_logs"
down_revision = "2026_11_27_unique_user_achievement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.execute(sa.text("SELECT to_regclass('user_activity_logs')")).scalar():
        rows = conn.execute(sa.text("SELECT count(*) FROM user_activity_logs")).scalar()
        print(f"2026_11_28_drop_user_activity_logs: dropping {rows} event row(s)")
    op.execute("DROP TABLE IF EXISTS user_activity_logs")


def downgrade() -> None:
    # Recreated empty, as 2024_01_15_add_gamification_models made it.
    op.create_table(
        "user_activity_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_type", sa.String(length=100), nullable=False),
        sa.Column("activity_data", sa.JSON(), nullable=True),
        sa.Column("session_id", sa.String(length=100), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_activity_logs_user_id", "user_activity_logs", ["user_id"])
    op.create_index("ix_user_activity_logs_activity_type", "user_activity_logs", ["activity_type"])
    op.create_index("ix_user_activity_logs_session_id", "user_activity_logs", ["session_id"])
    op.execute("ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY")
