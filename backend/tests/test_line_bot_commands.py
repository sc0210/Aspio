"""LINE bot read commands against seeded data: /history, /undo, /summary, /balance,
/portfolio, /goals, /rate. Outgoing LINE calls are captured, never sent."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.goals.models import Goal, GoalStatus
from app.modules.line_bot import service as svc
from app.modules.line_bot.models import ExpenseSplit, LineGroup, LineGroupMember, LineUserLink, SharedExpense
from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding
from app.modules.users.models import PreferredCurrency, User, UserRole, UserStatus

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

G, RT = "Cgroup1", "reply-token"


def make_user():
    return User(id=uuid.uuid4(), email=f"u{uuid.uuid4().hex[:6]}@test.com", name="T", hashed_password="x",
                is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
                preferred_currency=PreferredCurrency.TWD, timezone="UTC", experience_points=0, level=1)


@pytest_asyncio.fixture
async def alice(async_session):
    u = make_user()
    async_session.add_all([u, LineUserLink(line_user_id="Ualice", user_id=u.id, display_name="Alice")])
    await async_session.flush()
    return u


@pytest_asyncio.fixture
async def bob(async_session):
    u = make_user()
    async_session.add_all([u, LineUserLink(line_user_id="Ubob", user_id=u.id, display_name="Bob")])
    await async_session.flush()
    return u


@pytest_asyncio.fixture
async def group(async_session, alice, bob):
    g = LineGroup(line_group_id=G, currency="TWD")
    async_session.add(g)
    await async_session.flush()
    async_session.add_all([LineGroupMember(group_id=g.id, user_id=alice.id, line_user_id="Ualice"),
                           LineGroupMember(group_id=g.id, user_id=bob.id, line_user_id="Ubob")])
    await async_session.flush()
    return g


async def expense(session, group, payer, amount, desc, created_at=None, owed_by=None):
    e = SharedExpense(group_id=group.id, payer_id=payer.id, amount=Decimal(amount), currency="TWD", description=desc)
    if created_at:
        e.created_at = created_at
    session.add(e)
    await session.flush()
    half = Decimal(amount) / 2
    for u in owed_by or []:
        session.add(ExpenseSplit(expense_id=e.id, user_id=u.id, amount=half))
    await session.flush()
    return e


@pytest.fixture
def sent():
    """Everything the bot replies with: [(alt_text_or_text, payload_json)]."""
    out = []

    async def reply(token, text, *a, **k):
        out.append((text, ""))

    async def reply_flex(token, alt, flex, *a, **k):
        out.append((alt, json.dumps(flex, ensure_ascii=False, default=str)))

    with patch.object(svc, "_reply", new=reply), patch.object(svc, "_reply_flex", new=reply_flex):
        yield out


class TestHistory:
    async def test_not_linked(self, async_session, sent):
        await svc.handle_history_command(async_session, "Unobody", None, RT)
        assert sent[0][0] == "Link your Aspiro account"

    async def test_group_shows_shared_expenses_with_payer_names(self, async_session, group, alice, bob, sent):
        await expense(async_session, group, alice, "300", "Hotpot")
        await expense(async_session, group, bob, "80", "Taxi")
        await svc.handle_history_command(async_session, "Ualice", G, RT)
        alt, payload = sent[0]
        assert alt == "Group expense history"
        assert "Hotpot" in payload and "Taxi" in payload and "by Alice" in payload and "by Bob" in payload

    async def test_empty_group_never_falls_back_to_personal_data(self, async_session, group, sent):
        await svc.handle_history_command(async_session, "Ualice", G, RT)
        assert sent[0][0].startswith("No expenses in this group yet.")

    async def test_dm_shows_personal_history(self, async_session, alice, sent):
        await svc.handle_history_command(async_session, "Ualice", None, RT)
        assert sent[0][0] == "Your recent transactions"


class TestUndo:
    async def test_removes_the_callers_latest_recent_expense(self, async_session, group, alice, bob, sent):
        now = datetime.now(timezone.utc)
        await expense(async_session, group, alice, "100", "Older", created_at=now - timedelta(minutes=10))
        await expense(async_session, group, alice, "50", "Latest", created_at=now - timedelta(minutes=1))
        await expense(async_session, group, bob, "70", "Bobs")
        await svc.handle_undo_command(async_session, "Ualice", G, RT)
        assert sent[0][0].startswith("Removed: Latest TWD 50")
        left = {e.description for e in (await async_session.execute(select(SharedExpense))).scalars()}
        assert left == {"Older", "Bobs"}

    async def test_only_the_last_30_minutes_can_be_undone(self, async_session, group, alice, sent):
        await expense(async_session, group, alice, "100", "Stale",
                      created_at=datetime.now(timezone.utc) - timedelta(hours=1))
        await svc.handle_undo_command(async_session, "Ualice", G, RT)
        assert sent[0][0].startswith("No recent expenses to undo")

    async def test_unknown_group_and_non_member(self, async_session, alice, sent):
        await svc.handle_undo_command(async_session, "Ualice", "Cnope", RT)
        assert sent[0][0] == "No expenses in this group yet."
        other = LineGroup(line_group_id="Cother", currency="TWD")
        async_session.add(other)
        await async_session.flush()
        await svc.handle_undo_command(async_session, "Ualice", "Cother", RT)
        assert sent[1][0] == "You're not a member of this group."


class FrozenTaipeiMorning(datetime):
    """1 Nov 2026 02:00 in Taipei, which is still 31 Oct 18:00 in UTC."""
    INSTANT = datetime(2026, 10, 31, 18, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.INSTANT.astimezone(tz) if tz else cls.INSTANT.replace(tzinfo=None)


class TestSummary:
    async def test_totals_this_months_expenses_by_payer(self, async_session, group, alice, bob, sent):
        await expense(async_session, group, alice, "300", "Hotpot", owed_by=[alice, bob])
        await expense(async_session, group, bob, "100", "Taxi", owed_by=[alice, bob])
        await svc.handle_summary_command(async_session, "Ualice", G, RT)
        alt, payload = sent[0]
        assert alt.endswith("Group Summary")
        assert "400" in payload and "Alice" in payload and "Bob" in payload

    async def test_month_follows_the_business_timezone(self, async_session, group, alice, sent):
        # 1 Nov 01:00 Taipei: a November expense, though it is still October in UTC.
        await expense(async_session, group, alice, "111", "Just after midnight",
                      created_at=datetime(2026, 10, 31, 17, 0, tzinfo=timezone.utc))
        await expense(async_session, group, alice, "999", "Mid October",
                      created_at=datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc))
        with patch.object(svc, "datetime", FrozenTaipeiMorning), \
             patch("app.utils.datetime_helpers.datetime", FrozenTaipeiMorning):
            await svc.handle_summary_command(async_session, "Ualice", G, RT)
        alt, payload = sent[0]
        assert alt == "November 2026 Group Summary"
        assert "111" in payload and "999" not in payload and "1,110" not in payload

    async def test_nothing_this_month(self, async_session, group, sent):
        await svc.handle_summary_command(async_session, "Ualice", G, RT)
        assert sent[0][0].startswith("No expenses this month")


class TestBalance:
    async def test_shows_who_owes_whom(self, async_session, group, alice, bob, sent):
        await expense(async_session, group, alice, "200", "Dinner", owed_by=[alice, bob])
        await svc.handle_balance_command(async_session, "Ubob", G, RT)
        alt, payload = sent[0]
        assert alt == "Group Balances" and "Alice" in payload and "Bob" in payload and "100" in payload

    async def test_settled_group(self, async_session, group, sent):
        await svc.handle_balance_command(async_session, "Ualice", G, RT)
        assert sent[0][0] == "All settled up!"

    async def test_unknown_group(self, async_session, alice, sent):
        await svc.handle_balance_command(async_session, "Ualice", "Cnope", RT)
        assert sent[0][0] == "No expenses recorded in this group yet."


def holding(pf, user, symbol, value, cost, active=True):
    return PortfolioHolding(
        id=uuid.uuid4(), portfolio_id=pf.id, user_id=user.id, symbol=symbol, name=f"{symbol} name", type="etf",
        exchange="TWSE", currency="TWD", market="TW", wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal("1"), average_cost=Decimal(cost), current_price=Decimal(value),
        total_cost=Decimal(cost), total_value=Decimal(value), gain_loss=Decimal(value) - Decimal(cost),
        gain_loss_percentage=Decimal("0"), is_active=active, purchase_date=datetime(2026, 1, 2, tzinfo=timezone.utc))


class TestPortfolio:
    async def test_no_portfolio(self, async_session, alice, sent):
        await svc.handle_portfolio_command(async_session, "Ualice", RT)
        assert sent[0][0] == "No portfolio yet"

    async def test_lots_merge_per_symbol_and_top_five_by_value(self, async_session, alice, sent):
        pf = Portfolio(id=uuid.uuid4(), user_id=alice.id, name="P", currency="TWD", is_active=True,
                       is_default=True, total_value=Decimal("12345"), total_gain_loss_percentage=Decimal("7.5"))
        async_session.add(pf)
        await async_session.flush()
        async_session.add_all([
            holding(pf, alice, "0050", "600", "500"), holding(pf, alice, "0050", "600", "500"),
            *[holding(pf, alice, s, str(v), str(v)) for s, v in [("A", 900), ("B", 800), ("C", 700), ("D", 100), ("E", 50)]],
            holding(pf, alice, "GONE", "99999", "1", active=False),
        ])
        await async_session.flush()
        with patch.object(svc, "_log_activity", new=AsyncMock()):
            await svc.handle_portfolio_command(async_session, "Ualice", RT)
        alt, payload = sent[0]
        assert alt == "Portfolio  TWD 12,345"
        assert "0050" in payload and "TWD 1,200" in payload  # two lots merged
        assert '"text": "E"' not in payload  # sixth symbol by value is left out
        assert "GONE" not in payload  # a sold-out lot is not a holding


class TestGoals:
    async def test_lists_active_goals(self, async_session, alice, sent):
        async_session.add_all([
            Goal(user_id=alice.id, title="Japan trip", target_date=datetime(2027, 1, 1, tzinfo=timezone.utc), target_amount=Decimal("60000"),
                 current_amount=Decimal("15000"), status=GoalStatus.ACTIVE),
            Goal(user_id=alice.id, title="Done goal", target_amount=Decimal("1"),
                 current_amount=Decimal("1"), status=GoalStatus.COMPLETED),
        ])
        await async_session.flush()
        await svc.handle_goals_command(async_session, "Ualice", RT)
        alt, payload = sent[0]
        assert alt == "Your Financial Goals" and "Japan trip" in payload and "Done goal" not in payload


class TestRate:
    async def test_live_rates_and_fallback_for_missing_ones(self, async_session, alice, sent):
        fake = MagicMock()
        fake.get_multiple_rates = AsyncMock(return_value={"USD": Decimal("0.031"), "JPY": None, "EUR": None,
                                                          "GBP": None, "KRW": None, "SGD": None})
        fake._get_fallback_rates = MagicMock(return_value={"JPY": 4.7})
        with patch.object(svc, "ExchangeRateService", return_value=fake):
            await svc.handle_rate_command(async_session, "Ualice", RT)
        alt, payload = sent[0]
        assert alt == "Exchange Rates • 1 TWD"
        assert "0.0310" in payload and "4.7000" in payload and "Approx." in payload
        targets = fake.get_multiple_rates.await_args.args[1]
        assert "TWD" not in targets and "USD" in targets

    async def test_unlinked_caller_gets_twd_base(self, async_session, sent):
        fake = MagicMock(get_multiple_rates=AsyncMock(return_value={"USD": Decimal("0.03")}))
        with patch.object(svc, "ExchangeRateService", return_value=fake):
            await svc.handle_rate_command(async_session, "Unobody", RT)
        assert sent[0][0] == "Exchange Rates • 1 TWD" and "Live" in sent[0][1]


class TestPersonalMonth:
    """The DM /balance and /summary cards read the business (Taipei) month too."""

    @pytest_asyncio.fixture
    async def ledger(self, async_session, alice):
        from datetime import date
        from app.modules.transactions.models import (
            CategoryType, Transaction, TransactionCategory, TransactionType, TransactionWalletType)
        food = TransactionCategory(id=uuid.uuid4(), name="Food", type=CategoryType.EXPENSE, is_active=True)
        async_session.add(food)
        await async_session.flush()
        for amount, day in (("250", date(2026, 11, 1)), ("999", date(2026, 10, 20))):
            async_session.add(Transaction(
                id=uuid.uuid4(), user_id=alice.id, amount=Decimal(amount), currency="TWD",
                type=TransactionType.EXPENSE, wallet_type=TransactionWalletType.LIFE,
                category_id=food.id, transaction_date=day, description=f"spent {amount}"))
        await async_session.flush()

    def frozen(self):
        return patch.object(svc, "datetime", FrozenTaipeiMorning), \
            patch("app.utils.datetime_helpers.datetime", FrozenTaipeiMorning)

    async def test_dm_summary(self, async_session, ledger, sent):
        a, b = self.frozen()
        send = AsyncMock()
        with a, b, patch.object(svc, "_log_activity", new=AsyncMock()), patch.object(svc, "_send", new=send):
            await svc.handle_dm_summary_command(async_session, "Ualice", RT)
        assert sent == [], sent  # not the "no expenses" text reply
        image, card = send.await_args.args[1]
        text = card["altText"] + json.dumps(card["contents"], ensure_ascii=False)
        assert image["type"] == "image"
        assert "November 2026" in text and "250" in text and "999" not in text

    async def test_dm_balance(self, async_session, ledger, sent):
        a, b = self.frozen()
        with a, b, patch.object(svc, "_log_activity", new=AsyncMock()):
            await svc.handle_dm_balance_command(async_session, "Ualice", RT)
        text = sent[0][0] + sent[0][1]
        assert "November 2026" in text and "250" in text and "999" not in text
