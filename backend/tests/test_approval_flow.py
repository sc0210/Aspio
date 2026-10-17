"""
Unit tests for the registration → pending approval → super_admin approval → login flow.

Coverage:
1. Registration creates user with PENDING_APPROVAL status
2. Pending user is blocked from login (403)
3. Super admin can list pending users
4. Super admin can approve a pending user → status becomes ACTIVE
5. Approved user can login successfully
6. Non-admin cannot call the approve endpoint (401/403)
7. Already-active user cannot be re-approved (400)
"""

import pytest
import uuid
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import User, UserStatus, UserRole
from app.modules.admin.models import AdminUser, AdminRole
from app.modules.users.schemas import UserRegistration, LoginRequest
from app.modules.users.services import UserService
from app.modules.admin.services import UserManagementService as AdminService


# ── Helpers ───────────────────────────────────────────────────────────────────

def _reg(email: str = "user@example.com") -> UserRegistration:
    return UserRegistration(
        email=email,
        password="StrongPass123!",
        confirm_password="StrongPass123!",
        name="Test User",
        terms_accepted=True,
    )


def _login(email: str, password: str = "StrongPass123!") -> LoginRequest:
    return LoginRequest(email=email, password=password)


def _active_user(email: str = "user@example.com") -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        name="Test User",
        hashed_password="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        is_active=True,
        is_verified=True,
        status=UserStatus.ACTIVE,
        role=UserRole.USER,
        preferred_currency="TWD",
        timezone="UTC",
        experience_points=0,
        level=1,
    )


def _pending_user(email: str = "pending@example.com") -> User:
    u = _active_user(email)
    u.status = UserStatus.PENDING_APPROVAL
    return u


def _super_admin(user: User) -> AdminUser:
    return AdminUser(
        id=uuid.uuid4(),
        user_id=user.id,
        role=AdminRole.SUPER_ADMIN.value,
        is_active=True,
    )


# ── 1. Registration ───────────────────────────────────────────────────────────

class TestRegistration:
    @pytest.mark.asyncio
    async def test_register_sets_pending_approval(self, async_session: AsyncSession):
        """New user registration must produce PENDING_APPROVAL status."""
        from sqlalchemy import select

        service = UserService(async_session)
        await service.register_user(_reg("new@example.com"))

        result = await async_session.execute(select(User).where(User.email == "new@example.com"))
        user = result.scalar_one()
        assert user.status == UserStatus.PENDING_APPROVAL

    @pytest.mark.asyncio
    async def test_register_duplicate_email_raises_400(self, async_session: AsyncSession):
        """Registering the same email twice returns HTTP 400."""
        from fastapi import HTTPException

        service = UserService(async_session)
        await service.register_user(_reg("dup@example.com"))

        with pytest.raises(HTTPException) as exc:
            await service.register_user(_reg("dup@example.com"))

        assert exc.value.status_code == 400


# ── 2. Login blocked for pending users ───────────────────────────────────────

class TestPendingUserBlocked:
    @pytest.mark.asyncio
    async def test_pending_user_login_blocked(self, async_session: AsyncSession):
        """PENDING_APPROVAL users receive HTTP 403 on login."""
        from fastapi import HTTPException

        service = UserService(async_session)
        await service.register_user(_reg("blocked@example.com"))

        with pytest.raises(HTTPException) as exc:
            await service.authenticate_user(_login("blocked@example.com"))

        assert exc.value.status_code == 403
        assert "pending" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_active_user_login_succeeds(self, async_session: AsyncSession):
        """An ACTIVE user receives tokens on login."""
        service = UserService(async_session)
        await service.register_user(_reg("ok@example.com"))

        # Manually activate (simulates admin approval)
        from app.modules.users.repositories import get_user_repository
        user = await get_user_repository(async_session).get_user_by_email("ok@example.com")
        user.status = UserStatus.ACTIVE
        async_session.add(user)
        await async_session.commit()

        result = await service.authenticate_user(_login("ok@example.com"))
        assert result.access_token


# ── 3. Admin service — pending list ──────────────────────────────────────────

class TestGetPendingUsers:
    @pytest.mark.asyncio
    async def test_only_pending_users_returned(self, async_session: AsyncSession):
        """get_pending_approval_users returns only PENDING_APPROVAL rows."""
        pending = _pending_user("p@example.com")
        active = _active_user("a@example.com")
        async_session.add_all([pending, active])
        await async_session.commit()

        result = await AdminService(async_session).get_pending_approval_users()
        emails = [u["email"] for u in result["users"]]

        assert "p@example.com" in emails
        assert "a@example.com" not in emails


# ── 4. Admin service — approve user ──────────────────────────────────────────

class TestApproveUser:
    @pytest.mark.asyncio
    async def test_approve_transitions_to_active(self, async_session: AsyncSession):
        """approve_user changes PENDING_APPROVAL → ACTIVE."""
        user = _pending_user()
        async_session.add(user)
        await async_session.commit()

        approved = await AdminService(async_session).approve_user(user.id)

        assert approved.status == UserStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_approve_already_active_raises_400(self, async_session: AsyncSession):
        """Approving an already-active user raises HTTP 400."""
        from fastapi import HTTPException

        user = _active_user()
        async_session.add(user)
        await async_session.commit()

        with pytest.raises(HTTPException) as exc:
            await AdminService(async_session).approve_user(user.id)

        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_approve_nonexistent_user_raises_404(self, async_session: AsyncSession):
        """Approving a missing user ID raises HTTP 404."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await AdminService(async_session).approve_user(uuid.uuid4())

        assert exc.value.status_code == 404


# ── 5. HTTP endpoint tests ────────────────────────────────────────────────────

class TestApprovalHTTP:
    def test_register_returns_pending_status(self, client):
        """POST /users/register → 200, status is pending_approval."""
        resp = client.post("/api/v1/users/register", json={
            "email": "http_new@example.com",
            "password": "StrongPass123!",
            "confirm_password": "StrongPass123!",
            "name": "HTTP New",
            "terms_accepted": True,
        })
        assert resp.status_code == 200
        body = resp.json()
        message = body.get("message", "")
        assert "pending" in message.lower()

    def test_pending_user_login_returns_403(self, client):
        """Pending user login → 403."""
        client.post("/api/v1/users/register", json={
            "email": "http_pending@example.com",
            "password": "StrongPass123!",
            "confirm_password": "StrongPass123!",
            "name": "HTTP Pending",
            "terms_accepted": True,
        })
        resp = client.post("/api/v1/auth/login", json={
            "email": "http_pending@example.com",
            "password": "StrongPass123!",
        })
        assert resp.status_code == 403
        body = resp.json()
        error_msg = body.get("detail", "") or body.get("error", {}).get("message", "")
        assert "pending" in error_msg.lower()

    def test_approve_endpoint_requires_auth(self, client):
        """Unauthenticated approve call → 401 or 403."""
        resp = client.post(f"/api/v1/admin/approve-user/{uuid.uuid4()}")
        assert resp.status_code in (401, 403)

    def test_regular_user_token_cannot_approve(self, client, test_user):
        """Regular user JWT → 401/403 on approve endpoint."""
        from app.modules.users.security import jwt_manager

        token = jwt_manager.create_access_token(
            {"sub": str(test_user.id), "email": test_user.email}
        )
        resp = client.post(
            f"/api/v1/admin/approve-user/{uuid.uuid4()}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_full_register_approve_login_flow(self, client, async_session):
        """
        End-to-end: register → 403 on login → super_admin approves → 200 on login.
        """
        from app.modules.users.security import jwt_manager

        # 1. Register
        reg = client.post("/api/v1/users/register", json={
            "email": "e2e@example.com",
            "password": "StrongPass123!",
            "confirm_password": "StrongPass123!",
            "name": "E2E User",
            "terms_accepted": True,
        })
        assert reg.status_code == 200

        # 2. Login blocked
        assert client.post("/api/v1/auth/login", json={
            "email": "e2e@example.com", "password": "StrongPass123!",
        }).status_code == 403

        # 3. Seed super_admin
        admin_u = _active_user("sadmin@example.com")
        admin_r = _super_admin(admin_u)
        async_session.add(admin_u)
        async_session.add(admin_r)
        await async_session.commit()

        admin_token = jwt_manager.create_access_token(
            {"sub": str(admin_u.id), "email": admin_u.email}
        )
        auth_headers = {"Authorization": f"Bearer {admin_token}"}

        # 4. Fetch pending list
        pending = client.get("/api/v1/admin/pending-users", headers=auth_headers)
        assert pending.status_code == 200
        pending_data = pending.json().get("data", {})
        pending_users = pending_data.get("users", pending_data) if isinstance(pending_data, dict) else pending_data
        target = next(
            (u for u in pending_users if u["email"] == "e2e@example.com"),
            None,
        )
        assert target is not None, "Registered user missing from pending list"

        # 5. Approve
        assert client.post(
            f"/api/v1/admin/approve-user/{target['id']}",
            headers=auth_headers,
        ).status_code == 200

        # 6. Login succeeds
        login = client.post("/api/v1/auth/login", json={
            "email": "e2e@example.com", "password": "StrongPass123!",
        })
        assert login.status_code == 200
        assert "access_token" in login.json()
