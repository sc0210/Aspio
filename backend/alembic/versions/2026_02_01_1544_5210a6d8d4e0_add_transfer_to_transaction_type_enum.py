"""add_transfer_to_transaction_type_enum

Revision ID: 5210a6d8d4e0
Revises: 28f9b9c2f703
Create Date: 2026-02-01 15:44:57.858421

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5210a6d8d4e0"
down_revision: Union[str, None] = "28f9b9c2f703"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add TRANSFER to transactiontype enum"""
    # PostgreSQL requires special handling to alter enums
    # We need to use raw SQL to add a new value to the enum

    # Add TRANSFER value to the transactiontype enum
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'TRANSFER'")

    # Note: The enum is used in both 'transactions' and 'recurring_transactions' tables
    # Both will automatically support the new TRANSFER value


def downgrade() -> None:
    """Remove TRANSFER from transactiontype enum"""
    # PostgreSQL doesn't support removing enum values directly
    # This would require recreating the enum and all dependent columns
    # For safety, we'll leave a comment explaining manual steps if needed

    # Manual downgrade steps (if needed):
    # 1. Ensure no transactions have type='TRANSFER'
    # 2. Create new enum without TRANSFER
    # 3. Alter columns to use new enum
    # 4. Drop old enum

    pass  # Cannot automatically downgrade enum value removal in PostgreSQL
