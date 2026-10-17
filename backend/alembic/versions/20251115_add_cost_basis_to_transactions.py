"""add cost basis fields to portfolio transactions

Revision ID: 20251115_cost_basis
Revises: 20251112_create_historical_prices
Create Date: 2025-11-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON


# revision identifiers, used by Alembic.
revision = '20251115_cost_basis'
down_revision = '20251112_create_historical_prices'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add cost basis fields to portfolio_transactions
    op.add_column('portfolio_transactions',
        sa.Column('cost_basis_method', sa.String(20), nullable=True)
    )
    op.add_column('portfolio_transactions',
        sa.Column('lot_ids', JSON, nullable=True)
    )
    op.add_column('portfolio_transactions',
        sa.Column('cost_basis', sa.Numeric(15, 2), nullable=True)
    )
    op.add_column('portfolio_transactions',
        sa.Column('capital_gain', sa.Numeric(15, 2), nullable=True)
    )

    # Add index for cost basis method
    op.create_index(
        'idx_portfolio_transactions_cost_basis_method',
        'portfolio_transactions',
        ['cost_basis_method']
    )


def downgrade() -> None:
    op.drop_index('idx_portfolio_transactions_cost_basis_method', table_name='portfolio_transactions')
    op.drop_column('portfolio_transactions', 'capital_gain')
    op.drop_column('portfolio_transactions', 'cost_basis')
    op.drop_column('portfolio_transactions', 'lot_ids')
    op.drop_column('portfolio_transactions', 'cost_basis_method')
