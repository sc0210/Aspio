"""A shared goal is two personal goals: saving records retire

Revision ID: 2026_11_16_shared_goal_sides
Revises: 2026_11_15_access_tier
Create Date: 2026-11-16

A shared goal (peers) counted each side from two places: saving records (typed
amounts holding no cash) plus the partner's linked personal goal, against a
joint target either partner could edit. Now each side is only that partner's
personal goal: its target is their part, its value their amount, and the
shared goal's target and amount are the sums (app/modules/peers/service.py).

Upgrade, for every shared goal that is not cancelled:
  1. each participant without a personal goal for it gets one (savings, TWD,
     the shared title and date). Target: what the old joint target leaves after
     the parts already linked, split between the sides still missing one
     (at least 1.00), so the old total target is kept unless the linked parts
     already exceed it. A part may start past its target: its records count.
  2. each saving record becomes a legacy contribution on its owner's part
     (legacy = progress holding no cash), same day and note, with
     extra_data.saving_record_id; that goal's current_amount is recomputed
     from its rows and it completes if it reached its target.
  3. saving_records and shared_goals.target_amount / requester_amount /
     receiver_amount are dropped.
A removed or pending partnership's shared goal is hidden from both people, so
its sides get a part only when they have records to carry over: no one finds an
empty, unexplained goal, and no typed amount is lost. Records of cancelled
shared goals (nothing sets that status today) go with the table.

Records land on an existing part whatever its category. An emergency-fund part
is worth its Emergency Wallet, not its rows, so records copied onto one stop
counting. Prod cannot hit this: it applies goal_shared in the same update, so no
goal is a part yet when this runs; a dev DB that linked one may.

Downgrade restores the columns (target = sum of the parts' targets) and an
empty saving_records with RLS. The legacy rows stay on the personal goals,
where the old code counts them as each side's linked goal, so the totals hold.

Prod: backend/scripts/prod_sql/2026_11_16_shared_goal_sides.sql (same SQL).
Drops a table, adds none, so no RLS. Take a pg_dump first.
"""

from alembic import op

revision = "2026_11_16_shared_goal_sides"
down_revision = "2026_11_15_access_tier"
branch_labels = None
depends_on = None

# Guarded on the column it drops, so a second run changes nothing.
UPGRADE_SQL = """
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'shared_goals'
             AND column_name = 'target_amount') THEN

    -- 1. A personal goal for each participant of an open shared goal who has none:
    --    on an accepted connection, or with saving records to carry over.
    WITH sides AS (
        SELECT sg.id AS shared_id, sg.title, sg.target_date, sg.target_amount, p.user_id,
               pc.status = 'accepted'
               OR EXISTS (SELECT 1 FROM saving_records r
                          WHERE r.goal_id = sg.id AND r.user_id = p.user_id) AS needed
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
    FROM parts
    WHERE needed;

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
"""

DOWNGRADE_SQL = """
ALTER TABLE shared_goals
    ADD COLUMN IF NOT EXISTS target_amount NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS requester_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS receiver_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
UPDATE shared_goals sg
SET target_amount = GREATEST(COALESCE((SELECT sum(g.target_amount) FROM goals g
                                       WHERE g.shared_goal_id = sg.id
                                         AND g.status <> 'cancelled'), 0), 1)
WHERE target_amount IS NULL;
ALTER TABLE shared_goals ALTER COLUMN target_amount SET NOT NULL;

CREATE TABLE IF NOT EXISTS saving_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES shared_goals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    record_date DATE NOT NULL,
    note VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saving_record_positive_amount CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_saving_records_goal_id ON saving_records (goal_id);
CREATE INDEX IF NOT EXISTS idx_saving_records_user_id ON saving_records (user_id);
ALTER TABLE saving_records ENABLE ROW LEVEL SECURITY;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
