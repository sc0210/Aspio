"""A 4xx raised inside a handler's try must reach the client, not become a 500.

These handlers wrapped their own HTTPException in `except Exception`, so a
missing row answered "Failed to update ..." with status 500.
"""

import uuid

import pytest
import pytest_asyncio

from app.modules.admin.models import AdminUser

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


@pytest_asyncio.fixture
async def admin_client(authenticated_client, async_session, test_user):
    async_session.add(AdminUser(user_id=test_user.id, role="super_admin", is_active=True))
    await async_session.commit()
    return authenticated_client


@pytest.mark.parametrize("path,body", [
    (f"/api/v1/transactions/{uuid.uuid4()}", {"description": "x"}),
    (f"/api/v1/transactions/recurring/{uuid.uuid4()}", {"description": "x"}),
])
async def test_updating_a_missing_row_is_404(authenticated_client, path, body):
    r = authenticated_client.put(path, json=body)
    assert r.status_code == 404, r.text[:200]


async def test_unknown_export_format_is_400(authenticated_client):
    r = authenticated_client.get("/api/v1/portfolio/export", params={"format": "pdf"})  # was routed to a method that never existed
    assert r.status_code == 400, r.text[:200]


async def test_updating_a_missing_category_is_404(admin_client):
    r = admin_client.put(f"/api/v1/transactions/categories/{uuid.uuid4()}", json={"name": "x"})
    assert r.status_code == 404, r.text[:200]


async def test_admin_updates_a_category_by_its_id(admin_client, test_category):
    r = admin_client.put(f"/api/v1/transactions/categories/{test_category.id}", json={"color": "#112233"})
    assert r.status_code == 200, r.text[:200]
    assert r.json()["color"] == "#112233"


@pytest.mark.parametrize("method,suffix,body", [
    ("post", "", {"name": "Mine", "type": "expense"}),
    ("put", "/{id}", {"name": "Renamed"}),
    ("delete", "/{id}", None),
])
async def test_non_admins_cannot_change_shared_categories(authenticated_client, test_category, method, suffix, body):
    url = "/api/v1/transactions/categories" + suffix.format(id=test_category.id)
    kwargs = {"json": body} if body is not None else {}
    r = getattr(authenticated_client, method)(url, **kwargs)
    assert r.status_code == 403, r.text[:200]
