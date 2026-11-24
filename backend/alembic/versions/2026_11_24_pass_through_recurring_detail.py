"""Pass-through money on transactions; a detail on recurring rules

Revision ID: 2026_11_24_pass_through_recurring_detail
Revises: 2026_11_24_drop_line_bot_activities
Create Date: 2026-11-24

transactions.pass_through marks money that passed through the user rather than
being theirs to spend or earn (a deposit, something bought for a friend, a bill
paid for family, and what comes back). It still moves the wallet; the spending
and earning figures leave it out. Every existing row is false.

recurring_transactions.subcategory is the detail (Subscriptions, Fuel...) each
occurrence of a repeating bill is recorded with, as transaction.subcategory is.

Prod: backend/scripts/prod_sql/2026_11_24_pass_through_recurring_detail.sql
(same SQL). No new table, so no RLS. Downgrade drops both columns.
"""

from alembic import op

revision = "2026_11_24_pass_through_recurring_detail"
down_revision = "2026_11_24_drop_line_bot_activities"
branch_labels = None
depends_on = None

STATEMENTS = [
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pass_through BOOLEAN "
    "NOT NULL DEFAULT false",
    "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100)",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("ALTER TABLE recurring_transactions DROP COLUMN IF EXISTS subcategory")
    op.execute("ALTER TABLE transactions DROP COLUMN IF EXISTS pass_through")
