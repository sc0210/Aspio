"""
Integration tests for editing wallet-to-wallet transfers as a single unit.

Exercises the transfer_group_id linkage added alongside these endpoints:
POST /transactions/transfer tags both legs with a shared group id, GET/PUT
/transactions/transfer/{group_id} read and atomically rewrite them, and
DELETE /transactions/{id} cascades to the sibling leg so a transfer is never
left as an orphaned half-transaction.
"""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.modules.users.models import User, UserRole, UserStatus


@pytest.fixture
def mock_current_user():
    return User(
        id=uuid4(),
        email="transfer-edit-test@example.com",
        name="Transfer Edit Test User",
        hashed_password="$2b$12$fakehash",
        is_active=True,
        is_verified=True,
        status=UserStatus.ACTIVE,
        role=UserRole.USER,
        preferences={},
    )


@pytest.fixture
def client(mock_current_user, override_get_async_session):
    """Test client with a real (non-demo) authenticated user.

    GET/PUT/DELETE /transactions/{id} resolve auth via
    get_optional_current_user (falls back to demo mode when None), while the
    transfer endpoints require get_current_active_user directly — both must
    be overridden or half the calls in a test silently fall through to the
    unrelated demo-fixture data instead of this test's real rows.
    """
    from app.main import app as fastapi_app
    from app.modules.users.dependencies import (
        get_current_active_user,
        get_optional_current_user,
    )
    from app.core.database import get_async_session, get_db

    fastapi_app.dependency_overrides[get_current_active_user] = lambda: mock_current_user
    fastapi_app.dependency_overrides[get_optional_current_user] = lambda: mock_current_user
    fastapi_app.dependency_overrides[get_async_session] = override_get_async_session
    fastapi_app.dependency_overrides[get_db] = override_get_async_session
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


def _create_transfer(client: TestClient, amount=1000, from_wallet="life", to_wallet="emergency"):
    response = client.post(
        "/api/v1/transactions/transfer",
        json={
            "from_wallet": from_wallet,
            "to_wallet": to_wallet,
            "amount": amount,
            "currency": "TWD",
            "transaction_date": "2026-07-01",
            "notes": None,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


class TestTransferCreateLinksLegs:
    def test_both_legs_share_a_transfer_group_id(self, client):
        data = _create_transfer(client)
        items = data["items"]
        assert len(items) == 2
        group_ids = {item["item"]["transfer_group_id"] for item in items}
        assert len(group_ids) == 1
        assert None not in group_ids


class TestGetTransfer:
    def test_returns_combined_view_of_both_legs(self, client):
        data = _create_transfer(client, amount=500, from_wallet="life", to_wallet="emergency")
        group_id = data["items"][0]["item"]["transfer_group_id"]

        response = client.get(f"/api/v1/transactions/transfer/{group_id}")
        assert response.status_code == 200, response.text
        transfer = response.json()["data"]
        assert transfer["from_wallet"] == "life"
        assert transfer["to_wallet"] == "emergency"
        assert float(transfer["amount"]) == 500

    def test_unknown_group_id_returns_404(self, client):
        response = client.get(f"/api/v1/transactions/transfer/{uuid4()}")
        assert response.status_code == 404


class TestUpdateTransfer:
    def test_rewrites_both_legs_atomically(self, client):
        data = _create_transfer(client, amount=1000, from_wallet="life", to_wallet="emergency")
        group_id = data["items"][0]["item"]["transfer_group_id"]
        leg_ids = [item["item"]["id"] for item in data["items"]]

        response = client.put(
            f"/api/v1/transactions/transfer/{group_id}",
            json={
                "from_wallet": "emergency",
                "to_wallet": "life",
                "amount": 2500,
                "currency": "TWD",
                "transaction_date": "2026-07-02",
                "notes": "Corrected direction",
            },
        )
        assert response.status_code == 200, response.text

        legs = [client.get(f"/api/v1/transactions/{leg_id}").json() for leg_id in leg_ids]
        for leg in legs:
            assert float(leg["amount"]) == 2500

        expense_leg = next(l for l in legs if l["type"] == "expense")
        income_leg = next(l for l in legs if l["type"] == "income")
        assert expense_leg["walletType"] == "emergency"
        assert income_leg["walletType"] == "life"

    def test_same_wallet_on_both_sides_is_rejected(self, client):
        data = _create_transfer(client)
        group_id = data["items"][0]["item"]["transfer_group_id"]

        response = client.put(
            f"/api/v1/transactions/transfer/{group_id}",
            json={
                "from_wallet": "life",
                "to_wallet": "life",
                "amount": 100,
                "currency": "TWD",
                "transaction_date": "2026-07-02",
            },
        )
        assert response.status_code == 400


class TestDeleteTransferCascades:
    def test_deleting_one_leg_deletes_the_sibling(self, client):
        data = _create_transfer(client, amount=750, from_wallet="life", to_wallet="emergency")
        leg_ids = [item["item"]["id"] for item in data["items"]]

        delete_resp = client.delete(f"/api/v1/transactions/{leg_ids[0]}")
        assert delete_resp.status_code == 204

        for leg_id in leg_ids:
            leg_resp = client.get(f"/api/v1/transactions/{leg_id}")
            assert leg_resp.status_code == 404
