"""Demo holdings' annual dividend per share

Revision ID: 2026_11_25_demo_dividend_per_share
Revises: 2026_11_24_pass_through_recurring_detail
Create Date: 2026-11-25

`annual_dividend` is per share: get_dividend_data multiplies it by quantity.
The demo seed stored each holding's yearly total instead (AAPL 10.42 for 10
shares), so the demo account's projected income came out quantity times too
high. The seed now stores per-share values, but it skips an account that is
already seeded, so this fixes those rows. Only the demo account's seeded rows
still holding the old totals change. Data only: no new table, so no RLS.

Matches backend/scripts/prod_sql/2026_11_25_demo_dividend_per_share.sql.
"""

from alembic import op

revision = "2026_11_25_demo_dividend_per_share"
down_revision = "2026_11_24_pass_through_recurring_detail"
branch_labels = None
depends_on = None

# (symbol, seeded yearly total, per share)
_ROWS = (("AAPL", "10.42", "1.04"), ("VOO", "26.78", "6.63"), ("2330", "1656.00", "16.56"))


def _set(old_index: int, new_index: int) -> None:
    for row in _ROWS:
        op.execute(
            f"""
            UPDATE portfolio_holdings h SET annual_dividend = {row[new_index]}
            FROM users u
            WHERE u.id = h.user_id AND u.email = 'demo@aspiro.dev'
              AND h.symbol = '{row[0]}' AND h.annual_dividend = {row[old_index]}
            """
        )


def upgrade() -> None:
    _set(1, 2)


def downgrade() -> None:
    _set(2, 1)
