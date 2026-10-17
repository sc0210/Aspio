"""Add line_processed_events (LINE webhook idempotency / dedup)

Revision ID: 2026_07_12_line_processed_events
Revises: 2026_07_07_add_transfer_group_id
Create Date: 2026-07-12

One row per handled LINE webhook event, keyed by webhookEventId. The webhook
acks 200 immediately and processes in the background, so LINE may re-deliver a
batch; without dedup a redelivered /add or /txn would be recorded twice. Rows
are pruned after a short retention window.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_07_12_line_processed_events.sql on Supabase
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_07_12_line_processed_events"
down_revision = "2026_07_07_add_transfer_group_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "line_processed_events",
        sa.Column("event_id", sa.String(length=100), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_line_processed_events_created_at",
        "line_processed_events",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_line_processed_events_created_at",
        table_name="line_processed_events",
    )
    op.drop_table("line_processed_events")
