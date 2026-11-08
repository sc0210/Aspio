-- Idempotent prod DDL: mute split notifications per partner.
--
-- Flow:
--   1. Back up the database.
--   2. After the 2026_11_07_* files, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_08_peer_prefs_notifications.sql
--   3. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_08_peer_prefs_notifications.py exactly.

ALTER TABLE peer_connection_prefs
    ADD COLUMN IF NOT EXISTS split_notifications BOOLEAN NOT NULL DEFAULT true;
