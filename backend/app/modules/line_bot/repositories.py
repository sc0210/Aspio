"""
Repository layer for the LINE Bot module.

Encapsulates all SQLAlchemy data-access for LINE account linking, expense
groups, members, shared expenses and splits. Repositories take an
``AsyncSession``, return ORM models (or rows), and contain no business logic.

Transaction boundaries are owned by the caller:
  * Webhook event handlers run inside ``db.begin_nested()`` and rely on a single
    outer commit (``get_db``); repository methods therefore use ``flush()``,
    never ``commit()``.
  * REST endpoints that need to persist immediately call ``commit()`` in the
    service layer after invoking the repository.

These methods are intentionally thin wrappers around the exact queries that
previously lived inline in ``service.py`` — same filters, ordering, locking
and concurrency handling — so behaviour is preserved.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import and_, delete, func as sqlfunc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.line_bot.models import (
    ExpenseSplit,
    LineBotActivity,
    LineGroup,
    LineGroupMember,
    LineLinkToken,
    LineProcessedEvent,
    LineUserLink,
    SharedExpense,
)
from app.modules.users.models import User


class LineAccountRepository:
    """Data-access for LINE user links, link tokens and activity logging."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- LineUserLink -----------------------------------------------------

    async def get_link_by_line_user_id(
        self, line_user_id: str
    ) -> Optional[LineUserLink]:
        result = await self.db.execute(
            select(LineUserLink).where(LineUserLink.line_user_id == line_user_id)
        )
        return result.scalar_one_or_none()

    async def get_link_by_user_id(self, user_id: UUID) -> Optional[LineUserLink]:
        result = await self.db.execute(
            select(LineUserLink).where(LineUserLink.user_id == user_id)
        )
        return result.scalar_one_or_none()

    def add_link(
        self, line_user_id: str, user_id: UUID, display_name: Optional[str]
    ) -> LineUserLink:
        """Stage a new LineUserLink. Caller is responsible for flush/commit."""
        link = LineUserLink(
            line_user_id=line_user_id,
            user_id=user_id,
            display_name=display_name,
        )
        self.db.add(link)
        return link

    async def get_links_by_user_ids(
        self, user_ids: Sequence[UUID]
    ) -> list[LineUserLink]:
        result = await self.db.execute(
            select(LineUserLink).where(LineUserLink.user_id.in_(user_ids))
        )
        return list(result.scalars().all())

    async def get_links_by_line_user_ids(
        self, line_user_ids: Sequence[str]
    ) -> list[LineUserLink]:
        result = await self.db.execute(
            select(LineUserLink).where(
                LineUserLink.line_user_id.in_(line_user_ids)
            )
        )
        return list(result.scalars().all())

    async def find_group_member_link_by_display_name(
        self, group_id: UUID, display_name: str
    ) -> Optional[LineUserLink]:
        """Find a LineUserLink for a member of *group_id* by display name (ilike).

        Returns the first match; ``limit(1)`` + ``first()`` (rather than
        ``scalar_one_or_none``) so two members sharing a display name resolve to
        one instead of raising MultipleResultsFound and breaking the command.
        """
        result = await self.db.execute(
            select(LineUserLink)
            .join(
                LineGroupMember,
                LineGroupMember.user_id == LineUserLink.user_id,
            )
            .where(
                and_(
                    LineGroupMember.group_id == group_id,
                    LineUserLink.display_name.ilike(display_name),
                )
            )
            .order_by(LineGroupMember.id)
            .limit(1)
        )
        return result.scalars().first()

    async def delete_links_by_user_id(self, user_id: UUID) -> None:
        await self.db.execute(
            delete(LineUserLink).where(LineUserLink.user_id == user_id)
        )

    # --- LineLinkToken ----------------------------------------------------

    def add_token(self, line_user_id: str, expires_at: datetime) -> LineLinkToken:
        """Stage a new link token. Caller is responsible for flush/commit."""
        token = LineLinkToken(
            line_user_id=line_user_id,
            expires_at=expires_at,
        )
        self.db.add(token)
        return token

    async def get_token(self, token: UUID) -> Optional[LineLinkToken]:
        result = await self.db.execute(select(LineLinkToken).where(LineLinkToken.token == token))
        return result.scalar_one_or_none()

    async def get_token_for_update(self, token: UUID) -> Optional[LineLinkToken]:
        result = await self.db.execute(
            select(LineLinkToken)
            .where(LineLinkToken.token == token)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def purge_unused_tokens(
        self, line_user_id: str, keep_token: UUID
    ) -> None:
        """Delete unused tokens for a user, except *keep_token*."""
        await self.db.execute(
            delete(LineLinkToken).where(
                and_(
                    LineLinkToken.line_user_id == line_user_id,
                    LineLinkToken.used == False,  # noqa: E712
                    LineLinkToken.token != keep_token,
                )
            )
        )

    async def delete_tokens_by_line_user_id(self, line_user_id: str) -> None:
        await self.db.execute(
            delete(LineLinkToken).where(
                LineLinkToken.line_user_id == line_user_id
            )
        )

    # --- LineBotActivity --------------------------------------------------

    def add_activity(
        self,
        user_id: UUID,
        event_type: str,
        description: str,
        amount: Optional[Decimal] = None,
        currency: Optional[str] = None,
    ) -> LineBotActivity:
        """Stage an activity record. Caller owns flush/commit."""
        activity = LineBotActivity(
            user_id=user_id,
            event_type=event_type,
            description=description,
            amount=amount,
            currency=currency,
        )
        self.db.add(activity)
        return activity

    async def get_recent_activities(
        self, user_id: UUID, limit: int = 20
    ) -> list[LineBotActivity]:
        """Most-recent LINE bot activity for a user, newest first."""
        result = await self.db.execute(
            select(LineBotActivity)
            .where(LineBotActivity.user_id == user_id)
            .order_by(LineBotActivity.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    # --- LineProcessedEvent (webhook idempotency) -------------------------

    async def mark_event_processed(self, event_id: str) -> bool:
        """Record a LINE webhook event id as processed.

        Returns True if it was new (this delivery should be handled), False if it
        was already seen (a re-delivery — skip it). The savepoint means a
        primary-key conflict doesn't poison the surrounding transaction.
        """
        self.db.add(LineProcessedEvent(event_id=event_id))
        try:
            async with self.db.begin_nested():
                await self.db.flush()
            return True
        except IntegrityError:
            return False

    async def prune_processed_events(self, older_than: datetime) -> None:
        """Delete dedup markers older than *older_than* so the table stays bounded."""
        await self.db.execute(
            delete(LineProcessedEvent).where(
                LineProcessedEvent.created_at < older_than
            )
        )

    # --- User -------------------------------------------------------------

    async def get_user(self, user_id: UUID) -> Optional[User]:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()


class LineGroupRepository:
    """Data-access for LINE expense groups and their membership."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_group_by_line_group_id(
        self, line_group_id: str
    ) -> Optional[LineGroup]:
        result = await self.db.execute(
            select(LineGroup).where(LineGroup.line_group_id == line_group_id)
        )
        return result.scalar_one_or_none()

    async def get_group_by_id(self, group_id: UUID) -> Optional[LineGroup]:
        result = await self.db.execute(
            select(LineGroup).where(LineGroup.id == group_id)
        )
        return result.scalar_one_or_none()

    async def create_group_if_absent(
        self, line_group_id: str, currency: str
    ) -> LineGroup:
        """Create a group, tolerating a concurrent insert.

        Mirrors the original ``_get_or_create_group`` flush-in-savepoint
        behaviour: on a unique-constraint race, re-fetch the winning row.
        """
        group = LineGroup(line_group_id=line_group_id, currency=currency)
        self.db.add(group)
        try:
            async with self.db.begin_nested():
                await self.db.flush()
        except IntegrityError:
            result = await self.db.execute(
                select(LineGroup).where(
                    LineGroup.line_group_id == line_group_id
                )
            )
            group = result.scalar_one()
        return group

    async def get_member(
        self, group_id: UUID, user_id: UUID
    ) -> Optional[LineGroupMember]:
        result = await self.db.execute(
            select(LineGroupMember).where(
                and_(
                    LineGroupMember.group_id == group_id,
                    LineGroupMember.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def add_member_if_absent(
        self, group_id: UUID, user_id: UUID, line_user_id: str
    ) -> None:
        """Insert a membership row, tolerating a concurrent insert.

        Assumes the caller has already verified the member is absent; the
        savepoint swallows a unique-constraint race exactly as before.
        """
        self.db.add(
            LineGroupMember(
                group_id=group_id,
                user_id=user_id,
                line_user_id=line_user_id,
            )
        )
        try:
            async with self.db.begin_nested():
                await self.db.flush()
        except IntegrityError:
            pass  # another request registered the member concurrently

    async def get_members(self, group_id: UUID) -> list[LineGroupMember]:
        result = await self.db.execute(
            select(LineGroupMember).where(
                LineGroupMember.group_id == group_id
            )
        )
        return list(result.scalars().all())

    async def get_members_with_names(
        self, group_id: UUID
    ) -> list[tuple[LineGroupMember, Optional[str]]]:
        """Return (member, display_name) rows joined to LineUserLink."""
        result = await self.db.execute(
            select(LineGroupMember, LineUserLink.display_name)
            .outerjoin(
                LineUserLink,
                LineUserLink.user_id == LineGroupMember.user_id,
            )
            .where(LineGroupMember.group_id == group_id)
            .order_by(LineGroupMember.id)
        )
        return list(result.all())

    async def get_user_groups_with_counts(
        self, user_id: UUID
    ) -> list[tuple[LineGroup, int]]:
        """Return (group, member_count) for every group the user belongs to."""
        result = await self.db.execute(
            select(
                LineGroup,
                sqlfunc.count(LineGroupMember.id).label("member_count"),
            )
            .join(LineGroupMember, LineGroupMember.group_id == LineGroup.id)
            .where(LineGroupMember.user_id == user_id)
            .group_by(LineGroup.id)
            .order_by(LineGroup.created_at.desc())
        )
        return list(result.all())

    async def delete_group(self, group: LineGroup) -> None:
        await self.db.delete(group)

    async def delete_members_by_group(self, group_id: UUID) -> None:
        await self.db.execute(
            delete(LineGroupMember).where(
                LineGroupMember.group_id == group_id
            )
        )

    async def delete_members_by_user(self, user_id: UUID) -> None:
        await self.db.execute(
            delete(LineGroupMember).where(
                LineGroupMember.user_id == user_id
            )
        )

    async def delete_members_by_group_and_users(
        self, group_id: UUID, user_ids: Sequence[UUID]
    ) -> None:
        await self.db.execute(
            delete(LineGroupMember).where(
                and_(
                    LineGroupMember.group_id == group_id,
                    LineGroupMember.user_id.in_(user_ids),
                )
            )
        )


class SharedExpenseRepository:
    """Data-access for shared expenses and their per-member splits."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def add_expense(
        self,
        group_id: UUID,
        payer_id: UUID,
        amount: Decimal,
        currency: str,
        description: str,
    ) -> SharedExpense:
        """Stage a new expense. Caller flushes to obtain its id."""
        expense = SharedExpense(
            group_id=group_id,
            payer_id=payer_id,
            amount=amount,
            currency=currency,
            description=description,
        )
        self.db.add(expense)
        return expense

    def add_split(
        self,
        expense_id: UUID,
        user_id: UUID,
        amount: Decimal,
        ratio: Optional[Decimal] = None,
    ) -> ExpenseSplit:
        """Stage a split row. ``ratio`` omitted -> model default (equal share)."""
        kwargs = {
            "expense_id": expense_id,
            "user_id": user_id,
            "amount": amount,
        }
        if ratio is not None:
            kwargs["ratio"] = ratio
        split = ExpenseSplit(**kwargs)
        self.db.add(split)
        return split

    async def get_recent_expenses(
        self, group_id: UUID, limit: int = 50, offset: int = 0
    ) -> list[SharedExpense]:
        result = await self.db.execute(
            select(SharedExpense)
            .options(selectinload(SharedExpense.splits))
            .where(SharedExpense.group_id == group_id)
            .order_by(SharedExpense.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def get_expenses_since(
        self, group_id: UUID, since: datetime
    ) -> list[SharedExpense]:
        result = await self.db.execute(
            select(SharedExpense)
            .options(selectinload(SharedExpense.splits))
            .where(
                and_(
                    SharedExpense.group_id == group_id,
                    SharedExpense.created_at >= since,
                )
            )
        )
        return list(result.scalars().all())

    async def get_last_expense_by_payer_for_update(
        self, group_id: UUID, payer_id: UUID, since: datetime
    ) -> Optional[SharedExpense]:
        """Lock and return the payer's most recent expense newer than *since*."""
        result = await self.db.execute(
            select(SharedExpense)
            .where(
                and_(
                    SharedExpense.group_id == group_id,
                    SharedExpense.payer_id == payer_id,
                    SharedExpense.created_at >= since,
                )
            )
            .order_by(SharedExpense.created_at.desc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        return result.scalar_one_or_none()

    async def get_expense_by_id(
        self, group_id: UUID, expense_id: UUID
    ) -> Optional[SharedExpense]:
        """Return a single expense (with its splits eager-loaded) scoped to a
        group, or None if it does not exist in that group.

        Uses ``populate_existing`` so a re-fetch after the splits have been
        rewritten (edit recompute) refreshes the in-memory ``splits`` collection
        instead of returning the stale eager-loaded rows — the session is
        configured with ``expire_on_commit=False`` in places, so without this a
        cached collection would survive the bulk delete/re-insert."""
        result = await self.db.execute(
            select(SharedExpense)
            .options(selectinload(SharedExpense.splits))
            .where(
                and_(
                    SharedExpense.id == expense_id,
                    SharedExpense.group_id == group_id,
                )
            )
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def delete_splits_for_expense(self, expense_id: UUID) -> None:
        """Delete all splits for an expense (used when recomputing on edit)."""
        await self.db.execute(
            delete(ExpenseSplit).where(ExpenseSplit.expense_id == expense_id)
        )

    async def delete_expense(self, expense: SharedExpense) -> None:
        await self.db.delete(expense)

    async def get_unsettled_splits_owed_to(
        self, group_id: UUID, payer_id: UUID, debtor_id: UUID
    ) -> list[ExpenseSplit]:
        """Unsettled splits where *debtor_id* owes *payer_id* in this group.

        Eager-loads the parent expense so callers can read ``split.expense``
        (e.g. ``created_at`` for oldest-first partial settlement) without
        triggering a lazy load on the async session.
        """
        result = await self.db.execute(
            select(ExpenseSplit)
            .join(SharedExpense, SharedExpense.id == ExpenseSplit.expense_id)
            .options(selectinload(ExpenseSplit.expense))
            .where(
                and_(
                    SharedExpense.group_id == group_id,
                    SharedExpense.payer_id == payer_id,
                    ExpenseSplit.user_id == debtor_id,
                    ExpenseSplit.settled == False,  # noqa: E712
                )
            )
        )
        return list(result.scalars().all())

    async def get_expenses_with_unsettled_splits(
        self, group_id: UUID
    ) -> list[SharedExpense]:
        """Expenses that have at least one unsettled split (for balance calc)."""
        unsettled_expense_ids = (
            select(ExpenseSplit.expense_id)
            .join(SharedExpense, SharedExpense.id == ExpenseSplit.expense_id)
            .where(
                SharedExpense.group_id == group_id,
                ExpenseSplit.settled == False,  # noqa: E712
            )
            .distinct()
        )
        result = await self.db.execute(
            select(SharedExpense)
            .options(selectinload(SharedExpense.splits))
            .where(SharedExpense.id.in_(unsettled_expense_ids))
        )
        return list(result.scalars().all())
