-- Idempotent prod DDL for security_quotes (shared live quotes, one row per symbol).
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Back up the database.
--   2. Run this file against it, e.g. on the Pi:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_03_security_quotes.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_03_security_quotes.py exactly.

CREATE TABLE IF NOT EXISTS security_quotes (
    symbol          VARCHAR(20) PRIMARY KEY,
    market          VARCHAR(10) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'TWD',
    price           NUMERIC(20, 10) NOT NULL,
    previous_close  NUMERIC(20, 10),
    quote_time      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_quotes_quote_time ON security_quotes (quote_time);

-- Seed from the freshest priced lot of each symbol, so freshness carries over.
-- Holdings no feed prices (cash, crypto, lending) have no quote.
INSERT INTO security_quotes (symbol, market, currency, price, previous_close, quote_time)
SELECT DISTINCT ON (symbol) symbol, market, currency, current_price, previous_close,
       last_price_update_at
FROM portfolio_holdings
WHERE is_active AND last_price_update_at IS NOT NULL AND current_price > 0
  AND lower(type::text) NOT IN ('cash', 'crypto', 'cryptocurrency', 'lending')
ORDER BY symbol, last_price_update_at DESC
ON CONFLICT (symbol) DO NOTHING;

-- Row Level Security: shared market data, but still not for direct PostgREST /
-- anon access. The backend connects as superuser and bypasses RLS. Idempotent.
ALTER TABLE security_quotes ENABLE ROW LEVEL SECURITY;
