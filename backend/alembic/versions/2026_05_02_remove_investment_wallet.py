"""Remove investment_wallet, rename portfolio_performance→portfolio and urgent→emergency

Revision ID: 2026_05_02_remove_investment_wallet
Revises: 2026_04_09_missing_indexes
Create Date: 2026-05-02

This migration moves from a four-wallet system to a three-wallet system:
- investment_wallet is removed (asset purchases now go directly from life_wallet)
- portfolio_performance_wallet is renamed to portfolio_wallet
- urgent_wallet is renamed to emergency_wallet
- life_wallet is unchanged

Data migration:
- transactions: investment → life (re-classified), urgent → emergency
- portfolio_holdings: investment + portfolio_performance → portfolio, urgent → emergency
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "remove_invest_wallet"
down_revision = "2026_04_09_missing_indexes"
branch_labels = None
depends_on = None


def upgrade():
    # ── transactions table ────────────────────────────────────────────────────
    # 1. Re-classify investment transactions back to life wallet
    op.execute("UPDATE transactions SET wallet_type = 'life' WHERE wallet_type = 'investment'")

    # 2. Drop the old enum and column, then recreate with new values
    op.execute("ALTER TABLE transactions ALTER COLUMN wallet_type DROP DEFAULT")
    op.execute("ALTER TABLE transactions ALTER COLUMN wallet_type TYPE TEXT")
    op.execute("DROP TYPE transaction_wallet_type")

    # 3. Rename urgent → emergency
    op.execute("UPDATE transactions SET wallet_type = 'emergency' WHERE wallet_type = 'urgent'")

    # 4. Recreate enum with the two remaining values
    op.execute("CREATE TYPE transaction_wallet_type AS ENUM ('life', 'emergency')")
    op.execute(
        "ALTER TABLE transactions ALTER COLUMN wallet_type TYPE transaction_wallet_type "
        "USING wallet_type::transaction_wallet_type"
    )
    op.execute("ALTER TABLE transactions ALTER COLUMN wallet_type SET DEFAULT 'life'")

    # ── portfolio_holdings table ──────────────────────────────────────────────
    # 1. Convert to TEXT first so we can assign values not in the old enum
    op.execute("ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type DROP DEFAULT")
    op.execute("ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type TYPE TEXT")
    op.execute("DROP TYPE holding_wallet_type")

    # 2. Merge investment + portfolio_performance → portfolio, urgent → emergency
    op.execute(
        "UPDATE portfolio_holdings SET wallet_type = 'portfolio' "
        "WHERE wallet_type IN ('investment', 'portfolio_performance')"
    )
    op.execute(
        "UPDATE portfolio_holdings SET wallet_type = 'emergency' "
        "WHERE wallet_type = 'urgent'"
    )

    # 4. Recreate enum with the two new values
    op.execute("CREATE TYPE holding_wallet_type AS ENUM ('portfolio', 'emergency')")
    op.execute(
        "ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type TYPE holding_wallet_type "
        "USING wallet_type::holding_wallet_type"
    )
    op.execute(
        "ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type SET DEFAULT 'portfolio'"
    )


def downgrade():
    # ── portfolio_holdings: reverse ───────────────────────────────────────────
    op.execute("ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type TYPE TEXT")
    op.execute("DROP TYPE holding_wallet_type")
    op.execute(
        "CREATE TYPE holding_wallet_type AS ENUM ('investment', 'portfolio_performance', 'urgent')"
    )
    # Restore: portfolio → portfolio_performance, emergency → urgent
    op.execute(
        "UPDATE portfolio_holdings SET wallet_type = 'portfolio_performance' "
        "WHERE wallet_type = 'portfolio'"
    )
    op.execute(
        "UPDATE portfolio_holdings SET wallet_type = 'urgent' "
        "WHERE wallet_type = 'emergency'"
    )
    op.execute(
        "ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type TYPE holding_wallet_type "
        "USING wallet_type::holding_wallet_type"
    )
    op.execute(
        "ALTER TABLE portfolio_holdings ALTER COLUMN wallet_type SET DEFAULT 'portfolio_performance'"
    )

    # ── transactions: reverse ─────────────────────────────────────────────────
    op.execute("ALTER TABLE transactions ALTER COLUMN wallet_type TYPE TEXT")
    op.execute("DROP TYPE transaction_wallet_type")
    op.execute(
        "CREATE TYPE transaction_wallet_type AS ENUM ('life', 'investment', 'urgent')"
    )
    # Restore: emergency → urgent (investment data is unrecoverable, was merged into life)
    op.execute(
        "UPDATE transactions SET wallet_type = 'urgent' WHERE wallet_type = 'emergency'"
    )
    op.execute(
        "ALTER TABLE transactions ALTER COLUMN wallet_type TYPE transaction_wallet_type "
        "USING wallet_type::transaction_wallet_type"
    )
    op.execute("ALTER TABLE transactions ALTER COLUMN wallet_type SET DEFAULT 'life'")
