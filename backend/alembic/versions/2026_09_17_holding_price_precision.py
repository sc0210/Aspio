"""Ten decimal places on a holding's average cost and current price

Revision ID: 2026_09_17_holding_price_precision
Revises: 2026_08_26_canonical_symbols
Create Date: 2026-09-17

A lending position (USDT-LEND) had no way to record interest: its price is
never fetched, and nothing let the user set it or type a total cost. The fix
lets both be entered as totals, stored as per-unit figures, cost / quantity and
value / quantity. At NUMERIC(12,4) those round badly: a cost of 10,000 over
10,688.88 units stores 0.9356 and reads back as 10,000.52. Ten places keep the
round trip exact to the cent for any realistic quantity.

Widening NUMERIC loses nothing and needs no backfill. Existing values keep
their four places until the next edit.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_09_17_holding_price_precision.sql on the Pi
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_09_17_holding_price_precision"
down_revision = "2026_08_26_canonical_symbols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in ("average_cost", "current_price"):
        op.alter_column(
            "portfolio_holdings",
            column,
            type_=sa.Numeric(20, 10),
            existing_type=sa.Numeric(12, 4),
            existing_nullable=False,
        )


def downgrade() -> None:
    for column in ("average_cost", "current_price"):
        op.alter_column(
            "portfolio_holdings",
            column,
            type_=sa.Numeric(12, 4),
            existing_type=sa.Numeric(20, 10),
            existing_nullable=False,
        )
