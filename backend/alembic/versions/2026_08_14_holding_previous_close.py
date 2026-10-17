"""Store the provider's previous close on each holding

Revision ID: 2026_08_14_holding_previous_close
Revises: 2026_07_23_merge_uiux_heads
Create Date: 2026-08-14

The portfolio page's "% today" was derived by looking up the previous session's
close in `historical_prices`. That table is only as complete as the nightly
sync, and a single missing session silently turns the day change into a
multi-day one — 0050 on 2026-08-14 showed +1.14% (measured against 2026-08-12's
105.20) while public quotes showed -0.28% (against 2026-08-13's 106.70). Both
FinLab and Yahoo were missing that ETF's 08-13 daily bar, yet the *live quote*
carried the correct previous close the whole time.

This adds `portfolio_holdings.previous_close`, captured from the same provider
quote as `current_price` so the two always describe the same session. The
historical lookup stays as a fallback for holdings not yet repriced.

Nullable with no backfill: the column fills in on each holding's next price
update, and the read path falls back to the historical lookup until then.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_08_14_holding_previous_close.sql on Supabase
manually, then `alembic stamp head`.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_08_14_holding_previous_close"
down_revision = "2026_07_23_merge_uiux_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "portfolio_holdings",
        sa.Column("previous_close", sa.Numeric(12, 4), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("portfolio_holdings", "previous_close")
