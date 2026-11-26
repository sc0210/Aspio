"""
Account state and admin authority on the paths that used to skip them.

Optional-auth routes and the LINE bot resolved a principal without checking the
account's state, so an account an admin deactivated kept writing. Global actions
(processing every user's recurring schedules, clearing the shared market cache,
editing shared categories) were open to any account, or to any admin role.
"""

import uuid

import pytest

from app.modules.admin.models import AdminUser
from app.modules.line_bot import service as line_service
from app.modules.line_bot.models import LineUserLink

pytestmark = pytest.mark.asyncio


async def test_deactivated_account_loses_optional_auth_routes(authenticated_client, test_user, async_session):
    assert authenticated_client.get("/api/v1/transactions/").status_code == 200

    from app.modules.users.dependencies import invalidate_user_auth_cache

    test_user.is_active = False
    await async_session.commit()
    invalidate_user_auth_cache(test_user.id)

    assert authenticated_client.get("/api/v1/transactions/").status_code == 403


async def test_line_commands_treat_a_deactivated_account_as_unlinked(async_session, test_user):
    async_session.add(LineUserLink(line_user_id="Udeact", user_id=test_user.id, display_name="t"))
    await async_session.commit()
    assert await line_service._get_link(async_session, "Udeact") is not None

    test_user.is_active = False
    await async_session.commit()
    assert await line_service._get_link(async_session, "Udeact") is None
    # Linking code still sees the row, so it can report "already linked".
    assert await line_service._get_raw_link(async_session, "Udeact") is not None


async def _grant(async_session, user, role):
    async_session.add(AdminUser(id=uuid.uuid4(), user_id=user.id, role=role, is_active=True, is_suspended=False))
    await async_session.commit()


async def test_market_cache_clear_needs_admin_and_keeps_single_flight_state(authenticated_client, test_user, async_session):
    from app.modules.portfolio import market_data_service as mds

    assert authenticated_client.post("/api/v1/portfolio/clear-market-cache").status_code == 403

    await _grant(async_session, test_user, "admin")
    sentinel_lock = object()
    mds._finlab_market_cache.update(close="data", fetch_lock=sentinel_lock, failed_at=123.0)
    assert authenticated_client.post("/api/v1/portfolio/clear-market-cache").status_code == 200
    assert mds._finlab_market_cache["close"] is None
    assert mds._finlab_market_cache["fetch_lock"] is sentinel_lock
    assert mds._finlab_market_cache["failed_at"] == 123.0
    mds._finlab_market_cache.update(fetch_lock=None, failed_at=None)
