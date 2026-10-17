"""Allow multiple lots per symbol

Revision ID: 002_multiple_lots
Revises: None
Create Date: 2025-01-15 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '002_multiple_lots'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Add purchase_date column to track individual lots
    op.add_column('portfolio_holdings',
        sa.Column('purchase_date', sa.DateTime(timezone=True), nullable=True)
    )

    # Add notes column for lot-specific notes
    op.add_column('portfolio_holdings',
        sa.Column('notes', sa.Text(), nullable=True)
    )

    # Drop the unique constraint that prevents multiple holdings of same symbol
    op.drop_constraint('uq_holdings_portfolio_symbol', 'portfolio_holdings', type_='unique')

    # Create new index on portfolio_id, symbol, purchase_date for better query performance
    op.create_index(
        'idx_holdings_portfolio_symbol_date',
        'portfolio_holdings',
        ['portfolio_id', 'symbol', 'purchase_date']
    )

    # Update existing holdings to have a purchase_date (use created_at as default)
    op.execute("""
        UPDATE portfolio_holdings
        SET purchase_date = created_at
        WHERE purchase_date IS NULL
    """)

    # Now make purchase_date NOT NULL
    op.alter_column('portfolio_holdings', 'purchase_date', nullable=False)


def downgrade():
    # Make purchase_date nullable again
    op.alter_column('portfolio_holdings', 'purchase_date', nullable=True)

    # Drop the new index
    op.drop_index('idx_holdings_portfolio_symbol_date', 'portfolio_holdings')

    # Recreate the unique constraint (this will fail if there are duplicate symbol holdings)
    # Note: You would need to aggregate/merge holdings manually before downgrading
    op.create_unique_constraint(
        'uq_holdings_portfolio_symbol',
        'portfolio_holdings',
        ['portfolio_id', 'symbol']
    )

    # Drop the added columns
    op.drop_column('portfolio_holdings', 'notes')
    op.drop_column('portfolio_holdings', 'purchase_date')
