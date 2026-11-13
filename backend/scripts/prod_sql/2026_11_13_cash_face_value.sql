-- Idempotent prod data repair: cash holdings at face value (1 per unit).
--
-- Flow:
--   1. Back up the database. To keep an undo, first run:
--        SELECT id, symbol, currency, quantity, average_cost, current_price
--          FROM portfolio_holdings
--         WHERE lower(type::text) = 'cash' AND (average_cost <> 1 OR current_price <> 1);
--        SELECT pt.id, pt.price, pt.total_amount FROM portfolio_transactions pt
--          JOIN portfolio_holdings h ON h.id = pt.holding_id
--         WHERE lower(h.type::text) = 'cash' AND pt.type::text IN ('buy', 'sell') AND pt.price <> 1;
--   2. After 2026_11_09_split_cancel_request.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_13_cash_face_value.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_13_cash_face_value.py exactly. Running it
-- twice changes nothing the second time.

UPDATE portfolio_holdings
   SET average_cost = 1, current_price = 1,
       total_cost = quantity, total_value = quantity,
       gain_loss = 0, gain_loss_percentage = 0, updated_at = now()
 WHERE lower(type::text) = 'cash'
   AND (average_cost <> 1 OR current_price <> 1);

UPDATE portfolio_transactions pt
   SET price = 1, total_amount = pt.quantity, updated_at = now()
  FROM portfolio_holdings h
 WHERE h.id = pt.holding_id
   AND lower(h.type::text) = 'cash'
   AND pt.type::text IN ('buy', 'sell')
   AND pt.price <> 1;
