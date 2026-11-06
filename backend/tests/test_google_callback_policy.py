"""
The Google callback (the only Google sign-in path) applies the same admission
policy as every other door.

These cases were pinned on POST /auth/oauth/google, the code-exchange endpoint
that skipped super_admin approval before it was fixed. That endpoint had no
caller (NextAuth posts to the callback) and was removed, so the policy is pinned
here, on the path that is actually live.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.modules.users.models import UserStatus
from app.modules.users.schemas import GoogleCallbackRequest
from tests.test_users_service_unit import make_mock_user, make_service

EMAIL = "newcomer@example.com"
IDENTITY = {"sub": "google-sub-1", "email": EMAIL}


def _callback() -> GoogleCallbackRequest:
    return GoogleCallbackRequest(code="id-token", email=EMAIL, id="google-sub-1", verified_email=True)


def _service(existing=None):
    svc = make_service()
    svc.user_repo.get_user_by_email = AsyncMock(return_value=existing)
    svc.user_repo.create_user = AsyncMock(
        side_effect=lambda data: make_mock_user(email=data["email"], status=data["status"], is_active=data["is_active"])
    )
    svc.user_repo.update_user = AsyncMock()
    svc.user_repo.update_login_info = AsyncMock()
    svc.refresh_token_repo.create_refresh_token = AsyncMock()
    svc._update_user_activity = AsyncMock()
    return svc


def _google_verifies():
    return patch(
        "app.modules.users.services.google_oauth.verify_token_identity",
        AsyncMock(return_value=IDENTITY),
    )


@pytest.mark.asyncio
async def test_new_google_user_waits_for_approval():
    svc = _service()
    with _google_verifies():
        with pytest.raises(HTTPException) as exc:
            await svc.google_oauth_callback(_callback())

    assert exc.value.status_code == 403
    created = svc.user_repo.create_user.call_args.args[0]
    assert created["status"] == UserStatus.PENDING_APPROVAL
    assert created["is_active"] is False
    svc.refresh_token_repo.create_refresh_token.assert_not_called()


@pytest.mark.parametrize(
    "state",
    [
        {"status": UserStatus.PENDING_APPROVAL, "is_active": False},
        {"status": UserStatus.ACTIVE, "is_active": False},
        {"status": UserStatus.SUSPENDED, "is_active": True},
    ],
    ids=["pending", "deactivated", "suspended"],
)
@pytest.mark.asyncio
async def test_blocked_existing_account_gets_nothing(state):
    svc = _service(existing=make_mock_user(email=EMAIL, **state))
    with _google_verifies():
        with pytest.raises(HTTPException) as exc:
            await svc.google_oauth_callback(_callback())

    assert exc.value.status_code == 403
    svc.refresh_token_repo.create_refresh_token.assert_not_called()


@pytest.mark.asyncio
async def test_active_account_signs_in():
    svc = _service(existing=make_mock_user(email=EMAIL))
    with _google_verifies():
        result = await svc.google_oauth_callback(_callback())

    assert result.access_token
    assert result.is_new_user is False
    svc.refresh_token_repo.create_refresh_token.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_password_lockout_does_not_block_google_sign_in():
    """Anyone who knows the email can trip the lock with wrong passwords; Google
    proves the owner without one, and signing in clears the lock."""
    user = make_mock_user(email=EMAIL)
    user.is_account_locked = True
    svc = _service(existing=user)
    with _google_verifies():
        result = await svc.google_oauth_callback(_callback())

    assert result.access_token
    svc.user_repo.update_login_info.assert_awaited_once()
    assert svc.user_repo.update_login_info.await_args.kwargs.get("success") is True
