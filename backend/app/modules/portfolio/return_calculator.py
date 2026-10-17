"""
Return Calculator for Portfolio Holdings

This module provides clean, accurate calculations for:
1. ROI (Return on Investment) - Simple percentage return
2. IRR (Internal Rate of Return) - Annualized time-weighted return
3. XIRR - IRR with multiple cash flows (for complex holdings)
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)


def calculate_roi(cost: Decimal, current_value: Decimal) -> Optional[Decimal]:
    """
    Calculate simple Return on Investment (ROI).

    Formula: ROI = (Current Value - Cost) / Cost

    Args:
        cost: Total cost basis
        current_value: Current market value

    Returns:
        ROI as decimal (e.g., 0.15 for 15% return), or None if invalid
    """
    if cost <= 0:
        return None

    if current_value < 0:
        return None

    roi = (current_value - cost) / cost
    return round(roi, 6)


def calculate_simple_irr(
    purchase_date: datetime,
    cost: Decimal,
    current_value: Decimal,
    current_date: Optional[datetime] = None
) -> Optional[Decimal]:
    """
    Calculate annualized IRR for a single purchase (no intermediate cash flows).

    Formula: IRR = (Current Value / Cost)^(1/years) - 1

    This is the compound annual growth rate (CAGR).

    Args:
        purchase_date: When the investment was made
        cost: Total cost basis
        current_value: Current market value
        current_date: Date to calculate as of (defaults to now)

    Returns:
        Annualized IRR as decimal (e.g., 0.15 for 15% annual return), or None if invalid
    """
    if current_date is None:
        current_date = datetime.now(timezone.utc)

    # Ensure timezone awareness
    if purchase_date.tzinfo is None:
        purchase_date = purchase_date.replace(tzinfo=timezone.utc)
    if current_date.tzinfo is None:
        current_date = current_date.replace(tzinfo=timezone.utc)

    # Calculate holding period in years
    time_delta = current_date - purchase_date
    years = Decimal(time_delta.days) / Decimal(365.25)

    # Validate inputs
    if years <= 0:
        # For same-day purchases, return simple ROI
        return calculate_roi(cost, current_value)

    if cost <= 0:
        return None

    if current_value <= 0:
        return Decimal(-1)  # Total loss = -100% annual return

    try:
        # Calculate CAGR: IRR = (current_value / cost)^(1/years) - 1
        ratio = float(current_value) / float(cost)
        exponent = 1.0 / float(years)
        irr = Decimal(ratio ** exponent - 1.0)
        return round(irr, 6)
    except (ValueError, OverflowError, ZeroDivisionError) as e:
        logger.warning(f"Error calculating simple IRR: {e}")
        return None


# Alias for backward compatibility
calculate_irr_for_holding = calculate_simple_irr


# Annualising a few months turns a good quarter into a fantasy rate: +20% in
# two months reads as ~+200% a year.
MIN_YEARS_TO_ANNUALISE = Decimal("1")


def lot_irr(
    cost: Decimal,
    current_value: Decimal,
    purchase_date: Optional[datetime],
    current_date: Optional[datetime] = None,
) -> Optional[Decimal]:
    """A lot's own annualised return: its cost on its purchase day against its value now.

    Deliberately not an XIRR over the symbol's ledger. A lot stores one purchase,
    and the ledger holds a buy for every lot of the symbol ever created —
    including closed re-import duplicates — so weighing all of them against one
    lot's value produced IRRs of -60% on lots up 88%. None when the lot is held
    under a year, or when cost or date is missing.
    """
    if purchase_date is None or cost is None or Decimal(str(cost)) <= 0:
        return None
    now = current_date or datetime.now(timezone.utc)
    start = purchase_date if purchase_date.tzinfo else purchase_date.replace(tzinfo=timezone.utc)
    if Decimal((now - start).days) / Decimal("365.25") < MIN_YEARS_TO_ANNUALISE:
        return None
    return calculate_simple_irr(start, Decimal(str(cost)), Decimal(str(current_value or 0)), now)
