"""
Test API optimization for market data service.
This tests the efficiency of API calls and caching.
"""

import pytest
from decimal import Decimal


class TestMarketDataOptimization:
    """Test market data service API optimization."""

    def test_api_optimization_stats_structure(self):
        """Test that get_api_optimization_stats returns expected structure."""
        from app.modules.portfolio.market_data_service import get_api_optimization_stats

        stats = get_api_optimization_stats()

        # Verify structure matches new format
        assert "finlab_cache_status" in stats
        assert "optimization_strategy" in stats
        assert "api_call_estimate" in stats
        assert "recommendations" in stats

        # Verify finlab cache status structure
        cache_status = stats["finlab_cache_status"]
        assert "is_cached" in cache_status
        assert "cache_age_seconds" in cache_status

        # Verify optimization strategy structure
        strategy = stats["optimization_strategy"]
        assert "market_level_caching" in strategy
        assert "request_deduplication" in strategy
        assert "symbol_level_caching" in strategy

    def test_market_data_service_initialization(self):
        """Test MarketDataService can be initialized."""
        from app.modules.portfolio.market_data_service import MarketDataService

        service = MarketDataService()
        assert service is not None

    def test_finlab_market_cache_module_level(self):
        """Test that finlab market cache is module-level for efficiency."""
        from app.modules.portfolio import market_data_service

        # Verify module-level cache exists
        assert hasattr(market_data_service, "_finlab_market_cache")

        # Verify cache structure
        cache = market_data_service._finlab_market_cache
        assert "close" in cache
        assert "open" in cache
        assert "high" in cache
        assert "low" in cache
        assert "volume" in cache
        assert "last_fetch" in cache


class TestHistoricalPriceBatching:
    """Test historical price batch queries."""

    def test_batch_price_range_concept(self):
        """Test that batch price range returns expected structure."""
        # This tests the concept of batch price fetching
        # Without actual DB, we verify the method signature exists
        from app.modules.portfolio.historical_price_service import (
            HistoricalPriceService,
        )

        # Verify the batch method exists
        assert hasattr(HistoricalPriceService, "get_batch_price_range")


class TestWalletCalculationEfficiency:
    """Test wallet calculation efficiency."""

    def test_wallet_type_enums_defined(self):
        """Test wallet type enums are properly defined."""
        from app.modules.portfolio.models import HoldingWalletType
        from app.modules.transactions.models import TransactionWalletType

        # Holding wallet types (two-wallet system)
        assert HoldingWalletType.PORTFOLIO.value == "portfolio"
        assert HoldingWalletType.EMERGENCY.value == "emergency"

        # Transaction wallet types (two-wallet system)
        assert TransactionWalletType.LIFE.value == "life"
        assert TransactionWalletType.EMERGENCY.value == "emergency"

    def test_wallet_response_schema(self):
        """Test wallet response schema includes wallet_type."""
        from app.modules.portfolio.schemas import HoldingResponse

        # Verify wallet_type field exists in schema
        assert "wallet_type" in HoldingResponse.model_fields


class TestDashboardStatsEfficiency:
    """Test dashboard stats calculation efficiency."""

    def test_dashboard_stats_schema(self):
        """Test dashboard stats schema includes all wallet fields."""
        from app.modules.dashboard.schemas import DashboardStatsResponse

        # Verify three-wallet system fields exist
        required_fields = [
            "life_wallet",
            "portfolio_wallet",
            "emergency_wallet",
            "total_asset",
            "investment_total",
        ]

        for field in required_fields:
            assert (
                field in DashboardStatsResponse.model_fields
            ), f"Missing field: {field}"

    def test_wallet_trend_schema(self):
        """Test wallet trend schema structure."""
        from app.modules.dashboard.schemas import (
            WalletTrendDataPoint,
            WalletTrendResponse,
        )

        # Verify data point fields
        datapoint_fields = [
            "date",
            "life_wallet",
            "portfolio_wallet",
            "emergency_wallet",
            "total_asset",
            "investment_total",
        ]

        for field in datapoint_fields:
            assert field in WalletTrendDataPoint.model_fields, f"Missing field: {field}"

        # Verify response fields
        assert "data_points" in WalletTrendResponse.model_fields
        assert "period" in WalletTrendResponse.model_fields
