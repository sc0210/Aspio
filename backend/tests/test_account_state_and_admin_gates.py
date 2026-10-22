"""
Account state and admin authority on the paths that used to skip them.

Optional-auth routes and the LINE bot resolved a principal without checking the
account's state, so an account an admin deactivated kept writing. Global actions
(processing every user's recurring schedules, clearing the shared market cache,
editing shared categories) were open to any account, or to any admin role.
"""

import uuid

import pytest
from sqlalchemy import select

from app.modules.admin.models import AdminUser
from app.modules.line_bot import service as line_service
from app.modules.line_bot.models import LineUserLink
from app.modules.transactions.models import TransactionCategory, TransactionType

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


async def test_recurring_processing_is_not_open_to_ordinary_accounts(authenticated_client):
    assert authenticated_client.post("/api/v1/transactions/recurring/process-due").status_code == 403


async def _grant(async_session, user, role):
    async_session.add(AdminUser(id=uuid.uuid4(), user_id=user.id, role=role, is_active=True, is_suspended=False))
    await async_session.commit()


@pytest.mark.parametrize("role", ["analyst", "support", "moderator"])
async def test_limited_admin_roles_cannot_edit_shared_categories(authenticated_client, test_user, async_session, role):
    await _grant(async_session, test_user, role)
    cat = TransactionCategory(name="Shared", name_en="Shared", type=TransactionType.EXPENSE, icon="x", color="#000000")
    async_session.add(cat)
    await async_session.commit()

    base = "/api/v1/transactions/categories"
    assert authenticated_client.post(base, json={"name": "New", "type": "expense"}).status_code == 403
    assert authenticated_client.put(f"{base}/{cat.id}", json={"is_active": False}).status_code == 403
    assert authenticated_client.delete(f"{base}/{cat.id}").status_code == 403

    await async_session.refresh(cat)
    assert cat.is_active is True
    names = (await async_session.execute(select(TransactionCategory.name))).scalars().all()
    assert "New" not in names


async def test_category_delete_is_a_soft_delete_for_admins(authenticated_client, test_user, async_session):
    await _grant(async_session, test_user, "admin")
    cat = TransactionCategory(name="Old", name_en="Old", type=TransactionType.EXPENSE, icon="x", color="#000000")
    async_session.add(cat)
    await async_session.commit()

    assert authenticated_client.delete(f"/api/v1/transactions/categories/{cat.id}").status_code == 204
    await async_session.refresh(cat)
    assert cat.is_active is False


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
