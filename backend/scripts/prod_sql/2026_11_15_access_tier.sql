-- Idempotent prod change: per-account access tier (free / premium).
--
-- Flow:
--   1. After 2026_11_15_goal_shared.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_15_access_tier.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_15_access_tier.py exactly. A second run
-- changes nothing: ADD COLUMN IF NOT EXISTS skips, so rows created since the
-- first run keep their tier. Every account existing at the first run becomes
-- premium; later ones default to free. No new table, so no RLS.

ALTER TABLE users ADD COLUMN IF NOT EXISTS access_tier VARCHAR(16)
    NOT NULL DEFAULT 'premium';
ALTER TABLE users ALTER COLUMN access_tier SET DEFAULT 'free';
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_access_tier;
ALTER TABLE users ADD CONSTRAINT ck_users_access_tier
    CHECK (access_tier IN ('free', 'premium'));
