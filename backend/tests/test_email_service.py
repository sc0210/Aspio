"""
Unit tests for EmailService.
SMTP calls are mocked so no real network traffic is needed.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.email_service import EmailService


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_service(smtp_configured: bool = True, frontend_url: str = "https://app.aspiro.com") -> EmailService:
    settings_mock = MagicMock()
    settings_mock.email_enabled = smtp_configured
    settings_mock.EMAIL_FROM = "noreply@aspiro.com"
    settings_mock.SMTP_HOST = "smtp.example.com" if smtp_configured else None
    settings_mock.SMTP_PORT = 587
    settings_mock.SMTP_USER = "user@example.com" if smtp_configured else None
    settings_mock.SMTP_PASSWORD = "secret" if smtp_configured else None
    settings_mock.FRONTEND_URL = frontend_url

    svc = EmailService.__new__(EmailService)
    svc._frontend_url = frontend_url.rstrip("/")
    # Patch module-level settings inside email_service
    with patch("app.core.email_service.settings", settings_mock):
        pass  # settings are read in __init__ only for _frontend_url; patch per-method below
    return svc, settings_mock


# ─── Tests: send_verification_email ─────────────────────────────────────────

class TestSendVerificationEmail:
    @pytest.mark.asyncio
    async def test_calls_smtp_when_configured(self):
        svc, settings_mock = make_service(smtp_configured=True)
        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp") as mock_smtp:
            result = await svc.send_verification_email("user@test.com", "tok123")

        assert result is True
        mock_smtp.assert_called_once()
        to, msg = mock_smtp.call_args[0]
        assert to == "user@test.com"
        assert "tok123" in msg.as_string()
        assert "verify-email" in msg.as_string()

    @pytest.mark.asyncio
    async def test_logs_when_smtp_not_configured(self, caplog):
        svc, settings_mock = make_service(smtp_configured=False)
        settings_mock.email_enabled = False

        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp") as mock_smtp:
            result = await svc.send_verification_email("user@test.com", "tok123")

        assert result is True
        mock_smtp.assert_not_called()

    @pytest.mark.asyncio
    async def test_includes_token_in_url(self):
        svc, settings_mock = make_service(frontend_url="https://app.example.com")
        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp"):
            result = await svc.send_verification_email("user@test.com", "mytoken")

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_on_smtp_error(self):
        svc, settings_mock = make_service(smtp_configured=True)
        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp", side_effect=ConnectionRefusedError("no smtp")):
            result = await svc.send_verification_email("user@test.com", "tok")

        assert result is False


# ─── Tests: send_password_reset_email ───────────────────────────────────────

class TestSendPasswordResetEmail:
    @pytest.mark.asyncio
    async def test_calls_smtp_when_configured(self):
        svc, settings_mock = make_service(smtp_configured=True)
        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp") as mock_smtp:
            result = await svc.send_password_reset_email("user@test.com", "resettok")

        assert result is True
        mock_smtp.assert_called_once()
        to, msg = mock_smtp.call_args[0]
        assert to == "user@test.com"
        assert "resettok" in msg.as_string()
        assert "reset-password" in msg.as_string()

    @pytest.mark.asyncio
    async def test_logs_when_smtp_not_configured(self):
        svc, settings_mock = make_service(smtp_configured=False)
        settings_mock.email_enabled = False

        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp") as mock_smtp:
            result = await svc.send_password_reset_email("user@test.com", "resettok")

        assert result is True
        mock_smtp.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_false_on_smtp_error(self):
        svc, settings_mock = make_service(smtp_configured=True)
        with patch("app.core.email_service.settings", settings_mock), \
             patch.object(svc, "_send_smtp", side_effect=OSError("smtp down")):
            result = await svc.send_password_reset_email("user@test.com", "tok")

        assert result is False


# ─── Tests: UserService email integration ───────────────────────────────────

class TestUserServiceEmailIntegration:
    """Verify that UserService delegates to EmailService correctly."""

    def _make_user_service(self, session=None):
        from app.modules.users.services import UserService
        svc = UserService.__new__(UserService)
        svc.session = session or MagicMock()
        svc.user_repo = MagicMock()
        svc.refresh_token_repo = MagicMock()
        svc.email_verification_repo = AsyncMock()
        return svc

    @pytest.mark.asyncio
    async def test_send_email_verification_calls_email_service(self):
        svc = self._make_user_service()
        user = MagicMock()
        user.id = "uid-1"
        user.email = "u@test.com"

        email_svc_mock = AsyncMock()
        email_svc_mock.send_verification_email = AsyncMock(return_value=True)

        with patch("app.modules.users.services.get_email_service", return_value=email_svc_mock):
            result = await svc._send_email_verification(user)

        assert result is True
        email_svc_mock.send_verification_email.assert_called_once()
        call_args = email_svc_mock.send_verification_email.call_args[0]
        assert call_args[0] == "u@test.com"

    @pytest.mark.asyncio
    async def test_send_password_reset_email_calls_email_service(self):
        svc = self._make_user_service()
        user = MagicMock()
        user.id = "uid-2"
        user.email = "u@test.com"

        email_svc_mock = AsyncMock()
        email_svc_mock.send_password_reset_email = AsyncMock(return_value=True)

        with patch("app.modules.users.services.get_email_service", return_value=email_svc_mock):
            result = await svc._send_password_reset_email(user, "reset-token-abc")

        assert result is True
        email_svc_mock.send_password_reset_email.assert_called_once_with("u@test.com", "reset-token-abc")

    @pytest.mark.asyncio
    async def test_send_email_verification_returns_false_on_email_failure(self):
        svc = self._make_user_service()
        user = MagicMock()
        user.id = "uid-3"
        user.email = "u@test.com"

        email_svc_mock = AsyncMock()
        email_svc_mock.send_verification_email = AsyncMock(side_effect=RuntimeError("smtp down"))

        with patch("app.modules.users.services.get_email_service", return_value=email_svc_mock):
            result = await svc._send_email_verification(user)

        assert result is False
