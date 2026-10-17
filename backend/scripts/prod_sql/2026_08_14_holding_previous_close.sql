-- Idempotent prod DDL: store the provider's previous close on each holding.
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Run this file against the Supabase database (SQL editor or psql).
--   2. On the deployed backend, run: alembic stamp head
-- Matches alembic/versions/2026_08_14_holding_previous_close.py.
--
-- Background: the portfolio page's "% today" was derived by looking up the
-- previous session's close in historical_prices. That table is only as complete
-- as the nightly sync, and one missing session silently turns the day change
-- into a multi-day change — 0050 on 2026-08-14 showed +1.14% (against
-- 2026-08-12's 105.20) while public quotes showed -0.28% (against 2026-08-13's
-- 106.70). Both FinLab and Yahoo were missing that ETF's 08-13 daily bar, while
-- the live quote carried the correct previous close all along.
--
-- previous_close is now captured from the same provider quote as current_price,
-- so the two always describe the same session. No backfill is needed or wanted:
-- the column fills in on each holding's next price update, and the read path
-- falls back to the historical lookup until then.

ALTER TABLE portfolio_holdings
    ADD COLUMN IF NOT EXISTS previous_close NUMERIC(12, 4);

-- Verify (expect one row, is_nullable = YES, numeric(12,4)):
--   SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'portfolio_holdings' AND column_name = 'previous_close';
--
-- After the next price-update cron run, expect most active holdings populated:
--   SELECT count(*) FILTER (WHERE previous_close IS NOT NULL) AS filled,
--          count(*) AS total
--   FROM portfolio_holdings WHERE is_active;
