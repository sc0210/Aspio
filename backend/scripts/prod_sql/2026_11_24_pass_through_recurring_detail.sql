-- Idempotent prod change: transactions.pass_through and recurring_transactions.subcategory.
--
-- Flow (`scripts/aspiro update` runs the Alembic migration itself; this is the
-- manual fallback):
--   1. After 2026_11_21_tw_market_valuations.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_24_pass_through_recurring_detail.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_24_pass_through_recurring_detail.py exactly.
-- A second run changes nothing. Existing rows get pass_through = false. No new
-- table, so no RLS.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pass_through BOOLEAN
    NOT NULL DEFAULT false;
ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);
