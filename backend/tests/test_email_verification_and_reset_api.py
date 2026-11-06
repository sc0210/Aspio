"""
Email verification and password-reset confirmation, end to end.

Both turn a single-use emailed token into a change on the account. The tokens
are stored hashed and typed: a reset token can't verify an email, a used or
expired token does nothing, and a successful reset ends every existing session.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from app.modules.users.models import User, UserRole, UserStatus
from app.modules.users.repositories import EmailVerificationRepository

pytestmark = pytest.mark.asyncio
AUTH = "/api/v1/auth"
NEW_PASSWORD = "N3w-Sturdy-Passphrase!"


@pytest_asyncio.fixture
async def unverified_user(async_session):
    user = User(id=uuid.uuid4(), email="fresh@example.com", name="Fresh", hashed_password="x",
                is_active=True, is_verified=False, role=UserRole.USER, status=UserStatus.ACTIVE,
                experience_points=0, level=1)
    async_session.add(user)
    await async_session.commit()
    return user


async def _token(async_session, user, token_type, expires_in=timedelta(hours=1)):
    raw = f"tok-{uuid.uuid4().hex}"
    await EmailVerificationRepository(async_session).create_verification_token(
        user.id, raw, token_type, datetime.now(timezone.utc) + expires_in)
    return raw


async def _reload(async_session, user):
    await async_session.refresh(user)
    return user


class TestVerifyEmail:
    async def test_a_valid_token_verifies_once_and_awards_xp_once(self, client, async_session, unverified_user):
        token = await _token(async_session, unverified_user, "email_verification")

        r = client.post(f"{AUTH}/verify-email", json={"token": token})
        assert r.status_code == 200, r.text
        user = await _reload(async_session, unverified_user)
        assert user.is_verified is True
        xp = user.experience_points
        assert xp >= 50

        assert client.post(f"{AUTH}/verify-email", json={"token": token}).status_code == 400
        assert (await _reload(async_session, unverified_user)).experience_points == xp

    async def test_an_expired_token_does_nothing(self, client, async_session, unverified_user):
        token = await _token(async_session, unverified_user, "email_verification", timedelta(minutes=-1))
        assert client.post(f"{AUTH}/verify-email", json={"token": token}).status_code == 400
        assert (await _reload(async_session, unverified_user)).is_verified is False

    async def test_a_reset_token_cannot_verify_an_email(self, client, async_session, unverified_user):
        token = await _token(async_session, unverified_user, "password_reset")
        assert client.post(f"{AUTH}/verify-email", json={"token": token}).status_code == 400
        assert (await _reload(async_session, unverified_user)).is_verified is False

    async def test_an_unknown_token_is_400(self, client):
        assert client.post(f"{AUTH}/verify-email", json={"token": "nope"}).status_code == 400

    async def test_resend_answers_the_same_for_known_and_unknown_emails(self, client, unverified_user):
        known = client.post(f"{AUTH}/resend-verification", json={"email": unverified_user.email})
        unknown = client.post(f"{AUTH}/resend-verification", json={"email": "nobody@example.com"})
        assert known.status_code == unknown.status_code == 200
        assert known.json()["message"] == unknown.json()["message"]


class TestResetConfirm:
    def _login(self, client, password):
        return client.post(f"{AUTH}/login", json={"email": "testuser@example.com", "password": password})

    def _reset(self, client, token, password=NEW_PASSWORD):
        return client.post(f"{AUTH}/password/reset-confirm",
                           json={"token": token, "new_password": password, "confirm_password": password})

    async def test_reset_changes_the_password_and_ends_old_sessions(self, client, async_session, test_user):
        login = self._login(client, "secret")
        assert login.status_code == 200, login.text
        old_refresh = login.json()["refresh_token"]

        token = await _token(async_session, test_user, "password_reset")
        assert self._reset(client, token).status_code == 200

        assert self._login(client, "secret").status_code == 401
        assert self._login(client, NEW_PASSWORD).status_code == 200
        assert client.post(f"{AUTH}/refresh", json={"refresh_token": old_refresh}).status_code == 401

    async def test_a_reset_token_works_once(self, client, async_session, test_user):
        token = await _token(async_session, test_user, "password_reset")
        assert self._reset(client, token).status_code == 200
        assert self._reset(client, token, "An0ther-Sturdy-Pass!").status_code == 400
        assert self._login(client, NEW_PASSWORD).status_code == 200

    async def test_expired_and_mistyped_tokens_change_nothing(self, client, async_session, test_user):
        expired = await _token(async_session, test_user, "password_reset", timedelta(minutes=-1))
        verification = await _token(async_session, test_user, "email_verification")
        assert self._reset(client, expired).status_code == 400
        assert self._reset(client, verification).status_code == 400
        assert self._reset(client, "unknown-token").status_code == 400
        assert self._login(client, "secret").status_code == 200

    async def test_a_weak_password_is_refused_and_the_token_survives(self, client, async_session, test_user):
        token = await _token(async_session, test_user, "password_reset")
        assert self._reset(client, token, "password").status_code in (400, 422)
        assert self._reset(client, token).status_code == 200
