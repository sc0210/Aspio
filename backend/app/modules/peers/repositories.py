"""
Repository layer for the Peers module.

Owns all raw database access for:
  - PeerConnection rows (find, insert, status transitions)
  - SharedGoal rows (CRUD)
  - SavingRecord rows (CRUD, per-user sum)
  - User look-ups used by peer comparison
  - Read-only cross-module queries (portfolio_holdings, currency_rates,
    transactions) needed for wallet totals and the compare chart

No business logic here — that lives in service.py.
The caller (service) is responsible for commit() / rollback().
"""

import uuid
import logging
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.peers.models import (
    GoalStatus,
    PeerConnection,
    PeerStatus,
    SavingRecord,
    SharedGoal,
)
from app.modules.users.models import User

logger = logging.getLogger(__name__)


class PeerConnectionRepository:
    """Raw DB operations for PeerConnection rows."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def find_any_between(
        self, requester_id: UUID, receiver_id: UUID
    ) -> Optional[PeerConnection]:
        """Return any existing connection row in either direction."""
        stmt = select(PeerConnection).where(
            or_(
                and_(
                    PeerConnection.requester_id == requester_id,
                    PeerConnection.receiver_id == receiver_id,
                ),
                and_(
                    PeerConnection.requester_id == receiver_id,
                    PeerConnection.receiver_id == requester_id,
                ),
            )
        )
        return (await self.session.execute(stmt)).scalars().first()

    async def list_non_removed(self, user_id: UUID) -> list[PeerConnection]:
        """Return all connections for user that are not REMOVED."""
        stmt = select(PeerConnection).where(
            and_(
                or_(
                    PeerConnection.requester_id == user_id,
                    PeerConnection.receiver_id == user_id,
                ),
                PeerConnection.status != PeerStatus.REMOVED,
            )
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_pending_for_receiver(
        self, connection_id: UUID, receiver_id: UUID
    ) -> Optional[PeerConnection]:
        """Return a PENDING invite addressed to receiver_id."""
        stmt = select(PeerConnection).where(
            and_(
                PeerConnection.id == connection_id,
                PeerConnection.receiver_id == receiver_id,
                PeerConnection.status == PeerStatus.PENDING,
            )
        )
        return (await self.session.execute(stmt)).scalars().first()

    async def get_for_participant(
        self, connection_id: UUID, user_id: UUID
    ) -> Optional[PeerConnection]:
        """Return a connection where user_id is either side (any status)."""
        stmt = select(PeerConnection).where(
            and_(
                PeerConnection.id == connection_id,
                or_(
                    PeerConnection.requester_id == user_id,
                    PeerConnection.receiver_id == user_id,
                ),
            )
        )
        return (await self.session.execute(stmt)).scalars().first()

    async def count_accepted(self, user_id: UUID) -> int:
        """Count accepted connections for a user (both sides)."""
        stmt = select(func.count()).where(
            and_(
                or_(
                    PeerConnection.requester_id == user_id,
                    PeerConnection.receiver_id == user_id,
                ),
                PeerConnection.status == PeerStatus.ACCEPTED,
            )
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def get_accepted_peer_ids(self, user_id: UUID) -> list[UUID]:
        """Return peer UUIDs connected via accepted connections."""
        stmt = select(
            PeerConnection.requester_id,
            PeerConnection.receiver_id,
        ).where(
            and_(
                or_(
                    PeerConnection.requester_id == user_id,
                    PeerConnection.receiver_id == user_id,
                ),
                PeerConnection.status == PeerStatus.ACCEPTED,
            )
        )
        rows = (await self.session.execute(stmt)).all()
        return [
            row.receiver_id if row.requester_id == user_id else row.requester_id
            for row in rows
        ]

    def add(self, conn: PeerConnection) -> None:
        """Stage a new PeerConnection for insertion."""
        self.session.add(conn)

    async def refresh(self, conn: PeerConnection) -> None:
        await self.session.refresh(conn)


class SharedGoalRepository:
    """Raw DB operations for SharedGoal rows."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def count_for_connection(self, connection_id: UUID) -> int:
        stmt = select(func.count()).where(
            SharedGoal.connection_id == connection_id
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def list_active_for_participant(
        self, user_id: UUID
    ) -> list[tuple[SharedGoal, PeerConnection]]:
        """Return (goal, connection) pairs where the user is a participant."""
        stmt = (
            select(SharedGoal, PeerConnection)
            .join(PeerConnection, SharedGoal.connection_id == PeerConnection.id)
            .where(
                and_(
                    or_(
                        PeerConnection.requester_id == user_id,
                        PeerConnection.receiver_id == user_id,
                    ),
                    SharedGoal.status == GoalStatus.active,
                    PeerConnection.status == PeerStatus.ACCEPTED,
                )
            )
            .order_by(SharedGoal.created_at.desc())
        )
        return list((await self.session.execute(stmt)).all())

    async def get_with_connection(
        self, goal_id: UUID, user_id: UUID
    ) -> Optional[tuple[SharedGoal, PeerConnection]]:
        """Return (goal, connection) verifying user is a participant of an accepted connection."""
        stmt = (
            select(SharedGoal, PeerConnection)
            .join(PeerConnection, SharedGoal.connection_id == PeerConnection.id)
            .where(
                and_(
                    SharedGoal.id == goal_id,
                    or_(
                        PeerConnection.requester_id == user_id,
                        PeerConnection.receiver_id == user_id,
                    ),
                    # Removing a peer ends the sharing for both sides. Re-inviting
                    # reuses this connection row, so accepting again brings it back.
                    PeerConnection.status == PeerStatus.ACCEPTED,
                )
            )
        )
        return (await self.session.execute(stmt)).first()

    async def get_by_id(self, goal_id: UUID) -> Optional[SharedGoal]:
        stmt = select(SharedGoal).where(SharedGoal.id == goal_id)
        return (await self.session.execute(stmt)).scalars().first()

    def add(self, goal: SharedGoal) -> None:
        self.session.add(goal)

    async def delete(self, goal: SharedGoal) -> None:
        await self.session.delete(goal)

    async def refresh(self, goal: SharedGoal) -> None:
        await self.session.refresh(goal)


class SavingRecordRepository:
    """Raw DB operations for SavingRecord rows."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_for_goal(self, goal_id: UUID) -> list[SavingRecord]:
        stmt = (
            select(SavingRecord)
            .where(SavingRecord.goal_id == goal_id)
            .order_by(
                SavingRecord.record_date.desc(),
                SavingRecord.created_at.desc(),
            )
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_by_id(
        self, record_id: UUID, goal_id: UUID
    ) -> Optional[SavingRecord]:
        stmt = select(SavingRecord).where(
            and_(SavingRecord.id == record_id, SavingRecord.goal_id == goal_id)
        )
        return (await self.session.execute(stmt)).scalars().first()

    async def sum_for_user(self, goal_id: UUID, user_id: UUID) -> Decimal:
        """Return the sum of all saving records for user on a goal."""
        stmt = select(
            func.coalesce(func.sum(SavingRecord.amount), Decimal("0"))
        ).where(
            and_(SavingRecord.goal_id == goal_id, SavingRecord.user_id == user_id)
        )
        return (await self.session.execute(stmt)).scalar_one()

    def add(self, record: SavingRecord) -> None:
        self.session.add(record)

    async def delete(self, record: SavingRecord) -> None:
        await self.session.delete(record)

    async def refresh(self, record: SavingRecord) -> None:
        await self.session.refresh(record)


class PeerUserRepository:
    """Read-only look-ups on the User table for peer features."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def find_by_username(
        self, username: str, exclude_id: Optional[UUID] = None
    ) -> Optional[User]:
        """Find an active user by username (case-insensitive)."""
        conditions = [
            func.lower(User.username) == username.lower(),
            User.deleted_at.is_(None),
        ]
        if exclude_id is not None:
            conditions.append(User.id != exclude_id)
        stmt = select(User).where(and_(*conditions))
        return (await self.session.execute(stmt)).scalars().first()

    async def get_by_id(self, user_id: UUID) -> Optional[User]:
        stmt = select(User).where(User.id == user_id)
        return (await self.session.execute(stmt)).scalars().first()

    async def get_profiles(self, user_ids: list[UUID]) -> dict[UUID, dict]:
        """Batch-fetch id + name for the given user IDs."""
        if not user_ids:
            return {}
        stmt = select(User.id, User.name).where(User.id.in_(user_ids))
        rows = (await self.session.execute(stmt)).mappings().all()
        return {row["id"]: dict(row) for row in rows}

    async def get_full_profiles(self, user_ids: list[UUID]) -> dict[UUID, dict]:
        """Batch-fetch id, username, name, avatar_url for the given user IDs."""
        if not user_ids:
            return {}
        stmt = select(
            User.id,
            User.username,
            User.name,
            User.avatar_url,
        ).where(User.id.in_(user_ids))
        rows = (await self.session.execute(stmt)).mappings().all()
        return {row["id"]: dict(row) for row in rows}

    async def get_profile_row(self, user_id: UUID) -> Optional[dict]:
        """Return a single user's public profile fields as a dict."""
        stmt = select(
            User.id,
            User.username,
            User.name,
            User.avatar_url,
        ).where(User.id == user_id)
        row = (await self.session.execute(stmt)).mappings().first()
        return dict(row) if row else None


class PeerWalletRepository:
    """Read-only cross-module queries for wallet totals and compare chart data."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_total_debt(self, user_id: UUID) -> float:
        """Outstanding balance across active loans: the debt the dashboard subtracts."""
        from app.modules.loans.models import DebtAccount, LoanStatus

        stmt = select(func.coalesce(func.sum(DebtAccount.current_balance), 0)).where(
            DebtAccount.user_id == user_id,
            DebtAccount.status == LoanStatus.ACTIVE,
            DebtAccount.is_deleted == False,  # noqa: E712
        )
        return float((await self.session.execute(stmt)).scalar_one() or 0)

    async def get_wallet_holdings_by_type(self, user_id: UUID) -> list[dict]:
        """Holdings totals grouped by wallet_type, type and currency, unconverted.

        The service converts them to TWD. This query used to convert to USD
        through currency_rates, while the frontend labels every compare figure
        as TWD.
        """
        stmt = text(
            """
            SELECT
                ph.wallet_type,
                ph.type,
                ph.currency,
                COALESCE(SUM(ph.total_value), 0) AS total_value
            FROM portfolio_holdings ph
            WHERE ph.user_id = :user_id
              AND ph.is_active = TRUE
            GROUP BY ph.wallet_type, ph.type, ph.currency
            """
        )
        rows = (await self.session.execute(stmt, {"user_id": str(user_id)})).all()
        return [
            {
                "wallet_type": row[0],
                "type": row[1],
                "currency": row[2],
                "total_value": float(row[3] or 0),
            }
            for row in rows
        ]

