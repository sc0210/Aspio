"""Usernames unique regardless of case

Revision ID: 2026_10_22_username_lower_unique
Revises: 2026_10_07_transaction_day_position
Create Date: 2026-10-22

Peer search and invites resolve a handle case-insensitively, but uniqueness was
only enforced on the exact string, so 'alice' could coexist with 'Alice' and an
invite to one could reach the other. A unique index on lower(username) makes the
namespace match the lookup. The upgrade refuses to run while case-only
duplicates exist; rename one of each pair first (the query is in the prod SQL).

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_10_22_username_lower_unique.sql on the host
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_10_22_username_lower_unique"
down_revision = "2026_10_07_transaction_day_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    dupes = op.get_bind().execute(
        sa.text(
            "SELECT lower(username) FROM users WHERE username IS NOT NULL "
            "GROUP BY lower(username) HAVING count(*) > 1"
        )
    ).fetchall()
    if dupes:
        raise RuntimeError(
            f"{len(dupes)} username(s) differ only by case; rename one of each pair "
            "before applying uq_users_username_lower"
        )
    op.create_index(
        "uq_users_username_lower", "users", [sa.text("lower(username)")], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_users_username_lower", table_name="users")
