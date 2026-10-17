"""
Integration tests for user management system in Aspiro FastAPI backend.

Uses the in-memory SQLite engine from conftest so no live Postgres DB is required.
"""

import pytest
import pytest_asyncio
from uuid import uuid4
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.core.database import get_async_session, get_db
from app.modules.users.models import User, UserStatus, UserRole
from app.modules.users.security import security_utils


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def async_client(override_get_async_session):
    """Async HTTP client wired to the in-memory test DB."""
    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_db] = override_get_async_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_async_session, None)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def created_user(async_session: AsyncSession) -> User:
    """Insert an already-active user directly, bypassing registration flow."""
    user = User(
        id=uuid4(),
        email=f"integration_{uuid4().hex[:8]}@example.com",
        name="Integration Test User",
        hashed_password=security_utils.hash_password("SecurePassword123!"),
        status=UserStatus.ACTIVE,
        role=UserRole.USER,
        is_active=True,
        is_verified=True,
        preferred_currency="USD",
        timezone="UTC",
        experience_points=0,
        level=1,
    )
    user.initialize_preferences()
    async_session.add(user)
    await async_session.commit()
    await async_session.refresh(user)
    return user


# ── Registration ──────────────────────────────────────────────────────────────

class TestUserRegistration:

    @pytest.mark.asyncio
    async def test_register_user_success(self, async_client: AsyncClient):
        user_data = {
            "email": f"reg_{uuid4().hex[:8]}@example.com",
            "name": "Test User",
            "password": "SecurePassword123!",
            "confirm_password": "SecurePassword123!",
            "terms_accepted": True,
        }
        response = await async_client.post("/api/v1/users/register", json=user_data)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["email"] == user_data["email"]
        assert data["data"]["name"] == user_data["name"]

    @pytest.mark.asyncio
    async def test_register_user_duplicate_email(
        self, async_client: AsyncClient, created_user: User
    ):
        user_data = {
            "email": created_user.email,
            "name": "Dup User",
            "password": "SecurePassword123!",
            "confirm_password": "SecurePassword123!",
            "terms_accepted": True,
        }
        response = await async_client.post("/api/v1/users/register", json=user_data)

        assert response.status_code == 400
        assert "already registered" in response.json()["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_register_user_weak_password(self, async_client: AsyncClient):
        """Password passes Pydantic min_length=8 but fails service strength check."""
        user_data = {
            "email": "weakpass@example.com",
            "name": "Test User",
            "password": "weakpass",
            "confirm_password": "weakpass",
            "terms_accepted": True,
        }
        response = await async_client.post("/api/v1/users/register", json=user_data)

        assert response.status_code == 400
        assert "password" in response.json()["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_register_user_password_mismatch(self, async_client: AsyncClient):
        user_data = {
            "email": "mismatch@example.com",
            "name": "Test User",
            "password": "SecurePassword123!",
            "confirm_password": "DifferentPassword123!",
            "terms_accepted": True,
        }
        response = await async_client.post("/api/v1/users/register", json=user_data)

        assert response.status_code == 422


# ── Authentication ────────────────────────────────────────────────────────────

class TestUserAuthentication:

    @pytest.mark.asyncio
    async def test_login_success(self, async_client: AsyncClient, created_user: User):
        login_data = {"email": created_user.email, "password": "SecurePassword123!"}
        response = await async_client.post("/api/v1/auth/login", json=login_data)

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data
        assert data["user"]["email"] == created_user.email

    @pytest.mark.asyncio
    async def test_login_invalid_email(self, async_client: AsyncClient):
        login_data = {"email": "nonexistent@example.com", "password": "SecurePassword123!"}
        response = await async_client.post("/api/v1/auth/login", json=login_data)

        assert response.status_code == 401
        assert "invalid email or password" in response.json()["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_login_invalid_password(
        self, async_client: AsyncClient, created_user: User
    ):
        login_data = {"email": created_user.email, "password": "WrongPassword123!"}
        response = await async_client.post("/api/v1/auth/login", json=login_data)

        assert response.status_code == 401
        assert "invalid email or password" in response.json()["error"]["message"].lower()


# ── Token management ──────────────────────────────────────────────────────────

class TestTokenManagement:

    @pytest.mark.asyncio
    async def test_token_refresh_success(
        self, async_client: AsyncClient, created_user: User
    ):
        login_resp = await async_client.post(
            "/api/v1/auth/login",
            json={"email": created_user.email, "password": "SecurePassword123!"},
        )
        assert login_resp.status_code == 200
        refresh_token = login_resp.json()["refresh_token"]

        refresh_resp = await async_client.post(
            "/api/v1/auth/refresh", json={"refresh_token": refresh_token}
        )

        assert refresh_resp.status_code == 200
        data = refresh_resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_token_refresh_invalid_token(self, async_client: AsyncClient):
        response = await async_client.post(
            "/api/v1/auth/refresh", json={"refresh_token": "invalid_token"}
        )
        assert response.status_code == 401


# ── User profile ──────────────────────────────────────────────────────────────

class TestUserProfile:

    @pytest.mark.asyncio
    async def test_get_current_user_profile(
        self, async_client: AsyncClient, created_user: User
    ):
        login_resp = await async_client.post(
            "/api/v1/auth/login",
            json={"email": created_user.email, "password": "SecurePassword123!"},
        )
        access_token = login_resp.json()["access_token"]

        response = await async_client.get(
            "/api/v1/users/me", headers={"Authorization": f"Bearer {access_token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == created_user.email
        assert data["name"] == created_user.name

    @pytest.mark.asyncio
    async def test_update_user_profile(
        self, async_client: AsyncClient, created_user: User
    ):
        login_resp = await async_client.post(
            "/api/v1/auth/login",
            json={"email": created_user.email, "password": "SecurePassword123!"},
        )
        access_token = login_resp.json()["access_token"]

        response = await async_client.put(
            "/api/v1/users/me",
            json={"name": "Updated Name", "occupation": "Software Engineer"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

        assert response.status_code == 200
        assert response.json()["name"] == "Updated Name"

    @pytest.mark.asyncio
    async def test_unauthorized_profile_access(self, async_client: AsyncClient):
        response = await async_client.get("/api/v1/users/me")
        assert response.status_code in (401, 403)


# ── Logout ────────────────────────────────────────────────────────────────────

class TestLogout:

    @pytest.mark.asyncio
    async def test_logout_success(self, async_client: AsyncClient, created_user: User):
        login_resp = await async_client.post(
            "/api/v1/auth/login",
            json={"email": created_user.email, "password": "SecurePassword123!"},
        )
        assert login_resp.status_code == 200
        tokens = login_resp.json()

        response = await async_client.post(
            "/api/v1/auth/logout",
            json={"refresh_token": tokens["refresh_token"], "logout_all_devices": False},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["logged_out"] is True


# ── Health check ──────────────────────────────────────────────────────────────

class TestHealthCheck:

    @pytest.mark.asyncio
    async def test_users_health_check(self, async_client: AsyncClient):
        response = await async_client.get("/api/v1/users/health")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["service"] == "users"
        assert data["data"]["status"] == "healthy"
