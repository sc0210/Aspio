"""Insurance expense category

Revision ID: 2026_11_21_insurance_category
Revises: 2026_11_16_shared_goal_sides
Create Date: 2026-11-21

The expense picker offers Insurance (保險) under its Others group. Categories
are global and an unknown name resolves to "Others"
(transactions/services.py::_ensure_category_id), so without this row the
choice would silently save as Others. An inactive Insurance row is reactivated
(only active categories resolve); otherwise one is inserted when none exists.
Data only: no new table, so no RLS.

Matches backend/scripts/prod_sql/2026_11_21_insurance_category.sql.
"""

from alembic import op

revision = "2026_11_21_insurance_category"
down_revision = "2026_11_16_shared_goal_sides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE transaction_categories SET is_active = true, updated_at = now()
        WHERE name = 'Insurance' AND type = 'EXPENSE'::categorytype AND NOT is_active
          AND NOT EXISTS (
            SELECT 1 FROM transaction_categories
            WHERE name = 'Insurance' AND type = 'EXPENSE'::categorytype AND is_active
          );
        """
    )
    op.execute(
        """
        INSERT INTO transaction_categories
          (id, name, name_en, name_zh, type, color, icon,
           is_default, is_active, is_system, usage_count, created_at, updated_at)
        SELECT gen_random_uuid(), 'Insurance', 'Insurance', '保險', 'EXPENSE'::categorytype,
               '#A29BFE', 'shield', true, true, true, 0, now(), now()
        WHERE NOT EXISTS (
          SELECT 1 FROM transaction_categories
          WHERE name = 'Insurance' AND type = 'EXPENSE'::categorytype
        )
        """
    )


def downgrade() -> None:
    # Only while nothing is filed under it: a row in use keeps its category.
    op.execute(
        """
        DELETE FROM transaction_categories c
        WHERE c.name = 'Insurance' AND c.type = 'EXPENSE'::categorytype
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.category_id = c.id)
        """
    )
