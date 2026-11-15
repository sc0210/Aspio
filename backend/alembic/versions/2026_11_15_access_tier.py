"""Per-account access tier: free or premium

Revision ID: 2026_11_15_access_tier
Revises: 2026_11_15_goal_shared
Create Date: 2026-11-15

A super admin assigns each account a tier; premium adds Loans, Savings/peers,
web LINE groups, Housing and Lifecycle (users/dependencies.py require_premium).
Every account that exists now becomes premium, so nobody loses a page on
deploy; accounts created afterwards start free.

Plain VARCHAR with a CHECK rather than a Postgres enum: the value stored is the
lowercase string the code compares against, with no name/value split to drift.

Prod: backend/scripts/prod_sql/2026_11_15_access_tier.sql (same SQL). No new
table, so no RLS. Downgrade drops the constraint and the column.
"""

from alembic import op

revision = "2026_11_15_access_tier"
down_revision = "2026_11_15_goal_shared"
branch_labels = None
depends_on = None

STATEMENTS = [
    # Added with a premium default so every existing row is filled as premium...
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS access_tier VARCHAR(16) "
    "NOT NULL DEFAULT 'premium'",
    # ...then new rows default to free.
    "ALTER TABLE users ALTER COLUMN access_tier SET DEFAULT 'free'",
    "ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_access_tier",
    "ALTER TABLE users ADD CONSTRAINT ck_users_access_tier "
    "CHECK (access_tier IN ('free', 'premium'))",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_access_tier")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS access_tier")
