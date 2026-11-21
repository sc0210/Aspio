"""Monthly Taiwan market inputs for the dashboard's CAPE

Revision ID: 2026_11_21_tw_market_valuations
Revises: 2026_11_16_shared_goal_sides
Create Date: 2026-11-21

One row per month: the TAIEX and the listed market's P/E on a trading day of
the month (its last, once the month is over), and DGBAS's CPI once published.
Filled by the daily scheduler job sync_tw_market (app/modules/market); the
first run backfills from 2005. Market data, not user data: no user_id.

Prod: backend/scripts/prod_sql/2026_11_21_tw_market_valuations.sql (same SQL).
New table, so RLS is enabled with no policies: only the backend (superuser)
reads it.
"""

from alembic import op

revision = "2026_11_21_tw_market_valuations"
down_revision = "2026_11_16_shared_goal_sides"
branch_labels = None
depends_on = None

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS tw_market_valuations (
        month       DATE PRIMARY KEY,
        as_of       DATE NOT NULL,
        taiex       NUMERIC(12, 2) NOT NULL,
        market_pe   NUMERIC(10, 4) NOT NULL,
        companies   INTEGER NOT NULL,
        cpi         NUMERIC(8, 3),
        is_final    BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "ALTER TABLE tw_market_valuations ENABLE ROW LEVEL SECURITY",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tw_market_valuations")
