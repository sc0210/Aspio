"""Holdings bought with a goal's money

Revision ID: 2026_11_15_goal_holdings
Revises: 2026_11_14_goal_reservations
Create Date: 2026-11-15

A goal reserves Life Wallet cash (2026_11_14_goal_reservations). This lets that
cash be invested: portfolio_holdings.goal_id names the goal whose reserve paid
for the lot. Its buy leg and any sale proceeds carry the same goal_id, so buying
moves the goal's money from reserved cash into the holding and selling moves it
back, with no change to Life's available cash. See
app/modules/goals/reservations.py.

Prod: backend/scripts/prod_sql/2026_11_15_goal_holdings.sql (same SQL). No new
table, so no RLS. Downgrade drops the column; the legs keep their goal_id.
"""

from alembic import op

revision = "2026_11_15_goal_holdings"
down_revision = "2026_11_14_goal_reservations"
branch_labels = None
depends_on = None

STATEMENTS = [
    "ALTER TABLE portfolio_holdings ADD COLUMN IF NOT EXISTS goal_id UUID "
    "REFERENCES goals(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS ix_portfolio_holdings_goal_id ON portfolio_holdings (goal_id)",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_portfolio_holdings_goal_id")
    op.execute("ALTER TABLE portfolio_holdings DROP COLUMN IF EXISTS goal_id")
