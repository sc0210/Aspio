"""
POST /auth/google/callback must not trust its body.

Caddy forwards /api/v1/* from the internet, and this route took `email` from
the request and returned that account's tokens without checking `code`: anyone
who knew an address could sign in as it, admins included. The backend now asks
Google who the token belongs to; these tests pin that a body Google does not
vouch for gets nothing.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.modules.users.schemas import GoogleCallbackRequest
from app.modules.users.security import GoogleOAuthManager
from tests.test_users_service_unit import make_mock_user, make_service

VICTIM = "admin@example.com"


def _callback(**overrides) -> GoogleCallbackRequest:
    body = {"code": "forged", "email": VICTIM, "id": "google-sub-1", "verified_email": True}
    body.update(overrides)
    return GoogleCallbackRequest(**body)


def _issuing_service(user):
    svc = make_service()
    svc.user_repo.get_user_by_email = AsyncMock(return_value=user)
    svc.user_repo.update_user = AsyncMock()
    svc.user_repo.update_login_info = AsyncMock()
    svc.refresh_token_repo.create_refresh_token = AsyncMock()
    svc._update_user_activity = AsyncMock()
    return svc


class TestCallbackService:
    @pytest.mark.asyncio
    async def test_unverifiable_token_gets_nothing(self):
        svc = _issuing_service(make_mock_user(email=VICTIM))
        with patch("app.modules.users.services.google_oauth.verify_token_identity", AsyncMock(return_value=None)):
            with pytest.raises(HTTPException) as exc:
                await svc.google_oauth_callback(_callback())

        assert exc.value.status_code == 401
        # Rejected before the account was even looked up.
        svc.user_repo.get_user_by_email.assert_not_called()
        svc.refresh_token_repo.create_refresh_token.assert_not_called()

    @pytest.mark.parametrize(
        "identity",
        [
            {"sub": "attacker-sub", "email": VICTIM},  # someone else's Google account
            {"sub": "google-sub-1", "email": "attacker@example.com"},  # real token, claimed email swapped
        ],
    )
    @pytest.mark.asyncio
    async def test_token_for_another_account_gets_nothing(self, identity):
        svc = _issuing_service(make_mock_user(email=VICTIM))
        with patch("app.modules.users.services.google_oauth.verify_token_identity", AsyncMock(return_value=identity)):
            with pytest.raises(HTTPException) as exc:
                await svc.google_oauth_callback(_callback())

        assert exc.value.status_code == 401
        svc.refresh_token_repo.create_refresh_token.assert_not_called()

    @pytest.mark.asyncio
    async def test_verified_token_signs_in(self):
        svc = _issuing_service(make_mock_user(email=VICTIM))
        identity = {"sub": "google-sub-1", "email": "Admin@Example.com"}
        with patch("app.modules.users.services.google_oauth.verify_token_identity", AsyncMock(return_value=identity)):
            result = await svc.google_oauth_callback(_callback())

        assert result.access_token
        svc.refresh_token_repo.create_refresh_token.assert_awaited_once()


def _tokeninfo(status_code=200, **payload):
    """Patch httpx so tokeninfo answers with `payload`; returns the GET mock."""
    response = MagicMock(status_code=status_code)
    response.json.return_value = payload
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return patch("app.modules.users.security.httpx.AsyncClient", return_value=client), client.get


def _manager(client_id="our-client.apps.googleusercontent.com"):
    manager = GoogleOAuthManager()
    manager.client_id = client_id
    return manager


GOOD = {"aud": "our-client.apps.googleusercontent.com", "sub": "s1", "email": "a@example.com", "email_verified": "true"}


class TestVerifyTokenIdentity:
    @pytest.mark.asyncio
    async def test_accepts_a_verified_token_for_this_client(self):
        patcher, get = _tokeninfo(**GOOD)
        with patcher:
            assert await _manager().verify_token_identity("ya29.token") == {"sub": "s1", "email": "a@example.com"}
        assert get.call_args.kwargs["params"] == {"access_token": "ya29.token"}

    @pytest.mark.asyncio
    async def test_sends_an_id_token_as_one(self):
        patcher, get = _tokeninfo(**GOOD)
        with patcher:
            await _manager().verify_token_identity("header.payload.sig")
        assert get.call_args.kwargs["params"] == {"id_token": "header.payload.sig"}

    @pytest.mark.parametrize(
        "change",
        [
            {"aud": "another-app.apps.googleusercontent.com"},
            {"email_verified": "false"},
            {"sub": ""},
        ],
    )
    @pytest.mark.asyncio
    async def test_rejects(self, change):
        patcher, _ = _tokeninfo(**{**GOOD, **change})
        with patcher:
            assert await _manager().verify_token_identity("ya29.token") is None

    @pytest.mark.asyncio
    async def test_rejects_what_google_rejects(self):
        patcher, _ = _tokeninfo(status_code=400, error="invalid_token")
        with patcher:
            assert await _manager().verify_token_identity("forged") is None

    @pytest.mark.asyncio
    async def test_fails_closed_without_a_client_id(self):
        patcher, get = _tokeninfo(**GOOD)
        with patcher:
            assert await _manager(client_id=None).verify_token_identity("ya29.token") is None
        get.assert_not_called()


def test_forged_callback_over_http_is_refused():
    """The route as the internet reaches it: Google is not configured, so nothing verifies."""
    from app.main import create_app

    res = TestClient(create_app()).post(
        "/api/v1/auth/google/callback",
        json={"code": "x", "email": VICTIM, "id": "x"},
    )
    assert res.status_code == 401
    assert "access_token" not in res.text
