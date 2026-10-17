"""A 4xx raised inside a handler's try must reach the client, not become a 500.

These handlers wrapped their own HTTPException in `except Exception`, so a
missing row answered "Failed to update ..." with status 500.
"""

import uuid

import pytest

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


@pytest.mark.parametrize("path,body", [
    (f"/api/v1/transactions/{uuid.uuid4()}", {"description": "x"}),
    (f"/api/v1/transactions/categories/{uuid.uuid4()}", {"name": "x"}),
    (f"/api/v1/transactions/recurring/{uuid.uuid4()}", {"description": "x"}),
])
async def test_updating_a_missing_row_is_404(authenticated_client, path, body):
    r = authenticated_client.put(path, json=body)
    assert r.status_code == 404, r.text[:200]


async def test_unknown_export_format_is_400(authenticated_client):
    r = authenticated_client.get("/api/v1/portfolio/export", params={"format": "pdf"})  # was routed to a method that never existed
    assert r.status_code == 400, r.text[:200]


async def test_updating_a_category_by_its_id(authenticated_client, test_category):
    r = authenticated_client.put(f"/api/v1/transactions/categories/{test_category.id}", json={"color": "#112233"})
    assert r.status_code == 200, r.text[:200]
    assert r.json()["color"] == "#112233"
