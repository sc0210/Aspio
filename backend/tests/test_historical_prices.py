"""
Test script for historical price service
"""

import asyncio
from datetime import date, timedelta
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.modules.portfolio.historical_price_service import HistoricalPriceService
from app.utils.datetime_helpers import business_today


async def run_historical_prices():
    """Run fetching and storing historical prices as a standalone script"""

    # Create database engine
    engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=True)

    # Create session factory
    async_session_factory = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    try:
        async with async_session_factory() as session:
            # Create service
            service = HistoricalPriceService(session)

            # Test 1: Fetch Taiwan stock (2330 = TSMC)
            print("\n=== Test 1: Fetching Taiwan stock 2330 (TSMC) ===")
            end_date = business_today()
            start_date = end_date - timedelta(days=30)  # Last 30 days

            result = await service.fetch_and_store_historical_data(
                symbol="2330", market="TW", start_date=start_date, end_date=end_date
            )

            print(f"Status: {result['status']}")
            print(f"Records stored: {result['records_stored']}")
            if "message" in result:
                print(f"Message: {result['message']}")

            # Test 2: Retrieve the stored data
            print("\n=== Test 2: Retrieving stored data ===")
            prices = await service.get_historical_prices_for_symbol(
                symbol="2330", start_date=start_date, end_date=end_date
            )

            print(f"Retrieved {len(prices)} price records")
            if prices:
                print(f"First date: {prices[0]['date']}, Close: {prices[0]['close']}")
                print(f"Last date: {prices[-1]['date']}, Close: {prices[-1]['close']}")

            # Test 3: Get price on specific date
            print("\n=== Test 3: Get price on specific date ===")
            test_date = end_date - timedelta(days=5)
            price_on_date = await service.get_price_on_date("2330", test_date)

            if price_on_date:
                print(f"Price on {test_date}: {price_on_date['close']}")
                print(f"Source: {price_on_date['source']}")
            else:
                print(f"No price found for date {test_date}")

            # Test 4: Check data coverage
            print("\n=== Test 4: Data coverage statistics ===")
            stats = await service.repository.get_data_coverage_stats("2330")
            print(f"Symbol: {stats['symbol']}")
            print(f"Date range: {stats['min_date']} to {stats['max_date']}")
            print(f"Data points: {stats['data_points']}")
            print(f"Coverage: {stats['coverage_percentage']}%")

    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback

        traceback.print_exc()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    print("=" * 60)
    print("Historical Price Service Test")
    print("=" * 60)
    asyncio.run(run_historical_prices())
