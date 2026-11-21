-- Idempotent prod change: monthly Taiwan market inputs for the dashboard's CAPE.
--
-- Flow:
--   1. After 2026_11_16_shared_goal_sides.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_21_tw_market_valuations.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_21_tw_market_valuations.py exactly. A second
-- run changes nothing. New table, so RLS is on (no policies: backend only).
--
-- The table starts empty; the daily job sync_tw_market (08:30 UTC) backfills it
-- from 2005 on its first run, about an hour of paced TWSE requests. To fill it
-- now instead: docker exec aspiro-backend python scripts/run_tw_market_sync.py

CREATE TABLE IF NOT EXISTS tw_market_valuations (
    month       DATE PRIMARY KEY,
    as_of       DATE NOT NULL,
    taiex       NUMERIC(12, 2) NOT NULL,
    market_pe   NUMERIC(10, 4) NOT NULL,
    companies   INTEGER NOT NULL,
    cpi         NUMERIC(8, 3),
    is_final    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tw_market_valuations ENABLE ROW LEVEL SECURITY;
