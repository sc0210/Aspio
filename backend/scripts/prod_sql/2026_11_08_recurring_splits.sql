-- Idempotent prod DDL: repeating bills split with a partner.
--
-- Flow:
--   1. Back up the database.
--   2. After 2026_11_08_peer_split_amendments.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_08_recurring_splits.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_08_recurring_splits.py exactly.

ALTER TABLE recurring_transactions
    ADD COLUMN IF NOT EXISTS split_connection_id UUID REFERENCES peer_connections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS split_method VARCHAR(10),
    ADD COLUMN IF NOT EXISTS split_my_percent NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS split_my_amount NUMERIC(15, 2);
