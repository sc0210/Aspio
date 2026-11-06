"""Enable RLS on saving_records

Revision ID: 2026_11_06_saving_records_rls
Revises: 2026_11_06_drop_system_alerts
Create Date: 2026-11-06

saving_records (2026-06-04) postdates the RLS migration (2026-05-27), so only
the manual scripts/enable_rls_all_tables.sql covered it; a database built by
`aspiro setup` (Alembic) had it off. RLS-on / no-policy, like every other table:
the backend connects as superuser and bypasses it.
"""

from alembic import op

revision = "2026_11_06_saving_records_rls"
down_revision = "2026_11_06_drop_system_alerts"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'saving_records'
            ) THEN
                ALTER TABLE public.saving_records ENABLE ROW LEVEL SECURITY;
                DROP POLICY IF EXISTS "backend_access" ON public.saving_records;
            END IF;
        END $$;
    """)


def downgrade():
    op.execute("ALTER TABLE IF EXISTS public.saving_records DISABLE ROW LEVEL SECURITY")
