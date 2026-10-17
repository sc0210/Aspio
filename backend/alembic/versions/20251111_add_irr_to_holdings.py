"""add irr to portfolio holdings

Revision ID: 20251111_add_irr
Revises: 20251107_072258
Create Date: 2025-11-11 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20251111_add_irr"
down_revision = "20251107_072258"  # Fixed: was 20251107_072258_add_performance_indexes
branch_labels = None
depends_on = None


def upgrade():
    # Add IRR column to portfolio_holdings table
    op.add_column(
        "portfolio_holdings",
        sa.Column(
            "irr",
            sa.Numeric(precision=8, scale=6),
            nullable=True,
            comment="Annualized Internal Rate of Return",
        ),
    )

    # Create an index on IRR for performance queries
    op.create_index(
        "idx_portfolio_holdings_irr", "portfolio_holdings", ["irr"], unique=False
    )


def downgrade():
    # Remove the index
    op.drop_index("idx_portfolio_holdings_irr", table_name="portfolio_holdings")

    # Remove the IRR column
    op.drop_column("portfolio_holdings", "irr")
