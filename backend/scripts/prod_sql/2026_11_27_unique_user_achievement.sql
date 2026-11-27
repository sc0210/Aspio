-- Idempotent prod change: one row per badge per user.
--
-- Flow (only if not applying via `aspiro update`, which runs the migration itself):
--   1. After 2026_11_25_demo_dividend_per_share.sql, run:
--        docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -f - \
--          < backend/scripts/prod_sql/2026_11_27_unique_user_achievement.sql
--   2. On the backend: alembic stamp head
-- Matches alembic/versions/2026_11_27_unique_user_achievement.py exactly. A second
-- run changes nothing: once the duplicates are gone, steps 1 and 2 match no rows
-- and the index already exists. No new table, so no RLS.

BEGIN;

-- 1. Take back the XP each duplicate paid, and recompute the level from it
--    (level_for_experience: 1 below 100 XP, else floor(sqrt(xp / 50)), max 100).
WITH ranked AS (
    SELECT user_id, points_awarded,
           row_number() OVER (PARTITION BY user_id, achievement_type ORDER BY unlocked_at, id) AS rn
    FROM user_gamification_achievements
), extra AS (
    SELECT user_id, sum(points_awarded) AS pts FROM ranked WHERE rn > 1 GROUP BY user_id
)
UPDATE users u
SET experience_points = GREATEST(0, u.experience_points - extra.pts),
    level = CASE WHEN GREATEST(0, u.experience_points - extra.pts) < 100 THEN 1
                 ELSE LEAST(100, GREATEST(1, floor(sqrt(GREATEST(0, u.experience_points - extra.pts) / 50.0))::int))
            END
FROM extra
WHERE u.id = extra.user_id;

-- 2. Keep the first unlock of each badge, delete the rest.
DELETE FROM user_gamification_achievements a
USING (
    SELECT id, row_number() OVER (PARTITION BY user_id, achievement_type ORDER BY unlocked_at, id) AS rn
    FROM user_gamification_achievements
) r
WHERE a.id = r.id AND r.rn > 1;

-- 3. One row per badge per user from now on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_gamification_achievement
    ON user_gamification_achievements (user_id, achievement_type);

COMMIT;
