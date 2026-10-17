"""
Test script for historical price fetching and storage.
"""
import asyncio
import sys
import pytest
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.modules.portfolio.historical_price_service import HistoricalPriceService
from app.utils.datetime_helpers import business_today


@pytest.mark.integration
@pytest.mark.slow
@pytest.mark.asyncio
async def test_historical_fetch():
    """Manual diagnostic: fetch historical data for common symbols.

    Marked integration/slow so the default CI selector skips it. It is not a
    unit test and cannot gate anything: it builds its own engine from
    settings.DATABASE_URL with Postgres-only pool args (pool_size/max_overflow,
    which SQLite's StaticPool rejects), reaches out to live market-data APIs for
    TSMC/AAPL/NVDA, writes to a real database, makes zero assertions, and
    swallows every exception into a print. Run it by hand against a real
    Postgres when you want to eyeball fetch coverage.
    """

    # Create database engine
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20
    )

    # Create session factory
    async_session_factory = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )

    try:
        async with async_session_factory() as session:
            # Create historical price service
            hist_service = HistoricalPriceService(session)

            # Test symbols from different markets
            test_cases = [
                {'symbol': '2330', 'market': 'TW', 'days': 30, 'name': 'TSMC (Taiwan)'},
                {'symbol': 'AAPL', 'market': 'US', 'days': 30, 'name': 'Apple (US)'},
                {'symbol': 'NVDA', 'market': 'US', 'days': 30, 'name': 'NVIDIA (US)'},
            ]

            print("\n=== Historical Price Fetch Test ===\n")

            for test in test_cases:
                print(f"Testing {test['name']} ({test['symbol']})...")

                end_date = business_today()
                start_date = end_date - timedelta(days=test['days'])

                # Fetch and store
                result = await hist_service.fetch_and_store_historical_data(
                    symbol=test['symbol'],
                    market=test['market'],
                    start_date=start_date,
                    end_date=end_date,
                    force_refresh=False
                )

                print(f"  Status: {result['status']}")
                print(f"  Records stored: {result['records_stored']}")
                if 'message' in result:
                    print(f"  Message: {result['message']}")

                # Get coverage stats
                from app.modules.portfolio.historical_price_repository import HistoricalPriceRepository
                repo = HistoricalPriceRepository(session)
                stats = await repo.get_data_coverage_stats(test['symbol'])

                print(f"  Coverage: {stats['data_points']} data points")
                print(f"  Date range: {stats.get('min_date', 'N/A')} to {stats.get('max_date', 'N/A')}")
                print()

            print("\n=== Testing data retrieval ===\n")

            # Test retrieving data
            for test in test_cases:
                print(f"Retrieving {test['name']} data...")

                prices = await hist_service.get_historical_prices_for_symbol(
                    symbol=test['symbol'],
                    start_date=business_today() - timedelta(days=7),
                    end_date=business_today()
                )

                print(f"  Retrieved {len(prices)} price records")
                if prices:
                    latest = prices[-1]
                    print(f"  Latest: {latest['date']} - Close: {latest['close']}")
                print()

            print("✅ Historical price fetch test completed successfully!")

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(test_historical_fetch())
