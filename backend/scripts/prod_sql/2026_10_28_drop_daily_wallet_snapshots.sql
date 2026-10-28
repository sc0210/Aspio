-- Idempotent prod DDL: drop the unused daily_wallet_snapshots table (2026-10-28).
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow on the host:
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/2026_10_28_drop_daily_wallet_snapshots.sql
--   then on the backend: docker exec aspiro-backend alembic stamp head
-- Matches alembic/versions/2026_10_28_drop_daily_wallet_snapshots.py.
--
-- Nothing reads or writes this table: the dashboard computes trends live, and the
-- nightly snapshot job was removed with the fast path. Its rows are derived data,
-- recomputable from transactions and holdings, so nothing is lost. Take a
-- `scripts/aspiro backup` first anyway: a DROP cannot be undone.
--
-- Safe to apply before or after the code ships: neither version touches the
-- table. Re-running is harmless (IF EXISTS).
--
-- 1. What is about to go (informational; silent once the table is gone).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.daily_wallet_snapshots') IS NOT NULL THEN
    SELECT count(*) AS n, min(snapshot_date) AS first_day, max(snapshot_date) AS last_day
      INTO r FROM daily_wallet_snapshots;
    RAISE NOTICE 'dropping daily_wallet_snapshots: % rows, % .. %', r.n, r.first_day, r.last_day;
  END IF;
END $$;

-- 2. The drop.
DROP TABLE IF EXISTS daily_wallet_snapshots;

-- Verify (expect zero rows):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'daily_wallet_snapshots';
