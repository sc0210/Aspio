"""
Free vs premium accounts (users.access_tier).

The frontend hides premium pages from a free account, but a hidden link is not a
lock: these tests hold the server to refusing the premium routes themselves, to
reading the tier fresh on every request, and to the defaults the migration and
the seeding paths promise.
"""

import uuid

import pytest
from sqlalchemy import select

from app.modules.users.dependencies import require_premium
from app.modules.users.models import AccessTier, User, UserRole, UserStatus
from app.modules.users.security import jwt_manager

pytestmark = pytest.mark.asyncio


def _auth(user):
    token = jwt_manager.create_access_token({"sub": str(user.id), "email": user.email})
    return {"Authorization": f"Bearer {token}"}


async def _account(async_session, name, tier=None):
    fields = dict(id=uuid.uuid4(), email=f"{name}@example.com", name=name, username=name,
                  hashed_password="x", is_active=True, is_verified=True,
                  role=UserRole.USER, status=UserStatus.ACTIVE)
    if tier is not None:
        fields["access_tier"] = tier
    user = User(**fields)
    async_session.add(user)
    await async_session.commit()
    await async_session.refresh(user)
    return user


async def test_a_new_account_starts_free(async_session):
    user = await _account(async_session, "newcomer")
    assert user.access_tier == AccessTier.FREE.value


@pytest.mark.parametrize("path", ["/api/v1/loans/", "/api/v1/loans/summary", "/api/v1/peers/",
                                  "/api/v1/peers/splits"])
async def test_a_free_account_is_refused_premium_routes(client, async_session, path):
    free = await _account(async_session, "freebie", AccessTier.FREE.value)

    response = client.get(path, headers=_auth(free))

    assert response.status_code == 403
    # A code the frontend can tell apart from "account suspended" and friends.
    assert response.json()["error"]["code"] == "PREMIUM_REQUIRED"


async def test_a_free_account_keeps_the_everyday_routes(client, async_session):
    free = await _account(async_session, "everyday", AccessTier.FREE.value)

    for path in ["/api/v1/transactions/", "/api/v1/goals/", "/api/v1/users/me"]:
        assert client.get(path, headers=_auth(free)).status_code == 200, path


async def test_a_tier_change_applies_on_the_next_request(client, async_session):
    """CurrentUser reads the database each request, not the 30s auth cache, so an
    admin's upgrade or downgrade needs no sign-out."""
    user = await _account(async_session, "switcher", AccessTier.FREE.value)
    headers = _auth(user)
    assert client.get("/api/v1/loans/", headers=headers).status_code == 403

    user.access_tier = AccessTier.PREMIUM.value
    await async_session.commit()
    assert client.get("/api/v1/loans/", headers=headers).status_code == 200

    user.access_tier = AccessTier.FREE.value
    await async_session.commit()
    assert client.get("/api/v1/loans/", headers=headers).status_code == 403


async def test_me_reports_the_tier(client, async_session):
    free = await _account(async_session, "reader", AccessTier.FREE.value)
    body = client.get("/api/v1/users/me", headers=_auth(free)).json()
    assert body["access_tier"] == "free"


async def test_a_peer_invite_to_a_free_account_is_refused(client, test_user, async_session):
    """The receiver could never open it, so it would sit pending for good."""
    await _account(async_session, "cannotjoin", AccessTier.FREE.value)

    response = client.post("/api/v1/peers/invite", json={"username": "cannotjoin"},
                           headers=_auth(test_user))

    assert response.status_code == 400
    assert "plan" in response.text


def test_the_column_is_never_null_and_defaults_free():
    """Rows written outside the ORM (raw SQL, scripts) get the same default the
    model gives. The CHECK on the two values lives in the migration, which the
    SQLite test schema does not run; it was applied and verified on Postgres."""
    column = User.__table__.c.access_tier
    assert column.nullable is False
    assert column.server_default.arg == AccessTier.FREE.value


def test_only_the_line_groups_routes_are_premium():
    """The webhook, LIFF sign-in and account linking serve every tier; group
    commands typed in LINE itself never pass through these routes."""
    from app.modules.line_bot.router import router

    for route in router.routes:
        gated = any(dep.dependency is require_premium for dep in route.dependencies)
        assert gated == route.path.startswith("/groups"), route.path


async def test_granting_admin_raises_the_tier(async_session):
    from app.modules.admin.init_admin import grant_admin

    staff = await _account(async_session, "staff", AccessTier.FREE.value)
    await grant_admin(async_session, staff.email, "super_admin")

    await async_session.refresh(staff)
    assert staff.access_tier == AccessTier.PREMIUM.value


async def test_the_demo_account_is_premium(async_session):
    from app.modules.users.init_demo_user import DEMO_EMAIL, init_demo_user

    await init_demo_user(async_session)
    demo = (await async_session.execute(select(User).where(User.email == DEMO_EMAIL))).scalar_one()
    assert demo.access_tier == AccessTier.PREMIUM.value

    # Refreshed on every start, even if someone set it to free by hand.
    demo.access_tier = AccessTier.FREE.value
    await async_session.commit()
    await init_demo_user(async_session)
    await async_session.refresh(demo)
    assert demo.access_tier == AccessTier.PREMIUM.value


# ── registration and the admin panel ─────────────────────────────────────────

async def test_registration_creates_a_free_account(async_session):
    from app.modules.users.schemas import UserRegistration
    from app.modules.users.services import UserService

    await UserService(async_session).register_user(UserRegistration(
        email="signup@example.com", password="StrongPass123!", confirm_password="StrongPass123!",
        name="Sign Up", terms_accepted=True,
    ))

    user = (await async_session.execute(select(User).where(User.email == "signup@example.com"))).scalar_one()
    assert user.access_tier == AccessTier.FREE.value


async def _admin(async_session, role):
    from app.modules.admin.models import AdminUser

    user = await _account(async_session, f"admin_{role}", AccessTier.PREMIUM.value)
    async_session.add(AdminUser(id=uuid.uuid4(), user_id=user.id, role=role, is_active=True))
    await async_session.commit()
    return user


async def test_a_super_admin_sets_a_tier_and_it_is_audited(client, async_session):
    from app.modules.admin.models import AdminAuditLog as AuditLog

    boss = await _admin(async_session, "super_admin")
    member = await _account(async_session, "member", AccessTier.FREE.value)
    url = f"/api/v1/admin/users/{member.id}/access-tier"

    response = client.patch(url, json={"access_tier": "premium"}, headers=_auth(boss))

    assert response.status_code == 200, response.text
    assert response.json()["data"]["access_tier"] == "premium"
    # The member's next request sees it, with no sign-out.
    assert client.get("/api/v1/loans/", headers=_auth(member)).status_code == 200

    log = (await async_session.execute(
        select(AuditLog).where(AuditLog.action == "set_access_tier"))).scalar_one()
    assert log.resource_id == str(member.id)


async def test_only_a_super_admin_sets_a_tier(client, async_session):
    plain_admin = await _admin(async_session, "admin")
    member = await _account(async_session, "member2", AccessTier.FREE.value)
    url = f"/api/v1/admin/users/{member.id}/access-tier"

    assert client.patch(url, json={"access_tier": "premium"}, headers=_auth(plain_admin)).status_code == 403
    assert client.patch(url, json={"access_tier": "premium"}, headers=_auth(member)).status_code == 403
    await async_session.refresh(member)
    assert member.access_tier == AccessTier.FREE.value


async def test_an_unknown_tier_is_rejected(client, async_session):
    boss = await _admin(async_session, "super_admin")
    member = await _account(async_session, "member3", AccessTier.FREE.value)

    response = client.patch(f"/api/v1/admin/users/{member.id}/access-tier",
                            json={"access_tier": "gold"}, headers=_auth(boss))

    assert response.status_code == 422


@pytest.mark.parametrize(("query", "expected"), [("?access_tier=premium", "premium"), ("", "free")])
async def test_approval_can_pick_the_tier(client, async_session, query, expected):
    boss = await _admin(async_session, "super_admin")
    pending = await _account(async_session, f"pending_{expected}")
    pending.status = UserStatus.PENDING_APPROVAL
    pending.is_active = False
    await async_session.commit()

    response = client.post(f"/api/v1/admin/approve-user/{pending.id}{query}", headers=_auth(boss))

    assert response.status_code == 200, response.text
    await async_session.refresh(pending)
    assert pending.access_tier == expected
    assert pending.status == UserStatus.ACTIVE


# ── splits with a partner moved to free ──────────────────────────────────────

async def _connected_pair(async_session):
    from app.modules.peers.models import PeerConnection, PeerStatus

    me = await _account(async_session, "payer", AccessTier.PREMIUM.value)
    partner = await _account(async_session, "partner", AccessTier.PREMIUM.value)
    conn = PeerConnection(id=uuid.uuid4(), requester_id=me.id, receiver_id=partner.id,
                          status=PeerStatus.ACCEPTED)
    async_session.add(conn)
    await async_session.commit()
    return me, partner, conn


async def test_no_split_reaches_a_partner_moved_to_free(async_session):
    """They could never open /peers to accept or settle it. This is the path the
    recurring runner takes too (split_transaction → _propose), where a refusal
    leaves the occurrence an ordinary expense."""
    from fastapi import HTTPException

    from app.modules.peers.splits import SplitService

    me, partner, conn = await _connected_pair(async_session)
    partner.access_tier = AccessTier.FREE.value
    await async_session.commit()

    with pytest.raises(HTTPException) as refused:
        await SplitService(async_session)._require_premium_pair(me.id, partner.id)
    assert refused.value.status_code == 403
    assert "partner" in refused.value.detail

    # And the payer's own plan counts, for the runner that has no router gate.
    partner.access_tier = AccessTier.PREMIUM.value
    me.access_tier = AccessTier.FREE.value
    await async_session.commit()
    with pytest.raises(HTTPException):
        await SplitService(async_session)._require_premium_pair(me.id, partner.id)

    me.access_tier = AccessTier.PREMIUM.value
    await async_session.commit()
    await SplitService(async_session)._require_premium_pair(me.id, partner.id)  # both premium: allowed


async def test_a_split_through_the_api_names_the_downgraded_partner(client, async_session):
    from app.modules.users.models import User as U  # noqa: F401

    me, partner, conn = await _connected_pair(async_session)
    partner.access_tier = AccessTier.FREE.value
    await async_session.commit()

    response = client.post("/api/v1/peers/splits", headers=_auth(me), json={
        "connection_id": str(conn.id), "total_amount": 1000, "currency": "TWD",
        "description": "dinner", "category_id": str(uuid.uuid4()), "split_date": "2026-11-15",
        "method": "equal", "payer": "me",
    })

    assert response.status_code == 403, response.text
    assert "partner's plan" in response.text
