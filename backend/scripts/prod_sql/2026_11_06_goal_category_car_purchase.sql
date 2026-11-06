-- Idempotent prod DDL: add 'car_purchase' to the goalcategory enum.
--
-- The goal modals offer "Car purchase"; without this value saving such a goal
-- fails with a 500. Flow:
--   1. Back up the database.
--   2. Run this file against it:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_06_goal_category_car_purchase.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_06_goal_category_car_purchase.py exactly.

ALTER TYPE goalcategory ADD VALUE IF NOT EXISTS 'car_purchase';
