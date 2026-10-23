"""
POST /auth/oauth/google must apply the same admission policy as every other door.

It created any new Google account as ACTIVE and verified, and issued tokens to
existing accounts without looking at their state, so on a Google-enabled
instance any stranger with a Google account skipped super_admin approval.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.core.config import Settings
from app.modules.users.models import UserStatus
from app.modules.users.schemas import GoogleOAuthRequest
from tests.test_users_service_unit import make_mock_user, make_service

GOOGLE = "app.modules.users.services.google_oauth"


def _google(user_info):
    """Patch Google so the code exchanges and userinfo returns `user_info`."""
    exchange = AsyncMock(return_value={"access_token": "ya29.dummy"})
    return (
        patch.object(Settings, "google_oauth_enabled", property(lambda self: True)),
        patch(f"{GOOGLE}.exchange_code_for_tokens", exchange),
        patch(f"{GOOGLE}.get_user_info", AsyncMock(return_value=user_info)),
        exchange,
    )


def _service(existing=None):
    svc = make_service()
    svc.user_repo.get_user_by_email = AsyncMock(return_value=existing)
    svc.user_repo.create_user = AsyncMock(side_effect=lambda data: make_mock_user(email=data["email"], status=data["status"], is_active=data["is_active"]))
    svc.user_repo.update_login_info = AsyncMock()
    svc.refresh_token_repo.create_refresh_token = AsyncMock()
    svc._update_user_activity = AsyncMock()
    return svc


VERIFIED = {"id": "g-1", "email": "newcomer@example.com", "verified_email": True}


@pytest.mark.asyncio
async def test_new_google_user_waits_for_approval():
    svc = _service()
    enabled, exch, info, _ = _google(VERIFIED)
    with enabled, exch, info:
        with pytest.raises(HTTPException) as exc:
            await svc.google_oauth_login(GoogleOAuthRequest(authorization_code="c"))

    assert exc.value.status_code == 403
    created = svc.user_repo.create_user.call_args.args[0]
    assert created["status"] == UserStatus.PENDING_APPROVAL
    assert created["is_active"] is False
    svc.refresh_token_repo.create_refresh_token.assert_not_called()


@pytest.mark.asyncio
async def test_unverified_google_email_gets_nothing():
    svc = _service(existing=make_mock_user(email="newcomer@example.com"))
    enabled, exch, info, _ = _google({**VERIFIED, "verified_email": False})
    with enabled, exch, info:
        with pytest.raises(HTTPException) as exc:
            await svc.google_oauth_login(GoogleOAuthRequest(authorization_code="c"))

    assert exc.value.status_code == 403
    svc.user_repo.create_user.assert_not_called()
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
    user = make_mock_user(email="newcomer@example.com", **state)
    user.deleted_at = None
    svc = _service(existing=user)
    enabled, exch, info, _ = _google(VERIFIED)
    with enabled, exch, info:
        with pytest.raises(HTTPException) as exc:
            await svc.google_oauth_login(GoogleOAuthRequest(authorization_code="c"))

    assert exc.value.status_code == 403
    svc.refresh_token_repo.create_refresh_token.assert_not_called()


@pytest.mark.asyncio
async def test_active_account_signs_in_and_redirect_uri_is_not_the_callers():
    user = make_mock_user(email="newcomer@example.com")
    user.deleted_at = None
    svc = _service(existing=user)
    enabled, exch, info, exchange = _google(VERIFIED)
    with enabled, exch, info:
        result = await svc.google_oauth_login(
            GoogleOAuthRequest(authorization_code="c", redirect_uri="https://attacker.example/cb")
        )

    assert result.access_token
    assert exchange.call_args.args == ("c",)
    assert "redirect_uri" not in exchange.call_args.kwargs
