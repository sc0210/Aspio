-- Idempotent prod DDL: ten decimal places on a holding's average cost and price.
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow on the Pi:
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/2026_09_17_holding_price_precision.sql
--   then on the backend: alembic stamp head
-- Matches alembic/versions/2026_09_17_holding_price_precision.py.
--
-- Background: a lending position's cost and current value are now entered as
-- totals and stored per unit (cost / quantity, value / quantity). At
-- NUMERIC(12,4) a cost of 10,000 over 10,688.88 units stored 0.9356 and read
-- back as 10,000.52. Ten places keep the round trip exact to the cent.
--
-- Without this the app still works; totals typed in the holding editor just
-- come back a few cents off.
--
-- Widening NUMERIC loses nothing, and re-running this is harmless: altering a
-- column to the type it already has changes nothing.

ALTER TABLE portfolio_holdings
    ALTER COLUMN average_cost TYPE NUMERIC(20, 10),
    ALTER COLUMN current_price TYPE NUMERIC(20, 10);

-- Verify (expect two rows, numeric_precision 20, numeric_scale 10):
--   SELECT column_name, numeric_precision, numeric_scale
--   FROM information_schema.columns
--   WHERE table_name = 'portfolio_holdings'
--     AND column_name IN ('average_cost', 'current_price');
