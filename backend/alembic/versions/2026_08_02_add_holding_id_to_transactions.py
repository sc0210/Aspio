"""Link the Life Wallet purchase entry back to its holding.

add_holding creates a Life Wallet expense to pay for a holding, but nothing
recorded which holding it paid for. With no link, editing a holding's quantity
or cost left the ledger untouched, and deleting a holding left the cash spent
with no asset against it.

SET NULL rather than CASCADE: if a holding row is ever hard-deleted the money
still moved, so the ledger entry has to survive with the link dropped.

Revision ID: 2026_08_02_holding_txn_link
Revises: 2026_07_23_merge_uiux_heads
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "2026_08_02_holding_txn_link"
# Re-parented from 2026_07_23_merge_uiux_heads while this branch sat open.
# 2026_08_14_holding_previous_close landed on main in the meantime and also
# descends from that merge point, so keeping the original parent would give
# Alembic two heads the moment this merges — the same split that previously
# broke deploys, since `upgrade head` refuses to pick between them. This
# revision has never been stamped in any database, so moving it to the end of
# the chain is safe and keeps history linear.
down_revision = "2026_08_14_holding_previous_close"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("holding_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_transactions_holding_id",
        "transactions",
        "portfolio_holdings",
        ["holding_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_transactions_holding", "transactions", ["holding_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("idx_transactions_holding", table_name="transactions")
    op.drop_constraint("fk_transactions_holding_id", "transactions", type_="foreignkey")
    op.drop_column("transactions", "holding_id")
