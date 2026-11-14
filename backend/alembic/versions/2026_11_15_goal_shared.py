"""A partner's own goal backs their side of a shared goal

Revision ID: 2026_11_15_goal_shared
Revises: 2026_11_15_goal_holdings
Create Date: 2026-11-15

A shared goal (peers) counted each partner's side from saving records, claims
that hold no cash. Now each partner can link one personal goal to it
(goals.shared_goal_id): that goal reserves their own Life cash, can be spent or
invested like any goal, and its value counts toward their side. Saving records
still count, as tracked progress. See app/modules/peers/service.py.

Prod: backend/scripts/prod_sql/2026_11_15_goal_shared.sql (same SQL). No new
table, so no RLS. Downgrade drops the index and the column.
"""

from alembic import op

revision = "2026_11_15_goal_shared"
down_revision = "2026_11_15_goal_holdings"
branch_labels = None
depends_on = None

STATEMENTS = [
    "ALTER TABLE goals ADD COLUMN IF NOT EXISTS shared_goal_id UUID "
    "REFERENCES shared_goals(id) ON DELETE SET NULL",
    # One linked goal per partner per shared goal; a cancelled goal is unlinked.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_user_shared_goal "
    "ON goals (user_id, shared_goal_id) WHERE shared_goal_id IS NOT NULL",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_goals_user_shared_goal")
    op.execute("ALTER TABLE goals DROP COLUMN IF EXISTS shared_goal_id")
