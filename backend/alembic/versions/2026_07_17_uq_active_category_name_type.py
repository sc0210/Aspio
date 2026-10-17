"""Partial unique index preventing duplicate active categories

Revision ID: 2026_07_17_uq_active_category_name_type
Revises: 2026_07_07_add_transfer_group_id
Create Date: 2026-07-17

Duplicate ACTIVE categories sharing a name+type (e.g. two "Dining" expense
rows) break name-based lookups (get_by_name -> MultipleResultsFound) and split
a category's transactions across two ids. This enforces uniqueness on
(lower(name), type) among active rows only — soft-deleted rows may still share
a name.

Prerequisite: any existing duplicates must be merged first, or index creation
fails. Run backend/scripts/prod_sql/2026_07_17_dedupe_duplicate_categories.sql
before this.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_07_17_uq_active_category_name_type.sql on Supabase
manually (after the dedupe script), then `alembic stamp head`.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_07_17_uq_active_category_name_type"
down_revision = "2026_07_07_add_transfer_group_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_active_category_name_type
        ON transaction_categories (lower(name), type)
        WHERE is_active
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_active_category_name_type")
