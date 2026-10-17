"""User, refresh-token and email-token repositories against the in-memory DB."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.modules.users.models import UserRole, UserStatus
from app.modules.users.repositories import (
    EmailVerificationRepository, RefreshTokenRepository, UserRepository,
)
from app.modules.users.security import security_utils

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


def data(email, **kw):
    base = dict(email=email, name=email.split("@")[0], password="Str0ng!Pass", is_active=True,
                is_verified=False, role=UserRole.USER, status=UserStatus.PENDING_VERIFICATION,
                preferred_currency="TWD", timezone="UTC", experience_points=0, level=1)
    base.update(kw)
    return base


@pytest.fixture
def repo(async_session):
    return UserRepository(async_session)


class TestCreateAndFetch:
    async def test_create_hashes_password_and_issues_referral_code(self, repo):
        u = await repo.create_user(data("a@example.com"))
        assert u.hashed_password != "Str0ng!Pass" and security_utils.verify_password("Str0ng!Pass", u.hashed_password)
        assert u.referral_code

    async def test_duplicate_email_is_a_value_error(self, repo):
        await repo.create_user(data("dup@example.com"))
        with pytest.raises(ValueError, match="already registered"):
            await repo.create_user(data("dup@example.com"))

    async def test_lookups(self, repo):
        u = await repo.create_user(data("find@example.com"))
        assert (await repo.get_user_by_id(u.id)).email == "find@example.com"
        assert (await repo.get_user_by_email("find@example.com")).id == u.id
        assert (await repo.get_user_by_email("FIND@example.com")).id == u.id  # lookup lowercases
        assert await repo.get_user_by_id(uuid4()) is None
        assert await repo.get_user_by_email("nobody@example.com") is None

    async def test_referral_lookup_requires_an_active_user(self, repo):
        u = await repo.create_user(data("ref@example.com"))
        assert (await repo.get_user_by_referral_code(u.referral_code)).id == u.id
        await repo.update_user(u.id, {"is_active": False})
        assert await repo.get_user_by_referral_code(u.referral_code) is None
        assert await repo.get_user_by_referral_code("nope") is None

    @pytest.mark.xfail(strict=True, raises=AssertionError,
                       reason="create_user stores the email as given but get_user_by_email lowercases the query")
    async def test_mixed_case_email_can_be_found_again(self, repo):
        await repo.create_user(data("Mixed@Example.com"))
        assert await repo.get_user_by_email("Mixed@Example.com") is not None


class TestUpdates:
    async def test_update_ignores_protected_fields(self, repo):
        u = await repo.create_user(data("u@example.com"))
        before = u.hashed_password
        out = await repo.update_user(u.id, {"name": "New", "email": "evil@example.com", "hashed_password": "x"})
        assert out.name == "New" and out.email == "u@example.com" and out.hashed_password == before

    async def test_update_with_only_protected_fields_returns_the_user(self, repo):
        u = await repo.create_user(data("p@example.com"))
        assert (await repo.update_user(u.id, {"email": "x@example.com"})).id == u.id

    async def test_update_unknown_user(self, repo):
        assert await repo.update_user(uuid4(), {"name": "x"}) is None

    async def test_password_change_unlocks_the_account(self, repo, async_session):
        u = await repo.create_user(data("pw@example.com", failed_login_attempts=7,
                                        account_locked_until=NOW() + timedelta(hours=1)))
        assert await repo.update_user_password(u.id, "N3w!Passw0rd") is True
        await async_session.refresh(u)
        assert u.failed_login_attempts == 0 and u.account_locked_until is None
        assert security_utils.verify_password("N3w!Passw0rd", u.hashed_password)
        assert await repo.update_user_password(uuid4(), "N3w!Passw0rd") is False

    async def test_verify_email_activates(self, repo, async_session):
        u = await repo.create_user(data("v@example.com"))
        assert await repo.verify_user_email(u.id) is True
        await async_session.refresh(u)
        assert u.is_verified and u.status == UserStatus.ACTIVE and u.email_verified_at
        assert await repo.verify_user_email(uuid4()) is False

    async def test_successful_login_resets_counters(self, repo, async_session):
        u = await repo.create_user(data("l@example.com", failed_login_attempts=3))
        assert await repo.update_login_info(u.id, "1.2.3.4", success=True) is True
        await async_session.refresh(u)
        assert u.failed_login_attempts == 0 and u.last_login_ip == "1.2.3.4" and u.last_login_at

    async def test_lockout_follows_the_security_policy(self, repo, async_session):
        from app.modules.users.security import account_security

        u = await repo.create_user(data("f@example.com"))
        first_lock = None
        for attempt in range(1, 16):
            await repo.update_login_info(u.id, "1.1.1.1", success=False)
            await async_session.refresh(u)
            assert u.failed_login_attempts == attempt
            locked = u.account_locked_until is not None
            assert locked == account_security.should_lock_account(attempt), f"attempt {attempt}"
            if locked and first_lock is None:
                first_lock = attempt
                now = datetime.now(timezone.utc)
                until = u.account_locked_until.replace(tzinfo=timezone.utc) if u.account_locked_until.tzinfo is None else u.account_locked_until
                assert until > now
                assert abs((until - now) - account_security.calculate_lockout_duration(attempt)) < timedelta(seconds=5)
        assert first_lock == 5  # pinned: four typos are fine, the fifth locks
        assert account_security.should_lock_account(4) is False and account_security.should_lock_account(5) is True
        assert await repo.update_login_info(uuid4(), "1.1.1.1", success=False) is False
        # ...and a good login lifts the lock and clears the count.
        await repo.update_login_info(u.id, "1.1.1.1", success=True)
        await async_session.refresh(u)
        assert u.account_locked_until is None and u.failed_login_attempts == 0

    async def test_deleted_at_hides_the_user(self, repo):
        u = await repo.create_user(data("d@example.com"))
        await repo.update_user(u.id, {"deleted_at": NOW()})
        assert await repo.get_user_by_id(u.id) is None
        assert (await repo.get_user_by_id(u.id, include_deleted=True)).id == u.id
        assert await repo.get_user_by_email("d@example.com") is None
        assert (await repo.get_user_by_email("d@example.com", include_deleted=True)).id == u.id


class TestListAndStats:
    async def seed(self, repo):
        a = await repo.create_user(data("alice@example.com", name="Alice", is_verified=True, status=UserStatus.ACTIVE))
        b = await repo.create_user(data("bob@example.com", name="Bob", role=UserRole.ADMIN))
        c = await repo.create_user(data("carol@example.com", name="Carol", is_active=False))
        await repo.update_user(c.id, {"deleted_at": NOW()})
        return a, b, c

    async def test_paging_and_soft_delete(self, repo):
        await self.seed(repo)
        users, total = await repo.list_users(page=1, limit=1)
        assert total == 2 and len(users) == 1
        users, total = await repo.list_users(page=2, limit=1)
        assert len(users) == 1
        assert (await repo.list_users(include_deleted=True))[1] == 3

    @pytest.mark.parametrize("flt,expected", [
        ({"role": UserRole.ADMIN}, {"bob@example.com"}),
        ({"is_verified": True}, {"alice@example.com"}),
        ({"status": UserStatus.ACTIVE}, {"alice@example.com"}),
        ({"is_active": True}, {"alice@example.com", "bob@example.com"}),
        ({"search": "ALI"}, {"alice@example.com"}),
        ({"search": "example.com"}, {"alice@example.com", "bob@example.com"}),
        ({"search": ""}, {"alice@example.com", "bob@example.com"}),
    ])
    async def test_filters(self, repo, flt, expected):
        await self.seed(repo)
        users, total = await repo.list_users(filters=flt)
        assert {u.email for u in users} == expected and total == len(expected)

    async def test_date_filters(self, repo):
        await self.seed(repo)
        assert (await repo.list_users(filters={"created_after": NOW() + timedelta(days=1)}))[1] == 0
        assert (await repo.list_users(filters={"created_before": NOW() + timedelta(days=1)}))[1] == 2

    async def test_statistics(self, repo):
        await self.seed(repo)
        s = await repo.get_user_statistics()
        assert (s["total_users"], s["active_users"], s["verified_users"]) == (2, 2, 1)
        assert s["new_users_today"] == 2 and s["new_users_this_week"] == 2 and s["new_users_this_month"] == 2
        assert s["average_level"] == 1.0 and s["total_experience_points"] == 0


class TestRefreshTokens:
    async def setup_user(self, repo):
        return await repo.create_user(data("rt@example.com"))

    async def test_store_lookup_and_revoke(self, repo, async_session):
        u = await self.setup_user(repo)
        tokens = RefreshTokenRepository(async_session)
        row = await tokens.create_refresh_token(u.id, "tok-1", NOW() + timedelta(days=7), "1.2.3.4", "UA")
        assert row.token_hash != "tok-1" and row.is_active
        assert (await tokens.get_refresh_token("tok-1")).id == row.id
        assert await tokens.get_refresh_token("other") is None
        assert await tokens.revoke_refresh_token("tok-1") is True
        await async_session.refresh(row)
        assert row.is_active is False
        assert await tokens.revoke_refresh_token("unknown") is False

    async def test_duplicate_token_returns_the_existing_row(self, repo, async_session):
        u = await self.setup_user(repo)
        tokens = RefreshTokenRepository(async_session)
        first = await tokens.create_refresh_token(u.id, "same", NOW() + timedelta(days=1))
        again = await tokens.create_refresh_token(u.id, "same", NOW() + timedelta(days=1))
        assert again.id == first.id

    async def test_revoke_all_can_keep_the_current_session(self, repo, async_session):
        u = await self.setup_user(repo)
        tokens = RefreshTokenRepository(async_session)
        keep = await tokens.create_refresh_token(u.id, "keep", NOW() + timedelta(days=1))
        drop = await tokens.create_refresh_token(u.id, "drop", NOW() + timedelta(days=1))
        assert await tokens.revoke_user_tokens(u.id, exclude_token="keep") is True
        await async_session.refresh(keep)
        await async_session.refresh(drop)
        assert keep.is_active is True and drop.is_active is False
        await tokens.revoke_user_tokens(u.id)
        await async_session.refresh(keep)
        assert keep.is_active is False


class TestEmailTokens:
    async def test_lifecycle(self, repo, async_session):
        u = await repo.create_user(data("et@example.com"))
        emails = EmailVerificationRepository(async_session)
        row = await emails.create_verification_token(u.id, "abc", "email_verification", NOW() + timedelta(hours=1))
        assert row.token_hash != "abc"
        assert (await emails.get_verification_token("abc", "email_verification")).id == row.id
        assert await emails.get_verification_token("zzz") is None
        assert await emails.use_verification_token(row.id) is True
        assert await emails.use_verification_token(uuid4()) is False

    async def test_cleanup_drops_used_and_expired(self, repo, async_session):
        u = await repo.create_user(data("ec@example.com"))
        emails = EmailVerificationRepository(async_session)
        used = await emails.create_verification_token(u.id, "u", "email_verification", NOW() + timedelta(hours=1))
        await emails.create_verification_token(u.id, "e", "email_verification", NOW() - timedelta(hours=1))
        await emails.create_verification_token(u.id, "ok", "email_verification", NOW() + timedelta(hours=1))
        await emails.use_verification_token(used.id)
        assert await emails.delete_expired_by_user(u.id, "email_verification") == 2
        assert await emails.get_verification_token("ok") is not None
