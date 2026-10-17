"""handle_event / handle_postback_event dispatch, with every handler stubbed."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.modules.line_bot import service as svc
from app.modules.line_bot.schemas import LineEvent

pytestmark = pytest.mark.unit

U, G = "Uuser", "Cgroup"
DB = MagicMock()

HANDLERS = [
    "handle_join_event", "handle_follow_event", "handle_member_joined_event",
    "handle_link_command", "handle_help_command", "handle_history_command",
    "handle_balance_command", "handle_dm_balance_command", "handle_summary_command",
    "handle_dm_summary_command", "handle_add_command", "handle_settle_command",
    "handle_undo_command", "handle_txn_command", "handle_goals_command",
    "handle_portfolio_command", "handle_rate_command", "handle_add_expense_start",
    "handle_add_expense_amount_selected", "handle_add_expense_confirm",
    "handle_txn_start", "handle_txn_category_selected", "handle_txn_amount_selected",
    "handle_txn_confirm", "_reply", "_reply_flex", "_ensure_group_membership_if_linked",
    "_get_link_safe", "_get_user_currency",
]


@pytest.fixture
def h():
    """Every collaborator replaced by an AsyncMock, keyed by name."""
    patches = {n: patch.object(svc, n, new=AsyncMock()) for n in HANDLERS}
    mocks = {n: p.start() for n, p in patches.items()}
    mocks["_get_link_safe"].return_value = SimpleNamespace(user_id=uuid4())
    mocks["_get_user_currency"].return_value = "JPY"
    yield SimpleNamespace(**mocks)
    for p in patches.values():
        p.stop()


def source(group=False):
    return {"type": "group", "userId": U, "groupId": G} if group else {"type": "user", "userId": U}


def msg(text, group=False, reply="rt"):
    return LineEvent(type="message", replyToken=reply, source=source(group), timestamp=1,
                     message={"id": "1", "type": "text", "text": text})


def pb(data, group=False, reply="rt"):
    return LineEvent(type="postback", replyToken=reply, source=source(group), timestamp=1,
                     postback={"data": data})


@pytest.mark.asyncio
class TestNonMessageEvents:
    @pytest.mark.parametrize("etype,handler,args", [
        ("join", "handle_join_event", 1), ("follow", "handle_follow_event", 2),
        ("memberJoined", "handle_member_joined_event", 1),
    ])
    async def test_lifecycle_events(self, h, etype, handler, args):
        ev = LineEvent(type=etype, source=source(True), timestamp=1)
        await svc.handle_event(DB, ev)
        assert getattr(h, handler).await_count == 1

    async def test_postback_is_delegated(self, h):
        with patch.object(svc, "handle_postback_event", new=AsyncMock()) as p:
            await svc.handle_event(DB, pb("cmd=help"))
        p.assert_awaited_once()

    async def test_unfollow_drops_link_tokens(self, h):
        repo = MagicMock(delete_tokens_by_line_user_id=AsyncMock())
        with patch.object(svc, "LineAccountRepository", return_value=repo):
            await svc.handle_event(DB, LineEvent(type="unfollow", source=source(), timestamp=1))
        repo.delete_tokens_by_line_user_id.assert_awaited_once_with(U)

    async def test_unfollow_without_user_id_is_a_noop(self, h):
        with patch.object(svc, "LineAccountRepository") as r:
            await svc.handle_event(DB, LineEvent(type="unfollow", source={"type": "user"}, timestamp=1))
        r.assert_not_called()

    async def test_leave_deletes_group_and_members(self, h):
        group = SimpleNamespace(id=uuid4())
        repo = MagicMock(
            get_group_by_line_group_id=AsyncMock(return_value=group),
            delete_members_by_group=AsyncMock(), delete_group=AsyncMock())
        with patch.object(svc, "LineGroupRepository", return_value=repo):
            await svc.handle_event(DB, LineEvent(type="leave", source=source(True), timestamp=1))
        repo.delete_members_by_group.assert_awaited_once_with(group.id)
        repo.delete_group.assert_awaited_once_with(group)

    async def test_leave_unknown_group_deletes_nothing(self, h):
        repo = MagicMock(get_group_by_line_group_id=AsyncMock(return_value=None), delete_group=AsyncMock())
        with patch.object(svc, "LineGroupRepository", return_value=repo):
            await svc.handle_event(DB, LineEvent(type="leave", source=source(True), timestamp=1))
        repo.delete_group.assert_not_awaited()

    async def test_member_left_removes_only_linked_members(self, h):
        group, uid = SimpleNamespace(id=uuid4()), uuid4()
        grepo = MagicMock(get_group_by_line_group_id=AsyncMock(return_value=group),
                          delete_members_by_group_and_users=AsyncMock())
        arepo = MagicMock(get_links_by_line_user_ids=AsyncMock(return_value=[SimpleNamespace(user_id=uid)]))
        ev = LineEvent(type="memberLeft", source=source(True), timestamp=1,
                       left={"members": [{"userId": "Ugone"}, {"type": "user"}]})
        with patch.object(svc, "LineGroupRepository", return_value=grepo), \
             patch.object(svc, "LineAccountRepository", return_value=arepo):
            await svc.handle_event(DB, ev)
        arepo.get_links_by_line_user_ids.assert_awaited_once_with(["Ugone"])
        grepo.delete_members_by_group_and_users.assert_awaited_once_with(group.id, [uid])

    async def test_member_left_with_nobody_linked_deletes_nothing(self, h):
        grepo = MagicMock(get_group_by_line_group_id=AsyncMock(return_value=SimpleNamespace(id=1)),
                          delete_members_by_group_and_users=AsyncMock())
        arepo = MagicMock(get_links_by_line_user_ids=AsyncMock(return_value=[]))
        ev = LineEvent(type="memberLeft", source=source(True), timestamp=1, left={"members": [{"userId": "U1"}]})
        with patch.object(svc, "LineGroupRepository", return_value=grepo), \
             patch.object(svc, "LineAccountRepository", return_value=arepo):
            await svc.handle_event(DB, ev)
        grepo.delete_members_by_group_and_users.assert_not_awaited()

    async def test_unknown_event_type_is_ignored(self, h):
        await svc.handle_event(DB, LineEvent(type="beacon", source=source(), timestamp=1))
        h._reply.assert_not_awaited()


@pytest.mark.asyncio
class TestTextDispatch:
    @pytest.mark.parametrize("ev", [
        LineEvent(type="message", source={"type": "user", "userId": U}, timestamp=1,
                  message={"id": "1", "type": "text", "text": "/help"}),  # no reply token
        LineEvent(type="message", replyToken="rt", source={"type": "user"}, timestamp=1,
                  message={"id": "1", "type": "text", "text": "/help"}),  # no user id
        LineEvent(type="message", replyToken="rt", source={"type": "user", "userId": U}, timestamp=1,
                  message={"id": "1", "type": "sticker"}),
        LineEvent(type="message", replyToken="rt", source={"type": "user", "userId": U}, timestamp=1),
    ])
    async def test_unactionable_messages_are_dropped(self, h, ev):
        await svc.handle_event(DB, ev)
        for name in HANDLERS:
            if name.startswith("handle_") and name not in ("handle_join_event",):
                assert not getattr(h, name).await_count

    @pytest.mark.parametrize("text,handler", [
        ("/link", "handle_link_command"), ("/help", "handle_help_command"),
        ("/history", "handle_history_command"), ("/rate", "handle_rate_command"),
        ("/TXN 5 food x", "handle_txn_command"), ("/goals", "handle_goals_command"),
        ("/portfolio", "handle_portfolio_command"),
        ("/balance", "handle_dm_balance_command"), ("/summary", "handle_dm_summary_command"),
    ])
    async def test_dm_commands(self, h, text, handler):
        await svc.handle_event(DB, msg(text))
        assert getattr(h, handler).await_count == 1
        h._ensure_group_membership_if_linked.assert_not_awaited()

    @pytest.mark.parametrize("text,handler", [
        ("/add 10 lunch", "handle_add_command"), ("/settle @bob", "handle_settle_command"),
        ("/undo", "handle_undo_command"), ("/balance", "handle_balance_command"),
        ("/summary", "handle_summary_command"), ("/history", "handle_history_command"),
    ])
    async def test_group_commands_also_register_membership(self, h, text, handler):
        await svc.handle_event(DB, msg(text, group=True))
        assert getattr(h, handler).await_count == 1
        h._ensure_group_membership_if_linked.assert_awaited_once_with(DB, G, U)

    @pytest.mark.parametrize("text", ["/add 10 x", "/settle @b", "/undo"])
    async def test_group_only_commands_in_dm_explain_themselves(self, h, text):
        await svc.handle_event(DB, msg(text))
        h._reply.assert_awaited_once()
        assert "group" in h._reply.await_args.args[1].lower()

    @pytest.mark.parametrize("text", ["/txn 5 food x", "/goals", "/portfolio"])
    async def test_personal_commands_never_run_in_a_group(self, h, text):
        await svc.handle_event(DB, msg(text, group=True))
        h._reply_flex.assert_awaited_once()
        for name in ("handle_txn_command", "handle_goals_command", "handle_portfolio_command"):
            assert not getattr(h, name).await_count

    @pytest.mark.parametrize("text", ["/menu", "/start"])
    async def test_menu_commands(self, h, text):
        await svc.handle_event(DB, msg(text))
        assert h._reply_flex.await_args.args[1] == "Aspiro Menu"
        await svc.handle_event(DB, msg(text, group=True))
        assert h._reply_flex.await_args.args[1] == "Group Expense Menu"

    async def test_chatter_gets_menu_in_dm_but_silence_in_group(self, h):
        await svc.handle_event(DB, msg("hello there"))
        assert h._reply_flex.await_count == 1
        await svc.handle_event(DB, msg("hello there", group=True))
        assert h._reply_flex.await_count == 1

    async def test_unknown_slash_command_is_silent(self, h):
        await svc.handle_event(DB, msg("/nonsense"))
        h._reply_flex.assert_not_awaited()
        h._reply.assert_not_awaited()


@pytest.mark.asyncio
class TestPostbackDispatch:
    @pytest.mark.parametrize("ev", [
        LineEvent(type="postback", source={"type": "user", "userId": U}, timestamp=1, postback={"data": "cmd=help"}),
        LineEvent(type="postback", replyToken="rt", source={"type": "user", "userId": U}, timestamp=1),
        LineEvent(type="postback", replyToken="rt", source={"type": "user"}, timestamp=1, postback={"data": "cmd=help"}),
    ])
    async def test_incomplete_postbacks_are_dropped(self, h, ev):
        await svc.handle_postback_event(DB, ev)
        h.handle_help_command.assert_not_awaited()

    @pytest.mark.parametrize("data,handler", [
        ("cmd=balance", "handle_dm_balance_command"), ("cmd=summary", "handle_dm_summary_command"),
        ("cmd=history", "handle_history_command"), ("cmd=goals", "handle_goals_command"),
        ("cmd=portfolio", "handle_portfolio_command"), ("cmd=rate", "handle_rate_command"),
        ("cmd=link", "handle_link_command"), ("cmd=help", "handle_help_command"),
        ("cmd=add_start", "handle_add_expense_start"), ("cmd=txn_start", "handle_txn_start"),
        ("cmd=add_amount&v=100", "handle_add_expense_amount_selected"),
        ("cmd=add_confirm&a=100&d=tea", "handle_add_expense_confirm"),
        ("cmd=txn_amount&c=food&v=50", "handle_txn_amount_selected"),
        ("cmd=txn_confirm&c=food&v=50&d=tea", "handle_txn_confirm"),
    ])
    async def test_dm_routes(self, h, data, handler):
        await svc.handle_postback_event(DB, pb(data))
        assert getattr(h, handler).await_count == 1

    async def test_params_reach_the_handler(self, h):
        await svc.handle_postback_event(DB, pb("cmd=add_confirm&a=100&d=tea"))
        assert h.handle_add_expense_confirm.await_args.args[-2:] == ("100", "tea")
        await svc.handle_postback_event(DB, pb("cmd=add_confirm"))
        assert h.handle_add_expense_confirm.await_args.args[-2:] == ("", "expense")

    async def test_category_pick_uses_the_users_currency(self, h):
        await svc.handle_postback_event(DB, pb("cmd=txn_cat&c=food"))
        h.handle_txn_category_selected.assert_awaited_once_with("rt", "food", "JPY")

    async def test_category_pick_defaults_to_twd_when_unlinked(self, h):
        h._get_link_safe.return_value = None
        await svc.handle_postback_event(DB, pb("cmd=txn_cat"))
        h.handle_txn_category_selected.assert_awaited_once_with("rt", "other", "TWD")

    @pytest.mark.parametrize("cmd", ["goals", "portfolio", "txn_start", "txn_cat", "txn_amount", "txn_confirm"])
    async def test_personal_postbacks_are_blocked_in_groups(self, h, cmd):
        await svc.handle_postback_event(DB, pb(f"cmd={cmd}", group=True))
        assert "personal" in h._reply.await_args.args[1]
        for name in ("handle_goals_command", "handle_portfolio_command", "handle_txn_start",
                     "handle_txn_category_selected", "handle_txn_amount_selected", "handle_txn_confirm"):
            assert not getattr(h, name).await_count

    @pytest.mark.parametrize("cmd,handler", [
        ("balance", "handle_balance_command"), ("summary", "handle_summary_command"),
        ("undo", "handle_undo_command"), ("settle_start", "handle_balance_command"),
    ])
    async def test_group_routes(self, h, cmd, handler):
        await svc.handle_postback_event(DB, pb(f"cmd={cmd}", group=True))
        assert getattr(h, handler).await_count == 1
        h._ensure_group_membership_if_linked.assert_awaited_once()

    @pytest.mark.parametrize("cmd", ["undo", "settle_start"])
    async def test_group_only_postbacks_in_dm(self, h, cmd):
        await svc.handle_postback_event(DB, pb(f"cmd={cmd}"))
        assert "group chats" in h._reply.await_args.args[1]

    async def test_menu_and_unknown(self, h):
        await svc.handle_postback_event(DB, pb("cmd=menu"))
        assert h._reply_flex.await_args.args[1] == "Aspiro Menu"
        await svc.handle_postback_event(DB, pb("cmd=zzz&junk"))
        assert h._reply_flex.await_count == 1
