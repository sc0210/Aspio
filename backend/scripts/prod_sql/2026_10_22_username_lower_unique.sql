-- Idempotent prod DDL: usernames unique regardless of case (security audit, 2026-10-22).
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow on the host:
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/2026_10_22_username_lower_unique.sql
--   then on the backend: docker exec aspiro-backend alembic stamp head
-- Matches alembic/versions/2026_10_22_username_lower_unique.py.
--
-- Safe to apply before the code ships: the old code never relied on case-only
-- duplicates. Re-running is harmless (IF NOT EXISTS).
--
-- 1. Case-only duplicates. If this returns rows, rename one user of each pair
--    (UPDATE users SET username = ... WHERE id = ...) before step 2, or the
--    index creation fails.
SELECT lower(username) AS handle, array_agg(username) AS spellings, count(*) AS n
FROM users
WHERE username IS NOT NULL
GROUP BY lower(username)
HAVING count(*) > 1;

-- 2. The index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (lower(username));

-- Verify (expect one row):
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'users' AND indexname = 'uq_users_username_lower';
