-- Idempotent prod change: a shared goal is two personal goals; saving records retire.
--
-- Flow:
--   0. pg_dump first: this drops saving_records (copied into goal_contributions first).
--   1. After 2026_11_15_goal_shared.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_16_shared_goal_sides.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_16_shared_goal_sides.py exactly (its docstring
-- explains each step). Guarded on shared_goals.target_amount, so a second run
-- changes nothing. Drops a table, adds none: no RLS.
--
-- Before running, what will move (expect the same counts after, as legacy rows):
--   SELECT count(*), sum(amount) FROM saving_records;
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'shared_goals'
             AND column_name = 'target_amount') THEN

    -- 1. A personal goal for each participant of an open shared goal who has none.
    WITH sides AS (
        SELECT sg.id AS shared_id, sg.title, sg.target_date, sg.target_amount, p.user_id
        FROM shared_goals sg
        JOIN peer_connections pc ON pc.id = sg.connection_id
        CROSS JOIN LATERAL (VALUES (pc.requester_id), (pc.receiver_id)) AS p(user_id)
        WHERE sg.status <> 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM goals g
                          WHERE g.shared_goal_id = sg.id AND g.user_id = p.user_id)
    ), parts AS (
        SELECT s.*,
               (s.target_amount - COALESCE((SELECT sum(g.target_amount) FROM goals g
                                            WHERE g.shared_goal_id = s.shared_id
                                              AND g.status <> 'cancelled'), 0))
               / count(*) OVER (PARTITION BY s.shared_id) AS share
        FROM sides s
    )
    INSERT INTO goals (id, user_id, title, description, category, priority, status,
                       target_amount, current_amount, currency, target_date, started_at,
                       extra_data, created_at, updated_at, shared_goal_id)
    SELECT gen_random_uuid(), user_id, title, 'My part of a shared goal',
           'savings', 'medium', 'active',
           round(GREATEST(share, 1), 2), 0, 'TWD', target_date::timestamptz, now(),
           '{"made_for_shared_goal": true}'::jsonb, now(), now(), shared_id
    FROM parts;

    -- 2. Each saving record becomes legacy progress on its owner's part.
    INSERT INTO goal_contributions (id, goal_id, kind, amount, contribution_date, notes,
                                    extra_data, created_at, updated_at)
    SELECT gen_random_uuid(), g.id, 'legacy', r.amount, r.record_date::timestamptz, r.note,
           jsonb_build_object('saving_record_id', r.id), r.created_at, now()
    FROM saving_records r
    JOIN goals g ON g.shared_goal_id = r.goal_id AND g.user_id = r.user_id;

    UPDATE goals g
    SET current_amount = c.total, updated_at = now()
    FROM (SELECT goal_id, sum(amount) AS total FROM goal_contributions GROUP BY goal_id) c
    WHERE c.goal_id = g.id
      AND EXISTS (SELECT 1 FROM goal_contributions m
                  WHERE m.goal_id = g.id AND m.extra_data ? 'saving_record_id');

    UPDATE goals g
    SET status = 'completed', completed_at = now()
    WHERE g.status = 'active' AND g.category <> 'emergency_fund'
      AND g.current_amount >= g.target_amount
      AND EXISTS (SELECT 1 FROM goal_contributions m
                  WHERE m.goal_id = g.id AND m.extra_data ? 'saving_record_id');

    -- 3. Records and the stored target and totals go.
    DROP TABLE IF EXISTS saving_records;
    ALTER TABLE shared_goals
        DROP COLUMN target_amount,
        DROP COLUMN IF EXISTS requester_amount,
        DROP COLUMN IF EXISTS receiver_amount;
END IF;
END $$;
