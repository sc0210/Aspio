"""Add transfer_group_id to transactions + backfill existing transfer pairs

Revision ID: 2026_07_07_add_transfer_group_id
Revises: 2026_07_04_daily_wallet_snapshots
Create Date: 2026-07-07

Links the two legs (debit + credit) created by create_transfer() so a
transfer can be edited/deleted as a single unit instead of two orphaned
rows. Existing transfer pairs are backfilled with a best-effort match on
user_id/amount/currency/date/notes (the `notes` column always holds the
fixed "Transfer from X to Y" string on both legs, regardless of any
user-provided description) plus a created_at proximity tiebreaker for the
rare case of duplicate same-day transfers.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_07_07_add_transfer_group_id.sql on Supabase
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "2026_07_07_add_transfer_group_id"
down_revision = "2026_07_04_daily_wallet_snapshots"
branch_labels = None
depends_on = None


BACKFILL_SQL = """
WITH candidates AS (
    SELECT
        a.id AS expense_id,
        b.id AS income_id,
        ABS(EXTRACT(EPOCH FROM (a.created_at - b.created_at))) AS time_diff
    FROM transactions a
    JOIN transactions b
        ON a.user_id = b.user_id
       AND a.amount = b.amount
       AND a.currency = b.currency
       AND a.transaction_date = b.transaction_date
       AND a.notes = b.notes
       AND a.wallet_type <> b.wallet_type
       AND a.type = 'EXPENSE' AND b.type = 'INCOME'
    JOIN transaction_categories ca ON ca.id = a.category_id AND ca.name = 'Transfer'
    JOIN transaction_categories cb ON cb.id = b.category_id AND cb.name = 'Transfer'
    WHERE a.transfer_group_id IS NULL
      AND b.transfer_group_id IS NULL
      AND a.notes ~ '^Transfer from .+ to .+$'
),
best_expense AS (
    SELECT DISTINCT ON (expense_id) expense_id, income_id
    FROM candidates
    ORDER BY expense_id, time_diff ASC
),
best_pair AS (
    SELECT DISTINCT ON (income_id) expense_id, income_id
    FROM best_expense
    ORDER BY income_id, expense_id
)
UPDATE transactions t
SET transfer_group_id = bp.expense_id
FROM best_pair bp
WHERE t.id = bp.expense_id OR t.id = bp.income_id;
"""


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("transfer_group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "idx_transactions_transfer_group",
        "transactions",
        ["transfer_group_id"],
    )
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.drop_index("idx_transactions_transfer_group", table_name="transactions")
    op.drop_column("transactions", "transfer_group_id")
