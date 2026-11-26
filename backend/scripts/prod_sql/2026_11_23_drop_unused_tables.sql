-- Idempotent prod DDL: drop nine tables no code reads or writes.
--
-- Flow:
--   1. Back up the database.
--   2. Check the row counts: _verify_pending.sql lists each table as 'gone' or
--      its count. This file stops without dropping anything if a table that
--      could hold a user's data (the first six below) still has rows.
--   3. Run this file against it:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_23_drop_unused_tables.sql
--   4. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_23_drop_unused_tables.py exactly.

-- One block, so the row check and the drops succeed or fail together: psql runs
-- statements one by one and would carry on to separate DROPs after an error.
DO $$
DECLARE
    t text;
    has_rows boolean;
BEGIN
    FOREACH t IN ARRAY ARRAY['chat_messages', 'chat_sessions', 'transaction_attachments',
                             'user_data_exports', 'user_security_logs', 'user_preference_history']
    LOOP
        IF to_regclass(t) IS NOT NULL THEN
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;
            IF has_rows THEN
                RAISE EXCEPTION 'Not dropping %: it still has rows. Export or delete them first.', t;
            END IF;
        END IF;
    END LOOP;

    -- chat_messages before chat_sessions (foreign key)
    FOREACH t IN ARRAY ARRAY['chat_messages', 'chat_sessions', 'transaction_attachments',
                             'user_data_exports', 'user_security_logs', 'user_preference_history',
                             'password_reset_tokens', 'notification_templates', 'market_data']
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I', t);
    END LOOP;
    DROP TYPE IF EXISTS market_data_type_enum;
END $$;
