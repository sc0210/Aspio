"""Add wallet_type to transactions and portfolio_holdings

Revision ID: add_wallet_system
Revises: remove_budgets_goals
Create Date: 2025-12-14 09:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20251214_add_wallet_system"
down_revision = "remove_budgets_goals"
branch_labels = None
depends_on = None


def upgrade():
    """
    Add wallet_type columns to support four-wallet system:
    - life_wallet: Daily transactions (income/expenses)
    - investment_wallet: Cash for trading
    - portfolio_performance_wallet: Invested assets (stocks, ETF, crypto)
    - urgent_wallet: Emergency fund
    """

    # Add wallet_type to transactions table
    op.execute(
        """
        CREATE TYPE transaction_wallet_type AS ENUM ('life', 'investment', 'urgent');
    """
    )

    op.add_column(
        "transactions",
        sa.Column(
            "wallet_type",
            postgresql.ENUM(
                "life", "investment", "urgent", name="transaction_wallet_type"
            ),
            nullable=False,
            server_default="life",
        ),
    )

    # Add wallet_type to portfolio_holdings table
    op.execute(
        """
        CREATE TYPE holding_wallet_type AS ENUM ('investment', 'portfolio_performance', 'urgent');
    """
    )

    op.add_column(
        "portfolio_holdings",
        sa.Column(
            "wallet_type",
            postgresql.ENUM(
                "investment",
                "portfolio_performance",
                "urgent",
                name="holding_wallet_type",
            ),
            nullable=False,
            server_default="portfolio_performance",
        ),
    )

    # Create indexes for performance
    op.create_index("idx_transactions_wallet_type", "transactions", ["wallet_type"])
    op.create_index(
        "idx_transactions_user_wallet", "transactions", ["user_id", "wallet_type"]
    )
    op.create_index("idx_holdings_wallet_type", "portfolio_holdings", ["wallet_type"])
    op.create_index(
        "idx_holdings_user_wallet", "portfolio_holdings", ["user_id", "wallet_type"]
    )

    # Migrate existing data
    # All existing transactions -> life_wallet (default is already set)
    # All existing portfolio holdings -> portfolio_performance_wallet
    op.execute(
        """
        UPDATE portfolio_holdings 
        SET wallet_type = 'portfolio_performance' 
        WHERE wallet_type IS NULL OR wallet_type = 'portfolio_performance';
    """
    )


def downgrade():
    """
    Remove wallet_type columns and enums
    """
    # Drop indexes
    op.drop_index("idx_holdings_user_wallet", table_name="portfolio_holdings")
    op.drop_index("idx_holdings_wallet_type", table_name="portfolio_holdings")
    op.drop_index("idx_transactions_user_wallet", table_name="transactions")
    op.drop_index("idx_transactions_wallet_type", table_name="transactions")

    # Drop columns
    op.drop_column("portfolio_holdings", "wallet_type")
    op.drop_column("transactions", "wallet_type")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS holding_wallet_type;")
    op.execute("DROP TYPE IF EXISTS transaction_wallet_type;")
