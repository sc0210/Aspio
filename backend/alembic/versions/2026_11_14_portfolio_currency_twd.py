"""Every portfolio's currency is TWD

Revision ID: 2026_11_14_portfolio_currency_twd
Revises: 2026_11_13_cash_face_value
Create Date: 2026-11-14

Portfolios were created with currency "USD" by default, but every page shows
TWD. Anything converting into portfolio.currency was quietly in dollars: the
dashboard P&L calendar read "+519" for a ~NT$16k day. New portfolios now default
to TWD; this moves the existing ones. Stored totals (read by the LINE bot and
rebalancing) are converted at the latest stored USD/TWD close; a portfolio with
no rate to use is relabelled and recomputed on its next price refresh.
Data only: no schema change, no RLS. Downgrade does nothing: the original
labels were defaults, not choices.
"""

from alembic import op

revision = "2026_11_14_portfolio_currency_twd"
down_revision = "2026_11_13_cash_face_value"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE portfolios p
           SET total_value = round(p.total_value * fx.rate, 2),
               total_cost = round(p.total_cost * fx.rate, 2),
               total_gain_loss = round(p.total_gain_loss * fx.rate, 2),
               currency = 'TWD', updated_at = now()
          FROM (SELECT close AS rate FROM historical_prices
                 WHERE market = 'FX' AND symbol = 'TWD=X' AND close > 0
                 ORDER BY date DESC LIMIT 1) fx
         WHERE upper(p.currency) = 'USD';
        """
    )
    op.execute(
        "UPDATE portfolios SET currency = 'TWD', updated_at = now() WHERE upper(currency) <> 'TWD'"
    )


def downgrade() -> None:
    pass
