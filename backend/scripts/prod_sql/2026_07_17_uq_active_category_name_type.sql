-- Idempotent DDL: partial unique index preventing duplicate ACTIVE categories.
--
-- Enforces uniqueness on (lower(name), type) among active rows only, so a
-- name+type can never again have two active category rows (soft-deleted rows
-- may still share a name). Backstops the app-level guard in
-- TransactionCategoryRepository.create.
--
-- Matches alembic/versions/2026_07_17_uq_active_category_name_type.py.
--
-- Prod flow (schema is NOT migrated on deploy):
--   1. FIRST run 2026_07_17_dedupe_duplicate_categories.sql (index creation
--      fails while duplicates still exist).
--   2. Run this file against the Supabase database.
--   3. On the deployed backend: alembic stamp head
-- Safe to re-run (IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_category_name_type
    ON transaction_categories (lower(name), type)
    WHERE is_active;
