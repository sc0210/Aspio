"""Add indexes to line_link_tokens for expiry and used-flag queries

Revision ID: 2026_06_02_line_link_token_indexes
Revises: 2026_06_01_perf_indexes_pool
Create Date: 2026-06-02

The purge query in _purge_unused_link_tokens and the lookup in confirm_link
both filter on (line_user_id, used). The confirm_link expiry check filters on
expires_at. Without indexes these are sequential scans on a table that grows
by one row per /link invocation and is never bulk-deleted.
"""

from alembic import op

revision = "2026_06_02_line_link_token_indexes"
down_revision = "2026_06_01_perf_indexes_pool"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_line_link_tokens_user_used",
        "line_link_tokens",
        ["line_user_id", "used"],
    )
    op.create_index(
        "idx_line_link_tokens_expires_at",
        "line_link_tokens",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_line_link_tokens_expires_at", table_name="line_link_tokens")
    op.drop_index("idx_line_link_tokens_user_used", table_name="line_link_tokens")
