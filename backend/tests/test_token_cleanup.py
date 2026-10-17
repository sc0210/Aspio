"""
Unit tests for verification-token cleanup:
  - EmailVerificationRepository.delete_expired_by_user
  - UserService._cleanup_old_verification_tokens
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


# ─── Repository tests ────────────────────────────────────────────────────────

class TestDeleteExpiredByUser:
    """Tests for EmailVerificationRepository.delete_expired_by_user."""

    def _make_repo(self, rowcount: int = 0):
        from app.modules.users.repositories import EmailVerificationRepository

        session = MagicMock()
        result_mock = MagicMock()
        result_mock.rowcount = rowcount
        session.execute = AsyncMock(return_value=result_mock)
        session.commit = AsyncMock()
        session.rollback = AsyncMock()

        repo = EmailVerificationRepository.__new__(EmailVerificationRepository)
        repo.session = session
        return repo, session

    @pytest.mark.asyncio
    async def test_returns_deleted_count(self):
        repo, _ = self._make_repo(rowcount=3)
        count = await repo.delete_expired_by_user(uuid4(), "email_verification")
        assert count == 3

    @pytest.mark.asyncio
    async def test_returns_zero_when_nothing_deleted(self):
        repo, _ = self._make_repo(rowcount=0)
        count = await repo.delete_expired_by_user(uuid4(), "password_reset")
        assert count == 0

    @pytest.mark.asyncio
    async def test_executes_delete_statement(self):
        repo, session = self._make_repo(rowcount=1)
        await repo.delete_expired_by_user(uuid4(), "email_verification")
        session.execute.assert_called_once()
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_rolls_back_and_returns_zero_on_db_error(self):
        repo, session = self._make_repo()
        session.execute = AsyncMock(side_effect=RuntimeError("db error"))

        count = await repo.delete_expired_by_user(uuid4(), "email_verification")

        assert count == 0
        session.rollback.assert_called_once()


# ─── Service tests ────────────────────────────────────────────────────────────

class TestCleanupOldVerificationTokens:
    """Tests for UserService._cleanup_old_verification_tokens."""

    def _make_service(self):
        from app.modules.users.services import UserService

        svc = UserService.__new__(UserService)
        svc.session = MagicMock()
        svc.user_repo = MagicMock()
        svc.refresh_token_repo = MagicMock()
        svc.email_verification_repo = AsyncMock()
        svc.email_verification_repo.delete_expired_by_user = AsyncMock(return_value=0)
        return svc

    @pytest.mark.asyncio
    async def test_delegates_to_repository(self):
        svc = self._make_service()
        uid = uuid4()
        await svc._cleanup_old_verification_tokens(uid, "email_verification")
        svc.email_verification_repo.delete_expired_by_user.assert_called_once_with(
            uid, "email_verification"
        )

    @pytest.mark.asyncio
    async def test_swallows_exceptions_silently(self):
        svc = self._make_service()
        svc.email_verification_repo.delete_expired_by_user = AsyncMock(
            side_effect=RuntimeError("unexpected")
        )
        # Should not raise
        await svc._cleanup_old_verification_tokens(uuid4(), "password_reset")

    @pytest.mark.asyncio
    async def test_called_before_create_in_send_email_verification(self):
        """Cleanup must happen before a new token is created."""
        svc = self._make_service()
        svc.email_verification_repo.create_verification_token = AsyncMock(
            return_value=MagicMock(id=uuid4())
        )

        user = MagicMock()
        user.id = uuid4()
        user.email = "u@test.com"

        call_order = []
        svc.email_verification_repo.delete_expired_by_user = AsyncMock(
            side_effect=lambda *a, **kw: call_order.append("cleanup") or 0
        )
        svc.email_verification_repo.create_verification_token = AsyncMock(
            side_effect=lambda *a, **kw: call_order.append("create") or MagicMock(id=uuid4())
        )

        email_svc_mock = AsyncMock()
        email_svc_mock.send_verification_email = AsyncMock(return_value=True)

        with patch("app.modules.users.services.get_email_service", return_value=email_svc_mock):
            await svc._send_email_verification(user)

        assert call_order.index("cleanup") < call_order.index("create"), (
            "cleanup must happen before create"
        )
