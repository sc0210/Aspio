-- Idempotent DATA fix: merge duplicate transaction_categories rows.
--
-- Some category names have two ACTIVE rows — a system/default category plus an
-- accidental user-created copy with the same name+type (e.g. two "Dining"
-- rows). Name-based category lookups (get_by_name) then hit
-- MultipleResultsFound, which the transaction filter endpoints swallowed,
-- silently returning ALL categories. The app code is now robust
-- (get_ids_by_names resolves to every matching id), but the duplicate rows
-- still clutter the category dropdown and split transactions across two ids.
--
-- This merges each duplicate group onto ONE canonical row (preferring the
-- system/default seed category), reassigns every reference, folds usage_count,
-- and deletes the copies.
--
-- Data-only — no schema change, so NO `alembic stamp` is needed. Run against
-- the Supabase DB (SQL editor or psql). Safe to re-run: once merged there are
-- no duplicates left to act on.

BEGIN;

-- Map every duplicate id -> the canonical id to keep, per (lower(name), type)
-- among ACTIVE rows. Canonical preference:
--   system > default > most transactions > oldest > lowest id.
CREATE TEMP TABLE _cat_dup_map ON COMMIT DROP AS
WITH counts AS (
    SELECT
        c.id, c.name, c.type, c.is_system, c.is_default, c.created_at,
        (SELECT count(*) FROM transactions t WHERE t.category_id = c.id) AS txns
    FROM transaction_categories c
    WHERE c.is_active = true
),
ranked AS (
    SELECT
        id,
        first_value(id) OVER w AS canonical_id,
        row_number()    OVER w AS rn
    FROM counts
    WINDOW w AS (
        PARTITION BY lower(name), type
        ORDER BY is_system DESC, is_default DESC, txns DESC, created_at ASC, id ASC
    )
)
SELECT id AS dup_id, canonical_id
FROM ranked
WHERE rn > 1 AND id <> canonical_id;

-- Reassign every reference from duplicate -> canonical.
UPDATE transactions t
   SET category_id = m.canonical_id
  FROM _cat_dup_map m
 WHERE t.category_id = m.dup_id;

UPDATE recurring_transactions r
   SET category_id = m.canonical_id
  FROM _cat_dup_map m
 WHERE r.category_id = m.dup_id;

UPDATE transaction_categories c
   SET parent_id = m.canonical_id
  FROM _cat_dup_map m
 WHERE c.parent_id = m.dup_id;

-- Fold the duplicates' usage_count into the canonical row.
UPDATE transaction_categories c
   SET usage_count = c.usage_count + agg.extra
  FROM (
        SELECT m.canonical_id, sum(d.usage_count) AS extra
          FROM _cat_dup_map m
          JOIN transaction_categories d ON d.id = m.dup_id
         GROUP BY m.canonical_id
       ) agg
 WHERE c.id = agg.canonical_id;

-- Delete the now-unreferenced duplicate rows.
DELETE FROM transaction_categories c
 USING _cat_dup_map m
 WHERE c.id = m.dup_id;

COMMIT;
