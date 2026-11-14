-- Idempotent prod change: holdings bought with a goal's money.
--
-- Flow:
--   1. After 2026_11_14_goal_reservations.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_15_goal_holdings.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_15_goal_holdings.py exactly. A second run
-- changes nothing. No new table, so no RLS.

ALTER TABLE portfolio_holdings ADD COLUMN IF NOT EXISTS goal_id UUID
    REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_portfolio_holdings_goal_id ON portfolio_holdings (goal_id);
