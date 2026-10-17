"""
Application-wide constants for Aspiro backend.

This module centralizes all magic numbers and hardcoded values
used throughout the application for better maintainability.
"""

from decimal import Decimal


# ============================================================================
# Portfolio Performance Constants
# ============================================================================

class PerformanceMetrics:
    """Constants for performance calculations and estimations"""

    # Time-based performance distribution ratios
    # Used to estimate performance over different time periods
    DAILY_PERFORMANCE_RATIO = Decimal('0.003')      # ~0.3% of yearly
    WEEKLY_PERFORMANCE_RATIO = Decimal('0.02')      # ~2% of yearly
    MONTHLY_PERFORMANCE_RATIO = Decimal('0.08')     # ~8% of yearly
    THREE_MONTH_RATIO = Decimal('0.25')             # 25% of yearly
    SIX_MONTH_RATIO = Decimal('0.50')               # 50% of yearly
    YEARLY_RATIO = Decimal('1.00')                  # 100% of yearly

    # Display settings
    TOP_PERFORMERS_LIMIT = 5
    WORST_PERFORMERS_LIMIT = 5

    # Cache settings
    PERFORMANCE_CACHE_TTL_SECONDS = 300  # 5 minutes


# ============================================================================
# Portfolio Settings
# ============================================================================

class PortfolioSettings:
    """Portfolio-related constants"""

    # Cache TTL
    DEFAULT_CACHE_TTL_SECONDS = 300  # 5 minutes

    # Holdings limits
    MAX_HOLDINGS_PER_QUERY = 1000
    MAX_HOLDINGS_DISPLAY = 100

    # Transaction limits
    MAX_TRANSACTIONS_PER_QUERY = 1000
    HISTORICAL_DATA_MAX_YEARS = 10

    # Price update settings
    PRICE_UPDATE_TIMEOUT_SECONDS = 10
    PRICE_UPDATE_RETRY_ATTEMPTS = 3

    # Asset types to skip for automatic price fetching
    SKIP_PRICE_FETCH_TYPES = ['crypto', 'cash', 'commodity', 'lending']


# ============================================================================
# Export commonly used constants
# ============================================================================

__all__ = [
    'PerformanceMetrics',
    'PortfolioSettings',
]
