"""Cash holdings at face value: 1 per unit in their own currency

Revision ID: 2026_11_13_cash_face_value
Revises: 2026_11_09_split_cancel_request
Create Date: 2026-11-13

The buy form let a cash lot take any price while the wallet bridge booked its
quantity alone, so a US$2,000 reserve entered at the exchange rate (31.5) was
stored as US$63,000 and converted to TWD again. New writes are fixed in code;
this repairs rows already stored that way: the holdings, and their buy/sell
ledger rows (whose total then matches the amount the wallet bridge booked).
Data only: no schema change, no RLS.
Not reversible (the wrong prices are not kept), so downgrade does nothing.
"""

from alembic import op

revision = "2026_11_13_cash_face_value"
down_revision = "2026_11_09_split_cancel_request"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE portfolio_holdings
           SET average_cost = 1, current_price = 1,
               total_cost = quantity, total_value = quantity,
               gain_loss = 0, gain_loss_percentage = 0, updated_at = now()
         WHERE lower(type::text) = 'cash'
           AND (average_cost <> 1 OR current_price <> 1)
        """
    )
    op.execute(
        """
        UPDATE portfolio_transactions pt
           SET price = 1, total_amount = pt.quantity, updated_at = now()
          FROM portfolio_holdings h
         WHERE h.id = pt.holding_id
           AND lower(h.type::text) = 'cash'
           AND pt.type::text IN ('buy', 'sell')
           AND pt.price <> 1
        """
    )


def downgrade() -> None:
    pass
