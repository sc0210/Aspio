-- Idempotent prod DDL for daily_wallet_snapshots.
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Run this file against the Supabase database (SQL editor or psql).
--   2. On the deployed backend, run: alembic stamp head
-- Matches alembic/versions/2026_07_04_daily_wallet_snapshots.py exactly.

CREATE TABLE IF NOT EXISTS daily_wallet_snapshots (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    snapshot_date   DATE NOT NULL,
    life_balance    NUMERIC(15, 2) NOT NULL DEFAULT 0,
    portfolio_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    emergency_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    debt_balance    NUMERIC(15, 2) NOT NULL DEFAULT 0,
    net_worth       NUMERIC(15, 2) NOT NULL DEFAULT 0,
    currency        VARCHAR(3) NOT NULL DEFAULT 'TWD',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique per user per day; doubles as the range-read index.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_daily_wallet_snapshots_user_date'
    ) THEN
        ALTER TABLE daily_wallet_snapshots
            ADD CONSTRAINT uq_daily_wallet_snapshots_user_date
            UNIQUE (user_id, snapshot_date);
    END IF;
END $$;

-- Row Level Security: this is per-user data. The FastAPI backend connects as the
-- postgres superuser via the Supabase pooler and bypasses RLS, so backend queries
-- are unaffected; enabling RLS with no policies denies all direct PostgREST / anon
-- access, matching every other user-data table (see migrations/enable_rls_all_tables.sql).
-- Idempotent: re-running when already enabled is a no-op.
ALTER TABLE daily_wallet_snapshots ENABLE ROW LEVEL SECURITY;
