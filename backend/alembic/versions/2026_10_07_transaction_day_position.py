"""A user-set order for transactions inside one day

Revision ID: 2026_10_07_transaction_day_position
Revises: 2026_09_17_holding_price_precision
Create Date: 2026-10-07

Within a day the list sorts by entry order (created_at). That is predictable but
is not the order things happened when a day is back-filled, and rows written in
one go (a transfer's legs, the ~2,350-row 錢跡 import) tie on created_at. Issue
#478 lets the user drag rows into order within a day; `day_position` holds it.

Nullable, no default, no backfill: a day nobody reordered keeps entry order. The
list's sort is transaction_date, day_position NULLS LAST, created_at, id.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_10_07_transaction_day_position.sql on the Pi
manually, then `alembic stamp head`. The deploy's schema gate refuses this code
until that is done.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_10_07_transaction_day_position"
down_revision = "2026_09_17_holding_price_precision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("day_position", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("transactions", "day_position")
