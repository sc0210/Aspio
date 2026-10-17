-- Idempotent prod DDL: enforce one active default portfolio per user.
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Run this file against the Supabase database (SQL editor or psql).
--   2. On the deployed backend, run: alembic stamp head
-- Matches alembic/versions/2026_07_13_portfolio_single_default.py.
--
-- Background: portfolios had no DB guard on "one default per user" — only
-- non-atomic app code — so concurrent writes/imports could leave a user with
-- two active defaults. get_default_portfolio() then raises MultipleResultsFound
-- and breaks the portfolio page + dashboard trend recompute for that user.

-- 1. Repair: collapse any existing duplicates to a single default per user,
--    keeping the most-recently-updated one. Safe to re-run: once each user has
--    at most one active default, rn > 1 selects nothing and this is a no-op.
--    MUST run before the unique index below (the index fails on duplicates).
WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY user_id
        ORDER BY updated_at DESC, created_at DESC, id
    ) AS rn
    FROM portfolios
    WHERE is_default AND is_active
)
UPDATE portfolios p
SET is_default = false, updated_at = now()
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

-- 2. Prevent recurrence: partial unique index → at most one active default per
--    user. CONCURRENTLY avoids locking the table in prod; IF NOT EXISTS makes
--    it idempotent. (Note: CONCURRENTLY cannot run inside a transaction block,
--    so run this statement on its own — not wrapped in BEGIN/COMMIT.)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_portfolios_one_active_default_per_user
    ON portfolios (user_id)
    WHERE is_default AND is_active;
