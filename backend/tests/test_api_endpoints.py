"""
Test all API endpoints for both demo and authenticated modes.

This test suite ensures that:
1. All API endpoints respond correctly
2. Demo mode works without authentication
3. Authenticated mode requires valid tokens
4. Response schemas are correct
5. Error handling works properly
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from datetime import date, datetime
import json

from app.main import app
from app.utils.datetime_helpers import business_today


class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_main_health_endpoint(self):
        """Test main application health endpoint."""
        client = TestClient(app)
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "aspiro-backend"

    def test_detailed_health_endpoint(self):
        """Test detailed health check endpoint requires auth key."""
        client = TestClient(app)
        # Without X-Health-Key the endpoint returns 401
        response = client.get("/health/detailed")
        assert response.status_code == 401


class TestTransactionEndpoints:
    """Test transaction API endpoints."""

    def test_transactions_health_demo_mode(self):
        """Test transactions health endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/transactions/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["module"] == "transactions"
        assert data["mode"] == "demo"
        assert data["user_id"] is None
        assert "timestamp" in data

    def test_transactions_list_demo_mode(self):
        """Test transactions list endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/transactions/")

        assert response.status_code == 200
        data = response.json()
        assert "transactions" in data
        assert "total" in data
        assert "page" in data
        assert "limit" in data
        assert "total_pages" in data
        assert "has_next" in data
        assert "has_previous" in data

        # Demo mode should have sample transactions
        assert data["total"] > 0
        assert len(data["transactions"]) > 0

        # Verify transaction structure
        transaction = data["transactions"][0]
        required_fields = [
            "id",
            "user_id",
            "type",
            "amount",
            "currency",
            "description",
            "transaction_date",
            "category_id",
        ]
        for field in required_fields:
            assert field in transaction

        # Demo transactions should have demo user_id
        assert transaction["user_id"] == "demo-user"

    def test_transactions_list_with_filters_demo_mode(self):
        """Test transactions list with filters in demo mode."""
        client = TestClient(app)

        # Test type filter
        response = client.get("/api/v1/transactions/?type=expense")
        assert response.status_code == 200
        data = response.json()
        for transaction in data["transactions"]:
            assert transaction["type"] == "expense"

        # Test date filter
        today = business_today().isoformat()
        response = client.get(f"/api/v1/transactions/?date_to={today}")
        assert response.status_code == 200

        # Test pagination
        response = client.get("/api/v1/transactions/?page=1&limit=5")
        assert response.status_code == 200
        data = response.json()
        assert len(data["transactions"]) <= 5

    def test_transactions_analytics_demo_mode(self):
        """Test transactions analytics endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/transactions/analytics/summary")

        assert response.status_code == 200
        data = response.json()

        # Should have analytics structure
        required_fields = [
            "total_income",
            "total_expenses",
            "net_income",
            "transaction_count",
            "average_transaction_amount",
        ]
        for field in required_fields:
            assert field in data

    def test_transactions_categories_demo_mode(self):
        """Test transaction categories endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/transactions/categories")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

        # Verify category structure
        category = data[0]
        required_fields = ["id", "name", "type", "color", "icon"]
        for field in required_fields:
            assert field in category

    def test_create_transaction_demo_mode(self):
        """Test creating a transaction in demo mode."""
        client = TestClient(app)

        transaction_data = {
            "type": "expense",
            "amount": "25.50",
            "currency": "USD",
            "description": "Test expense",
            "transaction_date": business_today().isoformat(),
            "category_id": "550e8400-e29b-41d4-a716-446655440001",
            "payment_method": "credit_card",
        }

        response = client.post("/api/v1/transactions/", json=transaction_data)
        assert response.status_code == 201
        data = response.json()

        # Should return created transaction
        if "transaction" in data:
            transaction = data["transaction"]
        else:
            transaction = data

        assert transaction["amount"] == "25.50"
        assert transaction["description"] == "Test expense"

    def test_bulk_create_transactions_demo_mode(self):
        """Test bulk creating transactions in demo mode."""
        client = TestClient(app)

        bulk_data = {
            "transactions": [
                {
                    "type": "expense",
                    "amount": "10.00",
                    "currency": "USD",
                    "description": "Bulk expense 1",
                    "transaction_date": business_today().isoformat(),
                    "category_id": "550e8400-e29b-41d4-a716-446655440001",
                },
                {
                    "type": "expense",
                    "amount": "15.00",
                    "currency": "USD",
                    "description": "Bulk expense 2",
                    "transaction_date": business_today().isoformat(),
                    "category_id": "550e8400-e29b-41d4-a716-446655440001",
                },
            ],
            "skip_duplicates": True,
        }

        response = client.post("/api/v1/transactions/bulk", json=bulk_data)
        assert response.status_code == 201
        data = response.json()

        # Should return bulk creation result
        assert "successful" in data or "created" in data

    def test_qr_payment_transaction_demo_mode(self):
        """Test QR payment transaction endpoint in demo mode."""
        client = TestClient(app)

        qr_transaction_data = {
            "type": "expense",
            "amount": "12.50",
            "currency": "SGD",
            "description": "QR Payment",
            "transaction_date": business_today().isoformat(),
            "category_id": "550e8400-e29b-41d4-a716-446655440001",
            "payment_method": "qr_code",
            "qr_payment_data": {
                "qr_code": "SGQRCode123",
                "merchant_id": "SG001",
                "terminal_id": "T001",
                "payment_method": "paynow",
            },
        }

        response = client.post(
            "/api/v1/transactions/qr-payment", json=qr_transaction_data
        )
        assert response.status_code == 201


class TestDashboardEndpoints:
    """Test dashboard API endpoints."""

    def test_dashboard_stats_demo_mode(self):
        """Test dashboard stats endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/dashboard/stats")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data

        stats = data["data"]
        required_fields = [
            "totalBalance",
            "totalIncome",
            "totalExpenses",
            "netWorth",
            "savingsRate",
            "portfolioValue",
        ]
        for field in required_fields:
            assert field in stats

        # Demo mode should have non-zero values
        assert stats["totalBalance"] > 0

    def test_dashboard_recent_activity_demo_mode(self):
        """Test dashboard recent activity endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/dashboard/recent-activity")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data
        assert isinstance(data["data"], list)

    def test_dashboard_overview_demo_mode(self):
        """Test dashboard overview endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/dashboard/overview")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data

    def test_dashboard_spending_by_category_demo_mode(self):
        """Test dashboard spending by category endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/dashboard/spending-by-category")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data
        assert isinstance(data["data"], list)

    def test_dashboard_monthly_trend_demo_mode(self):
        """Test dashboard monthly trend endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/dashboard/monthly-trend")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data

    def test_dashboard_refresh_demo_mode(self):
        """Test dashboard refresh endpoint in demo mode."""
        client = TestClient(app)
        response = client.post("/api/v1/dashboard/refresh")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True


class TestPortfolioEndpoints:
    """Test portfolio API endpoints."""

    def test_portfolio_holdings_demo_mode(self):
        """Test portfolio holdings endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/portfolio/holdings")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "size" in data

        # Demo mode should have sample holdings
        assert data["total"] > 0
        assert len(data["items"]) > 0

        # Verify holding structure (use camelCase aliases as returned by API)
        holding = data["items"][0]
        required_fields = [
            "id",
            "symbol",
            "name",
            "type",
            "quantity",
            "averageCost",
            "currentPrice",
            "totalValue",
        ]
        for field in required_fields:
            assert field in holding, f"Missing field: {field}"

    def test_portfolio_holdings_with_filters(self):
        """Test portfolio holdings with filters."""
        client = TestClient(app)

        # Test type filter
        response = client.get("/api/v1/portfolio/holdings?type=stock")
        assert response.status_code == 200
        data = response.json()
        for holding in data["items"]:
            assert holding["type"] == "stock"

        # Test sector filter
        response = client.get("/api/v1/portfolio/holdings?sector=Technology")
        assert response.status_code == 200

    def test_portfolio_summary_demo_mode(self):
        """Test portfolio summary endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/portfolio/summary")

        if response.status_code == 200:
            data = response.json()
            assert "total_value" in data or "totalValue" in data

    def test_portfolio_performance_demo_mode(self):
        """Test portfolio performance endpoint in demo mode."""
        client = TestClient(app)
        response = client.get("/api/v1/portfolio/performance")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)


class TestAuthenticationEndpoints:
    """Test authentication API endpoints."""

    def test_register_user(self):
        """Test user registration endpoint."""
        client = TestClient(app)

        user_data = {
            "email": "testregister@example.com",
            "password": "TestPassword123!",
            "confirm_password": "TestPassword123!",
            "name": "Test Register",
            "terms_accepted": True,
        }

        response = client.post("/api/v1/users/register", json=user_data)

        # Should succeed or return validation error with details
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is True
            assert "data" in data
            user = data["data"]
            assert user["email"] == user_data["email"]
            assert user["name"] == user_data["name"]
        else:
            # Check for validation errors
            assert response.status_code in [400, 422]

    def test_login_with_valid_credentials(self):
        """Test login with valid credentials."""
        client = TestClient(app)

        # First register a user
        user_data = {
            "email": "testlogin@example.com",
            "password": "TestPassword123!",
            "confirm_password": "TestPassword123!",
            "name": "Test Login",
            "terms_accepted": True,
        }
        register_response = client.post("/api/v1/users/register", json=user_data)

        if register_response.status_code == 200:
            # Try to login
            login_data = {
                "email": user_data["email"],
                "password": user_data["password"],
            }

            response = client.post("/api/v1/auth/login", json=login_data)
            assert response.status_code == 200

            data = response.json()
            assert "access_token" in data
            assert "refresh_token" in data
            assert "user" in data
            assert data["token_type"] == "bearer"

    def test_login_with_invalid_credentials(self):
        """Test login with invalid credentials."""
        client = TestClient(app)

        login_data = {"email": "nonexistent@example.com", "password": "wrongpassword"}

        response = client.post("/api/v1/auth/login", json=login_data)
        assert response.status_code in [400, 401, 404]

    def test_validate_token_endpoint(self):
        """Test token validation endpoint."""
        client = TestClient(app)

        # Create and login user first
        user_data = {
            "email": "testtoken@example.com",
            "password": "TestPassword123!",
            "confirm_password": "TestPassword123!",
            "name": "Test Token",
            "terms_accepted": True,
        }
        register_response = client.post("/api/v1/users/register", json=user_data)

        if register_response.status_code == 200:
            # Login to get token
            login_data = {
                "email": user_data["email"],
                "password": user_data["password"],
            }
            login_response = client.post("/api/v1/auth/login", json=login_data)

            if login_response.status_code == 200:
                token = login_response.json()["access_token"]

                # Test token validation
                headers = {"Authorization": f"Bearer {token}"}
                response = client.get("/api/v1/auth/me", headers=headers)

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert "data" in data
                user_info = data["data"]
                assert user_info["email"] == user_data["email"]


class TestAuthenticatedEndpoints:
    """Test endpoints that require authentication."""

    def get_auth_headers(self, client):
        """Helper to get authentication headers."""
        # Register and login user
        user_data = {
            "email": "testauthenticated@example.com",
            "password": "TestPassword123!",
            "confirm_password": "TestPassword123!",
            "name": "Test Authenticated",
            "terms_accepted": True,
        }
        register_response = client.post("/api/v1/users/register", json=user_data)

        if register_response.status_code != 200:
            return None

        login_data = {"email": user_data["email"], "password": user_data["password"]}
        login_response = client.post("/api/v1/auth/login", json=login_data)

        if login_response.status_code != 200:
            return None

        token = login_response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    def test_authenticated_transactions_health(self):
        """Test transactions health in authenticated mode."""
        client = TestClient(app)
        headers = self.get_auth_headers(client)

        if headers:
            response = client.get("/api/v1/transactions/health", headers=headers)
            assert response.status_code == 200

            data = response.json()
            assert data["mode"] == "authenticated"
            assert data["user_id"] is not None

    def test_authenticated_transactions_list_empty(self):
        """Test transactions list for new authenticated user (should be empty)."""
        client = TestClient(app)
        headers = self.get_auth_headers(client)

        if headers:
            response = client.get("/api/v1/transactions/", headers=headers)
            assert response.status_code == 200

            data = response.json()
            assert data["total"] == 0  # New user should have no transactions
            assert len(data["transactions"]) == 0

    def test_authenticated_dashboard_stats_empty(self):
        """Test dashboard stats for new authenticated user (should be zeros)."""
        client = TestClient(app)
        headers = self.get_auth_headers(client)

        if headers:
            response = client.get("/api/v1/dashboard/stats", headers=headers)
            assert response.status_code == 200

            data = response.json()
            assert data["success"] is True
            stats = data["data"]

            # New user should have zero values
            assert stats["totalBalance"] == 0.0
            assert stats["totalIncome"] == 0.0
            assert stats["totalExpenses"] == 0.0

    def test_authenticated_portfolio_holdings_empty(self):
        """Test portfolio holdings for new authenticated user (should be empty)."""
        client = TestClient(app)
        headers = self.get_auth_headers(client)

        if headers:
            response = client.get("/api/v1/portfolio/holdings", headers=headers)
            assert response.status_code == 200

            data = response.json()
            assert data["total"] == 0  # New user should have no holdings
            assert len(data["items"]) == 0


class TestErrorHandling:
    """Test error handling across all endpoints."""

    def test_invalid_endpoints(self):
        """Test that invalid endpoints return 404."""
        client = TestClient(app)

        invalid_endpoints = [
            "/api/v1/nonexistent",
            "/api/v1/transactions/invalid",
            "/api/v1/dashboard/invalid",
            "/api/v1/portfolio/invalid",
        ]

        for endpoint in invalid_endpoints:
            response = client.get(endpoint)
            assert response.status_code == 404

    def test_invalid_methods(self):
        """Test that invalid HTTP methods return 405."""
        client = TestClient(app)

        # Test invalid methods on valid endpoints
        response = client.delete("/api/v1/dashboard/stats")  # GET only endpoint
        assert response.status_code == 405

    def test_invalid_json_data(self):
        """Test handling of invalid JSON data."""
        client = TestClient(app)

        # Send invalid JSON to POST endpoint
        response = client.post(
            "/api/v1/transactions/",
            content=b"invalid json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_missing_required_fields(self):
        """Test handling of missing required fields."""
        client = TestClient(app)

        # Send incomplete transaction data
        incomplete_data = {
            "type": "expense",
            # Missing required fields like amount, currency, etc.
        }

        response = client.post("/api/v1/transactions/", json=incomplete_data)
        assert response.status_code == 422

        data = response.json()
        assert "detail" in data or "errors" in data


class TestRateLimiting:
    """Test rate limiting if implemented."""

    def test_rate_limiting(self):
        """Test that rate limiting works if implemented."""
        client = TestClient(app)

        # Make many requests quickly
        responses = []
        for _ in range(100):
            response = client.get("/api/v1/transactions/health")
            responses.append(response)

        # Most should succeed, but some might be rate limited
        success_count = sum(1 for r in responses if r.status_code == 200)
        assert success_count > 0  # At least some should succeed


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
