-- Idempotent prod DDL: a user-set order for transactions inside one day (#478).
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow on the Pi:
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/2026_10_07_transaction_day_position.sql
--   then on the backend: docker exec aspiro-backend alembic stamp head
-- Matches alembic/versions/2026_10_07_transaction_day_position.py.
--
-- The deploy's schema gate refuses the code that uses this column until the
-- database is stamped at its revision, so apply this first. It is safe to apply
-- BEFORE the code ships: the column is nullable with no default, the old code
-- never selects it, and the gate treats a database ahead of the code as a warning,
-- not a refusal.
--
-- Re-running is harmless (IF NOT EXISTS). No backfill: NULL means "entry order".

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS day_position INTEGER;

-- Verify (expect one row: day_position | integer | YES):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'transactions' AND column_name = 'day_position';
