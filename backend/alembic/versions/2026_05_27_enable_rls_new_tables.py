"""Enable RLS on tables added after the 2026-05-14 RLS sweep

Revision ID: 2026_05_27_enable_rls_new_tables
Revises: 2026_05_26_add_expense_split_ratio
Create Date: 2026-05-27

Covers tables flagged by the Supabase security linter that were created
after the original RLS sweep (2026_05_14_disable_rls):

  - debt_accounts        (added 2026-05-16)
  - peer_connections     (added 2026-05-23)
  - shared_goals         (recreated 2026-02-21, RLS lost on recreate)
  - line_groups          (added 2026-05-26)
  - line_group_members   (added 2026-05-26)
  - line_user_links      (added 2026-05-26)
  - line_link_tokens     (added 2026-05-26, contains sensitive token column)
  - shared_expenses      (added 2026-05-26)
  - expense_splits       (added 2026-05-26)

All access goes through the FastAPI backend which connects as the postgres
superuser (BYPASSRLS), so NO policy is needed: RLS-on with no policy denies
all direct PostgREST/anon access while the backend bypasses it entirely.

NOTE: this migration originally created a `backend_access` policy
`FOR ALL USING (true) WITH CHECK (true)` *without* a `TO postgres` clause, so it
defaulted to PUBLIC and actually GRANTED anon/authenticated full access via
PostgREST (Supabase lint 0024 / rls_policy_always_true). It now enables RLS and
drops that policy instead of creating it. See migrations/enable_rls_all_tables.sql.
"""
from alembic import op

revision = "2026_05_27_enable_rls_new_tables"
down_revision = "2026_05_26_add_expense_split_ratio"
branch_labels = None
depends_on = None

TABLES = [
    "debt_accounts",
    "peer_connections",
    "shared_goals",
    "line_groups",
    "line_group_members",
    "line_user_links",
    "line_link_tokens",
    "shared_expenses",
    "expense_splits",
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
                -- bypasses RLS. Drop the old permissive PUBLIC policy if present.
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
