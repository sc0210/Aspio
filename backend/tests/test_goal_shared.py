"""A shared goal is two personal goals, one per partner.

Promise (peers/service.py create_goal, link_goal, _attach_side, _backing,
_goal_to_out, side_history):
  * creating a shared goal makes the creator's part: a new personal goal with
    their target, or a goal they already have; the partner adds theirs with
    POST /peers/goals/{id}/link-goal (default target: the creator's part);
  * the shared goal's target is the sum of the two parts' targets and its
    amount the sum of their values; each partner sees the other's totals only;
  * it is reached only once both partners have a part and the sum is met;
  * a part is the caller's own open goal, not already another shared goal's;
  * the history gives each side's progress by day, and setting money aside
    tells the partner;
  * cancelling a part unlinks it; deleting the shared goal leaves both parts.

Harm when broken: a couple's shared goal shows money nobody set aside, or
misses money one of them did, or one partner can touch the other's goal.
"""

from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

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


def _income(client, amount="100000", headers=None):
    _ok(client.post(f"{API}/transactions/", json={
        "type": "income", "wallet_type": "life", "amount": amount, "currency": "TWD",
        "description": "Salary", "transaction_date": "2026-01-01", "category_name": "Salary",
    }, headers=headers), 201)


def _connect(client, partner):
    connection = _ok(client.post(f"{API}/peers/invite", json={"username": "partner"}), 201)["id"]
    _ok(client.patch(f"{API}/peers/{connection}/respond", json={"action": "accept"}, headers=partner))
    return connection


def _shared(client, partner, my_target):
    connection = _connect(client, partner)
    _income(client)
    return _ok(client.post(f"{API}/peers/goals", json={
        "connection_id": connection, "title": "Wedding", "my_target": str(my_target),
        "target_date": "2027-06-01"}), 201)["id"]


def _partner_part(client, partner, shared, target, reserve=None):
    """The partner joins with a part of `target` and sets `reserve` aside for it."""
    _income(client, headers=partner)
    theirs = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal",
                             json={"target_amount": str(target)}, headers=partner))
    if reserve:
        _ok(client.post(f"{API}/goals/{theirs['id']}/reserve", json={"amount": str(reserve)},
                        headers=partner), 201)
    return theirs


async def test_creating_makes_your_part_and_reserving_fills_it(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 50000)

    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    assert mine["sharedGoalId"] == shared
    assert float(mine["targetAmount"]) == 50000                       # the part given at create
    assert mine["title"] == "Wedding"

    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert (view["your_amount"], view["your_target"], view["target_amount"]) == (20000, 50000, 50000)
    assert view["your_goal_id"] == mine["id"] and view["peer_joined"] is False
    assert view["status"] == "active"                                 # one part alone is not the couple's goal

    # The partner sees the side's totals, not the goal behind it.
    theirs = _ok(client.get(f"{API}/peers/goals/{shared}", headers=partner))
    assert (theirs["peer_amount"], theirs["peer_target"]) == (20000, 50000)
    assert theirs["your_goal_id"] is None and theirs["peer_joined"] is True


async def test_the_partners_part_defaults_to_yours_and_the_target_is_the_sum(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 30000)
    _income(client, headers=partner)

    theirs = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal", headers=partner))
    assert float(theirs["targetAmount"]) == 30000                    # the creator's part
    again = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal", headers=partner))
    assert again["id"] == theirs["id"]                                # one per partner

    # Each partner edits only their own part; the shared target follows.
    _ok(client.put(f"{API}/goals/{theirs['id']}", json={"target_amount": "10000"}, headers=partner))
    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert (view["your_target"], view["peer_target"], view["target_amount"]) == (30000, 10000, 40000)


async def test_both_parts_full_reach_it_and_a_release_reopens_it(authenticated_client, seed_categories, partner, async_session):
    from app.modules.notifications.models import Notification
    from app.modules.peers.models import SharedGoal

    client = authenticated_client
    shared = _shared(client, partner, 20000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    _partner_part(client, partner, shared, 10000, reserve=10000)

    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert (view["total_amount"], view["target_amount"], view["status"]) == (30000, 30000, "completed")
    stored = (await async_session.execute(select(SharedGoal.status).where(SharedGoal.id == UUID(shared)))).scalar_one()
    assert stored == "completed"
    reached = (await async_session.execute(select(Notification.user_id).where(
        Notification.title == "Shared goal reached!"))).scalars().all()
    assert len(reached) == 2

    _ok(client.post(f"{API}/goals/{mine['id']}/release", json={"amount": "5000"}), 201)
    assert _ok(client.get(f"{API}/peers/goals/{shared}"))["status"] == "active"


async def test_a_goal_you_already_have_can_be_your_part(authenticated_client, seed_categories, partner):
    client = authenticated_client
    connection = _connect(client, partner)
    _income(client)
    flat = _ok(client.post(f"{API}/goals/", json={
        "title": "Flat fund", "category": "savings", "target_amount": "80000", "currency": "TWD"}), 201)
    _ok(client.post(f"{API}/goals/{flat['id']}/reserve", json={"amount": "5000"}), 201)

    shared = _ok(client.post(f"{API}/peers/goals", json={
        "connection_id": connection, "title": "Our flat", "goal_id": flat["id"]}), 201)
    assert shared["your_goal_id"] == flat["id"]
    assert (shared["your_amount"], shared["target_amount"]) == (5000, 80000)

    # Not both kinds of part, and not someone else's goal.
    assert client.post(f"{API}/peers/goals", json={
        "connection_id": connection, "title": "x", "goal_id": flat["id"], "my_target": "1"}).status_code == 422
    assert client.post(f"{API}/peers/goals/{shared['id']}/link-goal",
                       json={"goal_id": flat["id"]}, headers=partner).status_code == 404

    # A goal already part of one shared goal can't be part of another.
    assert client.post(f"{API}/peers/goals", json={
        "connection_id": connection, "title": "Other", "goal_id": flat["id"]}).status_code == 409
    # Nor can you swap in a second goal while you have a part.
    other = _ok(client.post(f"{API}/goals/", json={
        "title": "Car", "category": "savings", "target_amount": "100", "currency": "TWD"}), 201)
    assert client.post(f"{API}/peers/goals/{shared['id']}/link-goal",
                       json={"goal_id": other["id"]}).status_code == 409


async def test_a_cancelled_goal_cannot_be_a_part(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 1000)
    _income(client, headers=partner)
    old = _ok(client.post(f"{API}/goals/", json={
        "title": "Old", "category": "savings", "target_amount": "100", "currency": "TWD"}, headers=partner), 201)
    _ok(client.put(f"{API}/goals/{old['id']}", json={"status": "cancelled"}, headers=partner))
    assert client.post(f"{API}/peers/goals/{shared}/link-goal",
                       json={"goal_id": old["id"]}, headers=partner).status_code == 400


async def test_cancelling_your_part_unlinks_it(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 100000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={"amount": "20000"}), 201)

    _ok(client.put(f"{API}/goals/{mine['id']}", json={"status": "cancelled"}))

    view = _ok(client.get(f"{API}/peers/goals/{shared}"))
    assert (view["your_amount"], view["your_target"], view["your_goal_id"]) == (0, 0, None)
    # With no part on either side, a new one needs its size.
    assert client.post(f"{API}/peers/goals/{shared}/link-goal").status_code == 400
    fresh = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal", json={"target_amount": "50000"}))
    assert fresh["id"] != mine["id"]


async def test_deleting_the_shared_goal_keeps_both_parts(authenticated_client, seed_categories, partner):
    client = authenticated_client
    shared = _shared(client, partner, 1000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    theirs = _partner_part(client, partner, shared, 500, reserve=200)

    assert client.delete(f"{API}/peers/goals/{shared}").status_code == 204

    kept = _ok(client.get(f"{API}/goals/{mine['id']}"))
    assert kept["sharedGoalId"] is None
    kept = _ok(client.get(f"{API}/goals/{theirs['id']}", headers=partner))
    assert kept["sharedGoalId"] is None and float(kept["currentAmount"]) == 200


async def test_history_gives_each_side_by_day_and_the_partner_hears_of_it(
        authenticated_client, seed_categories, partner, async_session, test_user):
    from app.modules.notifications.models import Notification

    client = authenticated_client
    shared = _shared(client, partner, 1000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    _ok(client.post(f"{API}/goals/{mine['id']}/reserve", json={
        "amount": "300", "contribution_date": "2026-03-01T04:00:00Z", "notes": "bonus"}), 201)
    _ok(client.post(f"{API}/goals/{mine['id']}/release", json={
        "amount": "100", "contribution_date": "2026-03-05T04:00:00Z"}), 201)
    _partner_part(client, partner, shared, 500)
    theirs = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal", headers=partner))
    _ok(client.post(f"{API}/goals/{theirs['id']}/reserve", json={
        "amount": "200", "contribution_date": "2026-03-01T04:00:00Z"}, headers=partner), 201)

    seen_by_me = _ok(client.get(f"{API}/peers/goals/{shared}/history"))
    assert seen_by_me == [
        {"date": "2026-03-01", "side": "partner", "amount": 200.0},
        {"date": "2026-03-01", "side": "you", "amount": 300.0},
        {"date": "2026-03-05", "side": "you", "amount": -100.0},
    ]
    seen_by_partner = _ok(client.get(f"{API}/peers/goals/{shared}/history", headers=partner))
    assert {(p["side"], p["amount"]) for p in seen_by_partner} == {("you", 200.0), ("partner", 300.0), ("partner", -100.0)}
    assert all("notes" not in p for p in seen_by_partner)

    # Each reservation told the other partner; a release did not.
    told_partner = (await async_session.execute(select(Notification).where(
        Notification.title == "New shared savings deposit", Notification.user_id != test_user.id))).scalars().all()
    assert [n.message for n in told_partner] == ['Test User set aside NT$300 toward "Wedding".']
    told_me = (await async_session.execute(select(Notification).where(
        Notification.title == "New shared savings deposit", Notification.user_id == test_user.id))).scalars().all()
    assert len(told_me) == 1


async def test_an_outsider_cannot_link_or_read_history(authenticated_client, seed_categories, partner, async_session):
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
    assert client.get(f"{API}/peers/goals/{shared}/history", headers=headers).status_code == 404


async def test_any_edit_to_a_part_rejudges_the_shared_goal(authenticated_client, seed_categories, partner, async_session):
    """A category switch to emergency_fund makes the part worth its Emergency Wallet:
    the stored status and the alert follow at once, not at the next reservation."""
    from app.modules.peers.models import SharedGoal

    client = authenticated_client
    shared = _shared(client, partner, 20000)
    mine = _ok(client.post(f"{API}/peers/goals/{shared}/link-goal"))
    _partner_part(client, partner, shared, 1000, reserve=1000)
    _ok(client.post(f"{API}/transactions/", json={
        "type": "income", "wallet_type": "emergency", "amount": "30000", "currency": "TWD",
        "description": "Rainy day", "transaction_date": "2026-01-01", "category_name": "Salary"}), 201)

    _ok(client.put(f"{API}/goals/{mine['id']}", json={"category": "emergency_fund"}))

    stored = (await async_session.execute(
        select(SharedGoal.status).where(SharedGoal.id == UUID(shared))
        .execution_options(populate_existing=True))).scalar_one()
    assert stored == "completed"
