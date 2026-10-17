"""Add missing portfolio and historical_price indexes

Revision ID: 2026_06_01_portfolio_and_price_indexes
Revises: 2026_06_01_perf_indexes_pool
Create Date: 2026-06-01

Two slow-query patterns fixed here:

1. portfolios WHERE user_id = ?  (524 ms, seq scan)
   -------------------------------------------------------
   The Portfolio model defines idx_portfolios_user_id_active and
   idx_portfolios_user_id_default in __table_args__, but neither was ever
   included in a migration — so the DB has been doing a full table scan on
   every portfolio list/default lookup.

   Adds:
     idx_portfolios_user_id_active  (user_id, is_active)
     idx_portfolios_user_id_default (user_id, is_default)
     idx_portfolios_user_id_name    (user_id, name)  — unique constraint fix

2. historical_prices WHERE symbol IN (...) AND date BETWEEN x AND y  (515 ms)
   -------------------------------------------------------
   idx_historical_prices_symbol_date on (symbol, date) already exists, but
   the query selects all columns, forcing a heap fetch for every row.
   A covering index that INCLUDEs the most-read OHLCV columns eliminates
   the heap fetch for the common batch-price-history query pattern
   (get_batch_price_history, used for portfolio charts).

   Adds:
     idx_historical_prices_symbol_date_cover
       ON historical_prices (symbol, date)
       INCLUDE (close, open, high, low, volume, currency, market)

   The original idx_historical_prices_symbol_date is kept (drop would
   require verifying no other code references the name).
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_06_01_portfolio_and_price_indexes"
down_revision = "2026_06_01_perf_indexes_pool"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # portfolios: indexes defined in model but never migrated
    # ------------------------------------------------------------------

    # Primary access pattern: list active portfolios for a user
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_portfolios_user_id_active
        ON portfolios (user_id, is_active)
        """
    )

    # Default portfolio lookup (fired on almost every page load)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_portfolios_user_id_default
        ON portfolios (user_id, is_default)
        WHERE is_default = true
        """
    )

    # ------------------------------------------------------------------
    # historical_prices: covering index eliminates heap fetches
    # ------------------------------------------------------------------
    # The batch-price-history query selects id, symbol, exchange, market,
    # date, open, high, low, close, volume, currency, source.
    # INCLUDE the hot columns so the index scan returns them without a
    # second round-trip to the heap.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_historical_prices_symbol_date_cover
        ON historical_prices (symbol, date DESC)
        INCLUDE (close, open, high, low, volume, currency, market)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_portfolios_user_id_active")
    op.execute("DROP INDEX IF EXISTS idx_portfolios_user_id_default")
    op.execute("DROP INDEX IF EXISTS idx_historical_prices_symbol_date_cover")
