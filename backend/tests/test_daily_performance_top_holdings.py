#!/usr/bin/env python3
"""Test script to verify daily performance API returns topHoldings data."""

import asyncio
import sys
import pytest
from datetime import datetime
from app.modules.portfolio.router import get_daily_performance


@pytest.mark.asyncio
async def test_daily_performance():
    """Test the daily performance endpoint to verify topHoldings data."""

    # For demo mode (no user), we can test without authentication
    print("Testing daily performance API (demo mode)...")

    try:
        # Call the endpoint function directly with demo user (None)
        result = await get_daily_performance(days=7, current_user=None, session=None)

        print(f"\n✅ API Response received")
        print(f"Status: {result.get('success', False)}")

        data = result.get("data", [])
        print(f"Data points: {len(data)}")

        if data:
            # Check first data point
            first_point = data[0]
            print(f"\nFirst data point:")
            print(f"  Date: {first_point.get('date')}")
            print(f"  Value: {first_point.get('value')}")
            print(f"  Change: {first_point.get('change')}")
            print(f"  Change %: {first_point.get('changePercent')}")

            # Check for topHoldings
            top_holdings = first_point.get("topHoldings", [])
            print(f"  Top Holdings: {len(top_holdings)} items")

            if top_holdings:
                print(f"\n  Top Holdings Details:")
                for i, holding in enumerate(top_holdings, 1):
                    print(
                        f"    {i}. {holding.get('symbol')}: {holding.get('change'):+.2f} (value: {holding.get('value'):.2f})"
                    )
            else:
                print(f"  ⚠️  WARNING: No topHoldings data found!")

            # Check a few more data points
            print(f"\n📊 Checking all {len(data)} data points for topHoldings...")
            points_with_holdings = sum(1 for d in data if d.get("topHoldings"))
            print(f"Points with topHoldings: {points_with_holdings}/{len(data)}")

            if points_with_holdings == 0:
                print("❌ ERROR: No data points have topHoldings!")
                return False
            else:
                print(
                    f"✅ SUCCESS: {points_with_holdings} data points have topHoldings"
                )
                return True
        else:
            print("❌ ERROR: No data returned")
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback

        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_daily_performance())
    sys.exit(0 if success else 1)
