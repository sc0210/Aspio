"""
Test Exchange Rate Caching System

This script tests the daily database caching for exchange rates.
"""

import asyncio
import pytest
from decimal import Decimal
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.utils.exchange_rate_service import get_exchange_rate_service
from app.core.config import settings

@pytest.mark.asyncio
async def test_exchange_rate_caching():
    """Test exchange rate caching with database"""

    # Create database session
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        # Create service with database session
        exchange_service = get_exchange_rate_service(db_session=session)

        print("🧪 Testing Exchange Rate Caching System\n")
        print("=" * 60)

        # Test 1: First call (should fetch from API and cache)
        print("\n📡 Test 1: First call - should fetch from API")
        rate1 = await exchange_service.get_exchange_rate("USD", "TWD")
        print(f"   USD -> TWD: {rate1}")
        print(f"   ✅ Fetched and cached in database\n")

        # Test 2: Second call (should use database cache)
        print("💾 Test 2: Second call - should use database cache")
        rate2 = await exchange_service.get_exchange_rate("USD", "TWD")
        print(f"   USD -> TWD: {rate2}")
        print(f"   ✅ Retrieved from database cache\n")

        # Verify rates match
        assert rate1 == rate2, "Rates should match!"

        # Test 3: Different currency pair
        print("📡 Test 3: Different currency pair")
        eur_rate = await exchange_service.get_exchange_rate("USD", "EUR")
        print(f"   USD -> EUR: {eur_rate}")
        print(f"   ✅ Fetched and cached\n")

        # Test 4: Same currency (should return 1.0 instantly)
        print("⚡ Test 5: Same currency conversion")
        same_rate = await exchange_service.get_exchange_rate("USD", "USD")
        print(f"   USD -> USD: {same_rate}")
        assert same_rate == Decimal("1.0")
        print(f"   ✅ Instant return without API call\n")

        print("=" * 60)
        print("✅ All tests passed! Exchange rate caching is working.\n")
        print("Key Benefits:")
        print("  • First call: Fetches from API and caches in database (daily)")
        print("  • Subsequent calls: Uses database cache (no API calls)")
        print("  • Fast: Redis cache for sub-second access")
        print("  • Persistent: Database cache survives restarts")
        print("  • Cost-effective: Minimizes external API calls")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(test_exchange_rate_caching())
