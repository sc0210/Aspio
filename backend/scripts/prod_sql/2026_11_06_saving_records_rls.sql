-- Idempotent prod DDL: enable RLS on saving_records (RLS-on / no-policy).
--
-- The backend connects as superuser and bypasses RLS; this only denies direct
-- access through the Supabase/PostgREST roles. Flow:
--   1. Run this file:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_06_saving_records_rls.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_06_saving_records_rls.py exactly.

ALTER TABLE IF EXISTS public.saving_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backend_access" ON public.saving_records;
