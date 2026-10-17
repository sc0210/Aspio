"""
Comprehensive tests for super_admin account management capabilities.

Coverage:
1.  Auth guard — unauthenticated and regular-user requests are rejected (401/403)
2.  List pending users
3.  Approve user (PENDING_APPROVAL → ACTIVE)
4.  Reject user (PENDING_APPROVAL → deleted)
5.  Delete active user
6.  Toggle user active / inactive
7.  List all users
8.  Get single user details
9.  Bulk approve
10. Bulk delete
11. Self-protection — admin cannot delete/deactivate their own account
"""

import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.models import AdminUser, AdminRole
from app.modules.users.models import User, UserStatus, UserRole
from app.modules.users.security import jwt_manager


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_user(email: str, status: UserStatus = UserStatus.ACTIVE) -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        name="Test User",
        hashed_password="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        is_active=True,
        is_verified=True,
        status=status,
        role=UserRole.USER,
        preferred_currency="TWD",
        timezone="UTC",
        experience_points=0,
        level=1,
    )


def _make_admin(user: User, role: AdminRole = AdminRole.SUPER_ADMIN) -> AdminUser:
    return AdminUser(
        id=uuid.uuid4(),
        user_id=user.id,
        role=role.value,
        is_active=True,
    )


def _token(user: User) -> str:
    return jwt_manager.create_access_token({"sub": str(user.id), "email": user.email})


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {_token(user)}"}


# ── Shared fixtures ───────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seeded(client, async_session):
    """
    Seed DB with one super_admin + two regular users (one pending, one active).
    Returns a dict so tests can reference the objects and their tokens.
    """
    admin_user = _make_user("sadmin@example.com")
    admin_rec = _make_admin(admin_user, AdminRole.SUPER_ADMIN)
    pending_user = _make_user("pending@example.com", UserStatus.PENDING_APPROVAL)
    active_user = _make_user("active@example.com", UserStatus.ACTIVE)
    regular_user = _make_user("regular@example.com", UserStatus.ACTIVE)

    async_session.add_all([admin_user, admin_rec, pending_user, active_user, regular_user])
    await async_session.commit()

    return {
        "admin_user": admin_user,
        "admin_rec": admin_rec,
        "pending_user": pending_user,
        "active_user": active_user,
        "regular_user": regular_user,
        "admin_headers": _auth(admin_user),
        "regular_headers": _auth(regular_user),
    }


# ── 1. Auth guards ────────────────────────────────────────────────────────────

class TestAuthGuards:
    """All admin endpoints must reject unauthenticated and non-admin requests."""

    ENDPOINTS = [
        ("GET",    "/api/v1/admin/pending-users"),
        ("POST",   f"/api/v1/admin/approve-user/{uuid.uuid4()}"),
        ("POST",   f"/api/v1/admin/reject-user/{uuid.uuid4()}"),
        ("DELETE", f"/api/v1/admin/users/{uuid.uuid4()}"),
        ("PATCH",  f"/api/v1/admin/users/{uuid.uuid4()}/toggle-active"),
        ("GET",    "/api/v1/admin/users"),
        ("POST",   "/api/v1/admin/bulk-approve"),
        ("POST",   "/api/v1/admin/bulk-delete"),
    ]

    @pytest.mark.parametrize("method,path", ENDPOINTS)
    def test_unauthenticated_rejected(self, client, method, path):
        resp = client.request(method, path)
        assert resp.status_code in (401, 403), f"{method} {path} should require auth"

    @pytest.mark.parametrize("method,path", ENDPOINTS)
    def test_regular_user_rejected(self, client, seeded, method, path):
        resp = client.request(method, path, headers=seeded["regular_headers"])
        assert resp.status_code in (401, 403), f"{method} {path} should require admin role"


# ── 2. List pending users ─────────────────────────────────────────────────────

class TestListPendingUsers:
    def test_returns_only_pending(self, client, seeded):
        resp = client.get("/api/v1/admin/pending-users", headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", {})
        users = data.get("users", data) if isinstance(data, dict) else data
        emails = [u["email"] for u in users]
        assert "pending@example.com" in emails
        assert "active@example.com" not in emails
        assert "sadmin@example.com" not in emails


# ── 3. Approve user ───────────────────────────────────────────────────────────

class TestApproveUser:
    def test_approve_pending_succeeds(self, client, seeded):
        uid = str(seeded["pending_user"].id)
        resp = client.post(f"/api/v1/admin/approve-user/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 200
        assert "approved" in resp.json().get("message", "").lower()

    def test_approved_user_can_login(self, client, seeded):
        uid = str(seeded["pending_user"].id)
        client.post(f"/api/v1/admin/approve-user/{uid}", headers=seeded["admin_headers"])

        login = client.post("/api/v1/auth/login", json={
            "email": "pending@example.com",
            "password": "secret",
        })
        # Password above matches the bcrypt hash used in _make_user
        assert login.status_code == 200
        assert "access_token" in login.json()

    def test_approve_already_active_returns_400(self, client, seeded):
        uid = str(seeded["active_user"].id)
        resp = client.post(f"/api/v1/admin/approve-user/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 400

    def test_approve_nonexistent_returns_404(self, client, seeded):
        resp = client.post(f"/api/v1/admin/approve-user/{uuid.uuid4()}", headers=seeded["admin_headers"])
        assert resp.status_code == 404


# ── 4. Reject user ────────────────────────────────────────────────────────────

class TestRejectUser:
    def test_reject_pending_removes_user(self, client, seeded):
        uid = str(seeded["pending_user"].id)
        resp = client.post(f"/api/v1/admin/reject-user/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 200

        # User should be gone
        get_resp = client.get(f"/api/v1/admin/users/{uid}", headers=seeded["admin_headers"])
        assert get_resp.status_code == 404

    def test_reject_active_user_returns_400(self, client, seeded):
        uid = str(seeded["active_user"].id)
        resp = client.post(f"/api/v1/admin/reject-user/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 400

    def test_reject_nonexistent_returns_404(self, client, seeded):
        resp = client.post(f"/api/v1/admin/reject-user/{uuid.uuid4()}", headers=seeded["admin_headers"])
        assert resp.status_code == 404


# ── 5. Delete user ────────────────────────────────────────────────────────────

class TestDeleteUser:
    def test_delete_active_user(self, client, seeded):
        uid = str(seeded["active_user"].id)
        resp = client.delete(f"/api/v1/admin/users/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 200

        get_resp = client.get(f"/api/v1/admin/users/{uid}", headers=seeded["admin_headers"])
        assert get_resp.status_code == 404

    def test_delete_nonexistent_returns_404(self, client, seeded):
        resp = client.delete(f"/api/v1/admin/users/{uuid.uuid4()}", headers=seeded["admin_headers"])
        assert resp.status_code == 404

    def test_admin_cannot_delete_self(self, client, seeded):
        uid = str(seeded["admin_user"].id)
        resp = client.delete(f"/api/v1/admin/users/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 400


# ── 6. Toggle active / inactive ───────────────────────────────────────────────

class TestToggleActive:
    def test_deactivate_active_user(self, client, seeded):
        uid = str(seeded["active_user"].id)
        resp = client.patch(f"/api/v1/admin/users/{uid}/toggle-active", headers=seeded["admin_headers"])
        assert resp.status_code == 200
        assert resp.json()["data"]["is_active"] is False

    def test_reactivate_deactivated_user(self, client, seeded):
        uid = str(seeded["active_user"].id)
        # Deactivate first
        client.patch(f"/api/v1/admin/users/{uid}/toggle-active", headers=seeded["admin_headers"])
        # Reactivate
        resp = client.patch(f"/api/v1/admin/users/{uid}/toggle-active", headers=seeded["admin_headers"])
        assert resp.status_code == 200
        assert resp.json()["data"]["is_active"] is True

    def test_admin_cannot_deactivate_self(self, client, seeded):
        uid = str(seeded["admin_user"].id)
        resp = client.patch(f"/api/v1/admin/users/{uid}/toggle-active", headers=seeded["admin_headers"])
        assert resp.status_code == 400


# ── 7. List all users ─────────────────────────────────────────────────────────

class TestListUsers:
    def test_list_returns_users(self, client, seeded):
        resp = client.get("/api/v1/admin/users", headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", {})
        users = data.get("users", data) if isinstance(data, dict) else data
        assert len(users) >= 3

    def test_list_requires_admin(self, client, seeded):
        resp = client.get("/api/v1/admin/users", headers=seeded["regular_headers"])
        assert resp.status_code in (401, 403)


# ── 8. Get single user details ────────────────────────────────────────────────

class TestGetUserDetails:
    def test_get_existing_user(self, client, seeded):
        uid = str(seeded["active_user"].id)
        resp = client.get(f"/api/v1/admin/users/{uid}", headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", resp.json())
        assert data.get("email") == "active@example.com"

    def test_get_nonexistent_returns_404(self, client, seeded):
        resp = client.get(f"/api/v1/admin/users/{uuid.uuid4()}", headers=seeded["admin_headers"])
        assert resp.status_code == 404


# ── 9. Bulk approve ───────────────────────────────────────────────────────────

class TestBulkApprove:
    @pytest.mark.asyncio
    async def test_bulk_approve_multiple_pending(self, client, async_session, seeded):
        # Seed a second pending user
        extra = _make_user("pending2@example.com", UserStatus.PENDING_APPROVAL)
        async_session.add(extra)
        await async_session.commit()

        ids = [str(seeded["pending_user"].id), str(extra.id)]
        resp = client.post("/api/v1/admin/bulk-approve", json=ids, headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", {})
        assert len(data.get("approved", [])) == 2
        assert len(data.get("failed", [])) == 0

    def test_bulk_approve_already_active_ends_in_failed(self, client, seeded):
        ids = [str(seeded["active_user"].id)]
        resp = client.post("/api/v1/admin/bulk-approve", json=ids, headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", {})
        assert str(seeded["active_user"].id) in data.get("failed", [])


# ── 10. Bulk delete ───────────────────────────────────────────────────────────

class TestBulkDelete:
    @pytest.mark.asyncio
    async def test_bulk_delete_multiple_users(self, client, async_session, seeded):
        extra = _make_user("todelete@example.com")
        async_session.add(extra)
        await async_session.commit()

        ids = [str(seeded["active_user"].id), str(extra.id)]
        resp = client.post("/api/v1/admin/bulk-delete", json=ids, headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", {})
        assert len(data.get("deleted", [])) == 2

    def test_bulk_delete_self_goes_to_failed(self, client, seeded):
        ids = [str(seeded["admin_user"].id)]
        resp = client.post("/api/v1/admin/bulk-delete", json=ids, headers=seeded["admin_headers"])
        assert resp.status_code == 200
        data = resp.json().get("data", {})
        assert str(seeded["admin_user"].id) in data.get("failed", [])
