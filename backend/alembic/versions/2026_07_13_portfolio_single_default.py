"""Enforce one active default portfolio per user + repair existing duplicates

Revision ID: 2026_07_13_portfolio_single_default
Revises: 2026_07_07_add_transfer_group_id
Create Date: 2026-07-13

`portfolios` had no DB-level guard on "one default per user" — only app code
(create/update unset other defaults before setting a new one). That unset-then-
set is not atomic, so concurrent writes (or data imports) could leave a user
with two rows where is_default AND is_active. get_default_portfolio() then does
scalar_one_or_none() → raises MultipleResultsFound, breaking the whole portfolio
surface and the dashboard trend recompute for that user.

This migration (1) collapses any existing duplicates to a single default per
user, keeping the most-recently-updated one, then (2) adds a partial unique
index so the second concurrent write fails cleanly instead of silently
duplicating. Step order matters: the index cannot be created while duplicates
exist.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_07_13_portfolio_single_default.sql on Supabase
manually (it uses CREATE UNIQUE INDEX CONCURRENTLY to avoid locking the table),
then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_07_13_portfolio_single_default"
down_revision = "2026_07_07_add_transfer_group_id"
branch_labels = None
depends_on = None


# Keep the most-recently-updated active default per user; unset the rest.
DEDUP_SQL = """
WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY user_id
        ORDER BY updated_at DESC, created_at DESC, id
    ) AS rn
    FROM portfolios
    WHERE is_default AND is_active
)
UPDATE portfolios p
SET is_default = false, updated_at = now()
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;
"""


def upgrade() -> None:
    op.execute(DEDUP_SQL)
    op.create_index(
        "uq_portfolios_one_active_default_per_user",
        "portfolios",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_default AND is_active"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_portfolios_one_active_default_per_user",
        table_name="portfolios",
    )
