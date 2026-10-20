"""
Plain-text bookkeeping in a LINE DM: "午餐 120", "+50000 薪水".

The parser and keyword guess are pure; the handlers run against the shared
in-memory session with every LINE API call mocked.
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.line_bot import service as svc
from app.modules.line_bot.models import LineUserLink
from app.modules.line_bot.quick_log import guess_category_name, parse_quick_entry
from app.modules.line_bot.schemas import LineEvent
from app.modules.transactions.models import (
    CategoryType,
    PaymentMethod,
    Transaction,
    TransactionCategory,
    TransactionType,
    TransactionWalletType,
)
from app.modules.users.models import PreferredCurrency, User, UserRole, UserStatus
from app.utils.datetime_helpers import business_today

REPLY_TOKEN = "reply-token"
LINE_USER = "Uquick123"


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "text, amount, description, is_income",
    [
        ("午餐 120", "120", "午餐", False),
        ("120 咖啡", "120", "咖啡", False),
        ("午餐120", "120", "午餐", False),
        ("+50000 薪水", "50000", "薪水", True),
        ("薪水 +50000", "50000", "薪水", True),
        ("1,200 房租", "1200", "房租", False),
        ("NT$350 晚餐", "350", "晚餐", False),
        ("咖啡 85元", "85", "咖啡", False),
        ("剪髮 12.5", "12.5", "剪髮", False),
        ("７－１１ ８０", "80", "7-11", False),  # full-width keyboard
        ("80 7-11", "80", "7-11", False),       # not "80 7" minus 11
        ("Lunch 150", "150", "Lunch", False),
    ],
)
def test_parses_bookkeeping_lines(text, amount, description, is_income):
    entry = parse_quick_entry(text)
    assert entry is not None
    assert entry.amount == Decimal(amount)
    assert entry.description == description
    assert entry.is_income is is_income


@pytest.mark.parametrize(
    "text",
    ["hello", "120", "3點到", "我今天 3 點到", "2024年 旅行", "/txn 100 food", "咖啡 0",
     "咖啡 99999999", "午餐 120\n晚餐 200", ""],
)
def test_ignores_chat(text):
    assert parse_quick_entry(text) is None


@pytest.mark.parametrize(
    "description, is_income, expected",
    [
        ("午餐", False, "Dining"),
        ("全聯", False, "Groceries"),
        ("高鐵", False, "Transportation"),
        ("飯店", False, "Travel"),       # longest keyword wins over "飯"
        ("steam", False, "Entertainment"),  # not "tea"
        ("business lunch", False, "Dining"),  # not "bus"
        ("薪水", True, "Salary"),
        ("年終", True, "Bonus"),
        ("隨便", False, "Others"),
        ("午餐", True, "Others"),        # income never takes an expense keyword
    ],
)
def test_guesses_category(description, is_income, expected):
    assert guess_category_name(description, is_income) == expected


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _category(name: str, cat_type: CategoryType, usage: int = 0) -> TransactionCategory:
    return TransactionCategory(
        id=uuid.uuid4(), name=name, name_en=name, type=cat_type, color="#ffffff", icon="receipt",
        is_default=True, is_active=True, is_system=True, usage_count=usage,
    )


@pytest_asyncio.fixture
async def user(async_session: AsyncSession) -> User:
    u = User(
        id=uuid.uuid4(), email=f"q{uuid.uuid4().hex[:6]}@test.com", name="Quick", hashed_password="x",
        is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
        preferred_currency=PreferredCurrency.TWD, timezone="UTC", experience_points=0, level=1,
    )
    async_session.add(u)
    await async_session.flush()
    return u


@pytest_asyncio.fixture
async def link(async_session: AsyncSession, user: User) -> LineUserLink:
    lnk = LineUserLink(line_user_id=LINE_USER, user_id=user.id, display_name="Quick")
    async_session.add(lnk)
    await async_session.flush()
    return lnk


@pytest_asyncio.fixture
async def categories(async_session: AsyncSession) -> dict[str, TransactionCategory]:
    cats = {
        "Dining": _category("Dining", CategoryType.EXPENSE, 100),
        "Dining (dup)": _category("Dining", CategoryType.EXPENSE, 1),  # duplicate global row
        "Groceries": _category("Groceries", CategoryType.EXPENSE, 50),
        "Others": _category("Others", CategoryType.EXPENSE, 10),
        "Salary": _category("Salary", CategoryType.INCOME, 30),
        "Others income": _category("Others", CategoryType.INCOME, 5),
    }
    async_session.add_all(cats.values())
    await async_session.flush()
    return cats


async def _only_txn(session: AsyncSession) -> Transaction:
    return (await session.execute(select(Transaction))).scalar_one()


class TestHandleQuickLog:
    @pytest.mark.asyncio
    async def test_records_expense_with_keyword_category(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock) as reply:
            handled = await svc.handle_quick_log(async_session, "午餐 120", LINE_USER, REPLY_TOKEN)
        assert handled is True
        txn = await _only_txn(async_session)
        assert txn.type == TransactionType.EXPENSE
        assert txn.wallet_type == TransactionWalletType.LIFE
        assert txn.amount == Decimal("120")
        assert txn.description == "午餐"
        assert txn.transaction_date == business_today()
        assert txn.category_id == categories["Dining"].id  # the most used duplicate
        # Undo and change-category are bound to this row.
        quick_replies = reply.call_args[0][3]
        datas = [q["action"].get("data", "") for q in quick_replies]
        assert f"cmd=qlog_undo&t={txn.id}" in datas
        assert f"cmd=qlog_cat&t={txn.id}" in datas

    @pytest.mark.asyncio
    async def test_records_income(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock):
            await svc.handle_quick_log(async_session, "+50000 薪水", LINE_USER, REPLY_TOKEN)
        txn = await _only_txn(async_session)
        assert txn.type == TransactionType.INCOME
        assert txn.category_id == categories["Salary"].id

    @pytest.mark.asyncio
    async def test_confirmation_shows_the_stored_amount(self, async_session, link, categories):
        # "12.5" must not be echoed back as "12" — the reply has to match the books.
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock) as reply:
            await svc.handle_quick_log(async_session, "咖啡 12.5", LINE_USER, REPLY_TOKEN)
        assert (await _only_txn(async_session)).amount == Decimal("12.5")
        alt_text, flex = reply.call_args[0][1], reply.call_args[0][2]
        assert "12.5" in alt_text
        assert "12.5" in str(flex)

    @pytest.mark.asyncio
    async def test_users_own_history_beats_the_keyword(self, async_session, user, link, categories):
        # This user files 全聯 under Dining, not the keyword's Groceries.
        async_session.add(Transaction(
            user_id=user.id, type=TransactionType.EXPENSE, wallet_type=TransactionWalletType.LIFE,
            amount=Decimal("300"), currency="TWD", description="全聯", category_id=categories["Dining"].id,
            payment_method=PaymentMethod.OTHER, transaction_date=business_today(),
        ))
        await async_session.flush()
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock):
            await svc.handle_quick_log(async_session, "全聯 450", LINE_USER, REPLY_TOKEN)
        rows = (await async_session.execute(select(Transaction).where(Transaction.amount == Decimal("450")))).scalars().all()
        assert [r.category_id for r in rows] == [categories["Dining"].id]

    @pytest.mark.asyncio
    async def test_unknown_word_falls_back_to_others(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock):
            await svc.handle_quick_log(async_session, "隨便 99", LINE_USER, REPLY_TOKEN)
        assert (await _only_txn(async_session)).category_id == categories["Others"].id

    @pytest.mark.asyncio
    async def test_chat_is_not_handled(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock) as reply:
            handled = await svc.handle_quick_log(async_session, "hello there", LINE_USER, REPLY_TOKEN)
        assert handled is False
        reply.assert_not_awaited()
        assert (await async_session.execute(select(Transaction))).first() is None

    @pytest.mark.asyncio
    async def test_unlinked_user_is_asked_to_link(self, async_session, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock) as reply:
            handled = await svc.handle_quick_log(async_session, "午餐 120", "Unobody", REPLY_TOKEN)
        assert handled is True
        reply.assert_awaited_once()
        assert (await async_session.execute(select(Transaction))).first() is None

    @pytest.mark.asyncio
    async def test_offers_repeated_expenses_as_one_tap_entries(self, async_session, user, link, categories):
        for _ in range(3):
            async_session.add(Transaction(
                user_id=user.id, type=TransactionType.EXPENSE, wallet_type=TransactionWalletType.LIFE,
                amount=Decimal("65"), currency="TWD", description="早餐", category_id=categories["Dining"].id,
                payment_method=PaymentMethod.OTHER, transaction_date=business_today(),
            ))
        await async_session.flush()
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock) as reply:
            await svc.handle_quick_log(async_session, "午餐 120", LINE_USER, REPLY_TOKEN)
        texts = [q["action"].get("text") for q in reply.call_args[0][3]]
        assert "早餐 65" in texts


async def _log(session: AsyncSession, text: str = "午餐 120") -> Transaction:
    with patch.object(svc, "_reply_flex", new_callable=AsyncMock):
        await svc.handle_quick_log(session, text, LINE_USER, REPLY_TOKEN)
    return (await session.execute(select(Transaction).order_by(Transaction.created_at.desc()))).scalars().first()


class TestQuickUndo:
    @pytest.mark.asyncio
    async def test_removes_the_entry(self, async_session, link, categories):
        txn = await _log(async_session)
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock):
            await svc.handle_quick_undo(async_session, LINE_USER, REPLY_TOKEN, str(txn.id))
        assert (await async_session.execute(select(Transaction))).first() is None

    @pytest.mark.asyncio
    async def test_never_touches_a_row_not_made_in_line(self, async_session, user, link, categories):
        web_row = Transaction(
            user_id=user.id, type=TransactionType.EXPENSE, wallet_type=TransactionWalletType.LIFE,
            amount=Decimal("500"), currency="TWD", description="web", category_id=categories["Dining"].id,
            payment_method=PaymentMethod.OTHER, transaction_date=business_today(),
        )
        async_session.add(web_row)
        await async_session.flush()
        with patch.object(svc, "_reply", new_callable=AsyncMock) as reply:
            await svc.handle_quick_undo(async_session, LINE_USER, REPLY_TOKEN, str(web_row.id))
        assert "Nothing to undo" in reply.call_args[0][1]
        assert (await async_session.execute(select(Transaction))).scalar_one().id == web_row.id

    @pytest.mark.asyncio
    async def test_never_touches_another_users_row(self, async_session, link, categories):
        txn = await _log(async_session)
        other = LineUserLink(line_user_id="Uother", user_id=uuid.uuid4(), display_name="Other")
        async_session.add(other)
        await async_session.flush()
        with patch.object(svc, "_reply", new_callable=AsyncMock):
            await svc.handle_quick_undo(async_session, "Uother", REPLY_TOKEN, str(txn.id))
        assert (await async_session.execute(select(Transaction))).scalar_one().id == txn.id

    @pytest.mark.asyncio
    async def test_expires_after_a_day(self, async_session, link, categories):
        txn = await _log(async_session)
        txn.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
        await async_session.flush()
        with patch.object(svc, "_reply", new_callable=AsyncMock):
            await svc.handle_quick_undo(async_session, LINE_USER, REPLY_TOKEN, str(txn.id))
        assert (await async_session.execute(select(Transaction))).first() is not None

    @pytest.mark.asyncio
    async def test_garbage_id_is_harmless(self, async_session, link, categories):
        with patch.object(svc, "_reply", new_callable=AsyncMock) as reply:
            await svc.handle_quick_undo(async_session, LINE_USER, REPLY_TOKEN, "not-a-uuid")
        reply.assert_awaited_once()


class TestQuickCategory:
    @pytest.mark.asyncio
    async def test_picker_offers_each_name_once_and_skips_the_current(self, async_session, link, categories):
        txn = await _log(async_session)  # Dining
        with patch.object(svc, "_reply", new_callable=AsyncMock) as reply:
            await svc.handle_quick_category_picker(async_session, LINE_USER, REPLY_TOKEN, str(txn.id))
        labels = [q["action"]["displayText"] for q in reply.call_args[0][2]]
        assert labels == ["Groceries", "Others"]  # expense only; the Dining duplicate is not offered either

    @pytest.mark.asyncio
    async def test_moves_the_entry_and_learns(self, async_session, link, categories):
        txn = await _log(async_session, "麻辣燙 150")
        with patch.object(svc, "_reply", new_callable=AsyncMock):
            await svc.handle_quick_set_category(
                async_session, LINE_USER, REPLY_TOKEN, str(txn.id), str(categories["Groceries"].id))
        assert txn.category_id == categories["Groceries"].id
        # The same words again now follow the user's choice.
        again = await _log(async_session, "麻辣燙 180")
        assert again.category_id == categories["Groceries"].id

    @pytest.mark.asyncio
    async def test_rejects_a_category_of_the_other_type(self, async_session, link, categories):
        txn = await _log(async_session)
        with patch.object(svc, "_reply", new_callable=AsyncMock) as reply:
            await svc.handle_quick_set_category(
                async_session, LINE_USER, REPLY_TOKEN, str(txn.id), str(categories["Salary"].id))
        assert "Unknown category" in reply.call_args[0][1]
        assert txn.category_id == categories["Dining"].id


def _text_event(text: str, group_id: str | None = None) -> LineEvent:
    source = {"type": "group", "groupId": group_id, "userId": LINE_USER} if group_id else {"type": "user", "userId": LINE_USER}
    return LineEvent.model_validate({
        "type": "message", "replyToken": REPLY_TOKEN, "source": source, "timestamp": 1,
        "message": {"id": "m1", "type": "text", "text": text},
    })


class TestDispatch:
    @pytest.mark.asyncio
    async def test_dm_line_is_logged(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock):
            await svc.handle_event(async_session, _text_event("午餐 120"))
        assert (await _only_txn(async_session)).amount == Decimal("120")

    @pytest.mark.asyncio
    async def test_group_chat_is_never_logged(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock), \
             patch.object(svc, "_reply", new_callable=AsyncMock), \
             patch.object(svc, "_ensure_group_membership_if_linked", new_callable=AsyncMock):
            await svc.handle_event(async_session, _text_event("午餐 120", group_id="Cgroup1"))
        assert (await async_session.execute(select(Transaction))).first() is None

    @pytest.mark.asyncio
    async def test_dm_chat_still_gets_the_menu(self, async_session, link, categories):
        with patch.object(svc, "_reply_flex", new_callable=AsyncMock) as reply:
            await svc.handle_event(async_session, _text_event("hello"))
        assert reply.call_args[0][1] == "Aspiro Menu"
