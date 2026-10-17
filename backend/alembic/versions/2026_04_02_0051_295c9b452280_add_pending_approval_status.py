"""add_pending_approval_status

Revision ID: 295c9b452280
Revises: recreate_goals_tables
Create Date: 2026-04-02 00:51:42.594436

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '295c9b452280'
down_revision: Union[str, None] = 'recreate_goals_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add PENDING_APPROVAL to the userstatus enum
    op.execute("ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'pending_approval'")


def downgrade() -> None:
    """Downgrade database schema"""
    # PostgreSQL doesn't support removing enum values easily
    # This would require recreating the enum type and updating all references
    # For now, we'll leave the value in place even on downgrade
    pass