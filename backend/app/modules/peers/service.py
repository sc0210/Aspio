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
from app.modules.peers.models import GoalStatus, PeerConnection, PeerStatus, SavingRecord, SharedGoal
from app.modules.peers.repositories import (
    PeerConnectionRepository,
    PeerUserRepository,
    PeerWalletRepository,
    SavingRecordRepository,
    SharedGoalRepository,
)
from app.modules.peers.schemas import (
    CompareChartPoint,
    CompareDataResponse,
    PeerConnectionOut,
    PeerStatCard,
    SavingRecordCreate,
    SavingRecordOut,
    SavingRecordUpdate,
    SharedGoalCreate,
    SharedGoalOut,
    UserSearchResult,
    WalletTotals,
)
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)

# Maximum number of active peer connections per user.
MAX_PEERS = 2

# Maximum number of goals allowed per connection (abuse prevention).
MAX_GOALS_PER_CONNECTION = 10


class PeerService:
    """Async service for all peer-connection operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._connections = PeerConnectionRepository(session)
        self._goals = SharedGoalRepository(session)
        self._records = SavingRecordRepository(session)
        self._users = PeerUserRepository(session)
        self._wallets = PeerWalletRepository(session)

    # ------------------------------------------------------------------
    # User search
    # ------------------------------------------------------------------

    async def search_user(
        self, username: str, requesting_user_id: UUID
    ) -> UserSearchResult | None:
        """Look up a user by exact username (case-sensitive).

        Returns None if the username does not exist, belongs to the
        requesting user, or belongs to a soft-deleted account.
        """
        row = await self._users.get_profile_row(requesting_user_id)  # prime the cache
        # We need a profile-row for the target user, not the requester.
        # Use find_by_username which already excludes the requesting user.
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

        # 2. Check requester's accepted-peer count
        accepted_count = await self._connections.count_accepted(requester_id)
        if accepted_count >= MAX_PEERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You already have the maximum number of peer connections (2)",
            )

        # 3. Check for any existing connection row (either direction)
        any_existing = await self._connections.find_any_between(requester_id, receiver.id)

        # 4. Fetch requester for notification payload
        requester = await self._users.get_by_id(requester_id)

        from app.modules.users.init_demo_user import DEMO_EMAIL

        if any_existing is not None:
            if any_existing.status in (PeerStatus.PENDING, PeerStatus.ACCEPTED):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A pending or accepted connection already exists with this user",
                )
            # REMOVED or DECLINED — reuse the row so the unique constraint on
            # (requester_id, receiver_id) is not violated by a second INSERT.
            any_existing.requester_id = requester_id
            any_existing.receiver_id = receiver.id
            any_existing.status = (
                PeerStatus.ACCEPTED if receiver.email == DEMO_EMAIL else PeerStatus.PENDING
            )
            any_existing.updated_at = datetime.now(timezone.utc)
            conn = any_existing
            await self.session.flush()
        else:
            # 5. Insert new connection — auto-accept when receiver is the demo user
            conn = PeerConnection(
                id=uuid.uuid4(),
                requester_id=requester_id,
                receiver_id=receiver.id,
                status=(
                    PeerStatus.ACCEPTED if receiver.email == DEMO_EMAIL else PeerStatus.PENDING
                ),
            )
            self._connections.add(conn)
            await self.session.flush()  # populate conn.id before notification

        # 6. Insert notification for receiver
        requester_username = requester.username if requester else str(requester_id)
        notification = Notification(
            id=uuid.uuid4(),
            user_id=receiver.id,
            type=NotificationType.SYSTEM_UPDATE,
            priority=NotificationPriority.MEDIUM,
            status=NotificationStatus.PENDING,
            title="New peer invite",
            message=f"{requester_username} wants to connect with you as a peer.",
            data={
                "connection_id": str(conn.id),
                "requester_username": requester_username,
                "action": "peer_invite",
            },
            channels=[NotificationChannel.IN_APP],
        )
        self.session.add(notification)
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
            accepted_count = await self._connections.count_accepted(user_id)
            if accepted_count >= MAX_PEERS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="You already have the maximum number of peer connections (2)",
                )
            conn.status = PeerStatus.ACCEPTED
        else:
            conn.status = PeerStatus.DECLINED

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
        await self.session.commit()

    # ------------------------------------------------------------------
    # Shared goals — CRUD
    # ------------------------------------------------------------------

    async def create_goal(
        self, user_id: UUID, data: SharedGoalCreate
    ) -> SharedGoalOut:
        """Create a shared savings goal on an accepted peer connection.

        Rules:
          - The connection must exist, be accepted, and user_id must be either
            the requester or the receiver.
          - At most MAX_GOALS_PER_CONNECTION goals (any status) per connection.
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

        # 3. Create the goal
        goal = SharedGoal(
            id=uuid.uuid4(),
            connection_id=data.connection_id,
            title=data.title,
            target_amount=data.target_amount,
            target_date=data.target_date,
            created_by=user_id,
            status=GoalStatus.active,
            requester_amount=Decimal("0"),
            receiver_amount=Decimal("0"),
        )
        self._goals.add(goal)
        await self.session.commit()
        await self._goals.refresh(goal)

        # 4. Fetch both user profiles for the response
        users_by_id = await self._users.get_profiles([conn.requester_id, conn.receiver_id])
        return self._goal_to_out(goal, conn, user_id, users_by_id)

    async def list_goals(self, user_id: UUID) -> list[SharedGoalOut]:
        """Return all active goals where the calling user is a participant.

        Joins shared_goals → peer_connections to filter by participant.
        Results are ordered newest-first.
        """
        rows = await self._goals.list_active_for_participant(user_id)

        if not rows:
            return []

        # Collect all unique participant IDs across all goals in one query
        all_user_ids: set[UUID] = set()
        for goal, conn in rows:
            all_user_ids.add(conn.requester_id)
            all_user_ids.add(conn.receiver_id)

        users_by_id = await self._users.get_profiles(list(all_user_ids))

        return [
            self._goal_to_out(goal, conn, user_id, users_by_id)
            for goal, conn in rows
        ]

    async def get_goal(self, user_id: UUID, goal_id: UUID) -> SharedGoalOut:
        """Return a single goal (calling user must be a participant)."""
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)
        users_by_id = await self._users.get_profiles([conn.requester_id, conn.receiver_id])
        return self._goal_to_out(goal, conn, user_id, users_by_id)

    async def update_contribution(
        self, user_id: UUID, goal_id: UUID, amount: Decimal
    ) -> SharedGoalOut:
        """Set the calling user's contribution to *amount* (absolute, not delta).

        If the new total meets or exceeds target_amount the goal is
        automatically marked as 'completed'.
        """
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)

        if goal.status != GoalStatus.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update contribution on a '{goal.status}' goal",
            )

        # Update the correct side
        is_requester = conn.requester_id == user_id
        if is_requester:
            goal.requester_amount = amount
        else:
            goal.receiver_amount = amount

        goal.updated_at = datetime.now(timezone.utc)

        # Auto-complete when total >= target
        total = goal.requester_amount + goal.receiver_amount
        if total >= goal.target_amount:
            goal.status = GoalStatus.completed

        await self.session.commit()
        await self._goals.refresh(goal)

        users_by_id = await self._users.get_profiles([conn.requester_id, conn.receiver_id])
        return self._goal_to_out(goal, conn, user_id, users_by_id)

    async def delete_goal(self, user_id: UUID, goal_id: UUID) -> None:
        """Delete a shared goal.  Only the creator (created_by) may do this."""
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

        await self._goals.delete(goal)
        await self.session.commit()

    # ------------------------------------------------------------------
    # Saving records — per-deposit audit trail
    # ------------------------------------------------------------------

    async def list_records(
        self, user_id: UUID, goal_id: UUID
    ) -> list[SavingRecordOut]:
        """List all saving records for a goal (both participants can view).

        Results are ordered newest-first by record_date then created_at.
        """
        # Verify the caller is a participant in this goal's connection.
        await self._get_goal_and_connection(goal_id, user_id)
        records = await self._records.list_for_goal(goal_id)
        users_by_id = await self._users.get_profiles([r.user_id for r in records])
        return [self._record_to_out(r, users_by_id) for r in records]

    async def add_record(
        self, user_id: UUID, goal_id: UUID, data: SavingRecordCreate
    ) -> SavingRecordOut:
        """Add a new saving record and recalculate the user's total on the goal.

        Only allowed when the goal is in 'active' status.
        """
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)
        if goal.status != GoalStatus.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot add record to a '{goal.status}' goal",
            )
        record = SavingRecord(
            id=uuid.uuid4(),
            goal_id=goal_id,
            user_id=user_id,
            amount=data.amount,
            record_date=data.record_date,
            note=data.note,
        )
        self._records.add(record)
        await self.session.flush()
        await self._recalc_contribution(goal, conn, user_id)
        await self.session.commit()
        await self._records.refresh(record)
        users_by_id = await self._users.get_profiles([user_id])
        return self._record_to_out(record, users_by_id)

    async def update_record(
        self,
        user_id: UUID,
        goal_id: UUID,
        record_id: UUID,
        data: SavingRecordUpdate,
    ) -> SavingRecordOut:
        """Update an existing record (only the record owner may edit)."""
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)
        record = await self._records.get_by_id(record_id, goal_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Record not found",
            )
        if record.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only edit your own records",
            )
        if data.amount is not None:
            record.amount = data.amount
        if data.record_date is not None:
            record.record_date = data.record_date
        if data.note is not None:
            record.note = data.note
        record.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        await self._recalc_contribution(goal, conn, user_id)
        await self.session.commit()
        await self._records.refresh(record)
        users_by_id = await self._users.get_profiles([user_id])
        return self._record_to_out(record, users_by_id)

    async def delete_record(
        self, user_id: UUID, goal_id: UUID, record_id: UUID
    ) -> None:
        """Delete a saving record (only the record owner may delete)."""
        goal, conn = await self._get_goal_and_connection(goal_id, user_id)
        record = await self._records.get_by_id(record_id, goal_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Record not found",
            )
        if record.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only delete your own records",
            )
        await self._records.delete(record)
        await self.session.flush()
        await self._recalc_contribution(goal, conn, user_id)
        await self.session.commit()

    async def _recalc_contribution(
        self, goal: SharedGoal, conn: PeerConnection, user_id: UUID
    ) -> None:
        """Recompute requester_amount or receiver_amount from sum of all records.

        Called after every add / update / delete so the running totals on
        SharedGoal always equal the sum of the individual SavingRecord rows.
        Auto-completes the goal when the combined total meets target_amount.
        """
        new_total = await self._records.sum_for_user(goal.id, user_id)
        is_requester = conn.requester_id == user_id
        if is_requester:
            goal.requester_amount = new_total
        else:
            goal.receiver_amount = new_total
        combined = goal.requester_amount + goal.receiver_amount
        if combined >= goal.target_amount and goal.status == GoalStatus.active:
            goal.status = GoalStatus.completed
        goal.updated_at = datetime.now(timezone.utc)

    def _record_to_out(
        self, record: SavingRecord, users_by_id: dict
    ) -> SavingRecordOut:
        """Map a SavingRecord ORM object to SavingRecordOut."""
        profile = users_by_id.get(record.user_id, {})
        rd = record.record_date
        ca = record.created_at
        return SavingRecordOut(
            id=str(record.id),
            goal_id=str(record.goal_id),
            user_id=str(record.user_id),
            user_name=profile.get("name", "Unknown"),
            amount=float(record.amount),
            record_date=rd.isoformat() if hasattr(rd, "isoformat") else str(rd),
            note=record.note,
            created_at=ca.isoformat() if hasattr(ca, "isoformat") else str(ca),
        )

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
    ) -> SharedGoalOut:
        """Map a SharedGoal ORM object + its connection to SharedGoalOut.

        The 'your_*' / 'peer_*' fields are resolved relative to *user_id* so
        the frontend always receives a self-oriented view regardless of which
        side the user is on.
        """
        is_requester = conn.requester_id == user_id
        peer_id = conn.receiver_id if is_requester else conn.requester_id

        your_amount = float(
            goal.requester_amount if is_requester else goal.receiver_amount
        )
        peer_amount = float(
            goal.receiver_amount if is_requester else goal.requester_amount
        )

        your_profile = users_by_id.get(user_id, {})
        peer_profile = users_by_id.get(peer_id, {})

        total = your_amount + peer_amount
        target = float(goal.target_amount)
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
            status=goal.status if isinstance(goal.status, str) else goal.status.value,
            your_amount=your_amount,
            peer_amount=peer_amount,
            your_name=your_profile.get("name", "Unknown"),
            peer_name=peer_profile.get("name", "Unknown"),
            your_user_id=str(user_id),
            peer_user_id=str(peer_id),
            total_amount=total,
            progress_pct=round(progress_pct, 2),
            is_creator=(goal.created_by == user_id),
            created_at=created_at_str,
        )

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
