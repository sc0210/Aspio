"""Goals reserve Life Wallet cash

Revision ID: 2026_11_14_goal_reservations
Revises: 2026_11_14_portfolio_currency_twd
Create Date: 2026-11-14

A goal used to be a number typed into a form: nothing tied it to money, so the
same NT$100k could count toward a trip and still be spent from Life. Now a goal
reserves Life Wallet cash (goal_contributions.kind = reserve/release; no
transaction, no wallet moves) and an expense can be paid from that reserve
(transactions.goal_id). Life's *available* figure is its balance minus what
goals hold. See app/modules/goals/reservations.py.

  1. Goals are kept in TWD (what they reserve is TWD wallet cash). USD goals are
     converted at the latest stored USD/TWD close; with no rate, or another
     currency, it stops rather than mislabel.
  2. goal_contributions.kind. Existing progress becomes 'legacy': it still
     counts toward the goal but reserves nothing, so no one's available cash
     goes negative on deploy.
  3. transactions.goal_id (FK, SET NULL) + index.

Prod: backend/scripts/prod_sql/2026_11_14_goal_reservations.sql (same SQL).
No new table, so no RLS. Downgrade drops the two columns; the currency
conversion and legacy rows stay.
"""

from alembic import op

revision = "2026_11_14_goal_reservations"
down_revision = "2026_11_14_portfolio_currency_twd"
branch_labels = None
depends_on = None

# One statement per op.execute: asyncpg runs a single statement at a time.
STATEMENTS = [
    """
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM goals
     WHERE upper(currency) <> 'TWD'
       AND (upper(currency) <> 'USD' OR NOT EXISTS (
             SELECT 1 FROM historical_prices
              WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0))
  ) THEN
    RAISE EXCEPTION 'goals in a currency other than TWD and no rate to convert them by. USD: run a historical price sync (it stores TWD=X), then rerun. Any other currency: convert that goal by hand, then rerun';
  END IF;
END $$
    """,
    """

UPDATE goal_milestones m
   SET amount = round(m.amount * fx.rate, 2), updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE m.goal_id IN (SELECT id FROM goals WHERE upper(currency) = 'USD')
    """,
    """

UPDATE goal_contributions c
   SET amount = round(c.amount * fx.rate, 2), updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE c.goal_id IN (SELECT id FROM goals WHERE upper(currency) = 'USD')
    """,
    """

UPDATE goals g
   SET target_amount = round(g.target_amount * fx.rate, 2),
       current_amount = round(g.current_amount * fx.rate, 2),
       currency = 'TWD', updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE upper(g.currency) = 'USD'
    """,
    """

UPDATE goals SET currency = 'TWD', updated_at = now() WHERE currency <> 'TWD'
    """,
    """

-- 2. Contributions get a kind. Every existing row, and the part of a goal's
--    progress that no row explains (typed into the goal form), becomes
--    'legacy': it counts toward the goal but reserves no Life Wallet cash.
--    Runs once: only when the column is being added.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'goal_contributions'
                    AND column_name = 'kind') THEN
    ALTER TABLE goal_contributions ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'legacy';
    ALTER TABLE goal_contributions ALTER COLUMN kind SET DEFAULT 'reserve';
    INSERT INTO goal_contributions
           (id, goal_id, kind, amount, contribution_date, notes, extra_data, created_at, updated_at)
    SELECT gen_random_uuid(), g.id, 'legacy', g.current_amount - coalesce(c.total, 0), now(),
           'Progress recorded before goals reserved cash', '{}'::jsonb, now(), now()
      FROM goals g
      LEFT JOIN (SELECT goal_id, sum(amount) AS total
                   FROM goal_contributions GROUP BY goal_id) c ON c.goal_id = g.id
     WHERE g.current_amount <> coalesce(c.total, 0);
  END IF;
END $$
    """,
    """

-- 3. An expense paid from a goal's reserved cash.
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goals(id) ON DELETE SET NULL
    """,
    """
CREATE INDEX IF NOT EXISTS ix_transactions_goal_id ON transactions (goal_id)
    """,
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_transactions_goal_id")
    op.execute("ALTER TABLE transactions DROP COLUMN IF EXISTS goal_id")
    op.execute("ALTER TABLE goal_contributions DROP COLUMN IF EXISTS kind")
