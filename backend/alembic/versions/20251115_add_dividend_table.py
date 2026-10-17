"""add dividend table

Revision ID: 20251115_add_dividend_table
Revises: 20251112_create_historical_prices
Create Date: 2025-11-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
import uuid


# revision identifiers, used by Alembic.
revision = '20251115_add_dividend_table'
down_revision = '20251112_create_historical_prices'
branch_labels = None
depends_on = None


def upgrade():
    # Create dividends table
    op.create_table(
        'dividends',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('holding_id', UUID(as_uuid=True), sa.ForeignKey('portfolio_holdings.id'), nullable=True),

        # Symbol information
        sa.Column('symbol', sa.String(20), nullable=False),
        sa.Column('name', sa.String(255)),

        # Dividend details
        sa.Column('payment_date', sa.Date, nullable=False),
        sa.Column('ex_dividend_date', sa.Date),
        sa.Column('record_date', sa.Date),
        sa.Column('amount_per_share', sa.Numeric(12, 4), nullable=False),
        sa.Column('shares_owned', sa.Numeric(18, 8), nullable=False),
        sa.Column('total_amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='USD'),

        # Tax information
        sa.Column('tax_withheld', sa.Numeric(15, 2), server_default='0.00'),
        sa.Column('net_amount', sa.Numeric(15, 2)),

        # Reinvestment tracking
        sa.Column('is_reinvested', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('reinvestment_holding_id', UUID(as_uuid=True), sa.ForeignKey('portfolio_holdings.id'), nullable=True),
        sa.Column('reinvestment_shares', sa.Numeric(18, 8)),
        sa.Column('reinvestment_price', sa.Numeric(12, 4)),

        # Status
        sa.Column('status', sa.String(20), nullable=False, server_default='received'),

        # Notes
        sa.Column('notes', sa.Text),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )

    # Create indexes
    op.create_index('idx_dividends_user_id', 'dividends', ['user_id'])
    op.create_index('idx_dividends_holding_id', 'dividends', ['holding_id'])
    op.create_index('idx_dividends_symbol', 'dividends', ['symbol'])
    op.create_index('idx_dividends_payment_date', 'dividends', ['payment_date'])
    op.create_index('idx_dividends_user_payment_date', 'dividends', ['user_id', 'payment_date'])
    op.create_index('idx_dividends_symbol_payment_date', 'dividends', ['symbol', 'payment_date'])


def downgrade():
    op.drop_table('dividends')
