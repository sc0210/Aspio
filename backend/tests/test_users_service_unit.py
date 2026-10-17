"""
Unit tests for UserService.
All repository and external dependencies are mocked.
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException

from app.modules.users.services import UserService
from app.modules.users.schemas import (
    UserRegistration, LoginRequest, TokenRefreshRequest,
    UserUpdate, ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.modules.users.models import UserStatus, UserRole


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_mock_user(
    user_id=None,
    email="test@aspiro.com",
    status=UserStatus.ACTIVE,
    is_active=True,
    is_verified=True,
    is_account_locked=False,
    account_locked_until=None,
    hashed_password="$2b$12$fakehash",
):
    u = MagicMock()
    u.id = user_id or uuid4()
    u.email = email
    u.name = "Test User"
    u.avatar_url = None
    u.occupation = None
    u.monthly_income = None
    u.risk_tolerance = None
    u.preferences = {}
    u.profile = None
    u.google_id = None
    u.experience_points = 0
    u.level = 1
    u.preferred_language = "en"
    u.preferred_currency = "USD"
    u.timezone = "UTC"
    u.current_login_streak = 0
    u.longest_login_streak = 0
    u.status = status
    u.is_active = is_active
    u.is_verified = is_verified
    u.is_account_locked = is_account_locked
    u.account_locked_until = account_locked_until
    u.hashed_password = hashed_password
    u.role = UserRole.USER
    u.created_at = datetime.now(timezone.utc)
    u.updated_at = datetime.now(timezone.utc)
    return u


def make_service(session=None):
    """Create a UserService with all repos mocked."""
    mock_session = session or MagicMock()

    with (
        patch("app.modules.users.services.get_user_repository") as mock_user_repo_factory,
        patch("app.modules.users.services.get_refresh_token_repository") as mock_rt_factory,
        patch("app.modules.users.services.get_email_verification_repository") as mock_ev_factory,
    ):
        mock_user_repo = MagicMock()
        mock_rt_repo = MagicMock()
        mock_ev_repo = MagicMock()

        mock_user_repo_factory.return_value = mock_user_repo
        mock_rt_factory.return_value = mock_rt_repo
        mock_ev_factory.return_value = mock_ev_repo

        svc = UserService(mock_session)

    svc.user_repo = mock_user_repo
    svc.refresh_token_repo = mock_rt_repo
    svc.email_verification_repo = mock_ev_repo
    return svc


# ─── UserService.register_user ───────────────────────────────────────────────

class TestRegisterUser:

    @pytest.mark.asyncio
    async def test_register_success(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=None)
        svc.user_repo.create_user = AsyncMock(return_value=mock_user)

        with patch("app.modules.users.services.password_validator") as mock_pv:
            mock_pv.validate_password_strength.return_value = {"is_valid": True, "feedback": []}
            with patch("app.modules.users.schemas.UserResponse.model_validate", return_value=MagicMock()):
                user_data = UserRegistration(
                    email="new@aspiro.com",
                    password="SecurePass123!",
                    confirm_password="SecurePass123!",
                    name="New User",
                    terms_accepted=True,
                )
                result, email_required = await svc.register_user(user_data, "127.0.0.1")

        assert email_required is False
        svc.user_repo.create_user.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_register_duplicate_email_raises_400(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=mock_user)

        user_data = UserRegistration(
            email="existing@aspiro.com",
            password="SecurePass123!",
            confirm_password="SecurePass123!",
            name="User",
            terms_accepted=True,
        )
        with pytest.raises(HTTPException) as exc:
            await svc.register_user(user_data)

        assert exc.value.status_code == 400
        assert "already registered" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_register_weak_password_raises_400(self):
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=None)

        with patch("app.modules.users.services.password_validator") as mock_pv:
            mock_pv.validate_password_strength.return_value = {
                "is_valid": False,
                "feedback": ["No special characters", "No uppercase letters"],
            }
            # Use >=8 char password so it passes Pydantic schema validation;
            # the service's business-logic validator will reject it.
            user_data = UserRegistration(
                email="new@aspiro.com",
                password="weakpass",
                confirm_password="weakpass",
                name="User",
                terms_accepted=True,
            )
            with pytest.raises(HTTPException) as exc:
                await svc.register_user(user_data)

        assert exc.value.status_code == 400
        assert "requirements" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_register_with_referral_code(self):
        mock_user = make_mock_user()
        referring_user = make_mock_user(email="referrer@aspiro.com")

        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=None)
        svc.user_repo.get_user_by_referral_code = AsyncMock(return_value=referring_user)
        svc.user_repo.create_user = AsyncMock(return_value=mock_user)

        with patch("app.modules.users.services.password_validator") as mock_pv:
            mock_pv.validate_password_strength.return_value = {"is_valid": True, "feedback": []}
            with patch("app.modules.users.schemas.UserResponse.model_validate", return_value=MagicMock()):
                user_data = UserRegistration(
                    email="new@aspiro.com",
                    password="SecurePass123!",
                    confirm_password="SecurePass123!",
                    name="New User",
                    terms_accepted=True,
                    referral_code="REF123",
                )
                await svc.register_user(user_data)

        # Should look up referral code
        svc.user_repo.get_user_by_referral_code.assert_awaited_once_with("REF123")


# ─── UserService.authenticate_user ───────────────────────────────────────────

class TestAuthenticateUser:

    @pytest.mark.asyncio
    async def test_login_success(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=mock_user)
        svc.user_repo.update_login_info = AsyncMock()
        svc.refresh_token_repo.create_refresh_token = AsyncMock()
        svc._update_user_activity = AsyncMock()

        with (
            patch("app.modules.users.services.security_utils") as mock_su,
            patch("app.modules.users.services.jwt_manager") as mock_jm,
        ):
            mock_su.verify_password.return_value = True
            mock_jm.create_access_token.return_value = "access-token"
            mock_jm.create_refresh_token.return_value = "refresh-token"

            login_data = LoginRequest(email="test@aspiro.com", password="SecurePass123!")
            result = await svc.authenticate_user(login_data, "127.0.0.1")

        assert result.access_token == "access-token"
        assert result.refresh_token == "refresh-token"
        assert result.token_type == "bearer"

    @pytest.mark.asyncio
    async def test_login_user_not_found_raises_401(self):
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=None)

        with pytest.raises(HTTPException) as exc:
            await svc.authenticate_user(
                LoginRequest(email="nobody@aspiro.com", password="pass")
            )

        assert exc.value.status_code == 401
        assert "Invalid email or password" in exc.value.detail

    @pytest.mark.asyncio
    async def test_login_locked_account_raises_423(self):
        locked_user = make_mock_user(
            is_account_locked=True,
            account_locked_until=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=locked_user)

        with pytest.raises(HTTPException) as exc:
            await svc.authenticate_user(
                LoginRequest(email="test@aspiro.com", password="SecurePass123!")
            )

        assert exc.value.status_code == 423

    @pytest.mark.asyncio
    async def test_login_pending_approval_raises_403(self):
        pending_user = make_mock_user(
            status=UserStatus.PENDING_APPROVAL, is_account_locked=False
        )
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=pending_user)

        with pytest.raises(HTTPException) as exc:
            await svc.authenticate_user(
                LoginRequest(email="test@aspiro.com", password="SecurePass123!")
            )

        assert exc.value.status_code == 403
        assert "pending" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_login_inactive_account_raises_403(self):
        inactive_user = make_mock_user(
            is_active=False, status=UserStatus.ACTIVE, is_account_locked=False
        )
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=inactive_user)

        with pytest.raises(HTTPException) as exc:
            await svc.authenticate_user(
                LoginRequest(email="test@aspiro.com", password="SecurePass123!")
            )

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_login_wrong_password_raises_401(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=mock_user)
        svc.user_repo.update_login_info = AsyncMock()

        with patch("app.modules.users.services.security_utils") as mock_su:
            mock_su.verify_password.return_value = False

            with pytest.raises(HTTPException) as exc:
                await svc.authenticate_user(
                    LoginRequest(email="test@aspiro.com", password="WrongPassword")
                )

        assert exc.value.status_code == 401
        assert "Invalid email or password" in exc.value.detail
        svc.user_repo.update_login_info.assert_awaited_once()


# ─── UserService.refresh_token ───────────────────────────────────────────────

class TestRefreshToken:

    @pytest.mark.asyncio
    async def test_refresh_success(self):
        mock_user = make_mock_user()
        stored_token = MagicMock()
        stored_token.is_active = True
        stored_token.is_expired = False
        stored_token.user_id = mock_user.id
        stored_token.user_agent = "test-agent"
        stored_token.ip_address = "127.0.0.1"

        svc = make_service()
        svc.refresh_token_repo.get_refresh_token = AsyncMock(return_value=stored_token)
        svc.refresh_token_repo.revoke_refresh_token = AsyncMock()
        svc.refresh_token_repo.create_refresh_token = AsyncMock()
        svc.user_repo.get_user_by_id = AsyncMock(return_value=mock_user)

        with patch("app.modules.users.services.jwt_manager") as mock_jm:
            mock_jm.verify_token.return_value = {"sub": str(mock_user.id)}
            mock_jm.create_access_token.return_value = "new-access-token"
            mock_jm.create_refresh_token.return_value = "new-refresh-token"

            result = await svc.refresh_token(
                TokenRefreshRequest(refresh_token="old-refresh-token")
            )

        assert result.access_token == "new-access-token"
        assert result.refresh_token == "new-refresh-token"
        svc.refresh_token_repo.revoke_refresh_token.assert_awaited_once_with("old-refresh-token")

    @pytest.mark.asyncio
    async def test_refresh_invalid_jwt_raises_401(self):
        svc = make_service()

        with patch("app.modules.users.services.jwt_manager") as mock_jm:
            mock_jm.verify_token.return_value = None  # invalid token

            with pytest.raises(HTTPException) as exc:
                await svc.refresh_token(
                    TokenRefreshRequest(refresh_token="invalid-token")
                )

        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_expired_stored_token_raises_401(self):
        expired_token = MagicMock()
        expired_token.is_active = False
        expired_token.is_expired = True

        svc = make_service()
        svc.refresh_token_repo.get_refresh_token = AsyncMock(return_value=expired_token)

        with patch("app.modules.users.services.jwt_manager") as mock_jm:
            mock_jm.verify_token.return_value = {"sub": "some-user-id"}

            with pytest.raises(HTTPException) as exc:
                await svc.refresh_token(
                    TokenRefreshRequest(refresh_token="expired-token")
                )

        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_not_in_db_raises_401(self):
        svc = make_service()
        svc.refresh_token_repo.get_refresh_token = AsyncMock(return_value=None)

        with patch("app.modules.users.services.jwt_manager") as mock_jm:
            mock_jm.verify_token.return_value = {"sub": "user-id"}

            with pytest.raises(HTTPException) as exc:
                await svc.refresh_token(
                    TokenRefreshRequest(refresh_token="unknown-token")
                )

        assert exc.value.status_code == 401


# ─── UserService.logout_user ─────────────────────────────────────────────────

class TestLogoutUser:

    @pytest.mark.asyncio
    async def test_logout_specific_token(self):
        svc = make_service()
        svc.refresh_token_repo.revoke_refresh_token = AsyncMock()

        result = await svc.logout_user(
            uuid4(), refresh_token="my-token", logout_all_devices=False
        )

        assert result is True
        svc.refresh_token_repo.revoke_refresh_token.assert_awaited_once_with("my-token")

    @pytest.mark.asyncio
    async def test_logout_all_devices(self):
        user_id = uuid4()
        svc = make_service()
        svc.refresh_token_repo.revoke_user_tokens = AsyncMock()

        result = await svc.logout_user(user_id, logout_all_devices=True)

        assert result is True
        svc.refresh_token_repo.revoke_user_tokens.assert_awaited_once_with(user_id)

    @pytest.mark.asyncio
    async def test_logout_exception_returns_false(self):
        svc = make_service()
        svc.refresh_token_repo.revoke_refresh_token = AsyncMock(
            side_effect=Exception("DB error")
        )

        result = await svc.logout_user(uuid4(), refresh_token="token")

        assert result is False


# ─── UserService.get_user_profile ────────────────────────────────────────────

class TestGetUserProfile:

    @pytest.mark.asyncio
    async def test_get_profile_success(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.get_user_by_id = AsyncMock(return_value=mock_user)

        with patch("app.modules.users.schemas.UserProfileResponse.model_validate", return_value=MagicMock()):
            result = await svc.get_user_profile(mock_user.id)

        assert result is not None

    @pytest.mark.asyncio
    async def test_get_profile_not_found_raises_404(self):
        svc = make_service()
        svc.user_repo.get_user_by_id = AsyncMock(return_value=None)

        with pytest.raises(HTTPException) as exc:
            await svc.get_user_profile(uuid4())

        assert exc.value.status_code == 404


# ─── UserService.update_user_profile ─────────────────────────────────────────

class TestUpdateUserProfile:

    @pytest.mark.asyncio
    async def test_update_success(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.update_user = AsyncMock(return_value=mock_user)

        with patch("app.modules.users.schemas.UserProfileResponse.model_validate", return_value=MagicMock()):
            result = await svc.update_user_profile(
                mock_user.id, UserUpdate(name="New Name")
            )

        assert result is not None
        svc.user_repo.update_user.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_user_not_found_raises_404(self):
        svc = make_service()
        svc.user_repo.update_user = AsyncMock(return_value=None)

        with pytest.raises(HTTPException) as exc:
            await svc.update_user_profile(uuid4(), UserUpdate(name="Name"))

        assert exc.value.status_code == 404


# ─── UserService.change_password ─────────────────────────────────────────────

# ─── UserService.request_password_reset ──────────────────────────────────────

class TestRequestPasswordReset:

    @pytest.mark.asyncio
    async def test_reset_request_always_returns_true(self):
        """Security: never reveal whether email exists"""
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=None)

        result = await svc.request_password_reset(
            ForgotPasswordRequest(email="nobody@aspiro.com")
        )

        assert result is True

    @pytest.mark.asyncio
    async def test_reset_request_for_existing_user_creates_token(self):
        mock_user = make_mock_user()
        svc = make_service()
        svc.user_repo.get_user_by_email = AsyncMock(return_value=mock_user)
        svc.email_verification_repo.create_verification_token = AsyncMock()
        svc._send_password_reset_email = AsyncMock()

        with patch("app.modules.users.services.security_utils") as mock_su:
            mock_su.generate_secure_token.return_value = "secure-reset-token"

            result = await svc.request_password_reset(
                ForgotPasswordRequest(email="test@aspiro.com")
            )

        assert result is True
        svc.email_verification_repo.create_verification_token.assert_awaited_once()


# ─── UserService.reset_password ──────────────────────────────────────────────

class TestResetPassword:

    @pytest.mark.asyncio
    async def test_reset_password_success(self):
        mock_token = MagicMock()
        mock_token.is_used = False
        mock_token.is_expired = False
        mock_token.user_id = uuid4()

        svc = make_service()
        svc.email_verification_repo.get_verification_token = AsyncMock(return_value=mock_token)
        svc.email_verification_repo.use_verification_token = AsyncMock()
        svc.user_repo.update_user_password = AsyncMock(return_value=True)
        svc.refresh_token_repo.revoke_user_tokens = AsyncMock()

        with patch("app.modules.users.services.password_validator") as mock_pv:
            mock_pv.validate_password_strength.return_value = {"is_valid": True, "feedback": []}

            result = await svc.reset_password(
                ResetPasswordRequest(
                    token="valid-token",
                    new_password="NewPass456!",
                    confirm_password="NewPass456!",
                )
            )

        assert result is True
        svc.email_verification_repo.use_verification_token.assert_awaited_once()
        svc.refresh_token_repo.revoke_user_tokens.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reset_password_invalid_token_raises_400(self):
        svc = make_service()
        svc.email_verification_repo.get_verification_token = AsyncMock(return_value=None)

        with pytest.raises(HTTPException) as exc:
            await svc.reset_password(
                ResetPasswordRequest(
                    token="bad-token",
                    new_password="NewPass456!",
                    confirm_password="NewPass456!",
                )
            )

        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_reset_password_expired_token_raises_400(self):
        expired_token = MagicMock()
        expired_token.is_used = False
        expired_token.is_expired = True

        svc = make_service()
        svc.email_verification_repo.get_verification_token = AsyncMock(return_value=expired_token)

        with pytest.raises(HTTPException) as exc:
            await svc.reset_password(
                ResetPasswordRequest(
                    token="expired-token",
                    new_password="NewPass456!",
                    confirm_password="NewPass456!",
                )
            )

        assert exc.value.status_code == 400
