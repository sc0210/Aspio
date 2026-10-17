"""Add missing indexes: notifications, sessions, tokens, goals, transactions text search

Revision ID: 2026_04_09_missing_indexes
Revises: add_performance_indexes_2026
Create Date: 2026-04-09

This migration catches up indexes that were defined in earlier migration files
(20251205_add_critical_indexes, 2026_04_04_add_performance_indexes) but were
never applied because the database was created via SQLAlchemy create_all()
rather than through Alembic.

Gaps being closed:
1. notifications — no user-scoped indexes at all (full table scan on every dashboard load)
2. refresh_tokens — missing partial index for active-only token lookups
3. user_sessions  — missing partial index for active sessions + expiry cleanup
4. goals          — missing (user_id, updated_at) composite
5. goal_contributions — missing (user_id, created_at) composite
6. transactions   — missing pg_trgm extension + GIN text-search indexes
                    + partial live-rows covering index

All statements use IF NOT EXISTS / so this is safe to re-run.
"""

from alembic import op

# revision identifiers
revision = "2026_04_09_missing_indexes"
down_revision = "add_performance_indexes_2026"
branch_labels = None
depends_on = None


def upgrade() -> None:

    # ── 1. NOTIFICATIONS ────────────────────────────────────────────────────
    # Dashboard unread count: WHERE user_id = ? AND status IN ('pending','sent')
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_notifications_user_status
        ON notifications (user_id, status, created_at DESC)
        """
    )

    # Unread-only partial index (most frequent query, smallest scan)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
        ON notifications (user_id, created_at DESC)
        WHERE status IN ('PENDING'::notificationstatus, 'SENT'::notificationstatus)
        """
    )

    # Background scheduler: find notifications due to be sent
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_pending
        ON notifications (scheduled_at)
        WHERE scheduled_at IS NOT NULL AND status = 'PENDING'::notificationstatus
        """
    )

    # Cleanup job: expired notifications
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_notifications_expires
        ON notifications (expires_at)
        WHERE expires_at IS NOT NULL
        """
    )

    # ── 2. REFRESH TOKENS ───────────────────────────────────────────────────
    # Auth middleware: find active token for user (token rotation / logout-all)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
        ON refresh_tokens (user_id, created_at DESC)
        WHERE is_active = true
        """
    )

    # Cleanup job: expired tokens
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expired
        ON refresh_tokens (expires_at)
        WHERE is_active = true
        """
    )

    # ── 3. USER SESSIONS ────────────────────────────────────────────────────
    # "Active sessions" list for a user
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
        ON user_sessions (user_id, created_at DESC)
        WHERE is_active = true
        """
    )

    # Cleanup job: expired sessions
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expired
        ON user_sessions (expires_at)
        WHERE is_active = true
        """
    )

    # ── 4. GOALS ────────────────────────────────────────────────────────────
    # Goals list ordered by last update
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_goals_user_updated
        ON goals (user_id, updated_at DESC)
        """
    )

    # Active-only partial index (dashboard widget, most common query)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_goals_user_active
        ON goals (user_id, updated_at DESC)
        WHERE status IN ('active', 'paused')
        """
    )

    # ── 5. TRANSACTIONS — TEXT SEARCH (pg_trgm) ─────────────────────────────
    # Enable pg_trgm for similarity() / ILIKE search
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # GIN trigram index on description (similarity search, ILIKE)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transactions_description_trgm
        ON transactions USING gin (description gin_trgm_ops)
        """
    )

    # GIN trigram index on merchant_name (ILIKE filter)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transactions_merchant_trgm
        ON transactions USING gin (merchant_name gin_trgm_ops)
        WHERE merchant_name IS NOT NULL
        """
    )

    # Partial covering index: live rows only (avoids is_deleted in every query)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transactions_live_user_date
        ON transactions (user_id, transaction_date DESC)
        WHERE is_deleted = false
        """
    )

    # Dashboard query pattern: user + date + type + status, live rows only
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transactions_live_dashboard
        ON transactions (user_id, transaction_date DESC, type, status)
        WHERE is_deleted = false
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_transactions_live_dashboard")
    op.execute("DROP INDEX IF EXISTS idx_transactions_live_user_date")
    op.execute("DROP INDEX IF EXISTS idx_transactions_merchant_trgm")
    op.execute("DROP INDEX IF EXISTS idx_transactions_description_trgm")

    op.execute("DROP INDEX IF EXISTS idx_goals_user_active")
    op.execute("DROP INDEX IF EXISTS idx_goals_user_updated")

    op.execute("DROP INDEX IF EXISTS idx_user_sessions_expired")
    op.execute("DROP INDEX IF EXISTS idx_user_sessions_user_active")

    op.execute("DROP INDEX IF EXISTS idx_refresh_tokens_expired")
    op.execute("DROP INDEX IF EXISTS idx_refresh_tokens_user_active")

    op.execute("DROP INDEX IF EXISTS idx_notifications_expires")
    op.execute("DROP INDEX IF EXISTS idx_notifications_scheduled_pending")
    op.execute("DROP INDEX IF EXISTS idx_notifications_user_unread")
    op.execute("DROP INDEX IF EXISTS idx_notifications_user_status")
