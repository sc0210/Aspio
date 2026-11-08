-- Idempotent prod DDL: change an accepted split with the partner's approval.
--
-- Flow:
--   1. Back up the database.
--   2. After 2026_11_08_peer_prefs_notifications.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_08_peer_split_amendments.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_08_peer_split_amendments.py exactly.

CREATE TABLE IF NOT EXISTS peer_split_amendments (
    id            UUID PRIMARY KEY,
    split_id      UUID NOT NULL REFERENCES peer_splits(id) ON DELETE CASCADE,
    proposed_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount  NUMERIC(15, 2) NOT NULL,
    payer_share   NUMERIC(15, 2) NOT NULL,
    other_share   NUMERIC(15, 2) NOT NULL,
    method        VARCHAR(10) NOT NULL DEFAULT 'equal',
    description   VARCHAR(200) NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'proposed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT peer_split_amendment_positive_total CHECK (total_amount > 0),
    CONSTRAINT peer_split_amendment_shares_non_negative CHECK (payer_share >= 0 AND other_share >= 0),
    CONSTRAINT peer_split_amendment_shares_sum CHECK (payer_share + other_share = total_amount)
);
CREATE INDEX IF NOT EXISTS idx_peer_split_amendments_split ON peer_split_amendments (split_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_peer_split_amendments_open
    ON peer_split_amendments (split_id) WHERE status = 'proposed';

ALTER TABLE public.peer_split_amendments ENABLE ROW LEVEL SECURITY;
