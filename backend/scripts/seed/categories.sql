-- Starter global categories for a fresh install, so the category picker is not empty.
-- Everything else is created on demand (transactions/services.py::_ensure_category_id,
-- and the loans "Loan Payment" category). Loaded only when `alembic upgrade head`
-- bootstraps an EMPTY database (alembic/env.py); it never runs against an existing one.
-- Idempotent by (name, type).

INSERT INTO transaction_categories
  (id, name, name_en, type, color, icon, is_default, is_active, is_system, usage_count, created_at, updated_at)
SELECT gen_random_uuid(), v.name, v.name, v.type::categorytype, v.color, v.icon, true, true, true, 0, now(), now()
FROM (VALUES
  ('Food & Dining',     'EXPENSE', '#F59E0B', 'utensils'),
  ('Transportation',    'EXPENSE', '#3B82F6', 'car'),
  ('Housing',           'EXPENSE', '#8B5CF6', 'home'),
  ('Shopping',          'EXPENSE', '#EC4899', 'shopping-bag'),
  ('Entertainment',     'EXPENSE', '#10B981', 'film'),
  ('Healthcare',        'EXPENSE', '#EF4444', 'heart'),
  ('Others',            'EXPENSE', '#6B7280', 'receipt'),
  ('Salary',            'INCOME',  '#10B981', 'briefcase'),
  ('Investment Return', 'INCOME',  '#3B82F6', 'trending-up'),
  ('Other Income',      'INCOME',  '#6B7280', 'plus-circle')
) AS v(name, type, color, icon)
WHERE NOT EXISTS (
  SELECT 1 FROM transaction_categories c WHERE c.name = v.name AND c.type = v.type::categorytype
);
