"""Merge multiple migration heads

Revision ID: 28f9b9c2f703
Revises: 001_asian_market_goals, 001_initial_goals_gamification, 003_create_transaction_tables, add_gamification_models, 20251115_cost_basis, 20251214_add_wallet_system
Create Date: 2026-01-10 22:31:42.760290

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '28f9b9c2f703'
down_revision: Union[str, None] = ('001_asian_market_goals', '001_initial_goals_gamification', '003_create_transaction_tables', 'add_gamification_models', '20251115_cost_basis', '20251214_add_wallet_system')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade database schema"""
    pass


def downgrade() -> None:
    """Downgrade database schema"""
    pass