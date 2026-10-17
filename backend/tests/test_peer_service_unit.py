"""
Unit tests for PeerService.

Tests use AsyncMock/MagicMock so no real database or network is required.
The session.execute() return value is always a MagicMock whose chained
attribute accesses (.scalars().first(), .mappings().first(), .scalar_one(),
.all(), .first()) are configured per-test to simulate DB responses.

Covered behaviours
------------------
1.  search_user  — returns None when username not found
2.  search_user  — returns UserSearchResult when user exists
3.  send_invite  — raises 404 when receiver username is not in the DB
4.  send_invite  — raises 400 when requester already has 2 accepted peers
5.  send_invite  — raises 409 on duplicate pending/accepted pair
6.  send_invite  — happy path inserts connection + notification, then commits
7.  respond_to_invite — raises 404 when connection is not found / not pending
8.  respond_to_invite — accept sets status=ACCEPTED and commits
9.  respond_to_invite — decline sets status=DECLINED and commits
10. remove_connection — raises 404 when connection not found
11. remove_connection — sets status=REMOVED and commits
12. create_goal  — raises 404 when connection not found
13. create_goal  — raises 400 when goal cap (10) reached
14. update_contribution — auto-sets status to completed when total >= target
15. update_contribution — does NOT complete goal when total < target
16. delete_goal  — raises 404 when goal not found
17. delete_goal  — raises 403 when caller is not the creator
18. delete_goal  — happy path calls session.delete() and commit
19. _goal_to_out — your_/peer_ amounts are correct when caller is requester
20. _goal_to_out — your_/peer_ amounts are swapped when caller is receiver
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.modules.peers.models import GoalStatus, PeerStatus
from app.modules.peers.service import PeerService


# ---------------------------------------------------------------------------
# Session factory helpers
# ---------------------------------------------------------------------------

def _make_session() -> MagicMock:
    """Return a MagicMock that satisfies the AsyncSession interface."""
    s = MagicMock()
    s.execute = AsyncMock()
    s.add = MagicMock()
    s.flush = AsyncMock()
    s.commit = AsyncMock()
    s.refresh = AsyncMock()
    s.delete = AsyncMock()
    return s


def _scalars_first(obj) -> MagicMock:
    """Build an execute() return value for .scalars().first() -> obj."""
    r = MagicMock()
    r.scalars.return_value.first.return_value = obj
    return r


def _mappings_first(mapping: dict | None) -> MagicMock:
    """Build an execute() return value for .mappings().first() -> mapping."""
    r = MagicMock()
    if mapping is None:
        r.mappings.return_value.first.return_value = None
    else:
        m = MagicMock()
        m.__getitem__ = lambda self, k: mapping[k]
        m.keys.return_value = mapping.keys()
        # Make dict(row) work by supporting iteration of keys
        r.mappings.return_value.first.return_value = mapping
    return r


def _scalar_one(value) -> MagicMock:
    """Build an execute() return value for .scalar_one() -> value."""
    r = MagicMock()
    r.scalar_one.return_value = value
    return r


def _scalars_all(objs: list) -> MagicMock:
    """Build an execute() return value for .scalars().all() -> list."""
    r = MagicMock()
    r.scalars.return_value.all.return_value = objs
    return r


def _rows_all(rows: list) -> MagicMock:
    """Build an execute() return value for .all() -> list (tuple rows)."""
    r = MagicMock()
    r.all.return_value = rows
    return r


def _rows_first(row) -> MagicMock:
    """Build an execute() return value for .first() -> row."""
    r = MagicMock()
    r.first.return_value = row
    return r


def _mappings_all(rows: list[dict]) -> MagicMock:
    """Build an execute() return value for .mappings().all() -> list."""
    r = MagicMock()
    r.mappings.return_value.all.return_value = rows
    return r


# ---------------------------------------------------------------------------
# ORM object factories
# ---------------------------------------------------------------------------

def _make_user(
    user_id: uuid.UUID | None = None,
    username: str = "alice",
    name: str = "Alice",
    deleted_at=None,
) -> MagicMock:
    u = MagicMock()
    u.id = user_id or uuid.uuid4()
    u.username = username
    u.name = name
    u.avatar_url = None
    u.deleted_at = deleted_at
    return u


def _make_connection(
    conn_id: uuid.UUID | None = None,
    requester_id: uuid.UUID | None = None,
    receiver_id: uuid.UUID | None = None,
    status: PeerStatus = PeerStatus.PENDING,
) -> MagicMock:
    c = MagicMock()
    c.id = conn_id or uuid.uuid4()
    c.requester_id = requester_id or uuid.uuid4()
    c.receiver_id = receiver_id or uuid.uuid4()
    c.status = status
    c.created_at = datetime.now(timezone.utc)
    return c


def _make_goal(
    goal_id: uuid.UUID | None = None,
    connection_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
    status: GoalStatus = GoalStatus.active,
    target_amount: Decimal = Decimal("10000"),
    requester_amount: Decimal = Decimal("0"),
    receiver_amount: Decimal = Decimal("0"),
    target_date=None,
) -> MagicMock:
    g = MagicMock()
    g.id = goal_id or uuid.uuid4()
    g.connection_id = connection_id or uuid.uuid4()
    g.title = "Emergency Fund"
    g.target_amount = target_amount
    g.target_date = target_date
    g.created_by = created_by or uuid.uuid4()
    g.status = status
    g.requester_amount = requester_amount
    g.receiver_amount = receiver_amount
    g.created_at = datetime.now(timezone.utc)
    g.updated_at = datetime.now(timezone.utc)
    return g


# ===========================================================================
# 1–2. search_user
# ===========================================================================

class TestSearchUser:

    @pytest.mark.asyncio
    async def test_returns_none_when_user_not_found(self):
        session = _make_session()
        session.execute.return_value = _mappings_first(None)

        result = await PeerService(session).search_user("ghost", uuid.uuid4())

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_user_search_result_when_found(self):
        uid = uuid.uuid4()
        row = {"id": uid, "username": "alice", "name": "Alice", "avatar_url": None}
        session = _make_session()
        session.execute.return_value = _mappings_first(row)

        result = await PeerService(session).search_user("alice", uuid.uuid4())

        assert result is not None
        assert result.id == uid
        assert result.username == "alice"
        assert result.name == "Alice"


# ===========================================================================
# 3–6. send_invite
# ===========================================================================

class TestSendInvite:

    @pytest.mark.asyncio
    async def test_raises_404_when_receiver_not_found(self):
        session = _make_session()
        # First execute: find receiver by username → None
        session.execute.return_value = _scalars_first(None)

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).send_invite(uuid.uuid4(), "nobody")

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_raises_400_when_requester_has_2_accepted_peers(self):
        requester_id = uuid.uuid4()
        receiver = _make_user(username="bob")

        session = _make_session()
        # Call order:
        #   execute[0]: find receiver → receiver object
        #   execute[1]: _count_accepted → 2  (via scalar_one)
        session.execute.side_effect = [
            _scalars_first(receiver),
            _scalar_one(2),
        ]

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).send_invite(requester_id, "bob")

        assert exc_info.value.status_code == 400
        assert "maximum" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_raises_409_on_duplicate_pending_accepted_pair(self):
        requester_id = uuid.uuid4()
        receiver = _make_user(username="carol")
        existing_conn = _make_connection(status=PeerStatus.PENDING)

        session = _make_session()
        # Call order:
        #   execute[0]: find receiver → receiver object
        #   execute[1]: _count_accepted → 0
        #   execute[2]: check existing pair → existing connection
        session.execute.side_effect = [
            _scalars_first(receiver),
            _scalar_one(0),
            _scalars_first(existing_conn),
            _scalars_first(None),  # requester lookup (runs before the 409 check)
        ]

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).send_invite(requester_id, "carol")

        assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_happy_path_adds_connection_and_commits(self):
        requester_id = uuid.uuid4()
        receiver = _make_user(username="dave")
        requester = _make_user(user_id=requester_id, username="me")

        session = _make_session()
        # Call order:
        #   execute[0]: find receiver → receiver
        #   execute[1]: _count_accepted → 0
        #   execute[2]: check existing pair → None
        #   execute[3]: find requester → requester
        session.execute.side_effect = [
            _scalars_first(receiver),
            _scalar_one(0),
            _scalars_first(None),
            _scalars_first(requester),
        ]

        from app.modules.peers.models import PeerConnection
        from app.modules.notifications.models import Notification

        result = await PeerService(session).send_invite(requester_id, "dave")

        # Two objects should have been added: PeerConnection + Notification
        added = [call.args[0] for call in session.add.call_args_list]
        conn_objects = [o for o in added if isinstance(o, PeerConnection)]
        notif_objects = [o for o in added if isinstance(o, Notification)]

        assert len(conn_objects) == 1, "Expected exactly one PeerConnection to be added"
        assert len(notif_objects) == 1, "Expected exactly one Notification to be added"
        assert conn_objects[0].requester_id == requester_id
        assert conn_objects[0].receiver_id == receiver.id
        assert conn_objects[0].status == PeerStatus.PENDING
        session.commit.assert_called_once()


# ===========================================================================
# 7–9. respond_to_invite
# ===========================================================================

class TestRespondToInvite:

    @pytest.mark.asyncio
    async def test_raises_404_when_pending_connection_not_found(self):
        session = _make_session()
        session.execute.return_value = _scalars_first(None)

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).respond_to_invite(
                uuid.uuid4(), uuid.uuid4(), "accept"
            )

        assert exc_info.value.status_code == 404
        assert "pending" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_accept_sets_status_to_accepted(self):
        user_id = uuid.uuid4()
        conn = _make_connection(receiver_id=user_id, status=PeerStatus.PENDING)

        session = _make_session()
        # execute[0]: find pending connection → conn
        # execute[1]: _count_accepted → 0  (receiver check)
        session.execute.side_effect = [
            _scalars_first(conn),
            _scalar_one(0),
        ]

        await PeerService(session).respond_to_invite(conn.id, user_id, "accept")

        assert conn.status == PeerStatus.ACCEPTED
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_decline_sets_status_to_declined(self):
        user_id = uuid.uuid4()
        conn = _make_connection(receiver_id=user_id, status=PeerStatus.PENDING)

        session = _make_session()
        session.execute.return_value = _scalars_first(conn)

        await PeerService(session).respond_to_invite(conn.id, user_id, "decline")

        assert conn.status == PeerStatus.DECLINED
        session.commit.assert_called_once()


# ===========================================================================
# 10–11. remove_connection
# ===========================================================================

class TestRemoveConnection:

    @pytest.mark.asyncio
    async def test_raises_404_when_connection_not_found(self):
        session = _make_session()
        session.execute.return_value = _scalars_first(None)

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).remove_connection(uuid.uuid4(), uuid.uuid4())

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_sets_status_to_removed_and_commits(self):
        user_id = uuid.uuid4()
        conn = _make_connection(requester_id=user_id, status=PeerStatus.ACCEPTED)

        session = _make_session()
        session.execute.return_value = _scalars_first(conn)

        await PeerService(session).remove_connection(conn.id, user_id)

        assert conn.status == PeerStatus.REMOVED
        session.commit.assert_called_once()


# ===========================================================================
# 12–13. create_goal
# ===========================================================================

class TestCreateGoal:

    def _goal_create_data(self, connection_id: uuid.UUID):
        from app.modules.peers.schemas import SharedGoalCreate
        return SharedGoalCreate(
            connection_id=connection_id,
            title="Holiday Fund",
            target_amount=Decimal("5000"),
            target_date=date(2027, 12, 31),
        )

    @pytest.mark.asyncio
    async def test_raises_404_when_connection_not_found(self):
        user_id = uuid.uuid4()
        conn_id = uuid.uuid4()

        session = _make_session()
        # _get_participant_connection → execute returns None
        session.execute.return_value = _scalars_first(None)

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).create_goal(
                user_id, self._goal_create_data(conn_id)
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_raises_400_when_goal_cap_reached(self):
        user_id = uuid.uuid4()
        conn_id = uuid.uuid4()
        conn = _make_connection(
            conn_id=conn_id,
            requester_id=user_id,
            status=PeerStatus.ACCEPTED,
        )

        session = _make_session()
        # execute[0]: _get_participant_connection → accepted conn
        # execute[1]: count goals → 10  (cap reached)
        session.execute.side_effect = [
            _scalars_first(conn),
            _scalar_one(10),
        ]

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).create_goal(
                user_id, self._goal_create_data(conn_id)
            )

        assert exc_info.value.status_code == 400
        assert "maximum" in exc_info.value.detail.lower()


# ===========================================================================
# 14–15. update_contribution
# ===========================================================================

class TestUpdateContribution:

    @pytest.mark.asyncio
    async def test_auto_completes_goal_when_total_meets_target(self):
        user_id = uuid.uuid4()
        conn_id = uuid.uuid4()
        goal_id = uuid.uuid4()

        conn = _make_connection(
            conn_id=conn_id,
            requester_id=user_id,
            status=PeerStatus.ACCEPTED,
        )
        goal = _make_goal(
            goal_id=goal_id,
            connection_id=conn_id,
            target_amount=Decimal("10000"),
            requester_amount=Decimal("0"),
            receiver_amount=Decimal("5000"),
            status=GoalStatus.active,
        )

        session = _make_session()
        # _get_goal_and_connection: execute[0] returns (goal, conn) row
        row = MagicMock()
        row.__getitem__ = lambda self, i: (goal, conn)[i]
        first_result = MagicMock()
        first_result.first.return_value = row

        # _fetch_users_by_id: execute[1] returns empty mapping
        users_result = _mappings_all([])

        session.execute.side_effect = [first_result, users_result]

        # Requester contributes 5000 — total becomes 10000 >= 10000
        await PeerService(session).update_contribution(
            user_id, goal_id, Decimal("5000")
        )

        assert goal.status == GoalStatus.completed
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_does_not_complete_goal_when_total_below_target(self):
        user_id = uuid.uuid4()
        conn_id = uuid.uuid4()
        goal_id = uuid.uuid4()

        conn = _make_connection(
            conn_id=conn_id,
            requester_id=user_id,
            status=PeerStatus.ACCEPTED,
        )
        goal = _make_goal(
            goal_id=goal_id,
            connection_id=conn_id,
            target_amount=Decimal("10000"),
            requester_amount=Decimal("0"),
            receiver_amount=Decimal("1000"),
            status=GoalStatus.active,
        )

        session = _make_session()
        row = MagicMock()
        row.__getitem__ = lambda self, i: (goal, conn)[i]
        first_result = MagicMock()
        first_result.first.return_value = row

        users_result = _mappings_all([])

        session.execute.side_effect = [first_result, users_result]

        # Requester contributes 2000 — total becomes 3000 < 10000
        await PeerService(session).update_contribution(
            user_id, goal_id, Decimal("2000")
        )

        assert goal.status == GoalStatus.active
        session.commit.assert_called_once()


# ===========================================================================
# 16–18. delete_goal
# ===========================================================================

class TestDeleteGoal:

    @pytest.mark.asyncio
    async def test_raises_404_when_goal_not_found(self):
        session = _make_session()
        session.execute.return_value = _scalars_first(None)

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).delete_goal(uuid.uuid4(), uuid.uuid4())

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_raises_403_when_caller_is_not_creator(self):
        caller_id = uuid.uuid4()
        creator_id = uuid.uuid4()  # different from caller
        goal = _make_goal(created_by=creator_id)

        session = _make_session()
        session.execute.return_value = _scalars_first(goal)

        with pytest.raises(HTTPException) as exc_info:
            await PeerService(session).delete_goal(caller_id, goal.id)

        assert exc_info.value.status_code == 403
        assert "creator" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_happy_path_deletes_goal_and_commits(self):
        user_id = uuid.uuid4()
        goal = _make_goal(created_by=user_id)

        session = _make_session()
        session.execute.return_value = _scalars_first(goal)

        await PeerService(session).delete_goal(user_id, goal.id)

        session.delete.assert_called_once_with(goal)
        session.commit.assert_called_once()


# ===========================================================================
# 19–20. _goal_to_out  (perspective / side-switching)
# ===========================================================================

class TestGoalToOut:
    """_goal_to_out must correctly assign your_/peer_ amounts based on side."""

    def _build_goal_and_conn(
        self,
        requester_id: uuid.UUID,
        receiver_id: uuid.UUID,
        requester_amount: Decimal,
        receiver_amount: Decimal,
        target_amount: Decimal = Decimal("10000"),
    ):
        conn_id = uuid.uuid4()
        conn = _make_connection(
            conn_id=conn_id,
            requester_id=requester_id,
            receiver_id=receiver_id,
            status=PeerStatus.ACCEPTED,
        )
        goal = _make_goal(
            connection_id=conn_id,
            created_by=requester_id,
            target_amount=target_amount,
            requester_amount=requester_amount,
            receiver_amount=receiver_amount,
        )
        return goal, conn

    def _users_by_id(
        self,
        requester_id: uuid.UUID,
        receiver_id: uuid.UUID,
    ) -> dict:
        return {
            requester_id: {"id": requester_id, "name": "Requester"},
            receiver_id: {"id": receiver_id, "name": "Receiver"},
        }

    def test_requester_sees_correct_your_and_peer_amounts(self):
        requester_id = uuid.uuid4()
        receiver_id = uuid.uuid4()

        goal, conn = self._build_goal_and_conn(
            requester_id=requester_id,
            receiver_id=receiver_id,
            requester_amount=Decimal("3000"),
            receiver_amount=Decimal("1500"),
        )
        users_by_id = self._users_by_id(requester_id, receiver_id)
        session = _make_session()
        svc = PeerService(session)

        out = svc._goal_to_out(goal, conn, requester_id, users_by_id)

        # Requester looks at goal: "your" = requester_amount, "peer" = receiver_amount
        assert out.your_amount == float(Decimal("3000"))
        assert out.peer_amount == float(Decimal("1500"))
        assert out.your_user_id == str(requester_id)
        assert out.peer_user_id == str(receiver_id)
        assert out.your_name == "Requester"
        assert out.peer_name == "Receiver"
        assert out.is_creator is True

    def test_receiver_sees_swapped_your_and_peer_amounts(self):
        requester_id = uuid.uuid4()
        receiver_id = uuid.uuid4()

        goal, conn = self._build_goal_and_conn(
            requester_id=requester_id,
            receiver_id=receiver_id,
            requester_amount=Decimal("3000"),
            receiver_amount=Decimal("1500"),
        )
        users_by_id = self._users_by_id(requester_id, receiver_id)
        session = _make_session()
        svc = PeerService(session)

        out = svc._goal_to_out(goal, conn, receiver_id, users_by_id)

        # Receiver looks at goal: "your" = receiver_amount, "peer" = requester_amount
        assert out.your_amount == float(Decimal("1500"))
        assert out.peer_amount == float(Decimal("3000"))
        assert out.your_user_id == str(receiver_id)
        assert out.peer_user_id == str(requester_id)
        assert out.your_name == "Receiver"
        assert out.peer_name == "Requester"
        # goal was created by requester, so receiver is NOT the creator
        assert out.is_creator is False

    def test_total_amount_and_progress_pct_are_correct(self):
        requester_id = uuid.uuid4()
        receiver_id = uuid.uuid4()

        goal, conn = self._build_goal_and_conn(
            requester_id=requester_id,
            receiver_id=receiver_id,
            requester_amount=Decimal("4000"),
            receiver_amount=Decimal("2000"),
            target_amount=Decimal("10000"),
        )
        users_by_id = self._users_by_id(requester_id, receiver_id)
        session = _make_session()
        svc = PeerService(session)

        out = svc._goal_to_out(goal, conn, requester_id, users_by_id)

        assert out.total_amount == 6000.0
        assert out.progress_pct == pytest.approx(60.0)

    def test_progress_pct_capped_at_100_when_over_target(self):
        requester_id = uuid.uuid4()
        receiver_id = uuid.uuid4()

        goal, conn = self._build_goal_and_conn(
            requester_id=requester_id,
            receiver_id=receiver_id,
            requester_amount=Decimal("8000"),
            receiver_amount=Decimal("5000"),
            target_amount=Decimal("10000"),
        )
        users_by_id = self._users_by_id(requester_id, receiver_id)
        session = _make_session()
        svc = PeerService(session)

        out = svc._goal_to_out(goal, conn, requester_id, users_by_id)

        assert out.progress_pct == 100.0
        assert out.total_amount == 13000.0
