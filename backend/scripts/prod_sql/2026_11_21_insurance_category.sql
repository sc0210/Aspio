-- Idempotent prod change: the Insurance (保險) expense category.
--
-- Flow (only if not applying via `aspiro update`, which runs the migration itself):
--   1. After 2026_11_16_shared_goal_sides.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_21_insurance_category.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_21_insurance_category.py exactly. A second run
-- changes nothing. Data only: no new table, so no RLS.

INSERT INTO transaction_categories
  (id, name, name_en, name_zh, type, color, icon,
   is_default, is_active, is_system, usage_count, created_at, updated_at)
SELECT gen_random_uuid(), 'Insurance', 'Insurance', '保險', 'EXPENSE'::categorytype,
       '#A29BFE', 'shield', true, true, true, 0, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM transaction_categories
  WHERE name = 'Insurance' AND type = 'EXPENSE'::categorytype
);
