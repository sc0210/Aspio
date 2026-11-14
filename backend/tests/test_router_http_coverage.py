"""
HTTP-level tests for routers whose services were tested but whose routes were
not: goals, reports (only /reports/goals: spending and monthly-trends group by
Postgres to_char() and can't run on SQLite), the gamification endpoints,
recurring transaction CRUD and peers. Each checks the status, the ApiResponse envelope
and, where data is per-user, that another account can't reach it.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.transactions.models import TransactionCategory, TransactionType
from app.modules.users.models import User, UserRole, UserStatus
from app.modules.users.security import jwt_manager
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.asyncio
API = "/api/v1"


def _ok(response, code=200):
    assert response.status_code == code, (response.request.url, response.status_code, response.text[:300])
    body = response.json()
    if isinstance(body, dict) and "success" in body:
        assert body["success"] is True
        return body.get("data")
    return body


def _headers(user):
    return {"Authorization": "Bearer " + jwt_manager.create_access_token(
        {"sub": str(user.id), "email": user.email})}


@pytest_asyncio.fixture
async def stranger(async_session):
    user = User(id=uuid4(), email="stranger@example.com", name="Stranger", username="stranger",
                hashed_password="x", is_active=True, is_verified=True, role=UserRole.USER,
                status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="UTC",
                experience_points=0, level=1)
    async_session.add(user)
    await async_session.commit()
    return user


# ── Goals ─────────────────────────────────────────────────────────────────────

async def test_goal_crud_and_isolation(authenticated_client, stranger):
    client = authenticated_client
    created = _ok(client.post(f"{API}/goals/", json={
        # car_purchase is offered by the goal modals; it was missing from the enum and 500'd.
        "title": "Japan trip", "category": "car_purchase", "target_amount": "100000", "currency": "TWD",
    }), 201)
    goal_id = created["id"]

    listed = _ok(client.get(f"{API}/goals/"))
    goals = listed["goals"] if isinstance(listed, dict) and "goals" in listed else listed
    assert [g["id"] for g in goals] == [goal_id]
    _ok(client.get(f"{API}/goals/summary"))
    assert _ok(client.get(f"{API}/goals/{goal_id}"))["title"] == "Japan trip"

    updated = _ok(client.put(f"{API}/goals/{goal_id}", json={"title": "Kyoto trip"}))
    assert updated["title"] == "Kyoto trip"
    # A contribution reserves Life Wallet cash, so Life needs some first (the
    # refusal with an empty Life is in test_goal_reservations.py).
    _ok(client.post(f"{API}/transactions/", json={
        "type": "income", "wallet_type": "life", "amount": "5000", "currency": "TWD",
        "description": "Salary", "transaction_date": "2026-01-01", "category_name": "Salary",
    }), 201)
    _ok(client.post(f"{API}/goals/{goal_id}/contributions", json={"amount": "2500"}), 201)

    other = _headers(stranger)
    assert client.get(f"{API}/goals/{goal_id}", headers=other).status_code == 404
    assert client.put(f"{API}/goals/{goal_id}", json={"title": "x"}, headers=other).status_code == 404
    assert client.delete(f"{API}/goals/{goal_id}", headers=other).status_code == 404

    assert client.delete(f"{API}/goals/{goal_id}").status_code == 200
    assert client.get(f"{API}/goals/{goal_id}").status_code == 404


@pytest.mark.parametrize("field", [{"category": "travel"}, {"priority": "urgent"}])
async def test_an_unknown_category_or_priority_is_422_not_500(authenticated_client, field):
    body = {"title": "x", "category": "savings", "target_amount": "100", "currency": "TWD", **field}
    assert authenticated_client.post(f"{API}/goals/", json=body).status_code == 422


# ── Reports (/review) ─────────────────────────────────────────────────────────

# /reports/spending and /reports/monthly-trends group by Postgres to_char(), so
# they can't run on SQLite; their logic is covered in test_reports_service_unit.py.
@pytest.mark.parametrize("path", ["/reports/goals"])
async def test_report_endpoints_answer_for_an_empty_account(authenticated_client, seed_categories, path):
    _ok(authenticated_client.get(f"{API}{path}"))


# ── Gamification ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("method", "path"), [
    ("GET", "/users/me/gamification"),
    ("GET", "/users/me/achievements"),
    ("GET", "/users/me/achievements/progress"),
    ("POST", "/users/me/streak/update"),
    ("POST", "/users/me/achievements/check-all"),
])
async def test_gamification_endpoints(authenticated_client, method, path):
    _ok(authenticated_client.request(method, f"{API}{path}"))


# ── Recurring transactions ────────────────────────────────────────────────────

async def test_recurring_crud_and_isolation(authenticated_client, async_session, seed_categories, stranger):
    client = authenticated_client
    category = (await async_session.execute(select(TransactionCategory).where(
        TransactionCategory.type == TransactionType.EXPENSE))).scalars().first()

    created = _ok(client.post(f"{API}/transactions/recurring", json={
        "type": "expense", "amount": "1200", "currency": "TWD", "category_id": str(category.id),
        "description": "Gym", "frequency": "monthly", "start_date": (business_today() + timedelta(days=1)).isoformat(),
    }), 201)
    rule_id = created["id"]
    assert created["category"]["id"] == str(category.id)  # was null before the re-read

    assert rule_id in str(_ok(client.get(f"{API}/transactions/recurring")))
    assert _ok(client.get(f"{API}/transactions/recurring/{rule_id}"))["description"] == "Gym"
    assert _ok(client.put(f"{API}/transactions/recurring/{rule_id}",
                          json={"description": "Gym (annual)"}))["description"] == "Gym (annual)"

    other = _headers(stranger)
    assert client.get(f"{API}/transactions/recurring/{rule_id}", headers=other).status_code == 404
    assert client.delete(f"{API}/transactions/recurring/{rule_id}", headers=other).status_code == 404

    assert client.delete(f"{API}/transactions/recurring/{rule_id}").status_code == 204
    assert client.get(f"{API}/transactions/recurring/{rule_id}").status_code == 404


# ── Peers ─────────────────────────────────────────────────────────────────────

async def test_peer_invite_accept_compare_and_shared_goal(authenticated_client, async_session, test_user, stranger):
    client = authenticated_client
    test_user.username = "tester"
    await async_session.commit()

    found = _ok(client.get(f"{API}/peers/search", params={"username": "stranger"}))
    assert found["name"] == "Stranger"
    assert _ok(client.get(f"{API}/peers/search", params={"username": "nobody"})) is None

    invite = _ok(client.post(f"{API}/peers/invite", json={"username": "stranger"}), 201)
    connection_id = invite["id"]

    other = _headers(stranger)
    accepted = client.patch(f"{API}/peers/{connection_id}/respond", json={"action": "accept"}, headers=other)
    assert accepted.status_code == 200, accepted.text

    compare = _ok(client.get(f"{API}/peers/compare-data"))
    assert "Stranger" in str(compare)

    goal = _ok(client.post(f"{API}/peers/goals", json={
        "connection_id": connection_id, "title": "Shared trip", "target_amount": "50000"}), 201)
    goal_id = goal["id"]
    assert _ok(client.get(f"{API}/peers/goals/{goal_id}"))["title"] == "Shared trip"
    assert _ok(client.get(f"{API}/peers/goals/{goal_id}", headers=other))["title"] == "Shared trip"

    record = _ok(client.post(f"{API}/peers/goals/{goal_id}/records", json={
        "amount": "1000", "record_date": business_today().isoformat()}), 201)
    assert [r["id"] for r in _ok(client.get(f"{API}/peers/goals/{goal_id}/records"))] == [record["id"]]
    # Only the person who saved it can change a record.
    assert client.patch(f"{API}/peers/goals/{goal_id}/records/{record['id']}",
                        json={"amount": "5"}, headers=other).status_code == 403
    _ok(client.patch(f"{API}/peers/goals/{goal_id}/records/{record['id']}", json={"amount": "1500"}))
    assert client.delete(f"{API}/peers/goals/{goal_id}/records/{record['id']}").status_code == 204

    assert client.delete(f"{API}/peers/goals/{goal_id}").status_code == 204
    assert client.delete(f"{API}/peers/{connection_id}").status_code == 204
    assert client.get(f"{API}/peers/goals/{goal_id}", headers=other).status_code == 404


async def test_an_outsider_cannot_see_a_shared_goal(authenticated_client, async_session, test_user, stranger):
    client = authenticated_client
    test_user.username = "tester"
    outsider = User(id=uuid4(), email="outsider@example.com", name="Outsider", username="outsider",
                    hashed_password="x", is_active=True, is_verified=True, role=UserRole.USER,
                    status=UserStatus.ACTIVE, preferred_currency="TWD", timezone="UTC",
                    experience_points=0, level=1)
    async_session.add(outsider)
    await async_session.commit()

    connection_id = _ok(client.post(f"{API}/peers/invite", json={"username": "stranger"}), 201)["id"]
    client.patch(f"{API}/peers/{connection_id}/respond", json={"action": "accept"}, headers=_headers(stranger))
    goal_id = _ok(client.post(f"{API}/peers/goals", json={
        "connection_id": connection_id, "title": "Ours", "target_amount": "100"}), 201)["id"]

    assert client.get(f"{API}/peers/goals/{goal_id}", headers=_headers(outsider)).status_code == 404
    assert client.post(f"{API}/peers/goals/{goal_id}/records", json={
        "amount": "1", "record_date": business_today().isoformat()}, headers=_headers(outsider)).status_code == 404


def test_goal_schema_accepts_enum_values_or_names_and_nothing_else():
    from pydantic import ValidationError

    from app.modules.goals.schemas import GoalCreate, GoalUpdate

    base = {"title": "Car", "target_amount": "100", "currency": "TWD"}
    assert GoalCreate(**base, category="car_purchase").category == "car_purchase"
    assert GoalCreate(**base, category="CAR_PURCHASE").category == "car_purchase"
    for bad in ({"category": "bogus"}, {"category": "savings", "priority": "urgent"}):
        with pytest.raises(ValidationError):
            GoalCreate(**base, **bad)
    for bad in ({"status": "bogus"}, {"priority": "bogus"}, {"category": "bogus"}):
        with pytest.raises(ValidationError):
            GoalUpdate(**bad)
