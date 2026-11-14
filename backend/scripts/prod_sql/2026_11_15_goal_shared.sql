-- Idempotent prod change: a partner's own goal backs their side of a shared goal.
--
-- Flow:
--   1. After 2026_11_15_goal_holdings.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_15_goal_shared.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_15_goal_shared.py exactly. A second run
-- changes nothing. No new table, so no RLS.

ALTER TABLE goals ADD COLUMN IF NOT EXISTS shared_goal_id UUID
    REFERENCES shared_goals(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_user_shared_goal
    ON goals (user_id, shared_goal_id) WHERE shared_goal_id IS NOT NULL;
