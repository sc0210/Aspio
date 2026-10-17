"""Add lending asset type for crypto lending (e.g. Bitfinex)

Revision ID: 2026_05_08_add_lending
Revises: 2026_05_08_life_wallet_adj
Create Date: 2026-05-08

Adds 'lending' to asset_type_enum so users can track CeFi/DeFi lending
positions (e.g. Bitfinex funding, Aave deposits) as portfolio holdings.
These are manually priced and excluded from automatic price fetching.
"""

from alembic import op

revision = '2026_05_08_add_lending'
down_revision = '2026_05_08_life_wallet_adj'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE asset_type_enum ADD VALUE IF NOT EXISTS 'lending'")


def downgrade():
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
