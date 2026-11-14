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
-- run changes nothing: every row is TWD after the first.

UPDATE portfolios p
   SET total_value = round(p.total_value * fx.rate, 2),
       total_cost = round(p.total_cost * fx.rate, 2),
       total_gain_loss = round(p.total_gain_loss * fx.rate, 2),
       currency = 'TWD', updated_at = now()
  FROM (SELECT close AS rate FROM historical_prices
         WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
         ORDER BY date DESC LIMIT 1) fx
 WHERE upper(p.currency) = 'USD';

-- Any other currency, or USD with no stored rate: relabel; the totals are
-- recomputed in TWD on the next price refresh (_update_portfolio_totals).
UPDATE portfolios SET currency = 'TWD', updated_at = now() WHERE upper(currency) <> 'TWD';
