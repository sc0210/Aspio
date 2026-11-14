-- Idempotent prod change: goals reserve Life Wallet cash.
--
-- Flow:
--   1. Back up the database. To keep an undo of the currency step, first run:
--        SELECT id, currency, target_amount, current_amount
--          FROM goals WHERE upper(currency) <> 'TWD';
--   2. After 2026_11_14_portfolio_currency_twd.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_14_goal_reservations.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_14_goal_reservations.py exactly. A second run
-- changes nothing. No new table, so no RLS.

-- 1. Goals are kept in TWD. A USD goal is converted at the latest stored
--    USD/TWD close, with its milestones and contributions; with no rate, or in
--    any other currency, this stops rather than relabel dollars as TWD.
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
END $$;

UPDATE goal_milestones m
   SET amount = round(m.amount * fx.rate, 2), updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE m.goal_id IN (SELECT id FROM goals WHERE upper(currency) = 'USD');

UPDATE goal_contributions c
   SET amount = round(c.amount * fx.rate, 2), updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE c.goal_id IN (SELECT id FROM goals WHERE upper(currency) = 'USD');

UPDATE goals g
   SET target_amount = round(g.target_amount * fx.rate, 2),
       current_amount = round(g.current_amount * fx.rate, 2),
       currency = 'TWD', updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE upper(g.currency) = 'USD';

UPDATE goals SET currency = 'TWD', updated_at = now() WHERE currency <> 'TWD';

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
END $$;

-- 3. An expense paid from a goal's reserved cash.
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_transactions_goal_id ON transactions (goal_id);
