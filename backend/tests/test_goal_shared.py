"""A partner's own goal backs their side of a shared goal.

Promise (peers/service.py link_goal, _backing, _goal_to_out):
  * POST /peers/goals/{id}/link-goal gives the caller one personal goal for the
    shared goal (the same one on every call), with half its target as their share;
  * what that goal holds (reserved, spent, invested) counts toward the caller's
    side, alongside their saving records; the partner sees only the side's total;
  * reaching the target is judged from today's totals, linked goals included;
  * cancelling the personal goal unlinks it, and a new one can be linked.

Harm when broken: a couple's shared goal shows money nobody set aside, or
misses money one of them did.
"""

from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from app.modules.users.models import User, UserRole, UserStatus
from app.modules.users.security import jwt_manager

pytestmark = pytest.mark.asyncio
API = "/api/v1"


def _ok(response, code=200):
    assert response.status_code == code, (response.request.url, response.status_code, response.text[:400])
    body = response.json()
    return body.get("data") if isinstance(body, dict) and "success" in body else body


@pytest_asyncio.fixture
async def partner(async_session, test_user):
    test_user.username = "tester"
    user = User(id=uuid4(), email="partner@example.com", name="Partner", username="partner",
                hashed_password="x", is_active=True, is_verified=True, role=UserRole.USER,
                status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="UTC",
                experience_points=0, level=1)
    async_session.add(user)
    await async_session.commit()
    return {"Authorization": "Bearer " + jwt_manager.create_access_token(
        {"sub": str(user.id), "email": user.email})}


def _shared(client, partner, target):
    connection = _ok(client.post(f"{API}/peers/invite", json={"username": "partner"}), 201)["id"]
    _ok(client.patch(f"{API}/peers/{connection}/respond", json={"action": "accept"}, headers=partner))
    # Life cash to set aside.
    _ok(client.post(f"{API}/transactions/", json={
        "type": "income", "wallet_type": "life", "amount": "100000", "currency": "TWD",
        "description": "Salary", "transaction_date": "2026-01-01", "category_name": "Salary",
    }), 201)
    return _ok(client.post(f"{API}/peers/goals", json={
        "connection_id": connection, "title": "Wedding", "target_amount": str(target),
        "target_date": "2027-06-01"}), 201)["id"]


async def test_reserving_through_the_linked_goal_fills_your_side(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 100000)

    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    assert mine["sharedGoalId"] == shared
    assert float(mine["targetAmount"]) == 50000                     # half, editable
    again = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    assert again["id"] == mine["id"]                                 # one per partner

    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert view["your_amount"] == 20000
    assert view["your_set_aside"] == 20000
    assert view["your_goal_id"] == mine["id"]

    # The partner sees the side's total, not the goal behind it.
    theirs = _ok(client.get(f"{API}/peers/goals/{shared}", headers=partner))
    assert theirs["peer_amount"] == 20000
    assert theirs["your_goal_id"] is None


async def test_records_and_set_aside_money_add_up_and_complete_the_goal(authenticated_client, seed_categories, partner, async_session):
    client = authenticated_client
    shared = _shared(client, partner, 30000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)
    _ok(client.post(f"{API}/peers/goals/{shared}/records", json={
        "amount": "10000", "record_date": "2026-02-01"}, headers=partner), 201)

    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert view["total_amount"] == 30000
    assert view["status"] == "completed"                              # read from today's totals
    # The record that reached it stored it too, counting the linked goal's money.
    from sqlalchemy import select

    from app.modules.peers.models import SharedGoal

    stored = (await async_session.execute(select(SharedGoal.status).where(SharedGoal.id == UUID(shared)))).scalar_one()
    assert stored == "completed"

    # Releasing the cash reopens it.
    _ok(client.post(f"{API}/goals/{mine['id']}/release", json={"amount": "5000"}), 201)
    assert _ok(client.get(f"{API}/peers/goals/{shared}"))["status"] == "active"


async def test_cancelling_your_goal_unlinks_it(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 100000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    _ok(client.put(f"{API}/goals/{mine['id']}", json={"status": "cancelled"}))

    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert view["your_amount"] == 0 and view["your_goal_id"] is None
    fresh = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    assert fresh["id"] != mine["id"]


async def test_an_outsider_cannot_link(authenticated_client, seed_categories, partner, async_session):
    client = authenticated_client
    shared = _shared(client, partner, 100000)
    outsider = User(id=uuid4(), email="out@example.com", name="Out", username="out",
                    hashed_password="x", is_active=True, is_verified=True, role=UserRole.USER,
                    status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="UTC",
                    experience_points=0, level=1)
    async_session.add(outsider)
    await async_session.commit()
    headers = {"Authorization": "Bearer " + jwt_manager.create_access_token(
        {"sub": str(outsider.id), "email": outsider.email})}
    assert client.post(f"{API}/peers/goals/{shared}/link-goal", headers=headers).status_code == 404
