"""LINE bot: what unlink must clean up, who may read a group, and the guard
replies of /add and /settle. Outgoing LINE calls are captured, never sent.

LineGroupMember.line_user_id is a plain string, not a foreign key, so nothing
cascades: unlink has to delete the memberships and pending link tokens
itself, or a re-link with another LINE account inherits stale ids that break
/balance and /settle.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select

from app.modules.line_bot import service as svc
from app.modules.line_bot.models import (
    ExpenseSplit,
    LineGroup,
    LineGroupMember,
    LineLinkToken,
    LineUserLink,
)
from tests.test_line_bot_commands import G, RT, alice, bob, expense, group, make_user, sent  # noqa: F401

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def count(session, model, **where):
    stmt = select(func.count()).select_from(model)
    for col, val in where.items():
        stmt = stmt.where(getattr(model, col) == val)
    return (await session.execute(stmt)).scalar()


@pytest_asyncio.fixture
async def carol(async_session):
    u = make_user()
    async_session.add_all([u, LineUserLink(line_user_id="Ucarol", user_id=u.id, display_name="Carol")])
    await async_session.flush()
    return u


class TestUnlink:
    async def test_removes_the_link_memberships_and_tokens_but_nobody_elses(self, async_session, group, alice, bob):
        expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        async_session.add_all([
            LineLinkToken(token=uuid.uuid4(), line_user_id="Ualice", expires_at=expires),
            LineLinkToken(token=uuid.uuid4(), line_user_id="Ubob", expires_at=expires),
        ])
        await async_session.flush()

        await svc.unlink(async_session, alice.id)

        assert await count(async_session, LineUserLink, user_id=alice.id) == 0
        assert await count(async_session, LineGroupMember, user_id=alice.id) == 0
        assert await count(async_session, LineLinkToken, line_user_id="Ualice") == 0
        # Bob is untouched.
        assert await count(async_session, LineUserLink, user_id=bob.id) == 1
        assert await count(async_session, LineGroupMember, user_id=bob.id) == 1
        assert await count(async_session, LineLinkToken, line_user_id="Ubob") == 1

    async def test_clears_memberships_even_without_a_link(self, async_session, group, alice):
        # A membership can outlive its link (the bug this guards against).
        await async_session.execute(LineUserLink.__table__.delete().where(LineUserLink.user_id == alice.id))
        await svc.unlink(async_session, alice.id)
        assert await count(async_session, LineGroupMember, user_id=alice.id) == 0


class TestGroupAccess:
    async def test_members_pass_and_outsiders_get_403(self, async_session, group, alice, carol):
        await svc.assert_group_member(async_session, group.id, alice.id)
        with pytest.raises(HTTPException) as exc:
            await svc.assert_group_member(async_session, group.id, carol.id)
        assert exc.value.status_code == 403


class TestAddGuards:
    async def test_not_linked(self, async_session, sent):
        await svc.handle_add_command(async_session, "/add 100 x", "Unobody", G, RT)
        assert sent[0][0] == "Link your Aspiro account"

    async def test_bad_syntax_shows_usage(self, async_session, alice, sent):
        await svc.handle_add_command(async_session, "/add coffee", "Ualice", G, RT)
        assert sent[0][0].startswith("Usage: /add")

    async def test_rejects_an_amount_the_column_cannot_hold(self, async_session, group, sent):
        await svc.handle_add_command(async_session, "/add 100000000 yacht", "Ualice", G, RT)
        assert "under 100,000,000" in sent[0][0]

    async def test_needs_a_second_member(self, async_session, alice, sent):
        await svc.handle_add_command(async_session, "/add 100 x", "Ualice", "Cempty", RT)
        assert sent[0][0].startswith("Only you are set up")
        # The sender was still registered in the new group.
        g = (await async_session.execute(select(LineGroup).where(LineGroup.line_group_id == "Cempty"))).scalar_one()
        assert await count(async_session, LineGroupMember, group_id=g.id) == 1

    async def test_unknown_payer(self, async_session, group, sent):
        await svc.handle_add_command(async_session, "/add 100 x paid:@zed", "Ualice", G, RT)
        assert sent[0][0] == "@zed is not linked in this group."

    async def test_ratios_fall_back_to_an_equal_split_beyond_two_members(self, async_session, group, carol, sent):
        async_session.add(LineGroupMember(group_id=group.id, user_id=carol.id, line_user_id="Ucarol"))
        await async_session.flush()
        await svc.handle_add_command(async_session, "/add 100 x 60:40", "Ualice", G, RT)

        assert sent[0][0].startswith("Custom ratios only work in 2-person groups")
        splits = (await async_session.execute(select(ExpenseSplit))).scalars().all()
        assert len(splits) == 3
        # 100 / 3 does not divide evenly; the shares must still add back to 100.
        assert sum(s.amount for s in splits) == 100


class TestSettle:
    async def test_settles_what_the_sender_owes(self, async_session, group, alice, bob, sent):
        await expense(async_session, group, bob, "100", "dinner", owed_by=[alice])
        await svc.handle_settle_command(async_session, "/settle @Bob", "Ualice", G, RT)

        assert sent[0][0] == "Settled TWD 50 with @Bob"
        assert await count(async_session, ExpenseSplit, settled=False) == 0

        sent.clear()
        await svc.handle_settle_command(async_session, "/settle @Bob", "Ualice", G, RT)
        assert sent[0][0] == "No outstanding balance with @Bob."

    @pytest.mark.parametrize(
        "text,line_user,group_id,expected",
        [
            ("/settle @Bob", "Unobody", G, "Link your Aspiro account"),
            ("/settle Bob", "Ualice", G, "Usage: /settle @name"),
            ("/settle @Bob 20", "Ualice", G, "Partial settle is not yet supported."),
            ("/settle @Bob", "Ualice", "Cnone", "No expenses in this group yet."),
            ("/settle @Zed", "Ualice", G, "Could not find @Zed in this group."),
            ("/settle @Alice", "Ualice", G, "You can't settle a debt with yourself."),
        ],
    )
    async def test_guard_replies(self, async_session, group, sent, text, line_user, group_id, expected):
        await svc.handle_settle_command(async_session, text, line_user, group_id, RT)
        assert sent[0][0].startswith(expected)
