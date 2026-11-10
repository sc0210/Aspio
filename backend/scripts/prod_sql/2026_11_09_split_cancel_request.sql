-- Idempotent prod DDL: the non-payer asks the payer to cancel a split.
--
-- Flow:
--   1. Back up the database.
--   2. After 2026_11_08_recurring_splits.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_09_split_cancel_request.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_09_split_cancel_request.py exactly.

ALTER TABLE peer_split_amendments
    ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'change';
