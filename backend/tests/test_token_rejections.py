"""
Every way a bearer token can fail to name a usable account.

get_current_user_from_token guards every CurrentUser route; the optional-auth
lookup (with its 30s in-process cache) guards the routes that also serve demo
data. A signed token is not enough on either: it has to name a real, active,
unsuspended, undeleted account.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.modules.users.dependencies import invalidate_user_auth_cache
from app.modules.users.models import UserStatus
from app.modules.users.security import jwt_manager

pytestmark = pytest.mark.asyncio
STRICT = "/api/v1/loans/"           # CurrentUser
OPTIONAL = "/api/v1/transactions/"  # optional auth, cached


def _get(client, path, token):
    return client.get(path, headers={"Authorization": f"Bearer {token}"})


@pytest.mark.parametrize(
    "claims",
    [{"email": "x@example.com"}, {"sub": "not-a-uuid"}, {"sub": str(uuid.uuid4())}],
    ids=["no-sub", "non-uuid-sub", "unknown-user"],
)
async def test_a_signed_token_that_names_no_account_is_401(client, claims):
    assert _get(client, STRICT, jwt_manager.create_access_token(claims)).status_code == 401


async def test_a_refresh_token_is_not_an_access_token(client, test_user):
    refresh = jwt_manager.create_refresh_token({"sub": str(test_user.id), "email": test_user.email})
    assert _get(client, STRICT, refresh).status_code == 401


async def test_an_expired_token_is_401(client, test_user):
    token = jwt_manager.create_access_token(
        {"sub": str(test_user.id), "email": test_user.email}, expires_delta=timedelta(seconds=-5))
    assert _get(client, STRICT, token).status_code == 401


async def test_a_token_signed_with_another_key_is_401(client, test_user):
    import jwt as pyjwt

    forged = pyjwt.encode({"sub": str(test_user.id), "type": "access",
                           "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                          "not-the-server-secret", algorithm="HS256")
    assert _get(client, STRICT, forged).status_code == 401


@pytest.mark.parametrize(
    ("change", "strict_code"),
    [
        ({"is_active": False}, 403),
        ({"status": UserStatus.SUSPENDED}, 403),
        # The user lookup skips soft-deleted rows, so the token names no account.
        ({"deleted_at": datetime.now(timezone.utc)}, 401),
    ],
    ids=["deactivated", "suspended", "soft-deleted"],
)
async def test_a_blocked_account_is_refused_on_both_paths(client, test_user, async_session, change, strict_code):
    token = jwt_manager.create_access_token({"sub": str(test_user.id), "email": test_user.email})
    assert _get(client, STRICT, token).status_code == 200
    assert _get(client, OPTIONAL, token).status_code == 200  # warms the optional-auth cache

    for field, value in change.items():
        setattr(test_user, field, value)
    await async_session.commit()
    invalidate_user_auth_cache(test_user.id)

    assert _get(client, STRICT, token).status_code == strict_code
    assert _get(client, OPTIONAL, token).status_code in (401, 403)


async def test_hard_deleting_a_user_drops_their_cached_auth(client, test_user, async_session):
    """Without the invalidation, the deleted account kept passing optional-auth
    routes from the cache for up to 30 seconds."""
    from app.modules.admin.services import UserManagementService
    from app.modules.users.dependencies import _user_auth_cache

    token = jwt_manager.create_access_token({"sub": str(test_user.id), "email": test_user.email})
    assert _get(client, OPTIONAL, token).status_code == 200
    assert str(test_user.id) in _user_auth_cache

    await UserManagementService(async_session).hard_delete_user(test_user.id)

    assert str(test_user.id) not in _user_auth_cache
    assert _get(client, STRICT, token).status_code == 401
