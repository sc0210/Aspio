"""Enable RLS with permissive backend policy on tables flagged by Supabase linter

Revision ID: 2026_05_14_disable_rls
Revises: 2026_05_08_add_lending
Create Date: 2026-05-14

Supabase linter requires public-schema tables to have RLS enabled AND at
least one policy. These tables had no policies, causing INFO→ERROR churn.

Fix: enable RLS with NO policy. The postgres superuser our FastAPI backend
connects as bypasses RLS entirely, and RLS-on / no-policy denies all direct
PostgREST/anon access — which is the intent.

NOTE: this migration originally created a permissive `backend_access` policy
(`FOR ALL TO postgres USING (true) WITH CHECK (true)`). Even scoped to postgres
this is the always-true anti-pattern (Supabase lint 0024); it's dropped rather
than created now, matching migrations/enable_rls_all_tables.sql.

DO blocks make each statement safe to run locally where these tables may
not exist.
"""
from alembic import op

revision = "2026_05_14_disable_rls"
down_revision = "2026_05_08_add_lending"
branch_labels = None
depends_on = None

TABLES = [
    "achievement_badges",
    "budget_categories",
    "budgets",
    "cultural_savings_events",
    "family_goal_groups",
    "family_goal_members",
    "gamification_events",
    "shared_goals",
    "user_achievements",
    "user_gamification_profiles",
    "user_streaks",
]


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"""
            DO $$ BEGIN
              IF EXISTS (
                SELECT 1 FROM pg_tables
                WHERE schemaname = 'public' AND tablename = '{table}'
              ) THEN
                ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;
                -- RLS-on / no-policy: deny all direct access; backend (superuser)
                -- bypasses RLS. Drop the old permissive policy if present.
                DROP POLICY IF EXISTS "backend_access" ON public.{table};
              END IF;
            END $$;
        """)


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"""
            DO $$ BEGIN
              IF EXISTS (
                SELECT 1 FROM pg_tables
                WHERE schemaname = 'public' AND tablename = '{table}'
              ) THEN
                DROP POLICY IF EXISTS "backend_access" ON public.{table};
                ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;
              END IF;
            END $$;
        """)
