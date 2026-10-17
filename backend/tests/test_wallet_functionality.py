"""
Test wallet functionality - three-wallet system integration tests.

This test suite ensures that:
1. Holdings can be assigned to different wallet types
2. Transactions can be categorized by wallet type
3. Portfolio stats calculate correctly for each wallet type
4. Wallet filtering works correctly
5. Cash wallet data is accurate

Wallet values below are taken from the enums rather than written as string
literals. The 2026-05-02 four-to-three-wallet migration renamed
`portfolio_performance` → `portfolio` and `urgent` → `emergency` and deleted
`investment` entirely, and this suite kept passing against all three dead names
because it compared hand-built dicts to hand-written strings. Binding to the
enums means the next rename fails here instead of rotting silently.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import date, datetime, timedelta
from decimal import Decimal
import uuid

from app.main import app
from app.modules.portfolio.models import HoldingWalletType
from app.modules.transactions.models import TransactionWalletType
from app.modules.users.dependencies import get_optional_current_user

# Holdings live in the portfolio/emergency wallets; cash lives in the
# life/emergency transaction wallets. There is deliberately no holding wallet
# for day-to-day cash — buying a holding debits Life instead.
PORTFOLIO = HoldingWalletType.PORTFOLIO.value
EMERGENCY = HoldingWalletType.EMERGENCY.value
LIFE = TransactionWalletType.LIFE.value


class TestWalletTypes:
    """Test wallet type enumerations and validations."""

    def test_holding_wallet_types(self):
        """Test HoldingWalletType enum values."""
        assert HoldingWalletType.PORTFOLIO.value == "portfolio"
        assert HoldingWalletType.EMERGENCY.value == "emergency"

    def test_transaction_wallet_types(self):
        """Test TransactionWalletType enum values."""
        assert TransactionWalletType.LIFE.value == "life"
        assert TransactionWalletType.EMERGENCY.value == "emergency"

    def test_removed_wallets_are_gone(self):
        """The 2026-05-02 migration deleted these wallets; they must not return."""
        holding_values = {e.value for e in HoldingWalletType}
        transaction_values = {e.value for e in TransactionWalletType}
        for dead in ("investment", "portfolio_performance", "urgent"):
            assert dead not in holding_values
            assert dead not in transaction_values


class TestPortfolioWalletFiltering:
    """Test portfolio endpoints with wallet type filtering."""

    @pytest.fixture
    def mock_portfolio_data(self):
        """Mock portfolio data with multiple wallet types."""
        return {
            "id": str(uuid.uuid4()),
            "name": "Test Portfolio",
            "currency": "USD",
            "total_value": 40000.0,
            "total_cost": 37000.0,
            "total_gain_loss": 3000.0,
            "total_gain_loss_percentage": 8.11,
            "holdings": [
                # Portfolio wallet holding (invested assets)
                {
                    "id": str(uuid.uuid4()),
                    "symbol": "AAPL",
                    "name": "Apple Inc.",
                    "type": "stock",
                    "wallet_type": PORTFOLIO,
                    "quantity": 100.0,
                    "average_cost": 150.0,
                    "current_price": 175.0,
                    "total_cost": 15000.0,
                    "total_value": 17500.0,
                    "gain_loss": 2500.0,
                    "gain_loss_percentage": 16.67,
                    "currency": "USD",
                    "exchange": "NASDAQ",
                    "sector": "Technology",
                },
                # Another portfolio wallet holding
                {
                    "id": str(uuid.uuid4()),
                    "symbol": "GOOGL",
                    "name": "Alphabet Inc.",
                    "type": "stock",
                    "wallet_type": PORTFOLIO,
                    "quantity": 50.0,
                    "average_cost": 140.0,
                    "current_price": 150.0,
                    "total_cost": 7000.0,
                    "total_value": 7500.0,
                    "gain_loss": 500.0,
                    "gain_loss_percentage": 7.14,
                    "currency": "USD",
                    "exchange": "NASDAQ",
                    "sector": "Technology",
                },
                # Emergency wallet holding (emergency fund parked as a holding)
                {
                    "id": str(uuid.uuid4()),
                    "symbol": "EMERGENCY_FUND",
                    "name": "Emergency Fund",
                    "type": "cash",
                    "wallet_type": EMERGENCY,
                    "quantity": 15000.0,
                    "average_cost": 1.0,
                    "current_price": 1.0,
                    "total_cost": 15000.0,
                    "total_value": 15000.0,
                    "gain_loss": 0.0,
                    "gain_loss_percentage": 0.0,
                    "currency": "USD",
                    "exchange": "N/A",
                },
            ],
        }

    def test_portfolio_all_wallets(self, mock_portfolio_data):
        """Test portfolio endpoint returns all wallet types by default."""
        client = TestClient(app)

        # Force the unauthenticated path so the endpoint returns the demo
        # portfolio. Override the FastAPI dependency rather than patching a
        # module attribute — the route binds the dependency by reference at
        # registration time, so a patch would not take effect.
        app.dependency_overrides[get_optional_current_user] = lambda: None
        try:
            # Should return demo portfolio with all wallet types
            response = client.get("/api/v1/portfolio/")

            assert response.status_code == 200
            data = response.json()
            assert "holdings" in data
            assert len(data["holdings"]) > 0
        finally:
            app.dependency_overrides.pop(get_optional_current_user, None)

    def test_portfolio_wallet_type_filtering_concept(self, mock_portfolio_data):
        """Test that wallet type filtering concept is implemented correctly."""
        # This test validates the frontend filtering logic
        aggregated_holdings = mock_portfolio_data["holdings"]

        # Test filtering by portfolio
        filtered = [h for h in aggregated_holdings if h["wallet_type"] == PORTFOLIO]
        assert len(filtered) == 2
        assert sum(h["total_value"] for h in filtered) == 25000.0

        # Test filtering by emergency
        filtered = [h for h in aggregated_holdings if h["wallet_type"] == EMERGENCY]
        assert len(filtered) == 1
        assert sum(h["total_value"] for h in filtered) == 15000.0

        # Every holding belongs to one of the two holding wallets
        assert {h["wallet_type"] for h in aggregated_holdings} == {PORTFOLIO, EMERGENCY}

        # Test all wallets (no filter)
        assert len(aggregated_holdings) == 3
        assert sum(h["total_value"] for h in aggregated_holdings) == 40000.0


class TestWalletStatCalculations:
    """Test that portfolio stats calculate correctly with wallet filtering."""

    def test_filtered_stats_calculation(self):
        """Test that stats are calculated correctly from filtered holdings."""

        # Sample holdings
        holdings = [
            {
                "symbol": "AAPL",
                "wallet_type": PORTFOLIO,
                "total_value": 17500.0,
                "total_cost": 15000.0,
            },
            {
                "symbol": "GOOGL",
                "wallet_type": PORTFOLIO,
                "total_value": 7500.0,
                "total_cost": 7000.0,
            },
            {
                "symbol": "EMERGENCY",
                "wallet_type": EMERGENCY,
                "total_value": 15000.0,
                "total_cost": 15000.0,
            },
        ]

        # Test all wallets stats
        all_total_value = sum(h["total_value"] for h in holdings)
        all_total_cost = sum(h["total_cost"] for h in holdings)
        all_gain_loss = all_total_value - all_total_cost
        all_gain_loss_pct = (
            (all_gain_loss / all_total_cost) * 100 if all_total_cost > 0 else 0
        )

        assert all_total_value == 40000.0
        assert all_total_cost == 37000.0
        assert all_gain_loss == 3000.0
        assert abs(all_gain_loss_pct - 8.11) < 0.01  # ~8.11%

        # Test portfolio wallet stats only
        portfolio_holdings = [h for h in holdings if h["wallet_type"] == PORTFOLIO]
        portfolio_total_value = sum(h["total_value"] for h in portfolio_holdings)
        portfolio_total_cost = sum(h["total_cost"] for h in portfolio_holdings)
        portfolio_gain_loss = portfolio_total_value - portfolio_total_cost
        portfolio_gain_loss_pct = (
            (portfolio_gain_loss / portfolio_total_cost) * 100
            if portfolio_total_cost > 0
            else 0
        )

        assert portfolio_total_value == 25000.0
        assert portfolio_total_cost == 22000.0
        assert portfolio_gain_loss == 3000.0
        assert abs(portfolio_gain_loss_pct - 13.64) < 0.01  # ~13.64%

        # Test emergency wallet stats (cash-like, so no gain/loss)
        emergency_holdings = [h for h in holdings if h["wallet_type"] == EMERGENCY]
        emergency_total_value = sum(h["total_value"] for h in emergency_holdings)
        emergency_total_cost = sum(h["total_cost"] for h in emergency_holdings)
        emergency_gain_loss = emergency_total_value - emergency_total_cost

        assert emergency_total_value == 15000.0
        assert emergency_total_cost == 15000.0
        assert emergency_gain_loss == 0.0


class TestCashWalletEndpoint:
    """Test cash wallet endpoint functionality."""

    def test_cash_wallet_endpoint_requires_auth(self):
        """Test cash wallet endpoint requires authentication."""
        client = TestClient(app)

        response = client.get("/api/v1/portfolio/cash-wallet")

        # Should require authentication
        assert response.status_code == 401

    def test_cash_wallet_response_structure(self):
        """Test expected cash wallet response structure."""
        # This validates the expected structure without making actual API call
        expected_structure = {
            "wallets": [
                {
                    "portfolio_id": "uuid-string",
                    "currency": "USD",
                    "balance": 10000.0,
                    "symbol": "CASH_USD",
                    "last_updated": "2024-01-01T00:00:00",
                }
            ],
            "total_wallets": 1,
        }

        # Validate structure
        assert "wallets" in expected_structure
        assert "total_wallets" in expected_structure
        assert isinstance(expected_structure["wallets"], list)

        if expected_structure["wallets"]:
            wallet = expected_structure["wallets"][0]
            required_fields = ["currency", "balance", "symbol"]
            for field in required_fields:
                assert field in wallet


class TestTransactionWalletTypes:
    """Test transaction wallet type functionality."""

    def test_transaction_with_wallet_type_demo_mode(self):
        """Test creating transaction with wallet type in demo mode."""
        client = TestClient(app)

        # Get demo transactions to verify wallet_type field exists
        response = client.get("/api/v1/transactions/")
        assert response.status_code == 200

        data = response.json()
        if data.get("total", 0) > 0:
            transaction = data["transactions"][0]
            # A populated wallet_type must be one the transaction enum still
            # knows about — this is what would have caught the dead
            # `investment` value surviving the three-wallet migration.
            wallet_type = transaction.get("wallet_type")
            if wallet_type is not None:
                assert wallet_type in {e.value for e in TransactionWalletType}


class TestWalletSystemIntegration:
    """Integration tests for the three-wallet system."""

    def test_wallet_type_consistency(self):
        """Test that wallet types are consistent across holdings and transactions."""

        # Verify holding wallet types match enum values
        holding_types = [PORTFOLIO, EMERGENCY]
        for wtype in holding_types:
            assert wtype in [e.value for e in HoldingWalletType]

        # Verify transaction wallet types match enum values
        transaction_types = [LIFE, EMERGENCY]
        for wtype in transaction_types:
            assert wtype in [e.value for e in TransactionWalletType]

    def test_wallet_count_and_types(self):
        """Test wallet type counts as per system design."""

        # Portfolio holdings: 2 wallet types (portfolio, emergency)
        assert len(HoldingWalletType) == 2

        # Transactions: 2 wallet types (life, emergency)
        assert len(TransactionWalletType) == 2

    def test_life_is_cash_only_and_portfolio_is_holdings_only(self):
        """The two enums are deliberately different sets, not copies."""
        # Cash never sits in the portfolio wallet...
        assert "portfolio" not in {e.value for e in TransactionWalletType}
        # ...and holdings never sit in the life wallet.
        assert "life" not in {e.value for e in HoldingWalletType}
        # Emergency is the one wallet that appears in both.
        assert "emergency" in {e.value for e in TransactionWalletType}
        assert "emergency" in {e.value for e in HoldingWalletType}


class TestDashboardStatsWithWallets:
    """Test dashboard stats calculations with wallet filtering."""

    def test_dashboard_stats_endpoint_structure(self):
        """Test that dashboard stats endpoint returns correct structure."""
        client = TestClient(app)

        response = client.get("/api/v1/dashboard/stats")

        # Demo mode should return successful response
        assert response.status_code == 200
        data = response.json()

        # Validate response structure (demo mode returns nested data)
        assert "success" in data or "data" in data

        # If data field exists, validate it contains financial metrics
        if "data" in data:
            stats_data = data["data"]
            # Should contain at least one financial metric
            assert any(
                key in stats_data
                for key in [
                    "total_balance",
                    "life_wallet",
                    "investment_total",
                    "portfolio_wallet",
                    "emergency_wallet",
                ]
            )

    def test_wallet_balance_calculations(self):
        """Test that wallet balances are calculated correctly."""

        # Test Life Wallet calculation (income - expenses)
        life_transactions = [
            {"type": "income", "amount": 50000.0},
            {"type": "expense", "amount": 15000.0},
            {"type": "expense", "amount": 8000.0},
        ]

        life_balance = sum(
            t["amount"] if t["type"] == "income" else -t["amount"]
            for t in life_transactions
        )
        assert life_balance == 27000.0

        # Test Portfolio wallet (sum of portfolio holdings)
        portfolio_holdings = [
            {"wallet_type": PORTFOLIO, "total_value": 17500.0},
            {"wallet_type": PORTFOLIO, "total_value": 7500.0},
        ]

        portfolio_balance = sum(h["total_value"] for h in portfolio_holdings)
        assert portfolio_balance == 25000.0

        # Test Emergency wallet (sum of emergency holdings)
        emergency_holdings = [
            {"wallet_type": EMERGENCY, "total_value": 15000.0},
        ]

        emergency_balance = sum(h["total_value"] for h in emergency_holdings)
        assert emergency_balance == 15000.0

        # Total Asset = life + portfolio + emergency
        total_asset = life_balance + portfolio_balance + emergency_balance
        assert total_asset == 67000.0


class TestPortfolioStatsWithWallets:
    """Test portfolio stats calculations with wallet filtering."""

    @pytest.fixture
    def all_holdings(self):
        return [
            {
                "wallet_type": PORTFOLIO,
                "total_value": 17500.0,
                "total_cost": 15000.0,
            },
            {
                "wallet_type": PORTFOLIO,
                "total_value": 7500.0,
                "total_cost": 7000.0,
            },
            {
                "wallet_type": EMERGENCY,
                "total_value": 15000.0,
                "total_cost": 15000.0,
            },
        ]

    def test_portfolio_stats_all_wallets(self, all_holdings):
        """Test portfolio stats when showing all wallets."""

        total_value = sum(h["total_value"] for h in all_holdings)
        total_cost = sum(h["total_cost"] for h in all_holdings)
        gain_loss = total_value - total_cost
        gain_loss_pct = (gain_loss / total_cost) * 100 if total_cost > 0 else 0

        assert total_value == 40000.0
        assert total_cost == 37000.0
        assert gain_loss == 3000.0
        assert abs(gain_loss_pct - 8.11) < 0.01

    def test_portfolio_stats_portfolio_wallet_only(self, all_holdings):
        """Test portfolio stats filtered to the portfolio wallet only."""

        filtered = [h for h in all_holdings if h["wallet_type"] == PORTFOLIO]

        total_value = sum(h["total_value"] for h in filtered)
        total_cost = sum(h["total_cost"] for h in filtered)
        gain_loss = total_value - total_cost
        gain_loss_pct = (gain_loss / total_cost) * 100 if total_cost > 0 else 0

        assert total_value == 25000.0
        assert total_cost == 22000.0
        assert gain_loss == 3000.0
        assert abs(gain_loss_pct - 13.64) < 0.01

    def test_portfolio_stats_emergency_wallet_only(self, all_holdings):
        """Test portfolio stats filtered to the emergency wallet only."""

        filtered = [h for h in all_holdings if h["wallet_type"] == EMERGENCY]

        total_value = sum(h["total_value"] for h in filtered)
        total_cost = sum(h["total_cost"] for h in filtered)
        gain_loss = total_value - total_cost
        gain_loss_pct = (gain_loss / total_cost) * 100 if total_cost > 0 else 0

        assert total_value == 15000.0
        assert total_cost == 15000.0
        assert gain_loss == 0.0
        assert gain_loss_pct == 0.0

    def test_portfolio_stats_with_losses(self):
        """Test portfolio stats calculations with negative gains (losses)."""

        holdings_with_losses = [
            {
                "wallet_type": PORTFOLIO,
                "total_value": 8000.0,
                "total_cost": 10000.0,
            },  # -2000 loss
            {
                "wallet_type": PORTFOLIO,
                "total_value": 4500.0,
                "total_cost": 5000.0,
            },  # -500 loss
        ]

        total_value = sum(h["total_value"] for h in holdings_with_losses)
        total_cost = sum(h["total_cost"] for h in holdings_with_losses)
        gain_loss = total_value - total_cost
        gain_loss_pct = (gain_loss / total_cost) * 100 if total_cost > 0 else 0

        assert total_value == 12500.0
        assert total_cost == 15000.0
        assert gain_loss == -2500.0
        assert abs(gain_loss_pct - (-16.67)) < 0.01

    def test_portfolio_stats_empty_wallet(self):
        """Test portfolio stats with empty wallet (no holdings)."""

        all_holdings = [
            {
                "wallet_type": PORTFOLIO,
                "total_value": 17500.0,
                "total_cost": 15000.0,
            },
        ]

        # Filter to emergency wallet (empty)
        filtered = [h for h in all_holdings if h["wallet_type"] == EMERGENCY]

        total_value = sum(h["total_value"] for h in filtered)
        total_cost = sum(h["total_cost"] for h in filtered)
        gain_loss = total_value - total_cost
        gain_loss_pct = (gain_loss / total_cost) * 100 if total_cost > 0 else 0

        assert total_value == 0.0
        assert total_cost == 0.0
        assert gain_loss == 0.0
        assert gain_loss_pct == 0.0


class TestUserFacingCalculations:
    """Test calculations that users directly see in the UI."""

    def test_stat_card_display_values(self):
        """Test the exact values that appear in portfolio stat cards."""

        # Simulate real user portfolio data
        user_holdings = [
            # Apple stock in the portfolio wallet
            {
                "symbol": "AAPL",
                "wallet_type": PORTFOLIO,
                "quantity": 100,
                "average_cost": 150.0,
                "current_price": 175.0,
                "total_value": 17500.0,
                "total_cost": 15000.0,
            },
            # Google stock in the portfolio wallet
            {
                "symbol": "GOOGL",
                "wallet_type": PORTFOLIO,
                "quantity": 50,
                "average_cost": 140.0,
                "current_price": 150.0,
                "total_value": 7500.0,
                "total_cost": 7000.0,
            },
            # Emergency fund parked in the emergency wallet
            {
                "symbol": "EMERGENCY_FUND",
                "wallet_type": EMERGENCY,
                "quantity": 15000,
                "average_cost": 1.0,
                "current_price": 1.0,
                "total_value": 15000.0,
                "total_cost": 15000.0,
            },
        ]

        # Test "All Wallets" view - what user sees when no filter is applied
        all_total_value = sum(h["total_value"] for h in user_holdings)
        all_total_cost = sum(h["total_cost"] for h in user_holdings)
        all_gain_loss = all_total_value - all_total_cost
        all_gain_pct = (all_gain_loss / all_total_cost) * 100

        assert all_total_value == 40000.0  # Stat Card 1: Total Value
        assert all_total_cost == 37000.0
        assert all_gain_loss == 3000.0  # Stat Card 2: Total Gain/Loss
        assert abs(all_gain_pct - 8.11) < 0.01  # 8.11% gain

        # Test "Portfolio" filter - what user sees when filtering investments
        portfolio_holdings = [
            h for h in user_holdings if h["wallet_type"] == PORTFOLIO
        ]
        portfolio_value = sum(h["total_value"] for h in portfolio_holdings)
        portfolio_cost = sum(h["total_cost"] for h in portfolio_holdings)
        portfolio_gain = portfolio_value - portfolio_cost
        portfolio_gain_pct = (portfolio_gain / portfolio_cost) * 100

        assert portfolio_value == 25000.0  # Should show $25,000
        assert portfolio_gain == 3000.0  # Should show +$3,000
        assert abs(portfolio_gain_pct - 13.64) < 0.01  # Should show +13.64%

        # Test "Emergency" filter - what user sees for the reserve
        emergency_holdings = [
            h for h in user_holdings if h["wallet_type"] == EMERGENCY
        ]
        emergency_value = sum(h["total_value"] for h in emergency_holdings)

        assert emergency_value == 15000.0  # Stat Card 4: Emergency Fund

    def test_dashboard_total_asset(self):
        """Test the Total Asset calculation shown on dashboard."""

        # Simulate complete user financial picture
        life_wallet_balance = 27000.0  # Life expenses/income net
        portfolio_wallet = 25000.0  # Invested assets
        emergency_wallet = 15000.0  # Emergency fund

        total_asset = life_wallet_balance + portfolio_wallet + emergency_wallet

        # This is the main number user sees on dashboard
        assert total_asset == 67000.0

    def test_net_worth_subtracts_debt(self):
        """Net worth is Total Asset minus debt, not an alias for Total Asset."""
        total_asset = 67000.0
        total_debt = 15000.0

        net_worth = total_asset - total_debt

        assert net_worth == 52000.0
        assert net_worth != total_asset

    def test_percentage_display_formatting(self):
        """Test that gain/loss percentages are calculated correctly for display."""

        test_cases = [
            # (total_value, total_cost, expected_percentage)
            (11000.0, 10000.0, 10.0),  # 10% gain
            (9000.0, 10000.0, -10.0),  # 10% loss
            (15000.0, 10000.0, 50.0),  # 50% gain
            (5000.0, 10000.0, -50.0),  # 50% loss
            (10100.0, 10000.0, 1.0),  # 1% gain
            (10000.0, 10000.0, 0.0),  # Break even
        ]

        for total_value, total_cost, expected_pct in test_cases:
            gain_loss = total_value - total_cost
            calculated_pct = (gain_loss / total_cost) * 100 if total_cost > 0 else 0
            assert abs(calculated_pct - expected_pct) < 0.01


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
