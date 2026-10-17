-- Idempotent prod DDL for line_processed_events (LINE webhook dedup).
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Run this file against the Supabase database (SQL editor or psql).
--   2. On the deployed backend, run: alembic stamp head
-- Matches alembic/versions/2026_07_12_line_processed_events.py exactly.

CREATE TABLE IF NOT EXISTS line_processed_events (
    event_id   VARCHAR(100) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_processed_events_created_at
    ON line_processed_events (created_at);

-- New public table → enable RLS (backend connects as the Supabase superuser and
-- bypasses it; this denies direct PostgREST / anon access, matching every other
-- table). Idempotent: re-running when already enabled is a no-op.
ALTER TABLE line_processed_events ENABLE ROW LEVEL SECURITY;
