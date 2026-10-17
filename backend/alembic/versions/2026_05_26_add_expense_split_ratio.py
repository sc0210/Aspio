"""Add ratio column to expense_splits for future custom-split support

Revision ID: 2026_05_26_add_expense_split_ratio
Revises: 2026_05_26_add_line_bot_tables
Create Date: 2026-05-26

Adds expense_splits.ratio (NUMERIC 10,6, default 1) so that future
custom-ratio splits can be recorded alongside the computed amount.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_05_26_add_expense_split_ratio"
down_revision = "2026_05_26_add_line_bot_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expense_splits",
        sa.Column(
            "ratio",
            sa.Numeric(10, 6),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    op.drop_column("expense_splits", "ratio")
