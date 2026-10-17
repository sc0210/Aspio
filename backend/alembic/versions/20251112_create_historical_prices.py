"""Create historical_prices table for caching daily price data

Revision ID: 20251112_create_historical_prices
Revises: 20251111_add_irr
Create Date: 2025-11-12 16:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20251112_create_historical_prices"
down_revision = "20251111_add_irr"  # Fixed: was 20251111_add_irr_to_holdings
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create historical_prices table with optimized indexes"""

    # Create historical_prices table
    op.create_table(
        "historical_prices",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("symbol", sa.String(20), nullable=False, index=True),
        sa.Column("exchange", sa.String(10), nullable=True),
        sa.Column("market", sa.String(10), nullable=False, index=True),
        # Price data (OHLCV)
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("open", sa.Numeric(12, 4), nullable=True),
        sa.Column("high", sa.Numeric(12, 4), nullable=True),
        sa.Column("low", sa.Numeric(12, 4), nullable=True),
        sa.Column("close", sa.Numeric(12, 4), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=True),
        sa.Column("adjusted_close", sa.Numeric(12, 4), nullable=True),
        # Data source tracking
        sa.Column(
            "source", sa.String(20), nullable=False, default="finlab"
        ),  # finlab, yahoo, tradingview
        sa.Column("currency", sa.String(3), nullable=False, default="USD"),
        # Metadata
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        # Constraints
        sa.UniqueConstraint("symbol", "date", name="uq_historical_prices_symbol_date"),
    )

    # Create composite indexes for common queries
    op.create_index(
        "idx_historical_prices_symbol_date", "historical_prices", ["symbol", "date"]
    )

    op.create_index(
        "idx_historical_prices_market_date", "historical_prices", ["market", "date"]
    )

    op.create_index("idx_historical_prices_date", "historical_prices", ["date"])

    # Create index for recent data queries (most common)
    op.create_index(
        "idx_historical_prices_symbol_recent",
        "historical_prices",
        ["symbol", "date"],
        postgresql_using="btree",
        postgresql_ops={"date": "DESC"},
    )

    print("✅ Created historical_prices table with optimized indexes")


def downgrade() -> None:
    """Drop historical_prices table"""
    op.drop_table("historical_prices")
    print("✅ Dropped historical_prices table")
