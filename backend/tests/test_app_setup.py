"""
Test FastAPI application setup and basic functionality.
"""

import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

from app.core.config import get_settings
from app.main import app

settings = get_settings()


class TestApplicationSetup:
    """Test basic application setup and configuration"""
    
    def setup_method(self):
        """Set up test client"""
        self.client = TestClient(app)
    
    def test_health_check(self):
        """Test basic health check endpoint"""
        response = self.client.get("/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "aspiro-backend"

    def test_health_check_reports_build_commit(self, monkeypatch):
        """/health names the commit the image was built from (GIT_SHA build arg)."""
        monkeypatch.setenv("GIT_SHA", "abc123")
        assert self.client.get("/health").json()["commit"] == "abc123"
        monkeypatch.delenv("GIT_SHA")
        assert self.client.get("/health").json()["commit"] == "unknown"

    def test_detailed_health_check(self):
        """Test detailed health check endpoint requires auth key"""
        # Without the X-Health-Key header the endpoint returns 401
        response = self.client.get("/health/detailed")
        assert response.status_code == 401
    
    def test_openapi_docs_track_the_docs_flag(self):
        """Interactive docs are exposed only when ENABLE_API_DOCS is on.

        main.py sets docs_url/redoc_url/openapi_url to None unless
        settings.ENABLE_API_DOCS, which defaults to False. This asserts the
        gating rather than a flat 200, so it is honest both in the dev container
        (which opts in via docker-compose.yml) and under a bare CI environment.

        The gate used to be DEBUG. It moved because DEBUG is true on every stack
        built from docker-compose.yml, including the internet-facing self-hosted
        one — see tests/test_security_posture.py.
        """
        response = self.client.get("/docs")
        if settings.ENABLE_API_DOCS:
            assert response.status_code == 200
            assert "text/html" in response.headers.get("content-type", "")
        else:
            assert response.status_code == 404

    def test_openapi_schema_tracks_the_docs_flag(self):
        """Same gating for the raw schema."""
        response = self.client.get("/openapi.json")
        if not settings.ENABLE_API_DOCS:
            assert response.status_code == 404
            return

        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "info" in schema
        assert schema["info"]["title"] == "Aspiro API"
    
    def test_cors_headers(self):
        """Test CORS configuration"""
        # Test preflight request
        response = self.client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET"
            }
        )
        
        # CORS should be properly configured
        assert response.status_code in [200, 204]


class TestAuthenticationEndpoints:
    """Test authentication-related endpoints"""
    
    def setup_method(self):
        """Set up test client"""
        self.client = TestClient(app)
    
    def test_auth_endpoints_exist(self):
        """Test that auth endpoints are properly mounted"""
        # Registration is at /api/v1/users/register, login at /api/v1/auth/login
        response = self.client.post("/api/v1/users/register", json={})
        assert response.status_code == 422  # Validation error, not 404

        response = self.client.post("/api/v1/auth/login", json={})
        assert response.status_code == 422  # Validation error, not 404


class TestUserEndpoints:
    """Test user management endpoints"""
    
    def setup_method(self):
        """Set up test client"""
        self.client = TestClient(app)
    
    def test_user_endpoints_exist(self):
        """Test that user endpoints are properly mounted"""
        # These should require authentication (401) rather than not exist (404)
        response = self.client.get("/api/v1/users/me")
        assert response.status_code in (401, 403)  # Auth required, not 404


@pytest.mark.asyncio
async def test_async_client():
    """Test async client functionality"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestModuleImports:
    """Test that all modules can be imported correctly"""
    
    def test_core_imports(self):
        """Test core module imports"""
        from app.core import config, database
        assert config is not None
        assert database is not None
    
    def test_common_imports(self):
        """Test common module imports"""
        from app.common import schemas
        assert schemas is not None
    
    def test_utils_imports(self):
        """Test utils module imports"""
        from app.utils import currency_helpers, datetime_helpers
        assert currency_helpers is not None
        assert datetime_helpers is not None
    
    def test_module_routers_import(self):
        """Test that module routers can be imported"""
        from app.modules.auth import router as auth_router
        from app.modules.users import router_simple as users_router
        from app.modules.dashboard import router as dashboard_router
        
        assert auth_router is not None
        assert users_router is not None
        assert dashboard_router is not None


class TestUtilityFunctions:
    """Test utility functions"""
    
    def test_currency_helpers(self):
        """Test currency helper functions"""
        from app.utils.currency_helpers import format_currency, get_currency_symbol
        
        formatted = format_currency(1234.56, "USD")
        assert "$" in formatted
        
        symbol = get_currency_symbol("SGD")
        assert symbol == "S$"
    
    def test_datetime_helpers(self):
        """Test datetime helper functions"""
        from app.utils.datetime_helpers import utc_now, format_datetime
        from datetime import datetime
        
        now = utc_now()
        assert isinstance(now, datetime)
        assert now.tzinfo is not None
        
        formatted = format_datetime(now, "iso")
        assert "T" in formatted


if __name__ == "__main__":
    pytest.main([__file__])