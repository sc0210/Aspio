"""Performance: add missing indexes, increase connection pool defaults

Revision ID: 2026_06_01_perf_indexes_pool
Revises: 2026_05_27_enable_rls_new_tables
Create Date: 2026-06-01

Addresses three classes of slow queries observed in production (>500 ms):

1. admin_audit_logs.admin_user_id — FK column with no index; sequential
   scan on every admin audit-log query.

2. line_group_members (user_id, group_id) composite — the get_user_groups
   query does:
     SELECT line_groups.*, COUNT(line_group_members.id)
     FROM line_groups
     JOIN line_group_members ON line_group_members.group_id = line_groups.id
     WHERE line_group_members.user_id = ?
     GROUP BY line_groups.id
   A composite index (user_id, group_id) lets PostgreSQL satisfy both the
   WHERE filter and the JOIN key from a single index scan.

3. admin_users.is_active — used in the get_all admin listing filter; small
   table but benefits from a partial index.

Connection pool settings are code-level (config.py), not SQL — this
migration documents the corresponding deployment change.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_06_01_perf_indexes_pool"
down_revision = "2026_05_27_enable_rls_new_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Admin audit logs: index the FK column used in every per-admin query
    op.create_index(
        "idx_admin_audit_logs_admin_user_id",
        "admin_audit_logs",
        ["admin_user_id"],
    )

    # LINE group members: composite covers the get_user_groups GROUP BY query
    op.create_index(
        "idx_line_group_members_user_group",
        "line_group_members",
        ["user_id", "group_id"],
    )

    # Admin users: speeds up is_active filter in admin listing
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_admin_users_is_active
        ON admin_users (is_active)
        WHERE is_active = true
        """
    )


def downgrade() -> None:
    op.drop_index("idx_admin_audit_logs_admin_user_id", table_name="admin_audit_logs")
    op.drop_index("idx_line_group_members_user_group", table_name="line_group_members")
    op.execute("DROP INDEX IF EXISTS idx_admin_users_is_active")
