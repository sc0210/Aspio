"""
Bill splitting between the two people on a peer connection.

Share basis. Each person's ledger holds an ordinary expense for their own share,
so every existing total, review and dashboard figure is right with no change to
any aggregation: across the two ledgers the shares add up to exactly the cash
that left. Nothing is ever written into a partner's ledger without their
consent: their row is created only when they accept (or under a standing
auto-accept they chose). What one owes the other is derived from accepted
splits less confirmed settlements, never stored.

Settling up writes no ledger rows either. The payer's row already holds only
their share and the partner's row holds theirs, so each ledger is already as if
the money had been paid back; a repayment row would count it twice. A
settlement only lowers the balance.

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
from sqlalchemy import and_, func as sa_func, or_, select
from sqlalchemy.exc import IntegrityError
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
    PeerSettlement,
    PeerSplit,
    PeerSplitShare,
    PeerStatus,
    SettlementStatus,
    ShareStatus,
    SplitPolicy,
    SplitStatus,
)
from app.modules.peers.schemas import (
    CurrencyBalance,
    PeerBalanceOut,
    PeerPrefsOut,
    SettlementCreate,
    SettlementOut,
    SplitCreate,
    SplitFromTransaction,
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
from app.utils.datetime_helpers import business_today

CENT = Decimal("0.01")
SPLITS_URL = "/savings?tab=splits"
# Unanswered proposals one person may have open with one partner (each one notifies).
MAX_OPEN_PROPOSALS = 20
LIST_LIMIT = 200


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
        self._names: dict[UUID, str] = {}

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
        if user_id not in self._names:
            user = await self.session.get(User, user_id)
            self._names[user_id] = (user.name if user else None) or "Your partner"
        return self._names[user_id]

    async def _split_for(self, split_id: UUID, user_id: UUID, *, lock: bool = False) -> PeerSplit:
        """The split, if the user is on it. lock=True row-locks it (Postgres) and
        re-reads it, for every path that writes ledger rows: a double-clicked
        Accept, or an Accept racing a withdraw, must see the other's result."""
        stmt = select(PeerSplit).where(PeerSplit.id == split_id)
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        split = (await self.session.execute(stmt)).scalars().first()
        if split is None or not any(s.user_id == user_id for s in split.shares):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Split not found")
        if lock:
            await self.session.refresh(split, ["shares"])
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

    async def _detach_rows(self, split: PeerSplit) -> None:
        """A closed split's surviving rows become ordinary expenses: unlinked, so
        a linked row always means an open split (the row's lock and the list's
        Split badge both rely on that)."""
        for share in split.shares:
            row = await self._row_for(share)
            if row is not None:
                row.peer_split_share_id = None
        await self.session.flush()

    def _notify(self, user_id: UUID, title: str, message: str, action: str,
                obj: PeerSplit | PeerSettlement) -> None:
        self.session.add(Notification(
            id=uuid.uuid4(), user_id=user_id, type=NotificationType.SYSTEM_UPDATE,
            priority=NotificationPriority.MEDIUM, status=NotificationStatus.PENDING,
            title=title, message=message, action_url=SPLITS_URL, is_actionable=True,
            data={"action": action,
                  ("settlement_id" if isinstance(obj, PeerSettlement) else "split_id"): str(obj.id)},
            channels=[NotificationChannel.IN_APP],
        ))

    # ------------------------------------------------------------------
    # Create / respond / void
    # ------------------------------------------------------------------

    async def create_split(self, user_id: UUID, data: SplitCreate) -> SplitOut:
        conn = await self._connection(data.connection_id, user_id)
        await self._expense_category(data.category_id)
        payer_is_me = data.payer == "me"
        mine, theirs = split_amounts(data.total_amount, data.method, payer_is_me, data.my_percent, data.my_amount)
        return await self._propose(
            user_id, conn, payer_is_me=payer_is_me, mine=mine, theirs=theirs,
            description=data.description.strip(), currency=data.currency.upper(),
            category_id=data.category_id, split_date=data.split_date, method=data.method,
        )

    async def split_transaction(self, user_id: UUID, data: SplitFromTransaction) -> SplitOut:
        """Split an expense already in the user's ledger. They paid it, and that
        row becomes their share's row: whole until the partner accepts, then
        their share. Withdrawing or a decline hands it back whole."""
        conn = await self._connection(data.connection_id, user_id)
        row = (await self.session.execute(
            select(Transaction).where(and_(
                Transaction.id == data.transaction_id,
                Transaction.user_id == user_id,
                Transaction.is_deleted == False,  # noqa: E712
            )).with_for_update().execution_options(populate_existing=True)
        )).scalars().first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
        reason = _unsplittable(row)
        if reason:
            raise HTTPException(status.HTTP_409_CONFLICT, reason)
        mine, theirs = split_amounts(row.amount, data.method, True, data.my_percent, data.my_amount)
        return await self._propose(
            user_id, conn, payer_is_me=True, mine=mine, theirs=theirs,
            description=(row.description or "Shared bill")[:200], currency=row.currency.upper(),
            category_id=row.category_id, split_date=row.transaction_date, method=data.method,
            source=row,
        )

    async def _propose(self, user_id: UUID, conn: PeerConnection, *, payer_is_me: bool,
                       mine: Decimal, theirs: Decimal, description: str, currency: str,
                       category_id: UUID, split_date, method: str,
                       source: Optional[Transaction] = None) -> SplitOut:
        partner_id = self._partner(conn, user_id)
        partner_policy = await self._policy(conn.id, partner_id)
        if partner_policy == SplitPolicy.OFF.value:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your partner has turned off bill splitting with you")
        open_count = (await self.session.execute(
            select(sa_func.count()).select_from(PeerSplit).where(and_(
                PeerSplit.connection_id == conn.id,
                PeerSplit.created_by == user_id,
                PeerSplit.status == SplitStatus.PROPOSED.value,
            ))
        )).scalar_one()
        if open_count >= MAX_OPEN_PROPOSALS:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Too many bills are waiting for your partner's answer")

        split = PeerSplit(
            id=uuid.uuid4(), connection_id=conn.id, created_by=user_id,
            payer_id=user_id if payer_is_me else partner_id,
            description=description, total_amount=mine + theirs, currency=currency,
            category_id=category_id, split_date=split_date, method=method,
            status=SplitStatus.PROPOSED.value,
            source_transaction_id=source.id if source is not None else None,
        )
        my_share = PeerSplitShare(id=uuid.uuid4(), split_id=split.id, user_id=user_id,
                                  share_amount=mine, status=ShareStatus.ACCEPTED.value)
        their_share = PeerSplitShare(id=uuid.uuid4(), split_id=split.id, user_id=partner_id,
                                     share_amount=theirs, status=ShareStatus.PROPOSED.value)
        split.shares = [my_share, their_share]
        self.session.add(split)
        await self.session.flush()

        if source is not None:
            # The expense already carries the whole bill: it becomes the payer's row.
            source.peer_split_share_id = my_share.id
            await self.session.flush()
        else:
            # The payer fronted the whole bill: until the partner takes their part,
            # the whole of it is the payer's spending.
            await self._write_row(split, my_share, split.total_amount if payer_is_me else mine,
                                  category_id, "life")

        my_name = await self._name(user_id)
        if partner_policy == SplitPolicy.AUTO_ACCEPT.value:
            await self._accept(split, their_share, category_id, "life")
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
        split = await self._split_for(split_id, user_id, lock=True)
        # A removed partner can't answer an old proposal.
        await self._connection(split.connection_id, user_id)
        share = next(s for s in split.shares if s.user_id == user_id)
        if split.status != SplitStatus.PROPOSED.value or share.status != ShareStatus.PROPOSED.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "This split is not waiting for your answer")

        name = await self._name(user_id)
        if action == "accept":
            try:
                await self._accept(split, share, category_id, wallet_type)
            except IntegrityError as e:
                # Backstop for the row lock (SQLite has none): only a collision on
                # the one-live-row-per-share index means another Accept won.
                # Anything else is a real failure and must surface.
                if not _is_live_row_collision(e):
                    raise
                await self.session.rollback()
                raise HTTPException(status.HTTP_409_CONFLICT, "This split was already answered")
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
            await self._detach_rows(split)
            self._notify(split.created_by, "Shared bill declined",
                         f"{name} declined \"{split.description}\".", "peer_split_declined", split)
        await self.session.commit()
        return await self.get_split(user_id, split.id)

    async def void(self, user_id: UUID, split_id: UUID) -> SplitOut:
        """The creator withdraws a split the partner hasn't answered yet."""
        split = await self._split_for(split_id, user_id, lock=True)
        if split.created_by != user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who created the split can withdraw it")
        if split.status != SplitStatus.PROPOSED.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "Only a split still waiting for an answer can be withdrawn")
        for share in split.shares:
            if split.source_transaction_id is not None and share.user_id == split.created_by:
                continue  # an expense they recorded themselves: handed back below
            await self._set_row_amount(share, Decimal("0"))
        # Unlinked, the expense they split (still whole) is theirs to edit again.
        await self._detach_rows(split)
        split.status = SplitStatus.VOIDED.value
        partner_id = next(s.user_id for s in split.shares if s.user_id != user_id)
        self._notify(partner_id, "Shared bill withdrawn",
                     f"{await self._name(user_id)} withdrew \"{split.description}\".", "peer_split_voided", split)
        await self.session.commit()
        return await self.get_split(user_id, split.id)

    async def cancel(self, user_id: UUID, split_id: UUID) -> SplitOut:
        """The payer takes an accepted split back: their row returns to the whole
        bill and the partner's row goes. Only the payer, since it only ever moves
        cost onto the person cancelling; the other way round would push their
        share onto the payer without asking."""
        split = await self._split_for(split_id, user_id, lock=True)
        if split.status != SplitStatus.ACTIVE.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "Only an accepted split can be cancelled")
        if split.payer_id != user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Only the person who paid can cancel the split; ask them to")
        payer_share = next(s for s in split.shares if s.user_id == user_id)
        other_share = next(s for s in split.shares if s.user_id != user_id)
        if all([await self._row_for(s) is None for s in split.shares]):
            # Removing the partner unlinked both rows (a linked row always
            # means an open split), so each is now an ordinary expense its owner
            # may have edited. That holds even if the same connection row was
            # re-accepted since. Rewriting them would count the bill twice;
            # closing the split only clears the balance.
            split.status = SplitStatus.VOIDED.value
            self._notify(other_share.user_id, "Shared bill closed",
                         f"{await self._name(user_id)} closed \"{split.description}\"; nothing is owed on it now.",
                         "peer_split_cancelled", split)
            await self.session.commit()
            return await self.get_split(user_id, split.id)
        if await self._row_for(payer_share) is None:
            await self._write_row(split, payer_share, split.total_amount, split.category_id, "life")
        else:
            await self._set_row_amount(payer_share, split.total_amount)
        await self._set_row_amount(other_share, Decimal("0"))
        await self._detach_rows(split)
        split.status = SplitStatus.VOIDED.value
        self._notify(other_share.user_id, "Shared bill cancelled",
                     f"{await self._name(user_id)} cancelled \"{split.description}\"; your share was removed.",
                     "peer_split_cancelled", split)
        await self.session.commit()
        return await self.get_split(user_id, split.id)

    async def close_for_removed_connection(self, connection_id: UUID) -> None:
        """When a partner is removed: an unanswered proposal ends as if declined
        (the payer keeps the whole bill; a non-payer creator's share goes), and an
        accepted split keeps its numbers but its rows unlock, so neither person is
        left with entries they can't edit. Flushes; the caller commits."""
        splits = (await self.session.execute(select(PeerSplit).where(and_(
            PeerSplit.connection_id == connection_id,
            PeerSplit.status.in_((SplitStatus.PROPOSED.value, SplitStatus.ACTIVE.value)),
        )))).scalars().all()
        for split in splits:
            if split.status == SplitStatus.PROPOSED.value:
                for share in split.shares:
                    if share.status == ShareStatus.PROPOSED.value:
                        share.status = ShareStatus.DECLINED.value
                if split.payer_id != split.created_by:
                    creator_share = next(s for s in split.shares if s.user_id == split.created_by)
                    await self._set_row_amount(creator_share, Decimal("0"))
                split.status = SplitStatus.DECLINED.value
            await self._detach_rows(split)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def _out(self, split: PeerSplit, user_id: UUID,
                   rows: Optional[dict[UUID, UUID]] = None) -> SplitOut:
        mine = next(s for s in split.shares if s.user_id == user_id)
        theirs = next(s for s in split.shares if s.user_id != user_id)
        if rows is None:
            row = await self._row_for(mine)
            row_id = row.id if row else None
        else:
            row_id = rows.get(mine.id)
        return SplitOut(
            id=str(split.id), connection_id=str(split.connection_id), description=split.description,
            total_amount=float(split.total_amount), currency=split.currency,
            split_date=split.split_date.isoformat(),
            category_id=str(split.category_id) if split.category_id else None,
            method=split.method, status=split.status, payer_is_me=split.payer_id == user_id,
            created_by_me=split.created_by == user_id, partner_name=await self._name(theirs.user_id),
            my_share=float(mine.share_amount), partner_share=float(theirs.share_amount),
            my_share_status=mine.status, partner_share_status=theirs.status,
            my_transaction_id=str(row_id) if row_id else None,
        )

    async def get_split(self, user_id: UUID, split_id: UUID) -> SplitOut:
        split = await self._split_for(split_id, user_id)
        await self.session.refresh(split, ["shares"])
        return await self._out(split, user_id)

    async def list_splits(self, user_id: UUID, connection_id: Optional[UUID] = None) -> list[SplitOut]:
        """Every open split (they make up the balance, so none may be cut off),
        then the most recent LIST_LIMIT closed ones."""
        open_states = (SplitStatus.PROPOSED.value, SplitStatus.ACTIVE.value)

        def query(open_: bool):
            stmt = (
                select(PeerSplit)
                .join(PeerSplitShare, PeerSplitShare.split_id == PeerSplit.id)
                .where(PeerSplitShare.user_id == user_id)
                .where(PeerSplit.status.in_(open_states) if open_ else PeerSplit.status.notin_(open_states))
                .order_by(PeerSplit.split_date.desc(), PeerSplit.created_at.desc())
            )
            if connection_id is not None:
                stmt = stmt.where(PeerSplit.connection_id == connection_id)
            return stmt if open_ else stmt.limit(LIST_LIMIT)

        splits = [
            *(await self.session.execute(query(True))).scalars().unique().all(),
            *(await self.session.execute(query(False))).scalars().unique().all(),
        ]
        # One query for every split's ledger row, not one per split.
        my_share_ids = [s.id for split in splits for s in split.shares if s.user_id == user_id]
        rows = dict((await self.session.execute(
            select(Transaction.peer_split_share_id, Transaction.id).where(and_(
                Transaction.peer_split_share_id.in_(my_share_ids),
                Transaction.is_deleted == False,  # noqa: E712
            ))
        )).all()) if my_share_ids else {}
        return [await self._out(s, user_id, rows) for s in splits]

    async def balances(self, user_id: UUID) -> list[PeerBalanceOut]:
        """Per partner and currency: > 0 they owe you, < 0 you owe them.

        Every accepted partner is listed (even at zero), plus any former partner
        an accepted split still leaves a balance with: removing someone mustn't
        make what's owed disappear.
        """
        conns = (await self.session.execute(select(PeerConnection).where(
            or_(PeerConnection.requester_id == user_id, PeerConnection.receiver_id == user_id),
        ))).scalars().all()
        net = await self._net(user_id)

        out = []
        for conn in conns:
            owed = {c: v for c, v in net.get(conn.id, {}).items() if v != 0}
            if conn.status != PeerStatus.ACCEPTED and not owed:
                continue
            out.append(PeerBalanceOut(
                connection_id=str(conn.id),
                partner_name=await self._name(self._partner(conn, user_id)),
                balances=[CurrencyBalance(currency=c, net=float(v)) for c, v in sorted(owed.items())],
            ))
        return out

    async def _net(self, user_id: UUID, connection_id: Optional[UUID] = None) -> dict[UUID, dict[str, Decimal]]:
        """{connection: {currency: amount}}, > 0 when the partner owes the user:
        accepted splits, less confirmed settlements."""
        split_q = (
            select(PeerSplit)
            .join(PeerSplitShare, PeerSplitShare.split_id == PeerSplit.id)
            .where(and_(PeerSplitShare.user_id == user_id, PeerSplit.status == SplitStatus.ACTIVE.value))
        )
        settle_q = select(PeerSettlement).where(and_(
            or_(PeerSettlement.from_user_id == user_id, PeerSettlement.to_user_id == user_id),
            PeerSettlement.status == SettlementStatus.CONFIRMED.value,
        ))
        if connection_id is not None:
            split_q = split_q.where(PeerSplit.connection_id == connection_id)
            settle_q = settle_q.where(PeerSettlement.connection_id == connection_id)
        active = (await self.session.execute(split_q)).scalars().unique().all()
        settled = (await self.session.execute(settle_q)).scalars().all()

        net: dict[UUID, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        for split in active:
            mine = next(s for s in split.shares if s.user_id == user_id)
            theirs = next(s for s in split.shares if s.user_id != user_id)
            if split.payer_id == user_id:
                net[split.connection_id][split.currency] += theirs.share_amount
            else:
                net[split.connection_id][split.currency] -= mine.share_amount
        for st in settled:
            sign = -1 if st.to_user_id == user_id else 1
            net[st.connection_id][st.currency] += sign * st.amount
        return net

    # ------------------------------------------------------------------
    # Settling up
    # ------------------------------------------------------------------

    async def _any_connection(self, connection_id: UUID, user_id: UUID) -> PeerConnection:
        """The connection, locked, in any state: a former partner's balance can
        still be settled."""
        conn = (await self.session.execute(
            select(PeerConnection).where(and_(
                PeerConnection.id == connection_id,
                or_(PeerConnection.requester_id == user_id, PeerConnection.receiver_id == user_id),
            )).with_for_update().execution_options(populate_existing=True)
        )).scalars().first()
        if conn is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
        return conn

    async def _check_owed(self, settlement: PeerSettlement) -> None:
        owed = (await self._net(settlement.to_user_id, settlement.connection_id))[
            settlement.connection_id][settlement.currency]
        if settlement.amount > owed:
            shown = f"{max(owed, Decimal('0')):,.2f} {settlement.currency}"
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"That's more than is owed: {shown} is outstanding")

    async def _settlement_out(self, st: PeerSettlement, user_id: UUID) -> SettlementOut:
        partner = st.to_user_id if st.from_user_id == user_id else st.from_user_id
        return SettlementOut(
            id=str(st.id), connection_id=str(st.connection_id), partner_name=await self._name(partner),
            i_paid=st.from_user_id == user_id, created_by_me=st.created_by == user_id,
            amount=float(st.amount), currency=st.currency, settled_on=st.settled_on.isoformat(),
            note=st.note, status=st.status,
        )

    async def _settlement_for(self, settlement_id: UUID, user_id: UUID) -> PeerSettlement:
        st = (await self.session.execute(
            select(PeerSettlement).where(PeerSettlement.id == settlement_id)
            .with_for_update().execution_options(populate_existing=True)
        )).scalars().first()
        if st is None or user_id not in (st.from_user_id, st.to_user_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Settlement not found")
        return st

    async def create_settlement(self, user_id: UUID, data: SettlementCreate) -> SettlementOut:
        """they_paid_me counts at once: it only lowers what the user is owed.
        i_paid_them waits for the partner to confirm the money arrived.

        Removing a partner leaves repayments alone, proposed ones included: the
        balance outlives removal, and so does a claim that money was sent."""
        conn = await self._any_connection(data.connection_id, user_id)
        partner_id = self._partner(conn, user_id)
        received = data.direction == "they_paid_me"
        if not received:
            pending = (await self.session.execute(
                select(sa_func.count()).select_from(PeerSettlement).where(and_(
                    PeerSettlement.connection_id == conn.id,
                    PeerSettlement.created_by == user_id,
                    PeerSettlement.status == SettlementStatus.PROPOSED.value,
                ))
            )).scalar_one()
            if pending >= MAX_OPEN_PROPOSALS:
                raise HTTPException(status.HTTP_409_CONFLICT,
                                    "Too many repayments are waiting for your partner to confirm")
        st = PeerSettlement(
            id=uuid.uuid4(), connection_id=conn.id,
            from_user_id=partner_id if received else user_id,
            to_user_id=user_id if received else partner_id,
            created_by=user_id, amount=Decimal(data.amount).quantize(CENT),
            currency=data.currency.upper(), settled_on=data.settled_on or business_today(),
            note=(data.note or "").strip() or None,
            status=(SettlementStatus.CONFIRMED if received else SettlementStatus.PROPOSED).value,
        )
        await self._check_owed(st)
        self.session.add(st)
        me = await self._name(user_id)
        amount = f"{st.amount:,.2f} {st.currency}"
        if received:
            self._notify(partner_id, "Repayment recorded",
                         f"{me} recorded that you paid back {amount}.", "peer_settlement_recorded", st)
        else:
            self._notify(partner_id, "Did this arrive?",
                         f"{me} says they paid you back {amount}. Confirm it to clear it from what they owe.",
                         "peer_settlement_proposed", st)
        await self.session.commit()
        return await self._settlement_out(st, user_id)

    async def respond_settlement(self, user_id: UUID, settlement_id: UUID, action: str) -> SettlementOut:
        st = await self._settlement_for(settlement_id, user_id)
        if st.status != SettlementStatus.PROPOSED.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "This repayment has already been answered")
        if st.to_user_id != user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person paid can confirm a repayment")
        await self._any_connection(st.connection_id, user_id)  # serialise with other settlements
        if action == "confirm":
            await self._check_owed(st)  # the balance may have moved since it was sent
            st.status = SettlementStatus.CONFIRMED.value
        else:
            st.status = SettlementStatus.DECLINED.value
        amount = f"{st.amount:,.2f} {st.currency}"
        self._notify(st.from_user_id,
                     "Repayment confirmed" if action == "confirm" else "Repayment not confirmed",
                     f"{await self._name(user_id)} {'confirmed' if action == 'confirm' else 'did not confirm'}"
                     f" your repayment of {amount}.", "peer_settlement_confirmed" if action == "confirm" else "peer_settlement_declined", st)
        await self.session.commit()
        return await self._settlement_out(st, user_id)

    async def void_settlement(self, user_id: UUID, settlement_id: UUID) -> SettlementOut:
        """The sender withdraws an unconfirmed repayment, or the person paid undoes
        a confirmed one. Only ever raises what the one acting is owed, or takes
        back their own unanswered claim."""
        st = await self._settlement_for(settlement_id, user_id)
        if st.status == SettlementStatus.PROPOSED.value:
            if st.created_by != user_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Confirm or decline it instead")
        elif st.status == SettlementStatus.CONFIRMED.value:
            if st.to_user_id != user_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN,
                                    "Only the person who was paid can undo a repayment")
        else:
            raise HTTPException(status.HTTP_409_CONFLICT, "This repayment is already closed")
        was_confirmed = st.status == SettlementStatus.CONFIRMED.value
        st.status = SettlementStatus.VOIDED.value
        other = st.from_user_id if st.to_user_id == user_id else st.to_user_id
        amount = f"{st.amount:,.2f} {st.currency}"
        self._notify(other, "Repayment undone" if was_confirmed else "Repayment withdrawn",
                     f"{await self._name(user_id)} {'undid' if was_confirmed else 'withdrew'} the repayment of {amount}.",
                     "peer_settlement_voided", st)
        await self.session.commit()
        return await self._settlement_out(st, user_id)

    async def list_settlements(self, user_id: UUID) -> list[SettlementOut]:
        """Every unanswered repayment, then the most recent LIST_LIMIT others."""
        mine = or_(PeerSettlement.from_user_id == user_id, PeerSettlement.to_user_id == user_id)
        order = (PeerSettlement.settled_on.desc(), PeerSettlement.created_at.desc())
        proposed = PeerSettlement.status == SettlementStatus.PROPOSED.value
        rows = [
            *(await self.session.execute(select(PeerSettlement).where(and_(mine, proposed)).order_by(*order))).scalars(),
            *(await self.session.execute(select(PeerSettlement).where(and_(mine, ~proposed))
                                         .order_by(*order).limit(LIST_LIMIT))).scalars(),
        ]
        return [await self._settlement_out(st, user_id) for st in rows]

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
            pref = PeerConnectionPref(connection_id=connection_id, user_id=user_id, split_policy=split_policy)
            self.session.add(pref)
            try:
                await self.session.commit()
            except IntegrityError:
                # Two quick saves both found no row; the other inserted it.
                await self.session.rollback()
                pref = await self.session.get(PeerConnectionPref, (connection_id, user_id))
                if pref is None:  # not the insert race: a real failure
                    raise
                pref.split_policy = split_policy
                await self.session.commit()
        else:
            pref.split_policy = split_policy
            await self.session.commit()
        return PeerPrefsOut(connection_id=str(connection_id), split_policy=split_policy)


def _unsplittable(row: Transaction) -> Optional[str]:
    """Why this ledger row can't become a split, or None if it can."""
    if row.type != TransactionType.EXPENSE:
        return "Only an expense can be split"
    if row.peer_split_share_id is not None:
        return "This expense is already part of a split"
    if row.holding_id is not None:
        return "A purchase for a holding can't be split"
    if row.transfer_group_id is not None:
        return "A transfer between your wallets can't be split"
    if row.loan_id is not None:
        # Accepting would shrink the row and leave the loan's balance wrong.
        return "An expense that repays a loan can't be split"
    if row.amount is None or Decimal(row.amount) <= 0:
        return "Only an expense with an amount can be split"
    return None


def _is_live_row_collision(error: IntegrityError) -> bool:
    """Whether this is the one-live-row-per-share unique index, and nothing else.

    Postgres names the index; SQLite names the column. A bare substring would
    also match the share FK and the shares table's own constraints.
    """
    if getattr(error.orig, "constraint_name", None) == "uq_transactions_live_peer_split_share":
        return True
    msg = str(error.orig)
    return ("uq_transactions_live_peer_split_share" in msg
            or "UNIQUE constraint failed: transactions.peer_split_share_id" in msg)
