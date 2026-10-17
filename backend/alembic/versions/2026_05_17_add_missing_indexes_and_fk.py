"""Add missing indexes to chat/notification tables and FK on import_batch_id

Revision ID: 2026_05_17_add_missing_indexes_and_fk
Revises: 2026_05_16_add_debt_accounts
Create Date: 2026-05-17

Fixes:
- chat_sessions: add index on user_id
- chat_messages: add indexes on session_id and created_at
- notification_preferences: add index on user_id
- transactions.import_batch_id: add FK constraint to transaction_import_batches
"""

from alembic import op
import sqlalchemy as sa

revision = "2026_05_17_add_indexes_fk"
down_revision = "2026_05_16_add_debt_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # chat_sessions: user_id lookup (every chat load filters by user)
    op.create_index(
        "idx_chat_sessions_user_id",
        "chat_sessions",
        ["user_id"],
    )

    # chat_messages: session messages are always fetched by session_id, ordered by created_at
    op.create_index(
        "idx_chat_messages_session_id",
        "chat_messages",
        ["session_id"],
    )
    op.create_index(
        "idx_chat_messages_created_at",
        "chat_messages",
        ["created_at"],
        postgresql_using="brin",
    )

    # notification_preferences: one row per user, looked up by user_id on every notification send
    op.create_index(
        "idx_notification_preferences_user_id",
        "notification_preferences",
        ["user_id"],
        unique=True,
    )

    # transactions.import_batch_id FK — batch record must exist before transactions reference it
    op.create_foreign_key(
        "fk_transactions_import_batch_id",
        "transactions",
        "transaction_import_batches",
        ["import_batch_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_transactions_import_batch_id", "transactions", type_="foreignkey")
    op.drop_index("idx_notification_preferences_user_id", table_name="notification_preferences")
    op.drop_index("idx_chat_messages_created_at", table_name="chat_messages")
    op.drop_index("idx_chat_messages_session_id", table_name="chat_messages")
    op.drop_index("idx_chat_sessions_user_id", table_name="chat_sessions")
