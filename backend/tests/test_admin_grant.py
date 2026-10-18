"""grant_admin, behind both ADMIN_EMAILS and `aspiro admin grant` (scripts/create_admin.py)."""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin import init_admin
from app.modules.admin.init_admin import grant_admin, init_admin_users
from app.modules.admin.models import AdminUser
from app.modules.users.models import User, UserStatus
from app.modules.users.schemas import LoginRequest, UserRegistration
from app.modules.users.services import UserService


async def _register(session: AsyncSession, email: str) -> None:
    await UserService(session).register_user(UserRegistration(
        email=email, password="StrongPass123!", confirm_password="StrongPass123!",
        name="Owner", terms_accepted=True,
    ))


async def _user(session: AsyncSession, email: str) -> User:
    return (await session.execute(select(User).where(User.email == email))).scalar_one()


async def _admin(session: AsyncSession, user: User):
    return (await session.execute(select(AdminUser).where(AdminUser.user_id == user.id))).scalar_one_or_none()


class TestGrantAdmin:
    @pytest.mark.asyncio
    async def test_approves_a_pending_registration_so_the_admin_can_log_in(self, async_session):
        await _register(async_session, "owner@example.com")

        admin = await grant_admin(async_session, "owner@example.com", "super_admin")

        assert admin.role == "super_admin" and admin.is_active
        user = await _user(async_session, "owner@example.com")
        assert user.status == UserStatus.ACTIVE and user.is_active
        login = await UserService(async_session).authenticate_user(
            LoginRequest(email="owner@example.com", password="StrongPass123!")
        )
        assert login.access_token

    @pytest.mark.asyncio
    async def test_leaves_a_suspended_account_blocked(self, async_session):
        await _register(async_session, "owner@example.com")
        user = await _user(async_session, "owner@example.com")
        user.status = UserStatus.SUSPENDED
        user.is_active = False
        await async_session.commit()

        await grant_admin(async_session, "owner@example.com", "super_admin")

        await async_session.refresh(user)
        assert user.status == UserStatus.SUSPENDED and not user.is_active

    @pytest.mark.asyncio
    async def test_matches_the_email_regardless_of_case(self, async_session):
        await _register(async_session, "owner@example.com")
        assert await grant_admin(async_session, "  Owner@Example.COM ", "admin") is not None

    @pytest.mark.asyncio
    async def test_unknown_email_returns_none_and_creates_nothing(self, async_session):
        assert await grant_admin(async_session, "nobody@example.com", "super_admin") is None
        assert (await async_session.execute(select(AdminUser))).first() is None

    @pytest.mark.asyncio
    async def test_unknown_role_is_rejected(self, async_session):
        await _register(async_session, "owner@example.com")
        with pytest.raises(ValueError):
            await grant_admin(async_session, "owner@example.com", "root")

    @pytest.mark.asyncio
    async def test_regrant_changes_the_role_and_reactivates(self, async_session):
        await _register(async_session, "owner@example.com")
        admin = await grant_admin(async_session, "owner@example.com", "support")
        admin.is_active = False
        await async_session.commit()

        again = await grant_admin(async_session, "owner@example.com", "super_admin")

        assert again.id == admin.id
        assert again.role == "super_admin" and again.is_active


class TestAdminEmails:
    @pytest.mark.asyncio
    async def test_applies_each_entry_and_skips_bad_ones(self, async_session, monkeypatch):
        await _register(async_session, "a@example.com")
        await _register(async_session, "b@example.com")
        monkeypatch.setattr(
            init_admin.settings, "ADMIN_EMAILS",
            "A@example.com:super_admin, b@example.com:analyst, broken, c@example.com:admin, b@example.com:root",
        )

        await init_admin_users(async_session)

        a = await _admin(async_session, await _user(async_session, "a@example.com"))
        b = await _admin(async_session, await _user(async_session, "b@example.com"))
        assert a.role == "super_admin"
        assert b.role == "analyst"  # the later invalid role left it alone

    @pytest.mark.asyncio
    async def test_empty_setting_does_nothing(self, async_session, monkeypatch):
        monkeypatch.setattr(init_admin.settings, "ADMIN_EMAILS", None)
        await init_admin_users(async_session)
        assert (await async_session.execute(select(AdminUser))).first() is None
