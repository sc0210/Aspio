-- Idempotent prod data change: every portfolio's currency is TWD.
--
-- Flow:
--   1. Back up the database. To keep an undo, first run:
--        SELECT id, currency, total_value, total_cost, total_gain_loss
--          FROM portfolios WHERE upper(currency) <> 'TWD';
--   2. After 2026_11_13_cash_face_value.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_14_portfolio_currency_twd.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_14_portfolio_currency_twd.py exactly. A second
-- run changes nothing: every row is TWD after the first. If it stops with "no rate
-- to convert them by", run a historical price sync first (it stores TWD=X).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM portfolios
     WHERE upper(currency) <> 'TWD'
       AND (total_value <> 0 OR total_cost <> 0 OR total_gain_loss <> 0)
       AND (upper(currency) <> 'USD' OR NOT EXISTS (
             SELECT 1 FROM historical_prices
              WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0))
  ) THEN
    RAISE EXCEPTION 'portfolio totals to convert but no rate to convert them by: run a historical price sync (it stores TWD=X), then rerun';
  END IF;
END $$;

UPDATE portfolios p
   SET total_value = round(p.total_value * fx.rate, 2),
       total_cost = round(p.total_cost * fx.rate, 2),
       total_gain_loss = round(p.total_gain_loss * fx.rate, 2),
       currency = 'TWD', updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE upper(p.currency) = 'USD';

-- What is left has nothing to convert (the guard above saw to that): relabel.
UPDATE portfolios SET currency = 'TWD', updated_at = now() WHERE upper(currency) <> 'TWD';
