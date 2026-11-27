-- Idempotent prod DDL: drop user_activity_logs, a write-only event log.
-- Its last writer (PUT /users/me/regional-preferences) logged events nothing
-- read; the preferences themselves stay on the users row. Dropped even with rows.
--
-- Flow:
--   1. Back up the database.
--   2. Run this file against it:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_28_drop_user_activity_logs.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_28_drop_user_activity_logs.py exactly.

DROP TABLE IF EXISTS user_activity_logs;
