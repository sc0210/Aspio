"""Change default preferred_currency from USD to TWD

Revision ID: 3a8f1d2e9b5c
Revises: f1a7c00bbc4c
Create Date: 2026-06-04

Changes the column-level DEFAULT on users.preferred_currency from 'USD'
to 'TWD'. Existing rows are not touched — only the server-side default
for future INSERT statements is updated.
"""

from alembic import op

revision = "3a8f1d2e9b5c"
down_revision = "f1a7c00bbc4c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ALTER COLUMN preferred_currency SET DEFAULT 'TWD'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE users ALTER COLUMN preferred_currency SET DEFAULT 'USD'"
    )
