-- Idempotent prod DDL: drop line_bot_activities, the LINE bot's command log.
-- Nothing reads or writes it any more. It held command history, not records,
-- so it is dropped even with rows.
--
-- Flow:
--   1. Back up the database.
--   2. Run this file against it:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_24_drop_line_bot_activities.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_24_drop_line_bot_activities.py exactly.

DROP TABLE IF EXISTS line_bot_activities;
