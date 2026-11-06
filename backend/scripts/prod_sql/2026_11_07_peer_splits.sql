-- Idempotent prod DDL: bill splitting between peers.
--
-- Flow:
--   1. Back up the database.
--   2. Run this file:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_07_peer_splits.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_07_peer_splits.py exactly.

CREATE TABLE IF NOT EXISTS peer_connection_prefs (
    connection_id UUID NOT NULL REFERENCES peer_connections(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    split_policy  VARCHAR(16) NOT NULL DEFAULT 'approve_each',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (connection_id, user_id)
);

CREATE TABLE IF NOT EXISTS peer_splits (
    id            UUID PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES peer_connections(id) ON DELETE CASCADE,
    created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payer_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description   VARCHAR(200) NOT NULL,
    total_amount  NUMERIC(15, 2) NOT NULL,
    currency      VARCHAR(3) NOT NULL DEFAULT 'TWD',
    category_id   UUID REFERENCES transaction_categories(id) ON DELETE SET NULL,
    split_date    DATE NOT NULL,
    method        VARCHAR(10) NOT NULL DEFAULT 'equal',
    status        VARCHAR(10) NOT NULL DEFAULT 'proposed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT peer_split_positive_total CHECK (total_amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_peer_splits_connection ON peer_splits (connection_id);

CREATE TABLE IF NOT EXISTS peer_split_shares (
    id           UUID PRIMARY KEY,
    split_id     UUID NOT NULL REFERENCES peer_splits(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_amount NUMERIC(15, 2) NOT NULL,
    status       VARCHAR(10) NOT NULL DEFAULT 'proposed',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT peer_split_share_once_per_user UNIQUE (split_id, user_id),
    CONSTRAINT peer_split_share_non_negative CHECK (share_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_peer_split_shares_user ON peer_split_shares (user_id);

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS peer_split_share_id UUID
    REFERENCES peer_split_shares(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_peer_split_share ON transactions (peer_split_share_id);

ALTER TABLE public.peer_connection_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_splits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_split_shares     ENABLE ROW LEVEL SECURITY;
