"""
Test IRR calculations with various scenarios
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.modules.portfolio.return_calculator import (
    calculate_roi,
    calculate_simple_irr,
)


def test_roi():
    """Test simple ROI calculation"""
    print("\n=== Testing ROI Calculation ===")

    # Test 1: 20% gain
    roi = calculate_roi(Decimal('10000'), Decimal('12000'))
    print(f"Cost: $10,000, Value: $12,000 => ROI: {float(roi)*100:.2f}%")
    assert abs(float(roi) - 0.20) < 0.001

    # Test 2: 15% loss
    roi = calculate_roi(Decimal('10000'), Decimal('8500'))
    print(f"Cost: $10,000, Value: $8,500 => ROI: {float(roi)*100:.2f}%")
    assert abs(float(roi) - (-0.15)) < 0.001

    print("✓ ROI tests passed")


def test_simple_irr():
    """Test simple IRR (CAGR) calculation"""
    print("\n=== Testing Simple IRR (CAGR) ===")

    # Test 1: 1 year hold, 20% gain => 20% IRR
    purchase_date = datetime.now(timezone.utc) - timedelta(days=365)
    irr = calculate_simple_irr(
        purchase_date,
        Decimal('10000'),
        Decimal('12000')
    )
    print(f"1 year hold, 20% gain => IRR: {float(irr)*100:.2f}% (expected: ~20%)")
    assert abs(float(irr) - 0.20) < 0.01

    # Test 2: 2 years hold, 44% gain => ~20% annualized IRR
    # (1.20)^2 = 1.44
    purchase_date = datetime.now(timezone.utc) - timedelta(days=730)
    irr = calculate_simple_irr(
        purchase_date,
        Decimal('10000'),
        Decimal('14400')
    )
    print(f"2 years hold, 44% gain => IRR: {float(irr)*100:.2f}% (expected: ~20%)")
    assert abs(float(irr) - 0.20) < 0.01

    # Test 3: 6 months hold, 10% gain => ~21% annualized IRR
    purchase_date = datetime.now(timezone.utc) - timedelta(days=183)
    irr = calculate_simple_irr(
        purchase_date,
        Decimal('10000'),
        Decimal('11000')
    )
    print(f"6 months hold, 10% gain => IRR: {float(irr)*100:.2f}% (expected: ~21%)")
    assert abs(float(irr) - 0.21) < 0.02

    print("✓ Simple IRR tests passed")


if __name__ == "__main__":
    print("=" * 60)
    print("IRR/ROI Calculation Tests")
    print("=" * 60)

    test_roi()
    test_simple_irr()

    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)
