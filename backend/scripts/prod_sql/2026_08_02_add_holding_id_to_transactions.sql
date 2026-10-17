-- Idempotent prod DDL for transactions.holding_id.
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Run this file against the Supabase database (SQL editor or psql).
--   2. On the deployed backend, run: alembic stamp head
-- Matches alembic/versions/2026_08_02_add_holding_id_to_transactions.py exactly.
--
-- Why: add_holding writes a Life Wallet expense to pay for a holding, but
-- nothing recorded which holding it paid for. With no link, editing a holding's
-- quantity or cost left the ledger untouched, and deleting a holding left the
-- cash spent with no asset against it.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS holding_id UUID;

-- SET NULL, not CASCADE: if a holding row is ever hard-deleted the money still
-- moved, so the ledger entry must survive with the link dropped.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_holding_id'
    ) THEN
        ALTER TABLE transactions
            ADD CONSTRAINT fk_transactions_holding_id
            FOREIGN KEY (holding_id) REFERENCES portfolio_holdings (id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_holding
    ON transactions (holding_id);

-- Best-effort backfill for purchases made before the column existed.
--
-- add_holding writes the description as:
--     'Buy <SYMBOL> ×<qty> @ <price> <CCY>'
-- so the symbol is recoverable from the text. Pair each such expense to the
-- holding with the same symbol, same user, and the same purchase date. Rows
-- where that is ambiguous (several holdings of one symbol bought the same day)
-- are deliberately left NULL rather than guessed — a wrong link would make a
-- later edit rewrite the wrong ledger entry, which is worse than no link.
--
-- Safe to re-run: only rows still missing holding_id are considered.
WITH matched AS (
    SELECT
        t.id AS txn_id,
        MIN(h.id::text)::uuid AS holding_id,
        COUNT(*) AS candidate_count
    FROM transactions t
    JOIN portfolio_holdings h
        ON h.user_id = t.user_id
       AND t.description LIKE 'Buy ' || h.symbol || ' ×%'
       AND h.purchase_date::date = t.transaction_date
    WHERE t.holding_id IS NULL
      AND t.is_deleted = false
    GROUP BY t.id
)
UPDATE transactions t
SET holding_id = m.holding_id
FROM matched m
WHERE t.id = m.txn_id
  AND m.candidate_count = 1;

-- Report what was left unlinked, so the ambiguity is visible rather than silent.
SELECT
    COUNT(*) FILTER (WHERE holding_id IS NOT NULL) AS linked,
    COUNT(*) FILTER (WHERE holding_id IS NULL)     AS unlinked
FROM transactions
WHERE description LIKE 'Buy %'
  AND is_deleted = false;
