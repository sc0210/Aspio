import pytest
from httpx import AsyncClient
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.skip(reason="Integration test — requires live server and 'created_user' fixture")


@pytest.mark.asyncio
async def test_dashboard_updates_after_transaction(client: AsyncClient, created_user):
    """Create a transaction and verify dashboard endpoints reflect the change."""

    # Login to get access token
    login_payload = {"email": created_user.email, "password": "SecurePassword123!"}

    login_resp = await client.post("/api/v1/auth/login", json=login_payload)
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    assert login_data.get("success") is True
    access_token = login_data.get("access_token")
    assert access_token

    headers = {"Authorization": f"Bearer {access_token}"}

    # Get recent activity before creating transaction
    resp_before = await client.get(
        "/api/v1/dashboard/recent-activity?limit=10", headers=headers
    )
    assert resp_before.status_code == 200
    before_data = resp_before.json().get("data") or []
    before_count = len(before_data)

    # Create a new transaction (use category_name so test doesn't rely on existing category id)
    tx_payload = {
        "type": "expense",
        "amount": "123.45",
        "currency": "USD",
        "description": "Integration Test Expense",
        "transaction_date": business_today().isoformat(),
        "category_name": "Integration Test Category",
    }

    create_resp = await client.post(
        "/api/v1/transactions/", json=tx_payload, headers=headers
    )
    assert create_resp.status_code in (200, 201)

    # Fetch recent activity again (force refresh to bypass cache)
    resp_after = await client.get(
        "/api/v1/dashboard/recent-activity?limit=10&force_refresh=true", headers=headers
    )
    assert resp_after.status_code == 200
    after_data = resp_after.json().get("data") or []
    after_count = len(after_data)

    # Ensure we have at least one more or same number (some endpoints may cap results)
    assert after_count >= before_count

    # Ensure our created transaction appears in recent activity
    found = any(
        (item.get("title") and "Integration Test Expense" in item.get("title"))
        or (
            item.get("description")
            and "Integration Test Expense" in item.get("description")
        )
        for item in after_data
    )
    assert found, "Created transaction not found in recent activity"

    # Fetch dashboard stats and ensure the response structure is present and refreshed
    stats_resp = await client.get(
        "/api/v1/dashboard/stats?force_refresh=true", headers=headers
    )
    assert stats_resp.status_code == 200
    stats = stats_resp.json().get("data") or {}

    # Basic sanity checks on stats structure
    assert "total_balance" in stats
    assert "total_income" in stats
    assert "total_expenses" in stats
    assert "last_updated" in stats
