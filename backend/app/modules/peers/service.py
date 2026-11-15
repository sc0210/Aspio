"""
Business logic for the peers module.

PeerService wraps all database operations and enforces the rules:
  - A user may have at most 2 *accepted* peer connections at a time.
  - A user cannot connect to themselves.
  - Duplicate pending/accepted pairs are rejected (409 Conflict).
  - Only the receiver can respond to an invite.
  - Either party can remove an accepted/pending connection.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import (
    Notification,
    NotificationChannel,
    NotificationPriority,
    NotificationStatus,
    NotificationType,
)
from app.modules.peers.models import GoalStatus, PeerConnection, PeerStatus, SharedGoal
from app.modules.peers.repositories import (
    PeerConnectionRepository,
    PeerUserRepository,
    PeerWalletRepository,
    SharedGoalRepository,
)
from app.modules.peers.schemas import (
    CompareChartPoint,
    CompareDataResponse,
    LinkGoalIn,
    PeerConnectionOut,
    PeerStatCard,
    SharedGoalCreate,
    SharedGoalHistoryPoint,
    SharedGoalOut,
    SharedGoalUpdate,
    UserSearchResult,
    WalletTotals,
)
from app.utils.datetime_helpers import business_day_of, business_today

logger = logging.getLogger(__name__)

# Maximum number of active peer connections per user.
MAX_PEERS = 2

# Maximum number of goals allowed per connection (abuse prevention).
MAX_GOALS_PER_CONNECTION = 10

# After a decline, the same person can't re-invite (and re-notify) for this long.
REINVITE_COOLDOWN = timedelta(days=7)

# Where every peer notification links: invites, accepts, deposits, completions.
PEERS_URL = "/savings"


class PeerService:
    """Async service for all peer-connection operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._connections = PeerConnectionRepository(session)
        self._goals = SharedGoalRepository(session)
        self._users = PeerUserRepository(session)
        self._wallets = PeerWalletRepository(session)

    # ------------------------------------------------------------------
    # User search
    # ------------------------------------------------------------------

    async def search_user(
        self, username: str, requesting_user_id: UUID
    ) -> UserSearchResult | None:
        """Look up a user by exact username (case-insensitive).

        Returns None if the username does not exist, belongs to the
        requesting user, or belongs to a soft-deleted account.
        """
        user = await self._users.find_by_username(username, exclude_id=requesting_user_id)
        if user is None:
            return None
        profile = await self._users.get_profile_row(user.id)
        if profile is None:
            return None
        return UserSearchResult.model_validate(profile)

    # ------------------------------------------------------------------
    # Send invite
    # ------------------------------------------------------------------

    async def send_invite(
        self, requester_id: UUID, receiver_username: str
    ) -> PeerConnection:
        """Create a peer invite from requester → receiver.

        Rules enforced:
          1. Receiver must exist (404 if not).
          2. Requester must not already have 2 accepted peers (400).
          3. No existing pending/accepted pair between the two (409).
          4. Inserts a Notification for the receiver.
        """
        # 1. Find receiver
        receiver = await self._users.find_by_username(receiver_username)
        if receiver is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User '{receiver_username}' not found",
            )

        if receiver.id == requester_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot invite yourself",
            )

        # The demo account's password is public, so a connection to it would show
        # this user's finances to anyone. Refused in both directions (the
        # requester side is checked once it is loaded, below).
        from app.modules.users.init_demo_user import DEMO_EMAIL

        if receiver.email == DEMO_EMAIL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The demo account cannot have peer connections",
            )

        # 3. Check for any existing connection row (either direction)
        any_existing = await self._connections.find_any_between(requester_id, receiver.id)

        # 4. Fetch requester for notification payload
        requester = await self._users.get_by_id(requester_id)
        if requester is not None and requester.email == DEMO_EMAIL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The demo account cannot have peer connections",
            )

        # An existing pair answers first (409 / cooldown), so re-sending to the
        # same person says "already exists" rather than a cap message.
        if any_existing is not None:
            if any_existing.status in (PeerStatus.PENDING, PeerStatus.ACCEPTED):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A pending or accepted connection already exists with this user",
                )
            if (
                any_existing.status == PeerStatus.DECLINED
                and any_existing.requester_id == requester_id
                and _is_recent(any_existing.updated_at, REINVITE_COOLDOWN)
            ):
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="This user declined your invite recently; try again later",
                )

        # 5. The cap counts outstanding invites too: checking accepted ones only
        #    let a user send unlimited invites and end up over the limit.
        accepted_count = await self._connections.count_accepted(requester_id)
        pending_count = await self._connections.count_pending_sent(requester_id)
        if accepted_count + pending_count >= MAX_PEERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"You already have the maximum number of peer connections "
                    f"({MAX_PEERS}), counting invites you have sent"
                ),
            )
        if await self._connections.count_accepted(receiver.id) >= MAX_PEERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This user already has the maximum number of peer connections",
            )

        if any_existing is not None:
            # REMOVED or DECLINED — reuse the row so the unique constraint on
            # (requester_id, receiver_id) is not violated by a second INSERT.
            # Swapping requester/receiver is safe: goal sides are keyed by
            # user (each partner's own goal), never by side.
            any_existing.requester_id = requester_id
            any_existing.receiver_id = receiver.id
            any_existing.status = PeerStatus.PENDING
            any_existing.updated_at = datetime.now(timezone.utc)
            conn = any_existing
            await self.session.flush()
        else:
            # 5. Insert new connection
            conn = PeerConnection(
                id=uuid.uuid4(),
                requester_id=requester_id,
                receiver_id=receiver.id,
                status=PeerStatus.PENDING,
            )
            self._connections.add(conn)
            await self.session.flush()  # populate conn.id before notification

        # 6. Insert notification for receiver
        requester_username = requester.username if requester else str(requester_id)
        self._notify(
            receiver.id,
            "New peer invite",
            f"{requester_username} wants to connect with you as a peer. "
            "Accepting shares your wallet totals and net worth with each other.",
            "peer_invite",
            connection_id=str(conn.id),
            requester_username=requester_username,
        )
        await self.session.commit()
        await self._connections.refresh(conn)
        return conn

    # ------------------------------------------------------------------
    # List connections
    # ------------------------------------------------------------------

    async def list_connections(self, user_id: UUID) -> list[PeerConnectionOut]:
        """Return all non-removed connections for the calling user."""
        connections = await self._connections.list_non_removed(user_id)

        result: list[PeerConnectionOut] = []
        for conn in connections:
            is_sent = conn.requester_id == user_id
            other_user_id = conn.receiver_id if is_sent else conn.requester_id

            other_row = await self._users.get_profile_row(other_user_id)
            if other_row is None:
                # The other user was hard-deleted; skip this connection.
                continue

            other_user = UserSearchResult.model_validate(other_row)
            result.append(
                PeerConnectionOut(
                    id=conn.id,
                    other_user=other_user,
                    status=conn.status,
                    direction="sent" if is_sent else "received",
                    created_at=conn.created_at,
                )
            )
        return result

    # ------------------------------------------------------------------
    # Respond to invite
    # ------------------------------------------------------------------

    async def respond_to_invite(
        self, connection_id: UUID, user_id: UUID, action: str
    ) -> PeerConnection:
        """Accept or decline a pending invite addressed to *user_id*.

        Only the receiver of the invite can call this endpoint.
        On "accept", verifies the receiver doesn't exceed MAX_PEERS.
        """
        conn = await self._connections.get_pending_for_receiver(connection_id, user_id)
        if conn is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pending invite not found",
            )

        if action == "accept":
            # Both sides: the inviter may have filled up since sending this.
            for participant in (user_id, conn.requester_id):
                if await self._connections.count_accepted(participant) >= MAX_PEERS:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            "You already have the maximum number of peer connections"
                            if participant == user_id
                            else "The inviter already has the maximum number of peer connections"
                        ),
                    )
            conn.status = PeerStatus.ACCEPTED
        else:
            conn.status = PeerStatus.DECLINED
        conn.updated_at = datetime.now(timezone.utc)

        responder = await self._users.get_profile_row(user_id)
        name = (responder or {}).get("name", "Your peer")
        self._notify(
            conn.requester_id,
            "Peer invite accepted" if action == "accept" else "Peer invite declined",
            f"{name} {'accepted' if action == 'accept' else 'declined'} your peer invite.",
            f"peer_invite_{'accepted' if action == 'accept' else 'declined'}",
            connection_id=str(conn.id),
        )
        await self.session.commit()
        await self._connections.refresh(conn)
        return conn

    # ------------------------------------------------------------------
    # Remove connection
    # ------------------------------------------------------------------

    async def remove_connection(self, connection_id: UUID, user_id: UUID) -> None:
        """Soft-remove a connection (either party can do this)."""
        conn = await self._connections.get_for_participant(connection_id, user_id)
        if conn is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Connection not found",
            )
        conn.status = PeerStatus.REMOVED
        # Removing never waits on money: open proposals close and accepted
        # splits' rows unlock (the balance stays readable afterwards).
        from app.modules.peers.splits import SplitService

        await SplitService(self.session).close_for_removed_connection(conn.id)
        await self.session.commit()

    # ------------------------------------------------------------------
    # Shared goals — CRUD
    # ------------------------------------------------------------------

    async def create_goal(
        self, user_id: UUID, data: SharedGoalCreate
    ) -> SharedGoalOut:
        """Create a shared savings goal and the caller's part of it.

        Rules:
          - The connection must exist, be accepted, and user_id must be either
            the requester or the receiver.
          - At most MAX_GOALS_PER_CONNECTION goals (any status) per connection.
          - The caller's part is a personal goal: a new one with data.my_target
            as its target, or data.goal_id, a goal they already have
            (_attach_side). The partner adds theirs with link_goal.
        """
        # 1. Verify the connection
        conn = await self._get_participant_connection(data.connection_id, user_id)

        # 2. Enforce goal cap
        goal_count = await self._goals.count_for_connection(data.connection_id)
        if goal_count >= MAX_GOALS_PER_CONNECTION:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"This connection already has the maximum number of "
                    f"goals ({MAX_GOALS_PER_CONNECTION})"
                ),
            )

        # 3. The goal and the caller's part, committed together (the part's
        # commit carries the staged goal row; a refused part rolls both back).
        goal = SharedGoal(
            id=uuid.uuid4(),
            connection_id=data.connection_id,
            title=data.title,
            target_date=data.target_date,
            created_by=user_id,
            status=GoalStatus.active,
        )
        self._goals.add(goal)
        try:
            await self.session.flush()
            await self._attach_side(user_id, goal, data.goal_id, data.my_target)
            await self._rejudge(goal, conn)
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self._goals.refresh(goal)

        # 4. Fetch both user profiles for the response
        users_by_id = await self._users.get_profiles([conn.requester_id, conn.receiver_id])
        backing = await self._backing([(goal, conn)])
        return self._goal_to_out(goal, conn, user_id, users_by_id, backing)

    async def list_goals(self, user_id: UUID) -> list[SharedGoalOut]:
        """Return the active and completed goals the calling user takes part in.

        Joins shared_goals → peer_connections to filter by participant.
        Results are ordered newest-first.
        """
        rows = await self._goals.list_for_participant(user_id)

        if not rows:
            return []

        # Collect all unique participant IDs across all goals in one query
        all_user_ids: set[UUID] = set()
        for goal, conn in rows:
            all_user_ids.add(conn.requester_id)
            all_user_ids.add(conn.receiver_id)

        users_by_id = await self._users.get_profiles(list(all_user_ids))
        backing = await self._backing(rows)

        return [
            self._goal_to_out(goal, conn, user_id, users_by_id, backing)
            for goal, conn in rows
        ]

    async def get_goal(self, user_id: UUID, goal_id: UUID) -> SharedGoalOut:
        """Return a single goal (calling user must be a participant)."""
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)
        users_by_id = await self._users.get_profiles([conn.requester_id, conn.receiver_id])
        backing = await self._backing([(goal, conn)])
        return self._goal_to_out(goal, conn, user_id, users_by_id, backing)

    async def update_goal(
        self, user_id: UUID, goal_id: UUID, data: SharedGoalUpdate
    ) -> SharedGoalOut:
        """Edit a goal's title or date. Either participant may.

        The target is each partner's own part, edited on their personal goal.
        """
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)
        if goal.status == GoalStatus.cancelled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit a cancelled goal",
            )
        fields = data.model_dump(exclude_unset=True)
        for name in ("title", "target_date"):
            if name in fields:
                setattr(goal, name, fields[name])
        goal.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self._goals.refresh(goal)
        users_by_id = await self._users.get_profiles([conn.requester_id, conn.receiver_id])
        backing = await self._backing([(goal, conn)])
        return self._goal_to_out(goal, conn, user_id, users_by_id, backing)

    async def link_goal(self, user_id: UUID, shared_goal_id: UUID, data: LinkGoalIn | None = None):
        """The caller's part of a shared goal: their own goal, made or linked if missing.

        That goal reserves the caller's Life cash and can be spent from or
        invested like any goal (goals/reservations.py); its target is their
        part and its value their side. With data.goal_id a goal they already
        have becomes their part; otherwise one is made with the shared goal's
        title and date and data.target_amount (default: the partner's part).
        Looked up and made under the shared goal's row lock, so a double click
        cannot make two.
        """
        from sqlalchemy import select

        from app.modules.goals.repositories import GoalRepository
        from app.modules.goals.service import GoalService

        data = data or LinkGoalIn()
        shared, conn = await self._get_goal_and_connection(shared_goal_id, user_id)
        if shared.status == GoalStatus.cancelled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot set money aside for a cancelled goal",
            )
        await self.session.execute(
            select(SharedGoal.id).where(SharedGoal.id == shared.id).with_for_update()
        )
        goals = GoalService(self.session)
        goal_id = await GoalRepository(self.session).linked_goal_id(user_id, shared.id)
        if goal_id is not None:
            if data.goal_id is not None and data.goal_id != goal_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="You already have a goal for your part. Cancel it to use another.",
                )
        else:
            target = data.target_amount
            if data.goal_id is None and target is None:
                peer_id = conn.receiver_id if conn.requester_id == user_id else conn.requester_id
                peer_part = (await self._backing([(shared, conn)])).get((shared.id, peer_id))
                if peer_part is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Say how much your part is",
                    )
                target = peer_part[2]
            try:
                goal_id = await self._attach_side(user_id, shared, data.goal_id, target)
                await self._rejudge(shared, conn)
                await self.session.commit()
            except Exception:
                await self.session.rollback()
                raise
        goal = await goals.get_goal(goal_id, user_id)
        await goals.attach_money([goal], user_id)
        return goal

    async def _attach_side(
        self, user_id: UUID, shared: SharedGoal, goal_id: UUID | None, target: Decimal | None
    ) -> UUID:
        """Make the caller's part of a shared goal and return its id (caller commits).

        goal_id: a goal of theirs becomes the part. It must be open and not
        already another shared goal's part. Otherwise a new savings goal with
        the shared goal's title and date and ``target`` as its target.
        """
        from datetime import date as _date

        from sqlalchemy import select

        from app.modules.goals.models import Goal
        from app.modules.goals.models import GoalStatus as PersonalStatus
        from app.modules.goals.schemas import GoalCreate
        from app.modules.goals.service import GoalService

        if goal_id is not None:
            goal = (await self.session.execute(
                select(Goal).where(Goal.id == goal_id, Goal.user_id == user_id).with_for_update()
            )).scalar_one_or_none()
            if goal is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
            if goal.status == PersonalStatus.CANCELLED:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A cancelled goal can't be your part",
                )
            if goal.shared_goal_id is not None and goal.shared_goal_id != shared.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="That goal is already part of another shared goal",
                )
            goal.shared_goal_id = shared.id
            await self.session.flush()
            return goal.id

        due = shared.target_date
        if isinstance(due, str):  # some driver paths return the DATE as text
            due = _date.fromisoformat(due[:10])
        # GoalService.create_goal commits, which carries the caller's staged rows.
        created = await GoalService(self.session).create_goal(user_id, GoalCreate(
            title=shared.title,
            category="savings",
            target_amount=Decimal(str(target)).quantize(Decimal("0.01")),
            target_date=(
                datetime(due.year, due.month, due.day, tzinfo=timezone.utc) if due else None
            ),
            description="My part of a shared goal",
        ), shared_goal_id=shared.id)
        return created.id

    async def sync_backed_goal(self, shared_goal_id: UUID, user_id: UUID) -> None:
        """Re-judge a shared goal after a partner's part moved (caller commits).

        A reservation, release, sale gain or new target on a part changes the
        shared goal's total or target, so its stored status and "reached"
        alert follow here.
        """
        from sqlalchemy import select

        row = await self._goals.get_with_connection(shared_goal_id, user_id)
        if row is None:
            return
        goal, conn = row
        if goal.status == GoalStatus.cancelled:
            return
        # Both partners' moves re-judge the same row: lock it, so the second
        # waits and then sees the first's committed money (no lost completion).
        await self.session.execute(
            select(SharedGoal.id).where(SharedGoal.id == goal.id).with_for_update()
        )
        await self._rejudge(goal, conn)

    async def notify_set_aside(self, shared_goal_id: UUID, user_id: UUID, amount: Decimal) -> None:
        """Tell the partner that the caller set money aside for their part (caller commits)."""
        row = await self._goals.get_with_connection(shared_goal_id, user_id)
        if row is None:
            return
        goal, conn = row
        partner_id = conn.receiver_id if conn.requester_id == user_id else conn.requester_id
        saver = await self._users.get_profile_row(user_id)
        saver_name = (saver or {}).get("name", "Your partner")
        self._notify(
            partner_id,
            "New shared savings deposit",
            f"{saver_name} set aside NT${amount:,.0f} toward \"{goal.title}\".",
            "peer_goal_deposit",
            goal_id=str(goal.id),
        )

    async def side_history(self, user_id: UUID, shared_goal_id: UUID) -> list[SharedGoalHistoryPoint]:
        """Each side's progress by day: the net of its part's contribution rows.

        Reserve, release, legacy and sale gain rows, summed per business day.
        Spending goal money moves it from reserved to spent without changing
        progress, so it is not a dip here. An emergency-fund part follows its
        wallet, not rows, so its history is empty. The partner sees amounts and
        days, never notes.
        """
        from collections import defaultdict

        from app.modules.goals.repositories import GoalRepository

        goal, _conn = await self._get_goal_and_connection(shared_goal_id, user_id)
        repo = GoalRepository(self.session)
        side_of = {
            gid: ("you" if owner == user_id else "partner")
            for gid, owner, _shared, _target in await repo.linked_to_shared([goal.id])
        }
        days: dict = defaultdict(Decimal)
        for gid, when, amount in await repo.contribution_rows(list(side_of)):
            days[(business_day_of(when), side_of[gid])] += Decimal(str(amount))
        return [
            SharedGoalHistoryPoint(date=day.isoformat(), side=side, amount=float(total))
            for (day, side), total in sorted(days.items())
            if total != 0
        ]

    async def _backing(self, rows) -> dict:
        """Each partner's part of these shared goals: {(shared id, user id): (goal id, value, target)}.

        Value is the part's money at market value (reserved + spent + legacy +
        invested), computed per owner: the partner sees only the total. An
        emergency-fund goal is worth its owner's Emergency Wallet, as on its card.
        """
        from collections import defaultdict

        from sqlalchemy import select

        from app.modules.goals.models import Goal, GoalCategory
        from app.modules.goals.repositories import GoalRepository
        from app.modules.goals.reservations import emergency_balance, goal_money

        linked = await GoalRepository(self.session).linked_to_shared([goal.id for goal, _conn in rows])
        emergency = set((await self.session.scalars(select(Goal.id).where(
            Goal.id.in_([goal_id for goal_id, _owner, _shared, _target in linked]),
            Goal.category == GoalCategory.EMERGENCY_FUND,
        ))).all()) if linked else set()
        by_owner: dict = defaultdict(list)
        for goal_id, owner, _shared, _target in linked:
            by_owner[owner].append(goal_id)
        values: dict = {}
        for owner, goal_ids in by_owner.items():
            wallet = (await emergency_balance(self.session, owner)
                      if emergency.intersection(goal_ids) else None)
            money = await goal_money(self.session, owner, [g for g in goal_ids if g not in emergency],
                                     with_holdings=True)
            for gid in goal_ids:  # a goal with no money rows has no entry
                if gid in emergency:
                    values[gid] = wallet
                elif gid in money:
                    values[gid] = money[gid].value
        return {
            (shared, owner): (goal_id, values.get(goal_id, Decimal("0")), Decimal(str(target)))
            for goal_id, owner, shared, target in linked
        }

    async def delete_goal(self, user_id: UUID, goal_id: UUID) -> None:
        """Delete a shared goal.  Only the creator (created_by) may do this.

        Both partners' personal goals stay, unlinked, with all their money.
        """
        from app.modules.goals.repositories import GoalRepository

        goal = await self._goals.get_by_id(goal_id)

        if goal is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found",
            )
        if goal.created_by != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the goal creator can delete it",
            )

        # The FK would null the link too; saying so keeps it off the database's word.
        await GoalRepository(self.session).unlink_shared(goal.id)
        await self._goals.delete(goal)
        await self.session.commit()

    async def _rejudge(self, goal: SharedGoal, conn: PeerConnection) -> None:
        """Store whether the parts reach the target now, and say so once (caller commits).

        Completion follows the total both ways: reaching the sum of both parts
        completes the goal and alerts both partners; dropping back below it (a
        release, a raised part) re-opens it. Reads judge it live as well
        (_live_status), so this stored figure only drives the alert.
        """
        await self.session.flush()  # a part staged by the caller counts
        parts = (await self._backing([(goal, conn)])).values()
        total = sum((value for _gid, value, _target in parts), Decimal("0"))
        target = sum((target for _gid, _value, target in parts), Decimal("0"))
        # Reached only once both partners have a part: one part filled alone
        # is that partner's goal done, not the couple's.
        reached = len(parts) == 2 and target > 0 and total >= target
        was_completed = goal.status == GoalStatus.completed
        if goal.status == GoalStatus.active and reached:
            goal.status = GoalStatus.completed
        elif was_completed and not reached:
            goal.status = GoalStatus.active
        goal.updated_at = datetime.now(timezone.utc)
        if goal.status == GoalStatus.completed and not was_completed:
            for participant in (conn.requester_id, conn.receiver_id):
                self._notify(
                    participant,
                    "Shared goal reached!",
                    f"\"{goal.title}\" reached its target together.",
                    "peer_goal_completed",
                    goal_id=str(goal.id),
                )

    def _notify(self, user_id: UUID, title: str, message: str, action: str, **data) -> None:
        """Queue an in-app notification that links to the savings page."""
        self.session.add(Notification(
            id=uuid.uuid4(),
            user_id=user_id,
            type=NotificationType.SYSTEM_UPDATE,
            priority=NotificationPriority.MEDIUM,
            status=NotificationStatus.PENDING,
            title=title,
            message=message,
            # The bell follows action_url only on actionable notifications.
            action_url=PEERS_URL,
            is_actionable=True,
            data={"action": action, **data},
            channels=[NotificationChannel.IN_APP],
        ))

    # ------------------------------------------------------------------
    # Compare data
    # ------------------------------------------------------------------

    async def get_compare_data(self, user_id: UUID) -> CompareDataResponse:
        """Build the comparison payload for the current user and their peers.

        Each participant's wallet totals and a 13-week net-worth chart, both in
        TWD and both the dashboard's own figures: the card's balances as the
        dashboard counts them, the chart read off its daily wallet trends as
        total assets less debt.
        """
        from app.modules.dashboard.schemas import PeriodEnum
        from app.modules.dashboard.services import DashboardService

        # 1. Collect accepted peer user IDs
        peer_ids = await self._connections.get_accepted_peer_ids(user_id)
        all_user_ids: list[UUID] = [user_id] + peer_ids  # self first

        # 2. Fetch user profiles
        user_map = await self._users.get_full_profiles(all_user_ids)

        # 3. Weekly date axis for the past ~90 days (13 points)
        today = business_today()
        date_axis = [(today - timedelta(weeks=w)).isoformat() for w in range(12, -1, -1)]

        # 4. Stat cards and each participant's daily net worth. One participant
        # at a time: every query shares this request's session.
        stat_cards: list[PeerStatCard] = []
        net_worth_by_user: dict[UUID, dict[str, float]] = {}
        dashboard = DashboardService(self.session)
        for uid in all_user_ids:
            # A peer whose figures fail to load is left out rather than taking
            # the whole comparison down with them. The page is still about you,
            # so a failure loading your own figures is still an error.
            try:
                totals = await self._compute_wallet_totals(uid)
                trends = await dashboard.get_wallet_trends(str(uid), PeriodEnum.NINETY_DAYS)
            except Exception:
                if uid == user_id:
                    raise
                logger.warning(f"Compare: leaving out peer {uid}, whose figures failed to load", exc_info=True)
                # A failed query leaves the transaction unusable; the next peer's
                # queries share it. Nothing here writes, so there is nothing to lose.
                await self.session.rollback()
                continue

            profile = user_map.get(uid, {})
            stat_cards.append(
                PeerStatCard(
                    user_id=uid,
                    username=profile.get("username"),
                    name=profile.get("name", "Unknown"),
                    avatar_url=profile.get("avatar_url"),
                    is_self=(uid == user_id),
                    wallet_totals=totals,
                )
            )
            # The chart used to interpolate each holding between its cost and
            # today's value, leaving out cash and debt, so its last point never
            # matched the net worth on the card beside it.
            net_worth_by_user[uid] = {
                point.date: round(float(point.total_asset - point.debt_balance), 2)
                for point in trends.data_points
            }

        # 5. Chart points on the weekly axis
        chart: list[CompareChartPoint] = []
        for day in date_axis:
            point: dict = {"date": day}
            for uid in net_worth_by_user:
                # A day the trends could not produce is left out, a gap in that
                # line, rather than drawn as a fall to zero.
                if day in net_worth_by_user[uid]:
                    point[str(uid)] = net_worth_by_user[uid][day]
            chart.append(CompareChartPoint(**point))

        return CompareDataResponse(users=stat_cards, chart=chart)

    # ------------------------------------------------------------------
    # Private helpers — shared goals
    # ------------------------------------------------------------------

    def _goal_to_out(
        self,
        goal: SharedGoal,
        conn: PeerConnection,
        user_id: UUID,
        users_by_id: dict[UUID, dict],
        backing: dict | None = None,
    ) -> SharedGoalOut:
        """Map a SharedGoal ORM object + its connection to SharedGoalOut.

        The 'your_*' / 'peer_*' fields are resolved relative to *user_id* so
        the frontend always receives a self-oriented view regardless of which
        side the user is on.
        """
        is_requester = conn.requester_id == user_id
        peer_id = conn.receiver_id if is_requester else conn.requester_id

        # Each side is that partner's personal goal: its target their part,
        # its value their amount. The partner sees only the side's totals.
        backing = backing or {}
        none = (None, Decimal("0"), Decimal("0"))
        your_goal_id, your_value, your_target = backing.get((goal.id, user_id), none)
        peer_goal_id, peer_value, peer_target = backing.get((goal.id, peer_id), none)
        your_amount = float(your_value)
        peer_amount = float(peer_value)

        your_profile = users_by_id.get(user_id, {})
        peer_profile = users_by_id.get(peer_id, {})

        total = your_amount + peer_amount
        target = float(your_target + peer_target)
        progress_pct = min((total / target * 100) if target > 0 else 0.0, 100.0)

        target_date_str: str | None = None
        if goal.target_date is not None:
            # target_date may come back as a date object or a string depending
            # on the asyncpg driver version; normalise to ISO string.
            td = goal.target_date
            target_date_str = td.isoformat() if hasattr(td, "isoformat") else str(td)

        created_at_val = goal.created_at
        created_at_str = (
            created_at_val.isoformat()
            if hasattr(created_at_val, "isoformat")
            else str(created_at_val)
        )

        return SharedGoalOut(
            id=str(goal.id),
            connection_id=str(goal.connection_id),
            title=goal.title,
            target_amount=target,
            target_date=target_date_str,
            status=self._live_status(goal, total, target, both_joined=bool(your_goal_id and peer_goal_id)),
            your_amount=your_amount,
            peer_amount=peer_amount,
            your_target=float(your_target),
            peer_target=float(peer_target),
            peer_joined=peer_goal_id is not None,
            your_name=your_profile.get("name", "Unknown"),
            peer_name=peer_profile.get("name", "Unknown"),
            your_user_id=str(user_id),
            peer_user_id=str(peer_id),
            total_amount=total,
            progress_pct=round(progress_pct, 2),
            is_creator=(goal.created_by == user_id),
            created_at=created_at_str,
            your_goal_id=str(your_goal_id) if your_goal_id else None,
            your_set_aside=your_amount,
        )

    @staticmethod
    def _live_status(goal: SharedGoal, total: float, target: float, both_joined: bool) -> str:
        """Stored status, with completion read from today's total (both parts in).

        The parts move without touching the shared goal (a reservation, a
        market move), so reaching the target is judged at read time; the
        figure stored by _rejudge can lag a market move.
        """
        stored = goal.status if isinstance(goal.status, str) else goal.status.value
        if stored == GoalStatus.cancelled.value:
            return stored
        reached = both_joined and target > 0 and total >= target
        return GoalStatus.completed.value if reached else GoalStatus.active.value

    async def _get_participant_connection(
        self, connection_id: UUID, user_id: UUID
    ) -> PeerConnection:
        """Fetch an accepted PeerConnection where user_id is a participant.

        Raises 404 if not found or user is not a participant.
        Raises 400 if the connection is not in ACCEPTED status.
        """
        conn = await self._connections.get_for_participant(connection_id, user_id)

        if conn is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Peer connection not found",
            )
        if conn.status != PeerStatus.ACCEPTED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Shared goals can only be created on accepted connections",
            )
        return conn

    async def _get_goal_and_connection(
        self, goal_id: UUID, user_id: UUID
    ) -> tuple[SharedGoal, PeerConnection]:
        """Fetch a SharedGoal joined with its PeerConnection.

        Verifies that user_id is a participant in the connection.
        Raises 404 if the goal does not exist or the user is not a participant.
        """
        row = await self._goals.get_with_connection(goal_id, user_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found",
            )
        return row[0], row[1]

    async def _compute_wallet_totals(self, user_id: UUID) -> WalletTotals:
        """Aggregate portfolio/emergency/cash/life totals for one user in TWD.

        Classification rules:
          - emergency wallet (any type), plus Emergency-wallet transaction
            cash                         → emergency_total
          - portfolio wallet, type=cash  → cash_total
          - portfolio wallet, other type → portfolio_total
          - life wallet (transaction net) → life_total
          - active loans' outstanding balance → debt_total, subtracted

        Holdings are converted to TWD with twd_rates_for; a currency with no
        rate counts at face value, as everywhere else.
        The life wallet balance is derived from the net of income minus expenses
        recorded against wallet_type='life' in the transactions table.
        """
        from app.utils.fx_sql import BASE_CURRENCY, twd_rates_for

        rows = await self._wallets.get_wallet_holdings_by_type(user_id)
        rates = await twd_rates_for(self.session, [row["currency"] for row in rows])

        portfolio_total = 0.0
        emergency_total = 0.0
        cash_total = 0.0
        for row in rows:
            wallet = (row["wallet_type"] or "").lower()
            typ = (row["type"] or "").lower()
            currency = (row["currency"] or BASE_CURRENCY).upper()
            val = row["total_value"] * float(rates.get(currency, 1))
            if wallet == "emergency":
                emergency_total += val
            elif wallet == "portfolio":
                if typ == "cash":
                    cash_total += val
                else:
                    portfolio_total += val

        # Life and Emergency cash live in transactions (see #137), beside any
        # legacy emergency-wallet holdings counted above. One query for both,
        # the one the dashboard's wallets read.
        from app.modules.transactions.models import TransactionWalletType
        from app.modules.transactions.repositories import TransactionRepository

        cash = await TransactionRepository(self.session).cash_balances_twd(user_id)
        life_total = float(cash.get(TransactionWalletType.LIFE, 0))
        emergency_total += float(cash.get(TransactionWalletType.EMERGENCY, 0))

        # Net worth as the dashboard defines it: total assets less outstanding
        # debt. Without the debt this card put total assets under the Net Worth
        # label, millions above the dashboard for anyone with a loan.
        debt_total = await self._wallets.get_total_debt(user_id)
        net_worth = portfolio_total + emergency_total + cash_total + life_total - debt_total
        return WalletTotals(
            portfolio_total=portfolio_total,
            emergency_total=emergency_total,
            cash_total=cash_total,
            life_total=life_total,
            debt_total=debt_total,
            net_worth=net_worth,
        )


# ---------------------------------------------------------------------------
# Factory helper (mirrors the pattern used in loans/service.py)
# ---------------------------------------------------------------------------


def get_peer_service(session: AsyncSession) -> PeerService:
    """Construct a PeerService bound to the given session."""
    return PeerService(session)


def _is_recent(moment, window: timedelta) -> bool:
    """Whether *moment* (possibly naive UTC, as SQLite returns it) is within *window* of now."""
    if moment is None:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - moment < window
