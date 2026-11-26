-- Idempotent prod change: the demo account's annual dividends, per share.
--
-- Flow (only if not applying via `aspiro update`, which runs the migration itself):
--   1. After 2026_11_24_pass_through_recurring_detail.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_25_demo_dividend_per_share.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_25_demo_dividend_per_share.py exactly. A second
-- run changes nothing: each update matches only the old seeded total. Data only.

UPDATE portfolio_holdings h SET annual_dividend = 1.04
FROM users u
WHERE u.id = h.user_id AND u.email = 'demo@aspiro.dev' AND h.symbol = 'AAPL' AND h.annual_dividend = 10.42;

UPDATE portfolio_holdings h SET annual_dividend = 6.63
FROM users u
WHERE u.id = h.user_id AND u.email = 'demo@aspiro.dev' AND h.symbol = 'VOO' AND h.annual_dividend = 26.78;

UPDATE portfolio_holdings h SET annual_dividend = 16.56
FROM users u
WHERE u.id = h.user_id AND u.email = 'demo@aspiro.dev' AND h.symbol = '2330' AND h.annual_dividend = 1656.00;
