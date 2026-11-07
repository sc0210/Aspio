-- Idempotent prod DDL: settling up between peers.
--
-- Flow:
--   1. Back up the database.
--   2. Apply 2026_11_07_peer_splits.sql first, then this file:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_07_peer_settlements.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_07_peer_settlements.py exactly.

CREATE TABLE IF NOT EXISTS peer_settlements (
    id            UUID PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES peer_connections(id) ON DELETE CASCADE,
    from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount        NUMERIC(15, 2) NOT NULL,
    currency      VARCHAR(3) NOT NULL DEFAULT 'TWD',
    settled_on    DATE NOT NULL,
    note          VARCHAR(200),
    status        VARCHAR(10) NOT NULL DEFAULT 'proposed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT peer_settlement_positive_amount CHECK (amount > 0),
    CONSTRAINT peer_settlement_two_people CHECK (from_user_id <> to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_peer_settlements_connection ON peer_settlements (connection_id);

ALTER TABLE public.peer_settlements ENABLE ROW LEVEL SECURITY;
