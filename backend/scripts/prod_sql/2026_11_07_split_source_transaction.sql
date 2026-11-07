-- Idempotent prod DDL: splitting an existing expense.
--
-- Flow:
--   1. Back up the database.
--   2. Apply 2026_11_07_peer_splits.sql and 2026_11_07_peer_settlements.sql first, then:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_07_split_source_transaction.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_07_split_source_transaction.py exactly.

ALTER TABLE peer_splits
    ADD COLUMN IF NOT EXISTS source_transaction_id UUID
    REFERENCES transactions(id) ON DELETE SET NULL;
