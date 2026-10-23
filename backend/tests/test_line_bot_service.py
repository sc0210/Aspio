"""
Unit tests for backend/app/modules/line_bot/service.py

All LINE API calls (_send, _push, _push_messages) are mocked so tests
run without network access. DB tests use the shared SQLite in-memory
session from conftest.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.line_bot import service as svc
from app.modules.line_bot.models import (
    ExpenseSplit,
    LineGroup,
    LineGroupMember,
    LineLinkToken,
    LineUserLink,
    SharedExpense,
)
from app.modules.line_bot.repositories import LineAccountRepository
from app.modules.line_bot.schemas import GroupBalanceResponse, LineEvent
from app.modules.transactions.models import (
    Transaction,
    TransactionCategory,
    TransactionType,
    TransactionWalletType,
)
from app.modules.users.models import PreferredCurrency, User, UserRole, UserStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MOCK_REPLY_TOKEN = "mock-reply-token-abc"
MOCK_LINE_USER_ID = "Uabc123"
MOCK_LINE_GROUP_ID = "Cxyz789"


def _make_user(session_or_id=None) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"u{uuid.uuid4().hex[:6]}@test.com",
        name="Test User",
        hashed_password="x",
        is_active=True,
        is_verified=True,
        role=UserRole.USER,
        status=UserStatus.ACTIVE,
        preferred_currency=PreferredCurrency.TWD,
        timezone="UTC",
        experience_points=0,
        level=1,
    )


def _make_link(
    user_id: uuid.UUID,
    line_user_id: str = MOCK_LINE_USER_ID,
    display_name: str = "Tester",
) -> LineUserLink:
    return LineUserLink(
        line_user_id=line_user_id,
        user_id=user_id,
        display_name=display_name,
    )


def _make_group(line_group_id: str = MOCK_LINE_GROUP_ID, currency: str = "TWD") -> LineGroup:
    return LineGroup(line_group_id=line_group_id, currency=currency)


async def _seed(db: AsyncSession, *objs):
    for obj in objs:
        db.add(obj)
    await db.flush()


# ---------------------------------------------------------------------------
# Pure-function parser tests (no DB needed)
# ---------------------------------------------------------------------------

class TestParseAdd:
    def test_basic(self):
        cmd = svc._parse_add("/add 150 coffee")
        assert cmd is not None
        assert cmd.amount == Decimal("150")
        assert cmd.description == "coffee"
        assert cmd.ratios is None
        assert cmd.paid_by is None

    def test_with_ratio(self):
        cmd = svc._parse_add("/add 200 lunch 60:40")
        assert cmd is not None
        assert cmd.ratios == [Decimal("60"), Decimal("40")]

    def test_with_paid_by(self):
        cmd = svc._parse_add("/add 300 dinner paid:@jane")
        assert cmd is not None
        assert cmd.paid_by == "jane"

    def test_invalid_returns_none(self):
        assert svc._parse_add("/add") is None
        assert svc._parse_add("/add notanumber food") is None

    def test_ratio_zero_sum_returns_no_ratios(self):
        cmd = svc._parse_add("/add 100 coffee 0:0")
        # 0:0 ratio should be ignored (r1+r2 == 0)
        assert cmd is not None
        assert cmd.ratios is None


class TestParseTxn:
    def test_basic(self):
        result = svc._parse_txn("/txn 150 food coffee")
        assert result is not None
        amount, cat, desc = result
        assert amount == Decimal("150")
        assert cat == "food"
        assert "coffee" in desc

    def test_invalid(self):
        assert svc._parse_txn("/txn") is None
        assert svc._parse_txn("/txn abc food item") is None


class TestParseSettle:
    def test_basic(self):
        result = svc._parse_settle("/settle @jane")
        assert result is not None
        name, amount = result
        assert name == "jane"
        assert amount is None

    def test_invalid(self):
        assert svc._parse_settle("/settle") is None


# ---------------------------------------------------------------------------
# _flex_goals — overdue display
# ---------------------------------------------------------------------------

class TestFlexGoals:
    def test_overdue_label(self):
        rows = [{"name": "House", "current_amount": 0, "target_amount": 100, "days_left": -3}]
        flex = svc._flex_goals(rows)
        import json
        body = json.dumps(flex)
        assert "Overdue" in body

    def test_days_left_label(self):
        rows = [{"name": "Car", "current_amount": 0, "target_amount": 100, "days_left": 30}]
        flex = svc._flex_goals(rows)
        import json
        assert "30d left" in json.dumps(flex)

    def test_no_deadline(self):
        rows = [{"name": "Trip", "current_amount": 0, "target_amount": 100, "days_left": None}]
        flex = svc._flex_goals(rows)
        import json
        assert "No deadline" in json.dumps(flex)

    def test_empty_shows_placeholder(self):
        flex = svc._flex_goals([])
        import json
        assert "No Active Goals" in json.dumps(flex)


# ---------------------------------------------------------------------------
# DB-backed tests
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def user(async_session: AsyncSession) -> User:
    u = _make_user()
    async_session.add(u)
    await async_session.flush()
    return u


@pytest_asyncio.fixture
async def user2(async_session: AsyncSession) -> User:
    u = _make_user()
    async_session.add(u)
    await async_session.flush()
    return u


@pytest_asyncio.fixture
async def link(async_session: AsyncSession, user: User) -> LineUserLink:
    lnk = _make_link(user.id)
    async_session.add(lnk)
    await async_session.flush()
    return lnk


@pytest_asyncio.fixture
async def link2(async_session: AsyncSession, user2: User) -> LineUserLink:
    lnk = _make_link(user2.id, line_user_id="Udef456", display_name="Tester2")
    async_session.add(lnk)
    await async_session.flush()
    return lnk


@pytest_asyncio.fixture
async def group(async_session: AsyncSession) -> LineGroup:
    g = _make_group()
    async_session.add(g)
    await async_session.flush()
    return g


@pytest_asyncio.fixture
async def two_member_group(async_session, group, link, link2):
    m1 = LineGroupMember(group_id=group.id, user_id=link.user_id, line_user_id=link.line_user_id)
    m2 = LineGroupMember(group_id=group.id, user_id=link2.user_id, line_user_id=link2.line_user_id)
    async_session.add(m1)
    async_session.add(m2)
    await async_session.flush()
    return group


# ---------------------------------------------------------------------------
# Token purge behaviour (tested via handle_link_command)
# ---------------------------------------------------------------------------

class TestTokenPurgeBehaviour:
    @pytest.mark.asyncio
    async def test_stale_unused_tokens_replaced_on_relink(self, async_session):
        """Issuing a new /link token must not accumulate stale unused tokens."""
        stale = LineLinkToken(
            line_user_id="Ustale",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            used=False,
        )
        async_session.add(stale)
        await async_session.flush()
        stale_token_value = stale.token

        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_link_command(async_session, "Ustale", MOCK_REPLY_TOKEN, is_group=False)

        from sqlalchemy import select
        tokens = (await async_session.execute(
            select(LineLinkToken).where(LineLinkToken.line_user_id == "Ustale")
        )).scalars().all()
        # Only the new token should survive; the stale unused one was replaced
        assert len(tokens) == 1
        assert tokens[0].token != stale_token_value
        assert tokens[0].used is False

    @pytest.mark.asyncio
    async def test_used_token_not_deleted_on_relink(self, async_session):
        """Already-used tokens (audit trail) are kept when a new token is issued."""
        used = LineLinkToken(
            line_user_id="Uused",
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            used=True,
        )
        async_session.add(used)
        await async_session.flush()

        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_link_command(async_session, "Uused", MOCK_REPLY_TOKEN, is_group=False)

        from sqlalchemy import select
        tokens = (await async_session.execute(
            select(LineLinkToken).where(LineLinkToken.line_user_id == "Uused")
        )).scalars().all()
        # The used token stays; a new unused token is added
        assert len(tokens) == 2
        used_tokens = [t for t in tokens if t.used]
        assert len(used_tokens) == 1


# ---------------------------------------------------------------------------
# handle_link_command
# ---------------------------------------------------------------------------

class TestHandleLinkCommand:
    @pytest.mark.asyncio
    async def test_dm_context_replies_directly(self, async_session):
        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock) as mock_reply, \
             patch("app.modules.line_bot.service._push_messages", new_callable=AsyncMock) as mock_push:
            await svc.handle_link_command(async_session, "Unew123", MOCK_REPLY_TOKEN, is_group=False)
            mock_reply.assert_awaited_once()
            mock_push.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_group_context_pushes_dm_not_group(self, async_session):
        with patch("app.modules.line_bot.service._push_messages", new_callable=AsyncMock) as mock_push, \
             patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_reply:
            await svc.handle_link_command(async_session, "Unew456", MOCK_REPLY_TOKEN, is_group=True)
            mock_push.assert_awaited_once()
            mock_reply.assert_awaited_once()
            # The push goes to the user's DM, not the group reply
            push_call_user = mock_push.call_args[0][0]
            assert push_call_user == "Unew456"

    @pytest.mark.asyncio
    async def test_already_linked_replies_welcome_back(self, async_session, link):
        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock) as mock_reply:
            await svc.handle_link_command(
                async_session, link.line_user_id, MOCK_REPLY_TOKEN, is_group=False
            )
            mock_reply.assert_awaited_once()
            alt_text = mock_reply.call_args[0][1]
            assert "Already linked" in alt_text

    @pytest.mark.asyncio
    async def test_purges_stale_tokens_before_issuing_new_one(self, async_session):
        stale = LineLinkToken(
            line_user_id="Ustale",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            used=False,
        )
        async_session.add(stale)
        await async_session.flush()

        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_link_command(async_session, "Ustale", MOCK_REPLY_TOKEN, is_group=False)

        from sqlalchemy import select
        tokens = (await async_session.execute(
            select(LineLinkToken).where(
                LineLinkToken.line_user_id == "Ustale",
                LineLinkToken.used == False,
            )
        )).scalars().all()
        # Only the newly issued token should exist (stale one was purged)
        assert len(tokens) == 1


# ---------------------------------------------------------------------------
# confirm_link
# ---------------------------------------------------------------------------

class TestConfirmLink:
    @pytest.mark.asyncio
    async def test_happy_path_creates_link(self, async_session, user):
        token = LineLinkToken(
            line_user_id=MOCK_LINE_USER_ID,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            used=False,
        )
        async_session.add(token)
        await async_session.flush()

        result = await svc.confirm_link(async_session, token.token, user.id, "Alice")

        assert result.line_user_id == MOCK_LINE_USER_ID
        assert result.display_name == "Alice"
        assert token.used is True

    @pytest.mark.asyncio
    async def test_expired_token_raises(self, async_session, user):
        token = LineLinkToken(
            line_user_id=MOCK_LINE_USER_ID,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            used=False,
        )
        async_session.add(token)
        await async_session.flush()

        with pytest.raises(ValueError, match="expired"):
            await svc.confirm_link(async_session, token.token, user.id, "Alice")

    @pytest.mark.asyncio
    async def test_used_token_raises(self, async_session, user):
        token = LineLinkToken(
            line_user_id=MOCK_LINE_USER_ID,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            used=True,
        )
        async_session.add(token)
        await async_session.flush()

        with pytest.raises(ValueError, match="already-used"):
            await svc.confirm_link(async_session, token.token, user.id, "Alice")

    @pytest.mark.asyncio
    async def test_invalid_token_raises(self, async_session, user):
        with pytest.raises(ValueError, match="Invalid"):
            await svc.confirm_link(async_session, uuid.uuid4(), user.id, "Alice")

    @pytest.mark.asyncio
    async def test_already_linked_to_different_user_raises(self, async_session, user, user2, link):
        token = LineLinkToken(
            line_user_id=link.line_user_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            used=False,
        )
        async_session.add(token)
        await async_session.flush()

        with pytest.raises(ValueError, match="already linked"):
            await svc.confirm_link(async_session, token.token, user2.id, "Bob")


# ---------------------------------------------------------------------------
# liff_session (LIFF ID token -> Aspiro session)
# ---------------------------------------------------------------------------


class TestLiffSession:
    @staticmethod
    def _patch_verify(status_code: int, payload: dict):
        """Patch the shared LINE HTTP client's verify call with a fake response.

        Patches the ``_get_http_client`` seam (the module now reuses one pooled
        httpx client rather than opening a context-managed client per call)."""
        class _Resp:
            def __init__(self):
                self.status_code = status_code
                self.text = str(payload)

            def json(self):
                return payload

        class _Client:
            async def post(self, *a, **kw):
                return _Resp()

            async def get(self, *a, **kw):
                return _Resp()

        return patch("app.modules.line_bot.service._get_http_client", return_value=_Client())

    @pytest.mark.asyncio
    async def test_linked_user_gets_access_token(self, async_session, user, link, monkeypatch):
        monkeypatch.setattr(svc.settings, "LINE_LOGIN_CHANNEL_ID", "test-channel")
        with self._patch_verify(200, {"sub": MOCK_LINE_USER_ID}):
            result = await svc.liff_session(async_session, "fake-id-token")
        assert result.linked is True
        assert result.access_token
        assert result.display_name == "Tester"
        payload = svc.jwt_manager.verify_token(result.access_token, "access")
        assert payload["sub"] == str(user.id)

    @pytest.mark.asyncio
    async def test_unlinked_returns_false(self, async_session, monkeypatch):
        monkeypatch.setattr(svc.settings, "LINE_LOGIN_CHANNEL_ID", "test-channel")
        with self._patch_verify(200, {"sub": "Uunknown999"}):
            result = await svc.liff_session(async_session, "fake-id-token")
        assert result.linked is False
        assert result.access_token is None

    @pytest.mark.asyncio
    async def test_invalid_token_raises(self, async_session, monkeypatch):
        monkeypatch.setattr(svc.settings, "LINE_LOGIN_CHANNEL_ID", "test-channel")
        with self._patch_verify(400, {"error": "invalid_request"}):
            with pytest.raises(ValueError, match="Invalid LINE ID token"):
                await svc.liff_session(async_session, "bad-token")

    @pytest.mark.asyncio
    async def test_not_configured_raises(self, async_session, monkeypatch):
        monkeypatch.setattr(svc.settings, "LINE_LOGIN_CHANNEL_ID", None)
        with pytest.raises(ValueError, match="not configured"):
            await svc.liff_session(async_session, "fake-id-token")


# ---------------------------------------------------------------------------
# compute_balances
# ---------------------------------------------------------------------------

class TestComputeBalances:
    @pytest.mark.asyncio
    async def test_empty_group_returns_empty_balances(self, async_session, group):
        result = await svc.compute_balances(async_session, group.id)
        assert result.balances == []
        assert result.currency == "TWD"

    @pytest.mark.asyncio
    async def test_skips_currency_fetch_when_passed(self, async_session, group):
        # Passing currency avoids the LineGroup re-fetch
        result = await svc.compute_balances(async_session, group.id, currency="USD")
        assert result.currency == "USD"

    @pytest.mark.asyncio
    async def test_nonexistent_group_returns_empty(self, async_session):
        result = await svc.compute_balances(async_session, uuid.uuid4())
        assert result.balances == []

    @pytest.mark.asyncio
    async def test_basic_balance_owed(self, async_session, two_member_group, link, link2):
        group = two_member_group
        expense = SharedExpense(
            group_id=group.id,
            payer_id=link.user_id,
            amount=Decimal("100.00"),
            currency="TWD",
            description="lunch",
        )
        async_session.add(expense)
        await async_session.flush()

        split = ExpenseSplit(
            expense_id=expense.id,
            user_id=link2.user_id,
            amount=Decimal("50.00"),
            settled=False,
        )
        async_session.add(split)
        await async_session.flush()

        result = await svc.compute_balances(async_session, group.id)
        assert len(result.balances) == 1
        assert result.balances[0].owed_by == link2.user_id
        assert result.balances[0].owed_to == link.user_id
        assert result.balances[0].amount == Decimal("50.00")

    @pytest.mark.asyncio
    async def test_settled_splits_excluded(self, async_session, two_member_group, link, link2):
        group = two_member_group
        expense = SharedExpense(
            group_id=group.id,
            payer_id=link.user_id,
            amount=Decimal("100.00"),
            currency="TWD",
            description="dinner",
        )
        async_session.add(expense)
        await async_session.flush()

        split = ExpenseSplit(
            expense_id=expense.id,
            user_id=link2.user_id,
            amount=Decimal("50.00"),
            settled=True,
        )
        async_session.add(split)
        await async_session.flush()

        result = await svc.compute_balances(async_session, group.id)
        assert result.balances == []

    @pytest.mark.asyncio
    async def test_net_out_mutual_debts(self, async_session, two_member_group, link, link2):
        group = two_member_group

        # link paid 100, link2 owes 50
        e1 = SharedExpense(group_id=group.id, payer_id=link.user_id,
                           amount=Decimal("100"), currency="TWD", description="a")
        async_session.add(e1)
        await async_session.flush()
        async_session.add(ExpenseSplit(expense_id=e1.id, user_id=link2.user_id,
                                       amount=Decimal("50"), settled=False))

        # link2 paid 60, link owes 30
        e2 = SharedExpense(group_id=group.id, payer_id=link2.user_id,
                           amount=Decimal("60"), currency="TWD", description="b")
        async_session.add(e2)
        await async_session.flush()
        async_session.add(ExpenseSplit(expense_id=e2.id, user_id=link.user_id,
                                       amount=Decimal("30"), settled=False))

        await async_session.flush()

        result = await svc.compute_balances(async_session, group.id)
        # Net: link2 owes link 50, link owes link2 30 → link2 owes link 20
        assert len(result.balances) == 1
        assert result.balances[0].owed_by == link2.user_id
        assert result.balances[0].owed_to == link.user_id
        assert result.balances[0].amount == Decimal("20.00")


# ---------------------------------------------------------------------------
# handle_add_command
# ---------------------------------------------------------------------------

class TestHandleAddCommand:
    @pytest.mark.asyncio
    async def test_ratio_warning_falls_through_to_equal_split_in_3_person_group(
        self, async_session, group, link
    ):
        # Three members so ratio validation fires
        for name, lid in [("UserB", "Usecond"), ("UserC", "Uthird")]:
            u = _make_user()
            async_session.add(u)
            await async_session.flush()
            lnk = _make_link(u.id, lid, display_name=name)
            async_session.add(lnk)
            async_session.add(LineGroupMember(group_id=group.id, user_id=u.id, line_user_id=lid))
        async_session.add(LineGroupMember(
            group_id=group.id, user_id=link.user_id, line_user_id=link.line_user_id
        ))
        await async_session.flush()

        with patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_warn, \
             patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_add_command(
                async_session, "/add 150 coffee 60:40",
                link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )
            # Warning must fire
            mock_warn.assert_awaited_once()
            assert "only work in 2-person" in mock_warn.call_args[0][1]

        # Expense IS saved with equal split (warning = informational, not abort)
        from sqlalchemy import select
        expenses = (await async_session.execute(select(SharedExpense))).scalars().all()
        assert len(expenses) == 1
        assert expenses[0].amount == Decimal("150")

        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        assert len(splits) == 3  # equal split among 3 members

    @pytest.mark.asyncio
    async def test_not_linked_sends_not_linked_flex(self, async_session):
        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock) as mock_reply:
            await svc.handle_add_command(
                async_session, "/add 100 coffee",
                "Uunknown", MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )
            mock_reply.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_equal_split_creates_splits(self, async_session, two_member_group, link, link2):
        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_add_command(
                async_session, "/add 100 lunch",
                link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )

        from sqlalchemy import select
        expenses = (await async_session.execute(select(SharedExpense))).scalars().all()
        assert len(expenses) == 1
        assert expenses[0].amount == Decimal("100")

        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        assert len(splits) == 2
        assert sum(s.amount for s in splits) == Decimal("100")

    @pytest.mark.asyncio
    async def test_two_person_ratio_split(self, async_session, two_member_group, link, link2):
        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_add_command(
                async_session, "/add 100 dinner 60:40",
                link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )

        from sqlalchemy import select
        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        amounts = sorted(s.amount for s in splits)
        assert amounts == [Decimal("40.00"), Decimal("60.00")]


# ---------------------------------------------------------------------------
# Group membership auto-register (_ensure_group_membership_if_linked)
# ---------------------------------------------------------------------------

class TestGroupMembershipAutoRegister:
    @staticmethod
    async def _members(session, group):
        from sqlalchemy import select
        result = await session.execute(
            select(LineGroupMember).where(LineGroupMember.group_id == group.id)
        )
        return list(result.scalars().all())

    @pytest.mark.asyncio
    async def test_linked_user_registered_on_group_interaction(
        self, async_session, group, link
    ):
        assert await self._members(async_session, group) == []

        await svc._ensure_group_membership_if_linked(
            async_session, group.line_group_id, link.line_user_id
        )

        members = await self._members(async_session, group)
        assert len(members) == 1
        assert members[0].user_id == link.user_id

    @pytest.mark.asyncio
    async def test_unlinked_user_not_registered(self, async_session, group):
        await svc._ensure_group_membership_if_linked(
            async_session, group.line_group_id, "Unot_linked"
        )
        assert await self._members(async_session, group) == []

    @pytest.mark.asyncio
    async def test_idempotent_no_duplicate_member(self, async_session, group, link):
        for _ in range(3):
            await svc._ensure_group_membership_if_linked(
                async_session, group.line_group_id, link.line_user_id
            )
        assert len(await self._members(async_session, group)) == 1

    @pytest.mark.asyncio
    async def test_two_linked_users_can_split_after_each_interacts(
        self, async_session, group, link, link2
    ):
        # Neither has run /add — simulate each merely sending a message in the group.
        await svc._ensure_group_membership_if_linked(
            async_session, group.line_group_id, link.line_user_id
        )
        await svc._ensure_group_membership_if_linked(
            async_session, group.line_group_id, link2.line_user_id
        )
        assert len(await self._members(async_session, group)) == 2

        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock), \
             patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_reply:
            await svc.handle_add_command(
                async_session, "/add 100 lunch",
                link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )
            # The "only you are set up" guard must NOT fire now that both are members.
            for call in mock_reply.await_args_list:
                assert "Only you are set up" not in call.args[1]

        from sqlalchemy import select
        expenses = (await async_session.execute(select(SharedExpense))).scalars().all()
        assert len(expenses) == 1
        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        assert len(splits) == 2


# ---------------------------------------------------------------------------
# handle_txn_command
# ---------------------------------------------------------------------------

class TestHandleTxnCommand:
    @pytest.mark.asyncio
    async def test_zero_amount_rejected(self, async_session, link):
        with patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_reply:
            await svc.handle_txn_command(
                async_session, "/txn 0 food coffee",
                link.line_user_id, MOCK_REPLY_TOKEN,
            )
            mock_reply.assert_awaited_once()
            assert "greater than zero" in mock_reply.call_args[0][1]

    @pytest.mark.asyncio
    async def test_sets_transaction_date(self, async_session, link):
        cat = TransactionCategory(
            id=uuid.uuid4(), name="food", name_en="food",
            type=TransactionType.EXPENSE, color="#fff", icon="🍔",
            description="food", keywords=["food"],
            is_default=True, is_active=True, is_system=True,
        )
        async_session.add(cat)
        await async_session.flush()

        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_txn_command(
                async_session, "/txn 150 food coffee",
                link.line_user_id, MOCK_REPLY_TOKEN,
            )

        from sqlalchemy import select
        txn = (await async_session.execute(select(Transaction))).scalar_one_or_none()
        assert txn is not None
        assert txn.transaction_date == business_today()
        assert txn.amount == Decimal("150")

    @pytest.mark.asyncio
    async def test_not_linked_sends_not_linked_flex(self, async_session):
        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock) as mock_reply:
            await svc.handle_txn_command(
                async_session, "/txn 100 food coffee",
                "Uunlinked", MOCK_REPLY_TOKEN,
            )
            mock_reply.assert_awaited_once()


# ---------------------------------------------------------------------------
# handle_settle_command
# ---------------------------------------------------------------------------

class TestHandleSettleCommand:
    @pytest.mark.asyncio
    async def test_no_outstanding_balance_replies_no_balance(
        self, async_session, two_member_group, link, link2
    ):
        with patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_reply:
            await svc.handle_settle_command(
                async_session, "/settle @Tester2",
                link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )
            mock_reply.assert_awaited_once()
            assert "No outstanding" in mock_reply.call_args[0][1]

    @pytest.mark.asyncio
    async def test_settles_splits(self, async_session, two_member_group, link, link2):
        group = two_member_group
        expense = SharedExpense(
            group_id=group.id, payer_id=link.user_id,
            amount=Decimal("100"), currency="TWD", description="x",
        )
        async_session.add(expense)
        await async_session.flush()

        split = ExpenseSplit(
            expense_id=expense.id, user_id=link2.user_id,
            amount=Decimal("50"), settled=False,
        )
        async_session.add(split)
        await async_session.flush()

        with patch("app.modules.line_bot.service._reply_flex", new_callable=AsyncMock):
            await svc.handle_settle_command(
                async_session, f"/settle @{link.display_name}",  # link2 settles debt to link
                link2.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )

        from sqlalchemy import select
        refreshed = (await async_session.execute(
            select(ExpenseSplit).where(ExpenseSplit.id == split.id)
        )).scalar_one()
        assert refreshed.settled is True


# ---------------------------------------------------------------------------
# handle_undo_command — membership check
# ---------------------------------------------------------------------------

class TestHandleUndoCommand:
    @pytest.mark.asyncio
    async def test_non_member_cannot_undo(self, async_session, group, link):
        # link is NOT added as a group member
        with patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_reply:
            await svc.handle_undo_command(
                async_session, link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )
            mock_reply.assert_awaited_once()
            assert "not a member" in mock_reply.call_args[0][1].lower()


# ---------------------------------------------------------------------------
# _get_user_currency
# ---------------------------------------------------------------------------

class TestGetUserCurrency:
    @pytest.mark.asyncio
    async def test_returns_user_preferred_currency(self, async_session, user):
        currency = await svc._get_user_currency(async_session, user.id)
        assert currency == "TWD"

    @pytest.mark.asyncio
    async def test_returns_twd_for_unknown_user(self, async_session):
        currency = await svc._get_user_currency(async_session, uuid.uuid4())
        assert currency == "TWD"


# ---------------------------------------------------------------------------
# _get_or_create_group
# ---------------------------------------------------------------------------

class TestGetOrCreateGroup:
    @pytest.mark.asyncio
    async def test_new_group_is_twd_even_when_creator_prefers_usd(self, async_session):
        # A group must NOT inherit the creator's personal currency: a USD-preferring
        # creator should still produce a TWD group (Taiwan bill-splitting market).
        creator = _make_user()
        creator.preferred_currency = PreferredCurrency.USD
        async_session.add(creator)
        await async_session.flush()

        group = await svc._get_or_create_group(
            async_session, "Cnewgroup001", creator_user_id=creator.id
        )
        assert group.currency == "TWD"

    @pytest.mark.asyncio
    async def test_returns_existing_group_unchanged(self, async_session, group):
        # Existing groups are returned as-is (currency not re-derived on each access).
        result = await svc._get_or_create_group(
            async_session, group.line_group_id, creator_user_id=uuid.uuid4()
        )
        assert result.id == group.id
        assert result.currency == group.currency


# ---------------------------------------------------------------------------
# Split-amount helpers (pure functions)
# ---------------------------------------------------------------------------

class TestSplitHelpers:
    def test_equal_split_sums_to_total(self):
        amounts = svc._split_amounts_equal(Decimal("100"), 3)
        assert sum(amounts) == Decimal("100")
        # rounding remainder lands on the last share
        assert amounts == [Decimal("33.33"), Decimal("33.33"), Decimal("33.34")]

    def test_equal_split_single_member(self):
        amounts = svc._split_amounts_equal(Decimal("50"), 1)
        assert amounts == [Decimal("50.00")]

    def test_ratio_split_sums_to_total(self):
        amounts = svc._split_amounts_by_ratio(Decimal("100"), [Decimal("60"), Decimal("40")])
        assert sum(amounts) == Decimal("100")
        assert amounts == [Decimal("60.00"), Decimal("40.00")]

    def test_ratio_split_uneven_rounds_to_total(self):
        amounts = svc._split_amounts_by_ratio(Decimal("100"), [Decimal("1"), Decimal("3")])
        assert sum(amounts) == Decimal("100")


# ---------------------------------------------------------------------------
# Web write endpoint service functions
# ---------------------------------------------------------------------------

from app.modules.line_bot.schemas import (  # noqa: E402
    ExpenseCreateRequest,
    ExpenseUpdateRequest,
    SettleRequest,
    SplitInput,
)
from fastapi import HTTPException  # noqa: E402
from app.utils.datetime_helpers import business_today


async def _seed_expense(async_session, group, payer_link, debtor_link, amount="100", desc="x"):
    """Create one expense paid by payer_link with an unsettled split owed by debtor_link."""
    expense = SharedExpense(
        group_id=group.id, payer_id=payer_link.user_id,
        amount=Decimal(amount), currency="TWD", description=desc,
    )
    async_session.add(expense)
    await async_session.flush()
    async_session.add(ExpenseSplit(
        expense_id=expense.id, user_id=debtor_link.user_id,
        amount=Decimal(amount) / 2, settled=False,
    ))
    await async_session.flush()
    return expense


class TestWebAddExpense:
    @pytest.mark.asyncio
    async def test_group_not_found_raises_404(self, async_session, user):
        body = ExpenseCreateRequest(amount=Decimal("100"), description="coffee")
        with pytest.raises(HTTPException) as exc:
            await svc.web_add_expense(async_session, uuid.uuid4(), user.id, body)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_non_member_raises_403(self, async_session, two_member_group):
        # A user who exists but is not a member of the group
        outsider = _make_user()
        async_session.add(outsider)
        await async_session.flush()
        body = ExpenseCreateRequest(amount=Decimal("100"), description="coffee")
        with pytest.raises(HTTPException) as exc:
            await svc.web_add_expense(async_session, two_member_group.id, outsider.id, body)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_equal_split_default_payer(self, async_session, two_member_group, link, link2):
        body = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        out = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        assert out.payer_id == link.user_id
        assert len(out.splits) == 2
        assert sum(s.amount for s in out.splits) == Decimal("100")

    @pytest.mark.asyncio
    async def test_explicit_payer(self, async_session, two_member_group, link, link2):
        body = ExpenseCreateRequest(
            amount=Decimal("100"), description="dinner", payer_id=link2.user_id
        )
        out = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        assert out.payer_id == link2.user_id

    @pytest.mark.asyncio
    async def test_payer_not_member_raises_422(self, async_session, two_member_group, link):
        body = ExpenseCreateRequest(
            amount=Decimal("100"), description="dinner", payer_id=uuid.uuid4()
        )
        with pytest.raises(HTTPException) as exc:
            await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_custom_split_persisted(self, async_session, two_member_group, link, link2):
        body = ExpenseCreateRequest(
            amount=Decimal("100"), description="dinner",
            splits=[
                SplitInput(user_id=link.user_id, amount=Decimal("70")),
                SplitInput(user_id=link2.user_id, amount=Decimal("30")),
            ],
        )
        out = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        amounts = sorted(s.amount for s in out.splits)
        assert amounts == [Decimal("30"), Decimal("70")]

    @pytest.mark.asyncio
    async def test_custom_split_must_sum_to_total(self, async_session, two_member_group, link, link2):
        body = ExpenseCreateRequest(
            amount=Decimal("100"), description="dinner",
            splits=[
                SplitInput(user_id=link.user_id, amount=Decimal("70")),
                SplitInput(user_id=link2.user_id, amount=Decimal("20")),
            ],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_custom_split_with_non_member_raises_422(self, async_session, two_member_group, link):
        body = ExpenseCreateRequest(
            amount=Decimal("100"), description="dinner",
            splits=[
                SplitInput(user_id=link.user_id, amount=Decimal("50")),
                SplitInput(user_id=uuid.uuid4(), amount=Decimal("50")),
            ],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_single_member_group_rejected(self, async_session, group, link):
        async_session.add(LineGroupMember(
            group_id=group.id, user_id=link.user_id, line_user_id=link.line_user_id
        ))
        await async_session.flush()
        body = ExpenseCreateRequest(amount=Decimal("100"), description="solo")
        with pytest.raises(HTTPException) as exc:
            await svc.web_add_expense(async_session, group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_logs_activity(self, async_session, two_member_group, link, link2):
        from app.modules.line_bot.models import LineBotActivity
        from sqlalchemy import select
        body = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        await svc.web_add_expense(async_session, two_member_group.id, link.user_id, body)
        acts = (await async_session.execute(
            select(LineBotActivity).where(LineBotActivity.event_type == "add_expense")
        )).scalars().all()
        assert len(acts) == 1


class TestWebUpdateExpense:
    @pytest.mark.asyncio
    async def test_amount_change_resplits_equally(self, async_session, two_member_group, link, link2):
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        update = ExpenseUpdateRequest(amount=Decimal("200"))
        out = await svc.web_update_expense(
            async_session, two_member_group.id, created.id, link.user_id, update
        )
        assert out.amount == Decimal("200")
        assert sum(s.amount for s in out.splits) == Decimal("200")
        assert len(out.splits) == 2

    @pytest.mark.asyncio
    async def test_description_only_keeps_splits(self, async_session, two_member_group, link, link2):
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        update = ExpenseUpdateRequest(description="lunch")
        out = await svc.web_update_expense(
            async_session, two_member_group.id, created.id, link.user_id, update
        )
        assert out.description == "lunch"
        assert sum(s.amount for s in out.splits) == Decimal("100")

    @pytest.mark.asyncio
    async def test_custom_split_update(self, async_session, two_member_group, link, link2):
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        update = ExpenseUpdateRequest(
            amount=Decimal("100"),
            splits=[
                SplitInput(user_id=link.user_id, amount=Decimal("80")),
                SplitInput(user_id=link2.user_id, amount=Decimal("20")),
            ],
        )
        out = await svc.web_update_expense(
            async_session, two_member_group.id, created.id, link.user_id, update
        )
        amounts = sorted(s.amount for s in out.splits)
        assert amounts == [Decimal("20"), Decimal("80")]

    @pytest.mark.asyncio
    async def test_change_payer(self, async_session, two_member_group, link, link2):
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        update = ExpenseUpdateRequest(payer_id=link2.user_id)
        out = await svc.web_update_expense(
            async_session, two_member_group.id, created.id, link.user_id, update
        )
        assert out.payer_id == link2.user_id

    @pytest.mark.asyncio
    async def test_expense_not_found_raises_404(self, async_session, two_member_group, link):
        update = ExpenseUpdateRequest(description="lunch")
        with pytest.raises(HTTPException) as exc:
            await svc.web_update_expense(
                async_session, two_member_group.id, uuid.uuid4(), link.user_id, update
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_non_member_raises_403(self, async_session, two_member_group, link):
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        outsider = _make_user()
        async_session.add(outsider)
        await async_session.flush()
        update = ExpenseUpdateRequest(description="hacked")
        with pytest.raises(HTTPException) as exc:
            await svc.web_update_expense(
                async_session, two_member_group.id, created.id, outsider.id, update
            )
        assert exc.value.status_code == 403


class TestWebDeleteExpense:
    @pytest.mark.asyncio
    async def test_delete_removes_expense_and_splits(self, async_session, two_member_group, link, link2):
        from sqlalchemy import select
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        await svc.web_delete_expense(async_session, two_member_group.id, created.id, link.user_id)

        expenses = (await async_session.execute(select(SharedExpense))).scalars().all()
        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        assert expenses == []
        assert splits == []

    @pytest.mark.asyncio
    async def test_delete_another_members_expense_allowed(self, async_session, two_member_group, link, link2):
        # link2 paid; link (another member) deletes it — group ledger is shared,
        # so any member may delete. Must still be 200, not 403.
        from sqlalchemy import select
        create = ExpenseCreateRequest(
            amount=Decimal("100"), description="dinner", payer_id=link2.user_id
        )
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        await svc.web_delete_expense(async_session, two_member_group.id, created.id, link.user_id)
        expenses = (await async_session.execute(select(SharedExpense))).scalars().all()
        assert expenses == []

    @pytest.mark.asyncio
    async def test_delete_non_member_raises_403(self, async_session, two_member_group, link):
        create = ExpenseCreateRequest(amount=Decimal("100"), description="dinner")
        created = await svc.web_add_expense(async_session, two_member_group.id, link.user_id, create)

        outsider = _make_user()
        async_session.add(outsider)
        await async_session.flush()
        with pytest.raises(HTTPException) as exc:
            await svc.web_delete_expense(
                async_session, two_member_group.id, created.id, outsider.id
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_missing_expense_raises_404(self, async_session, two_member_group, link):
        with pytest.raises(HTTPException) as exc:
            await svc.web_delete_expense(
                async_session, two_member_group.id, uuid.uuid4(), link.user_id
            )
        assert exc.value.status_code == 404


class TestWebSettle:
    @pytest.mark.asyncio
    async def test_full_settle(self, async_session, two_member_group, link, link2):
        from sqlalchemy import select
        # link paid 100, link2 owes 50
        await _seed_expense(async_session, two_member_group, link, link2, amount="100")

        body = SettleRequest(owed_by=link2.user_id, owed_to=link.user_id)
        result = await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert result.amount_settled == Decimal("50")

        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        assert all(s.settled for s in splits)

    @pytest.mark.asyncio
    async def test_partial_settle_fits_one_split(self, async_session, two_member_group, link, link2):
        from sqlalchemy import select
        # Two expenses: link2 owes 50 + 50 = 100 total
        await _seed_expense(async_session, two_member_group, link, link2, amount="100", desc="a")
        await _seed_expense(async_session, two_member_group, link, link2, amount="100", desc="b")

        # Settle exactly one 50 split
        body = SettleRequest(owed_by=link2.user_id, owed_to=link.user_id, amount=Decimal("50"))
        result = await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert result.amount_settled == Decimal("50")

        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        settled = [s for s in splits if s.settled]
        assert len(settled) == 1

    @pytest.mark.asyncio
    async def test_settle_more_than_owed_caps_at_outstanding(self, async_session, two_member_group, link, link2):
        # link2 owes 50; request 1000 → only 50 gets settled
        await _seed_expense(async_session, two_member_group, link, link2, amount="100")
        body = SettleRequest(owed_by=link2.user_id, owed_to=link.user_id, amount=Decimal("1000"))
        result = await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert result.amount_settled == Decimal("50")

    @pytest.mark.asyncio
    async def test_amount_smaller_than_any_split_raises_422(self, async_session, two_member_group, link, link2):
        # link2 owes a single 50 split; settling 10 can't be done atomically
        await _seed_expense(async_session, two_member_group, link, link2, amount="100")
        body = SettleRequest(owed_by=link2.user_id, owed_to=link.user_id, amount=Decimal("10"))
        with pytest.raises(HTTPException) as exc:
            await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_no_outstanding_balance_raises_422(self, async_session, two_member_group, link, link2):
        body = SettleRequest(owed_by=link2.user_id, owed_to=link.user_id)
        with pytest.raises(HTTPException) as exc:
            await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_self_settle_raises_422(self, async_session, two_member_group, link):
        body = SettleRequest(owed_by=link.user_id, owed_to=link.user_id)
        with pytest.raises(HTTPException) as exc:
            await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_non_member_party_raises_422(self, async_session, two_member_group, link, link2):
        body = SettleRequest(owed_by=uuid.uuid4(), owed_to=link.user_id)
        with pytest.raises(HTTPException) as exc:
            await svc.web_settle(async_session, two_member_group.id, link.user_id, body)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_non_member_caller_raises_403(self, async_session, two_member_group, link, link2):
        outsider = _make_user()
        async_session.add(outsider)
        await async_session.flush()
        body = SettleRequest(owed_by=link2.user_id, owed_to=link.user_id)
        with pytest.raises(HTTPException) as exc:
            await svc.web_settle(async_session, two_member_group.id, outsider.id, body)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_group_not_found_raises_404(self, async_session, user):
        body = SettleRequest(owed_by=uuid.uuid4(), owed_to=uuid.uuid4())
        with pytest.raises(HTTPException) as exc:
            await svc.web_settle(async_session, uuid.uuid4(), user.id, body)
        assert exc.value.status_code == 404


class TestChatSettleSelfGuard:
    @pytest.mark.asyncio
    async def test_settle_self_rejected(self, async_session, two_member_group, link):
        with patch("app.modules.line_bot.service._reply", new_callable=AsyncMock) as mock_reply:
            await svc.handle_settle_command(
                async_session, f"/settle @{link.display_name}",
                link.line_user_id, MOCK_LINE_GROUP_ID, MOCK_REPLY_TOKEN,
            )
            mock_reply.assert_awaited_once()
            assert "yourself" in mock_reply.call_args[0][1].lower()


# ---------------------------------------------------------------------------
# Background webhook processing (process_webhook_events)
# ---------------------------------------------------------------------------

class _FakeSavepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False  # propagate so the loop's try/except can catch handler errors


class _FakeSession:
    """Minimal async-session stub for process_webhook_events (no real DB)."""

    def __init__(self, commit_error: Exception | None = None):
        self.commits = 0
        self.rollbacks = 0
        self._commit_error = commit_error

    def begin_nested(self):
        return _FakeSavepoint()

    async def commit(self):
        if self._commit_error is not None:
            raise self._commit_error
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class TestProcessWebhookEvents:
    @pytest.mark.asyncio
    async def test_isolates_failures_and_commits_once(self, monkeypatch):
        """One failing event must not abort the batch; commit happens once."""
        handled = []

        async def fake_handle_event(db, event):
            handled.append(event)
            if event == "bad":
                raise RuntimeError("boom")

        fake_session = _FakeSession()
        monkeypatch.setattr(svc, "_dispatch_event", fake_handle_event)
        monkeypatch.setattr(svc, "async_session", lambda: fake_session)

        await svc.process_webhook_events(["ok1", "bad", "ok2"])

        assert handled == ["ok1", "bad", "ok2"]  # every event attempted
        assert fake_session.commits == 1
        assert fake_session.rollbacks == 0

    @pytest.mark.asyncio
    async def test_commit_failure_rolls_back_without_raising(self, monkeypatch):
        """A commit error is swallowed (LINE already got its 200) and rolled back."""
        async def fake_handle_event(db, event):
            return None

        fake_session = _FakeSession(commit_error=RuntimeError("db down"))
        monkeypatch.setattr(svc, "_dispatch_event", fake_handle_event)
        monkeypatch.setattr(svc, "async_session", lambda: fake_session)

        await svc.process_webhook_events(["ok"])  # must not raise

        assert fake_session.rollbacks == 1


# ---------------------------------------------------------------------------
# Webhook event dedup (mark_event_processed / _dispatch_event)
# ---------------------------------------------------------------------------

def _dedup_event(webhook_event_id, msg_id: str = "m1") -> LineEvent:
    return LineEvent.model_validate({
        "type": "message",
        "webhookEventId": webhook_event_id,
        "source": {"type": "user", "userId": MOCK_LINE_USER_ID},
        "timestamp": 1,
        "message": {"id": msg_id, "type": "text", "text": "hi"},
    })


class TestEventDedup:
    @pytest.mark.asyncio
    async def test_mark_event_processed_true_then_false(self, async_session):
        repo = LineAccountRepository(async_session)
        assert await repo.mark_event_processed("evt-1") is True    # first delivery
        assert await repo.mark_event_processed("evt-1") is False   # re-delivery

    @pytest.mark.asyncio
    async def test_dispatch_skips_already_processed(self, async_session, monkeypatch):
        seen = []

        async def fake_handle_event(db, event):
            seen.append(event)

        monkeypatch.setattr(svc, "handle_event", fake_handle_event)
        evt = _dedup_event("evt-dup-1")

        await svc._dispatch_event(async_session, evt)   # handled
        await svc._dispatch_event(async_session, evt)   # skipped (duplicate id)

        assert len(seen) == 1

    @pytest.mark.asyncio
    async def test_dispatch_handles_event_without_id(self, async_session, monkeypatch):
        """No webhookEventId and no message.id → handle it (don't drop it)."""
        seen = []

        async def fake_handle_event(db, event):
            seen.append(event)

        monkeypatch.setattr(svc, "handle_event", fake_handle_event)
        evt = LineEvent.model_validate({
            "type": "follow",
            "source": {"type": "user", "userId": MOCK_LINE_USER_ID},
            "timestamp": 1,
        })

        await svc._dispatch_event(async_session, evt)

        assert len(seen) == 1


# ---------------------------------------------------------------------------
# link_preview: /link-line shows the LINE account before anything is linked
# ---------------------------------------------------------------------------

class TestLinkPreview:
    """Anyone can run /link and send the URL to someone else, so the page must
    show whose LINE account it attaches and confirm only on a click. The preview
    must therefore never use the token up."""

    @pytest.mark.asyncio
    async def test_shows_the_line_account_without_using_the_token(self, async_session):
        token = LineLinkToken(
            line_user_id=MOCK_LINE_USER_ID,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            used=False,
        )
        async_session.add(token)
        await async_session.flush()

        with patch.object(svc, "_fetch_line_profile", AsyncMock(return_value=("Stranger", "https://x/p.png"))):
            preview = await svc.link_preview(async_session, token.token)

        assert preview.line_display_name == "Stranger"
        assert preview.picture_url == "https://x/p.png"
        assert token.used is False

    @pytest.mark.asyncio
    async def test_refuses_a_used_token(self, async_session):
        token = LineLinkToken(
            line_user_id=MOCK_LINE_USER_ID,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            used=True,
        )
        async_session.add(token)
        await async_session.flush()

        with pytest.raises(ValueError, match="already-used"):
            await svc.link_preview(async_session, token.token)


# ---------------------------------------------------------------------------
# liff_session: no password-less token for an account CurrentUser would refuse
# ---------------------------------------------------------------------------

def _liff_verify_ok(line_user_id: str):
    resp = MagicMock(status_code=200)
    resp.json.return_value = {"sub": line_user_id}
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    return patch.object(svc, "_get_http_client", return_value=client)


class TestLiffSessionAccountState:
    @pytest.mark.parametrize(
        "state",
        [
            {"is_active": False},
            {"status": UserStatus.SUSPENDED},
            {"status": UserStatus.PENDING_APPROVAL},
        ],
        ids=["deactivated", "suspended", "pending"],
    )
    @pytest.mark.asyncio
    async def test_refuses_a_blocked_account(self, async_session, monkeypatch, state):
        user = _make_user()
        for field, value in state.items():
            setattr(user, field, value)
        async_session.add(user)
        async_session.add(_make_link(user.id))
        await async_session.flush()
        monkeypatch.setattr(svc.settings, "LINE_LOGIN_CHANNEL_ID", "dummy-channel")

        with _liff_verify_ok(MOCK_LINE_USER_ID):
            result = await svc.liff_session(async_session, "id-token")

        assert result.linked is False
        assert result.access_token is None

    @pytest.mark.asyncio
    async def test_issues_a_token_for_an_active_account(self, async_session, monkeypatch):
        user = _make_user()
        async_session.add(user)
        async_session.add(_make_link(user.id))
        await async_session.flush()
        monkeypatch.setattr(svc.settings, "LINE_LOGIN_CHANNEL_ID", "dummy-channel")

        with _liff_verify_ok(MOCK_LINE_USER_ID):
            result = await svc.liff_session(async_session, "id-token")

        assert result.linked is True
        assert result.access_token
