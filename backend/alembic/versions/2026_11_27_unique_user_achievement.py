"""One row per badge per user

Revision ID: 2026_11_27_unique_user_achievement
Revises: 2026_11_25_demo_dividend_per_share
Create Date: 2026-11-27

award_achievement checked for an existing row and then inserted, with nothing
in the table to stop a second insert. Two requests at once (two tabs, the
achievements page's streak ping beside its badge check) could both award the
same badge and both add its XP. This takes back the XP each duplicate paid,
recomputes those users' levels, keeps the first unlock of each badge, and adds
a unique index so the database refuses the second insert from now on.

shortcut: a level-milestone bonus that only the duplicate XP reached is kept;
that would need the award history replayed, and duplicates are expected to be rare.

Matches backend/scripts/prod_sql/2026_11_27_unique_user_achievement.sql.
"""

from alembic import op

revision = "2026_11_27_unique_user_achievement"
down_revision = "2026_11_25_demo_dividend_per_share"
branch_labels = None
depends_on = None

_STEPS = """
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
"""


def upgrade() -> None:
    for statement in _STEPS.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade() -> None:
    # The removed duplicates and their XP are not restored.
    op.execute("DROP INDEX IF EXISTS uq_user_gamification_achievement")
