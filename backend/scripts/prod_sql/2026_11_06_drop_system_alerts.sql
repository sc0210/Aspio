-- Idempotent prod DDL: drop the unused system_alerts table (no model, no reader).
--
-- Flow:
--   1. Back up the database.
--   2. Run this file against it:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_06_drop_system_alerts.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_06_drop_system_alerts.py exactly.

DROP TABLE IF EXISTS system_alerts;
