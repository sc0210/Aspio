"""
Bill splitting between the two people on a peer connection.

Share basis. Each person's ledger holds an ordinary expense for their own share,
so every existing total, review and dashboard figure is right with no change to
any aggregation: across the two ledgers the shares add up to exactly the cash
that left. Nothing is ever written into a partner's ledger without their
consent: their row is created only when they accept (or under a standing
auto-accept they chose). What one owes the other is derived from accepted
splits, never stored.

Until the partner answers, the payer's own row carries the whole bill; on accept
it shrinks to the payer's share, and on decline it stays whole (they carry it).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import (
    Notification,
    NotificationChannel,
    NotificationPriority,
    NotificationStatus,
    NotificationType,
)
from app.modules.peers.models import (
    PeerConnection,
    PeerConnectionPref,
    PeerSplit,
    PeerSplitShare,
    PeerStatus,
    ShareStatus,
    SplitPolicy,
    SplitStatus,
)
from app.modules.peers.schemas import (
    CurrencyBalance,
    PeerBalanceOut,
    PeerPrefsOut,
    SplitCreate,
    SplitOut,
)
from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository
from app.modules.users.models import User

CENT = Decimal("0.01")
SPLITS_URL = "/savings?tab=splits"


def split_amounts(total: Decimal, method: str, payer_is_me: bool,
                  my_percent: Optional[Decimal], my_amount: Optional[Decimal]) -> tuple[Decimal, Decimal]:
    """(my_share, partner_share), summing to total exactly.

    equal: the non-payer takes the cents-floor half and the payer the rest, so a
    rounding cent is never owed to anyone.
    """
    total = Decimal(total).quantize(CENT)
    if method == "equal":
        half = (total / 2).quantize(CENT, rounding=ROUND_DOWN)
        mine = total - half if payer_is_me else half
    elif method == "percent":
        if my_percent is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "my_percent is required for a percent split")
        mine = (total * Decimal(my_percent) / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    elif method == "fixed":
        if my_amount is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "my_amount is required for a fixed split")
        mine = Decimal(my_amount).quantize(CENT)
        if mine > total:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Your share can't exceed the total")
    else:  # pragma: no cover - the schema restricts it
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown split method {method}")
    return mine, total - mine


class SplitService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._txns = TransactionRepository(session)

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    async def _connection(self, connection_id: UUID, user_id: UUID) -> PeerConnection:
        conn = (await self.session.execute(select(PeerConnection).where(and_(
            PeerConnection.id == connection_id,
            or_(PeerConnection.requester_id == user_id, PeerConnection.receiver_id == user_id),
            PeerConnection.status == PeerStatus.ACCEPTED,
        )))).scalars().first()
        if conn is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
        return conn

    @staticmethod
    def _partner(conn: PeerConnection, user_id: UUID) -> UUID:
        return conn.receiver_id if conn.requester_id == user_id else conn.requester_id

    async def _policy(self, connection_id: UUID, user_id: UUID) -> str:
        pref = await self.session.get(PeerConnectionPref, (connection_id, user_id))
        return pref.split_policy if pref else SplitPolicy.APPROVE_EACH.value

    async def _name(self, user_id: UUID) -> str:
        user = await self.session.get(User, user_id)
        return (user.name if user else None) or "Your partner"

    async def _split_for(self, split_id: UUID, user_id: UUID) -> PeerSplit:
        split = await self.session.get(PeerSplit, split_id)
        if split is None or not any(s.user_id == user_id for s in split.shares):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Split not found")
        return split

    async def _expense_category(self, category_id: UUID) -> TransactionCategory:
        category = await self.session.get(TransactionCategory, category_id)
        if category is None or not category.is_active or category.type != CategoryType.EXPENSE:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick an active expense category")
        return category

    async def _row_for(self, share: PeerSplitShare) -> Optional[Transaction]:
        return (await self.session.execute(select(Transaction).where(and_(
            Transaction.peer_split_share_id == share.id,
            Transaction.is_deleted == False,  # noqa: E712
        )))).scalars().first()

    # ------------------------------------------------------------------
    # Ledger rows
    # ------------------------------------------------------------------

    async def _write_row(self, split: PeerSplit, share: PeerSplitShare, amount: Decimal,
                         category_id: UUID, wallet_type: str) -> None:
        if amount <= 0:
            return
        await self._txns.create({
            "type": TransactionType.EXPENSE,
            "wallet_type": TransactionWalletType(wallet_type),
            "amount": amount,
            "currency": split.currency,
            "description": split.description,
            "transaction_date": split.split_date,
            "category_id": category_id,
            "status": TransactionStatus.COMPLETED,
            "processed_at": datetime.now(timezone.utc),
            "peer_split_share_id": share.id,
        }, str(share.user_id), commit=False)

    async def _set_row_amount(self, share: PeerSplitShare, amount: Decimal) -> None:
        row = await self._row_for(share)
        if row is None:
            return
        if amount <= 0:
            row.is_deleted = True
            row.deleted_at = datetime.now(timezone.utc)
        else:
            row.amount = amount
            row.amount_usd = amount * (row.exchange_rate or Decimal("1"))
        await self.session.flush()

    def _notify(self, user_id: UUID, title: str, message: str, action: str, split: PeerSplit) -> None:
        self.session.add(Notification(
            id=uuid.uuid4(), user_id=user_id, type=NotificationType.SYSTEM_UPDATE,
            priority=NotificationPriority.MEDIUM, status=NotificationStatus.PENDING,
            title=title, message=message, action_url=SPLITS_URL, is_actionable=True,
            data={"action": action, "split_id": str(split.id)},
            channels=[NotificationChannel.IN_APP],
        ))

    # ------------------------------------------------------------------
    # Create / respond / void
    # ------------------------------------------------------------------

    async def create_split(self, user_id: UUID, data: SplitCreate) -> SplitOut:
        conn = await self._connection(data.connection_id, user_id)
        partner_id = self._partner(conn, user_id)
        partner_policy = await self._policy(conn.id, partner_id)
        if partner_policy == SplitPolicy.OFF.value:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your partner has turned off bill splitting with you")
        await self._expense_category(data.category_id)

        payer_is_me = data.payer == "me"
        mine, theirs = split_amounts(data.total_amount, data.method, payer_is_me, data.my_percent, data.my_amount)

        split = PeerSplit(
            id=uuid.uuid4(), connection_id=conn.id, created_by=user_id,
            payer_id=user_id if payer_is_me else partner_id,
            description=data.description.strip(), total_amount=mine + theirs,
            currency=data.currency.upper(), category_id=data.category_id,
            split_date=data.split_date, method=data.method, status=SplitStatus.PROPOSED.value,
        )
        my_share = PeerSplitShare(id=uuid.uuid4(), split_id=split.id, user_id=user_id,
                                  share_amount=mine, status=ShareStatus.ACCEPTED.value)
        their_share = PeerSplitShare(id=uuid.uuid4(), split_id=split.id, user_id=partner_id,
                                     share_amount=theirs, status=ShareStatus.PROPOSED.value)
        split.shares = [my_share, their_share]
        self.session.add(split)
        await self.session.flush()

        # The payer fronted the whole bill: until the partner takes their part,
        # the whole of it is the payer's spending.
        await self._write_row(split, my_share, split.total_amount if payer_is_me else mine,
                              data.category_id, "life")

        my_name = await self._name(user_id)
        if partner_policy == SplitPolicy.AUTO_ACCEPT.value:
            await self._accept(split, their_share, data.category_id, "life")
            self._notify(partner_id, "Shared bill added",
                         f"{my_name} split \"{split.description}\" with you; your share is in your ledger.",
                         "peer_split_added", split)
        else:
            self._notify(partner_id, "New shared bill",
                         f"{my_name} wants to split \"{split.description}\" with you.",
                         "peer_split_proposed", split)
        await self.session.commit()
        return await self.get_split(user_id, split.id)

    async def _accept(self, split: PeerSplit, share: PeerSplitShare,
                      category_id: Optional[UUID], wallet_type: str) -> None:
        if category_id is not None:
            await self._expense_category(category_id)
        share.status = ShareStatus.ACCEPTED.value
        await self._write_row(split, share, share.share_amount,
                              category_id or split.category_id, wallet_type)
        creator_share = next(s for s in split.shares if s.user_id == split.created_by)
        if split.payer_id == split.created_by:
            await self._set_row_amount(creator_share, creator_share.share_amount)
        split.status = SplitStatus.ACTIVE.value

    async def respond(self, user_id: UUID, split_id: UUID, action: str,
                      category_id: Optional[UUID], wallet_type: str) -> SplitOut:
        split = await self._split_for(split_id, user_id)
        share = next(s for s in split.shares if s.user_id == user_id)
        if split.status != SplitStatus.PROPOSED.value or share.status != ShareStatus.PROPOSED.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "This split is not waiting for your answer")

        name = await self._name(user_id)
        if action == "accept":
            await self._accept(split, share, category_id, wallet_type)
            self._notify(split.created_by, "Shared bill accepted",
                         f"{name} accepted \"{split.description}\".", "peer_split_accepted", split)
        else:
            share.status = ShareStatus.DECLINED.value
            split.status = SplitStatus.DECLINED.value
            # The creator keeps their row: whole if they paid (they carry it all);
            # if their partner paid, there is no shared bill left to owe for.
            if split.payer_id != split.created_by:
                creator_share = next(s for s in split.shares if s.user_id == split.created_by)
                await self._set_row_amount(creator_share, Decimal("0"))
            self._notify(split.created_by, "Shared bill declined",
                         f"{name} declined \"{split.description}\".", "peer_split_declined", split)
        await self.session.commit()
        return await self.get_split(user_id, split.id)

    async def void(self, user_id: UUID, split_id: UUID) -> SplitOut:
        """The creator withdraws a split the partner hasn't answered yet."""
        split = await self._split_for(split_id, user_id)
        if split.created_by != user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who created the split can withdraw it")
        if split.status != SplitStatus.PROPOSED.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "Only a split still waiting for an answer can be withdrawn")
        for share in split.shares:
            await self._set_row_amount(share, Decimal("0"))
        split.status = SplitStatus.VOIDED.value
        partner_id = next(s.user_id for s in split.shares if s.user_id != user_id)
        self._notify(partner_id, "Shared bill withdrawn",
                     f"{await self._name(user_id)} withdrew \"{split.description}\".", "peer_split_voided", split)
        await self.session.commit()
        return await self.get_split(user_id, split.id)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def _out(self, split: PeerSplit, user_id: UUID) -> SplitOut:
        mine = next(s for s in split.shares if s.user_id == user_id)
        theirs = next(s for s in split.shares if s.user_id != user_id)
        row = await self._row_for(mine)
        return SplitOut(
            id=str(split.id), connection_id=str(split.connection_id), description=split.description,
            total_amount=float(split.total_amount), currency=split.currency,
            split_date=split.split_date.isoformat(),
            category_id=str(split.category_id) if split.category_id else None,
            method=split.method, status=split.status, payer_is_me=split.payer_id == user_id,
            created_by_me=split.created_by == user_id, partner_name=await self._name(theirs.user_id),
            my_share=float(mine.share_amount), partner_share=float(theirs.share_amount),
            my_share_status=mine.status, partner_share_status=theirs.status,
            my_transaction_id=str(row.id) if row else None,
        )

    async def get_split(self, user_id: UUID, split_id: UUID) -> SplitOut:
        split = await self._split_for(split_id, user_id)
        await self.session.refresh(split, ["shares"])
        return await self._out(split, user_id)

    async def list_splits(self, user_id: UUID, connection_id: Optional[UUID] = None) -> list[SplitOut]:
        stmt = (
            select(PeerSplit)
            .join(PeerSplitShare, PeerSplitShare.split_id == PeerSplit.id)
            .where(PeerSplitShare.user_id == user_id)
            .order_by(PeerSplit.split_date.desc(), PeerSplit.created_at.desc())
        )
        if connection_id is not None:
            stmt = stmt.where(PeerSplit.connection_id == connection_id)
        splits = (await self.session.execute(stmt)).scalars().unique().all()
        return [await self._out(s, user_id) for s in splits]

    async def balances(self, user_id: UUID) -> list[PeerBalanceOut]:
        """Per accepted partner and currency: > 0 they owe you, < 0 you owe them."""
        conns = (await self.session.execute(select(PeerConnection).where(and_(
            or_(PeerConnection.requester_id == user_id, PeerConnection.receiver_id == user_id),
            PeerConnection.status == PeerStatus.ACCEPTED,
        )))).scalars().all()
        out = []
        for conn in conns:
            net: dict[str, Decimal] = defaultdict(Decimal)
            splits = (await self.session.execute(select(PeerSplit).where(and_(
                PeerSplit.connection_id == conn.id,
                PeerSplit.status == SplitStatus.ACTIVE.value,
            )))).scalars().all()
            for split in splits:
                if split.payer_id == user_id:
                    owed = next(s for s in split.shares if s.user_id != user_id).share_amount
                    net[split.currency] += owed
                else:
                    net[split.currency] -= next(s for s in split.shares if s.user_id == user_id).share_amount
            out.append(PeerBalanceOut(
                connection_id=str(conn.id),
                partner_name=await self._name(self._partner(conn, user_id)),
                balances=[CurrencyBalance(currency=c, net=float(v)) for c, v in sorted(net.items()) if v != 0],
            ))
        return out

    # ------------------------------------------------------------------
    # Preferences
    # ------------------------------------------------------------------

    async def get_prefs(self, user_id: UUID, connection_id: UUID) -> PeerPrefsOut:
        await self._connection(connection_id, user_id)
        return PeerPrefsOut(connection_id=str(connection_id),
                            split_policy=await self._policy(connection_id, user_id))

    async def set_prefs(self, user_id: UUID, connection_id: UUID, split_policy: str) -> PeerPrefsOut:
        await self._connection(connection_id, user_id)
        pref = await self.session.get(PeerConnectionPref, (connection_id, user_id))
        if pref is None:
            pref = PeerConnectionPref(connection_id=connection_id, user_id=user_id)
            self.session.add(pref)
        pref.split_policy = split_policy
        await self.session.commit()
        return PeerPrefsOut(connection_id=str(connection_id), split_policy=split_policy)
