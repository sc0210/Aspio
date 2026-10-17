-- Idempotent prod DDL for transactions.transfer_group_id.
--
-- Prod schema is NOT migrated by Alembic on deploy. Flow:
--   1. Run this file against the Supabase database (SQL editor or psql).
--   2. On the deployed backend, run: alembic stamp head
-- Matches alembic/versions/2026_07_07_add_transfer_group_id.py exactly.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group
    ON transactions (transfer_group_id);

-- Best-effort backfill: pair up existing transfer legs. Both rows written by
-- create_transfer() always share an identical `notes` string
-- ("Transfer from X to Y"), regardless of any user-provided description —
-- that's the reliable pairing key here. Safe to re-run: only rows still
-- missing transfer_group_id are considered, so a second run is a no-op.
WITH candidates AS (
    SELECT
        a.id AS expense_id,
        b.id AS income_id,
        ABS(EXTRACT(EPOCH FROM (a.created_at - b.created_at))) AS time_diff
    FROM transactions a
    JOIN transactions b
        ON a.user_id = b.user_id
       AND a.amount = b.amount
       AND a.currency = b.currency
       AND a.transaction_date = b.transaction_date
       AND a.notes = b.notes
       AND a.wallet_type <> b.wallet_type
       AND a.type = 'EXPENSE' AND b.type = 'INCOME'
    JOIN transaction_categories ca ON ca.id = a.category_id AND ca.name = 'Transfer'
    JOIN transaction_categories cb ON cb.id = b.category_id AND cb.name = 'Transfer'
    WHERE a.transfer_group_id IS NULL
      AND b.transfer_group_id IS NULL
      AND a.notes ~ '^Transfer from .+ to .+$'
),
best_expense AS (
    SELECT DISTINCT ON (expense_id) expense_id, income_id
    FROM candidates
    ORDER BY expense_id, time_diff ASC
),
best_pair AS (
    SELECT DISTINCT ON (income_id) expense_id, income_id
    FROM best_expense
    ORDER BY income_id, expense_id
)
UPDATE transactions t
SET transfer_group_id = bp.expense_id
FROM best_pair bp
WHERE t.id = bp.expense_id OR t.id = bp.income_id;
