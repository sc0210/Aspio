"""
Repository layer for transaction database operations in the Aspiro personal finance application.
Handles all database interactions with SQLAlchemy 2.0 async patterns.
"""

import logging
import uuid as uuid_module
from datetime import datetime, date, timezone
from dateutil.relativedelta import relativedelta
from decimal import Decimal
from typing import Optional, List, Dict, Any, Tuple

logger = logging.getLogger(__name__)
from sqlalchemy import (
    and_,
    or_,
    func,
    select,
    update,
    delete,
    desc,
    asc,
    case,
    cast,
    exists,
    String,
)
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from .models import (
    Transaction,
    TransactionCategory,
    Currency,
    RecurringTransaction,
    TransactionType,
    TransactionStatus,
)
from .schemas import TransactionFilter

from app.utils.fx_sql import BASE_CURRENCY, in_twd, to_twd, twd_rates_for
from app.utils.datetime_helpers import business_today


def _forget_day_position_on_move(update_data: dict) -> None:
    """A row moved to another day drops its place in the old one (#478).

    day_position orders a row inside ITS day. Kept across a date edit, the row
    would carry a place from a different day into the new one — position 1 from
    Oct 1 sorting above every unordered row of Oct 5. So when an update sets
    transaction_date, the same statement keeps the position only if the date is
    unchanged. A moved row rejoins its new day as any unplaced row does: in entry
    order, after the rows placed by hand.
    Done as a CASE in the UPDATE, against the stored date, so it needs no read.
    """
    if "transaction_date" not in update_data or "day_position" in update_data:
        return
    new_date = update_data["transaction_date"]
    if isinstance(new_date, str):
        new_date = date.fromisoformat(new_date[:10])
    elif isinstance(new_date, datetime):
        new_date = new_date.date()
    update_data["day_position"] = case(
        (Transaction.transaction_date == new_date, Transaction.day_position),
        else_=None,
    )


class TransactionRepository:
    """Repository for transaction database operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, transaction_data: dict, user_id: str) -> Transaction:
        """Create a new transaction with improved error handling"""
        try:
            # Convert user_id to UUID if it's a string
            if isinstance(user_id, str):
                transaction_data["user_id"] = uuid_module.UUID(user_id)
            else:
                transaction_data["user_id"] = user_id

            # Validate required fields
            if (
                "category_id" not in transaction_data
                or not transaction_data["category_id"]
            ):
                raise ValueError("category_id is required for transaction creation")

            # Convert category_id to UUID if it's a string
            if isinstance(transaction_data["category_id"], str):
                transaction_data["category_id"] = uuid_module.UUID(
                    transaction_data["category_id"]
                )

            # Convert loan_id to UUID if present
            if transaction_data.get("loan_id") and isinstance(transaction_data["loan_id"], str):
                transaction_data["loan_id"] = uuid_module.UUID(transaction_data["loan_id"])

            # Calculate USD amount if not provided
            if not transaction_data.get("amount_usd"):
                if transaction_data.get("currency") == "USD":
                    transaction_data["amount_usd"] = transaction_data["amount"]
                    transaction_data["exchange_rate"] = Decimal("1.0")
                else:
                    currency = await self.get_currency(transaction_data["currency"])
                    if currency:
                        transaction_data["amount_usd"] = (
                            transaction_data["amount"] * currency.exchange_rate_usd
                        )
                        transaction_data["exchange_rate"] = currency.exchange_rate_usd
                    else:
                        # Fallback: use 1:1 exchange rate if currency not found
                        transaction_data["amount_usd"] = transaction_data["amount"]
                        transaction_data["exchange_rate"] = Decimal("1.0")

            transaction = Transaction(**transaction_data)
            self.db.add(transaction)
            await self.db.commit()
            await self.db.refresh(transaction)

            # Load relationships for complete response. category_obj.subcategories
            # is a nested relationship refresh() won't cascade into on its own —
            # TransactionResponse.category_obj needs it, and accessing it
            # unloaded outside this async context later (e.g. bulk import's
            # Pydantic response validation) crashes with MissingGreenlet.
            await self.db.refresh(transaction, ["category_obj"])
            await self.db.refresh(transaction.category_obj, ["subcategories"])

            return transaction
        except Exception as e:
            logger.error(
                "Transaction creation failed, rolling back: %s: %s",
                type(e).__name__,
                e,
                exc_info=True,
            )
            await self.db.rollback()
            raise

    async def get_by_id(
        self, transaction_id: str, user_id: str
    ) -> Optional[Transaction]:
        """Get transaction by ID for a specific user"""
        # Convert string UUIDs to UUID objects
        transaction_id_uuid = (
            uuid_module.UUID(transaction_id)
            if isinstance(transaction_id, str)
            else transaction_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category_obj).selectinload(
                    TransactionCategory.subcategories
                ),
                joinedload(Transaction.currency_obj),
                joinedload(Transaction.recurring_transaction),
            )
            .where(
                and_(
                    Transaction.id == transaction_id_uuid,
                    Transaction.user_id == user_id_uuid,
                    Transaction.is_deleted == False,
                )
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_all(
        self,
        user_id: str,
        filter_params: Optional[TransactionFilter] = None,
        page: int = 1,
        limit: int = 20,
        sort_by: str = "transaction_date",
        sort_order: str = "desc",
    ) -> Tuple[List[Transaction], int]:
        """Get paginated transactions with filtering"""
        # Convert string UUID to UUID object
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        # Base query
        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category_obj),
                joinedload(Transaction.currency_obj),
                joinedload(Transaction.recurring_transaction),
            )
            .where(
                and_(
                    Transaction.user_id == user_id_uuid, Transaction.is_deleted == False
                )
            )
        )

        # Apply filters
        if filter_params:
            stmt = self._apply_filters(stmt, filter_params)

        # Count total records
        count_stmt = select(func.count(Transaction.id)).where(
            and_(Transaction.user_id == user_id_uuid, Transaction.is_deleted == False)
        )
        if filter_params:
            count_stmt = self._apply_filters(count_stmt, filter_params)

        total_result = await self.db.execute(count_stmt)
        total = total_result.scalar()

        # Apply sorting. The sort column (e.g. transaction_date) has many ties — a
        # day of a trip can hold a dozen rows — so the tiebreakers decide what a
        # user actually sees inside a day:
        #
        #   created_at ASC  the order they were entered, so a day is predictable
        #                   and a new row lands at the bottom of it, whichever way
        #                   the days themselves run. The id alone used to be the
        #                   tiebreaker, and ids are random uuid4s, so rows in a day
        #                   came back in an arbitrary order. Applies to any sort
        #                   column, not only dates.
        #
        #                   Not perfect: created_at defaults to now(), the
        #                   TRANSACTION's start, so rows one write inserts together
        #                   tie — a transfer's two legs, or a bulk import (the 錢跡
        #                   import is ~2,350 such rows). Those still fall to the id.
        #                   Entry order is also not the order things happened when a
        #                   day is back-filled; manual reordering is the fix for both.
        #   id ASC          still last: two rows can share a created_at, and without
        #                   a total order OFFSET pagination is non-deterministic —
        #                   the same row on two pages, which surfaced as duplicate
        #                   React keys when the client aggregates pages.
        #
        #   day_position    ahead of both, when the list is by date: the order the
        #                   user dragged a day into (#478). NULLS LAST, so rows of a
        #                   day nobody reordered — or added after the reorder — keep
        #                   entry order below the positioned ones. Not applied to
        #                   other sort columns: it orders a day, nothing else.
        order_column = getattr(Transaction, sort_by, Transaction.transaction_date)
        tiebreakers = (asc(Transaction.created_at), asc(Transaction.id))
        if order_column is Transaction.transaction_date:
            tiebreakers = (Transaction.day_position.asc().nulls_last(), *tiebreakers)
        if sort_order.lower() == "desc":
            stmt = stmt.order_by(desc(order_column), *tiebreakers)
        else:
            stmt = stmt.order_by(asc(order_column), *tiebreakers)

        # Apply pagination
        offset = (page - 1) * limit
        stmt = stmt.offset(offset).limit(limit)

        result = await self.db.execute(stmt)
        transactions = result.scalars().all()

        return list(transactions), total

    def _apply_filters(self, stmt: Select, filters: TransactionFilter) -> Select:
        """Apply filters to the query"""
        conditions = []

        if filters.exclude_transfers:
            conditions.append(~TransactionRepository.transfer_leg())

        if filters.type:
            conditions.append(Transaction.type == filters.type)

        if filters.category_ids:
            conditions.append(Transaction.category_id.in_(filters.category_ids))

        if filters.payment_methods:
            conditions.append(Transaction.payment_method.in_(filters.payment_methods))

        if filters.currencies:
            conditions.append(Transaction.currency.in_(filters.currencies))

        if filters.wallet_type:
            conditions.append(Transaction.wallet_type == filters.wallet_type)

        if filters.status:
            conditions.append(Transaction.status == filters.status)

        if filters.date_from:
            conditions.append(Transaction.transaction_date >= filters.date_from)

        if filters.date_to:
            conditions.append(Transaction.transaction_date <= filters.date_to)

        if filters.amount_min is not None:
            conditions.append(Transaction.amount >= filters.amount_min)

        if filters.amount_max is not None:
            conditions.append(Transaction.amount <= filters.amount_max)

        if filters.merchant_name:
            conditions.append(
                Transaction.merchant_name.ilike(f"%{filters.merchant_name}%")
            )

        if filters.location:
            conditions.append(Transaction.location.ilike(f"%{filters.location}%"))

        if filters.tags:
            # Check if any of the provided tags exist in the transaction's tags
            tag_conditions = []
            for tag in filters.tags:
                tag_conditions.append(Transaction.tags.op("@>")(f'["{tag}"]'))
            conditions.append(or_(*tag_conditions))

        if filters.auto_categorized is not None:
            conditions.append(Transaction.auto_categorized == filters.auto_categorized)

        if filters.reviewed_by_user is not None:
            conditions.append(Transaction.reviewed_by_user == filters.reviewed_by_user)

        if filters.is_recurring is not None:
            if filters.is_recurring:
                conditions.append(Transaction.recurring_transaction_id.is_not(None))
            else:
                conditions.append(Transaction.recurring_transaction_id.is_(None))

        if filters.search:
            search_term = f"%{filters.search}%"
            # Mirrors the fields the old client-side search covered (category
            # name, payment method, tags, amount) so switching to server-side
            # search doesn't silently drop matches the user could find before.
            search_conditions = [
                Transaction.description.ilike(search_term),
                Transaction.merchant_name.ilike(search_term),
                Transaction.notes.ilike(search_term),
                Transaction.subcategory.ilike(search_term),
                Transaction.location.ilike(search_term),
                cast(Transaction.payment_method, String).ilike(search_term),
                cast(Transaction.tags, String).ilike(search_term),
                # correlate(Transaction) pins the correlation to the outer
                # transactions row only. Without it, a caller whose own FROM
                # already joins transaction_categories (the page-stats category
                # breakdown) auto-correlates BOTH tables away, leaving the
                # subquery with no FROM clause — SQLAlchemy then raises and the
                # whole /transactions/stats request 500s as soon as the user
                # types a search term.
                exists(
                    select(TransactionCategory.id)
                    .where(
                        TransactionCategory.id == Transaction.category_id,
                        TransactionCategory.name.ilike(search_term),
                    )
                    .correlate(Transaction)
                ),
            ]
            stripped_search = filters.search.strip()
            if stripped_search.replace(".", "", 1).isdigit():
                search_conditions.append(cast(Transaction.amount, String).like(f"%{stripped_search}%"))
            conditions.append(or_(*search_conditions))

        if conditions:
            stmt = stmt.where(and_(*conditions))

        return stmt

    async def set_day_order(self, user_id: str, day: date, ids: List[str]) -> List[str]:
        """Put the given rows of one day in the given order (#478).

        `ids` may be the whole day or only part of it — the rows the client could
        see, when a filter hid some or a page boundary split the day. Each given row
        takes, in the order given, one of the places the given rows held between
        them; every other row of the day keeps its place. Reordering b and d in
        a,b,c,d to d,b gives a,d,c,b. The whole day is then numbered 1..n, so the
        stored order is total and later rows (NULL) sort after it.

        Raises ValueError for a malformed or repeated id, and LookupError when an
        id is not one of this user's live rows on `day`.
        """
        user_uuid = uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        wanted = [uuid_module.UUID(str(i)) for i in ids]  # ValueError if malformed
        if len(set(wanted)) != len(wanted):
            raise ValueError("ids contains a duplicate")

        # The day as the list shows it now — the same sort as get_all.
        result = await self.db.execute(
            select(Transaction.id)
            .where(
                Transaction.user_id == user_uuid,
                Transaction.transaction_date == day,
                Transaction.is_deleted == False,  # noqa: E712
            )
            .order_by(
                Transaction.day_position.asc().nulls_last(),
                asc(Transaction.created_at),
                asc(Transaction.id),
            )
        )
        current = [row[0] for row in result.all()]

        wanted_set = set(wanted)
        missing = wanted_set - set(current)
        if missing:
            raise LookupError(
                f"{len(missing)} id(s) are not your transactions on {day.isoformat()}"
            )

        slots = [i for i, tid in enumerate(current) if tid in wanted_set]
        ordered = list(current)
        for slot, tid in zip(slots, wanted):
            ordered[slot] = tid

        # One small UPDATE per row: a day holds a dozen rows, not thousands.
        for position, tid in enumerate(ordered, start=1):
            await self.db.execute(
                update(Transaction)
                .where(Transaction.id == tid, Transaction.user_id == user_uuid)
                .values(day_position=position)
            )
        await self.db.commit()
        return [str(tid) for tid in ordered]

    async def update(
        self, transaction_id: str, user_id: str, update_data: dict
    ) -> Optional[Transaction]:
        """Update a transaction with improved error handling"""
        try:
            # Convert string UUIDs to UUID objects
            transaction_id_uuid = (
                uuid_module.UUID(transaction_id)
                if isinstance(transaction_id, str)
                else transaction_id
            )
            user_id_uuid = (
                uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
            )

            # Convert category_id if present in update_data
            if "category_id" in update_data and isinstance(
                update_data["category_id"], str
            ):
                update_data["category_id"] = uuid_module.UUID(
                    update_data["category_id"]
                )

            # Recalculate USD amount if currency or amount changed
            if "currency" in update_data or "amount" in update_data:
                transaction = await self.get_by_id(transaction_id, user_id)
                if not transaction:
                    return None

                currency_code = update_data.get("currency", transaction.currency)
                amount = update_data.get("amount", transaction.amount)

                if currency_code != "USD":
                    currency = await self.get_currency(currency_code)
                    if currency:
                        update_data["amount_usd"] = amount * currency.exchange_rate_usd
                        update_data["exchange_rate"] = currency.exchange_rate_usd
                    else:
                        # Fallback for unknown currency
                        update_data["amount_usd"] = amount
                        update_data["exchange_rate"] = Decimal("1.0")
                else:
                    update_data["amount_usd"] = amount
                    update_data["exchange_rate"] = Decimal("1.0")

            _forget_day_position_on_move(update_data)
            update_data["updated_at"] = datetime.now(timezone.utc)

            stmt = (
                update(Transaction)
                .where(
                    and_(
                        Transaction.id == transaction_id_uuid,
                        Transaction.user_id == user_id_uuid,
                        Transaction.is_deleted == False,
                    )
                )
                .values(**update_data)
                .returning(Transaction)
            )

            result = await self.db.execute(stmt)
            await self.db.commit()

            updated_transaction = result.scalar_one_or_none()
            if updated_transaction:
                await self.db.refresh(updated_transaction, ["category_obj"])

            return updated_transaction
        except Exception as e:
            logger.error(
                "Transaction update failed, rolling back: %s: %s",
                type(e).__name__,
                e,
                exc_info=True,
            )
            await self.db.rollback()
            raise

    async def update_flush(
        self, transaction_id: str, user_id: str, update_data: dict
    ) -> Optional[Transaction]:
        """
        Like update() but flush()es instead of commit()ing — the caller is
        responsible for the final commit (or rollback on error). Used to
        update multiple linked rows (e.g. both legs of a transfer) atomically.
        """
        transaction_id_uuid = (
            uuid_module.UUID(transaction_id)
            if isinstance(transaction_id, str)
            else transaction_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        if "category_id" in update_data and isinstance(
            update_data["category_id"], str
        ):
            update_data["category_id"] = uuid_module.UUID(update_data["category_id"])

        # Recalculate USD amount if currency or amount changed
        if "currency" in update_data or "amount" in update_data:
            transaction = await self.get_by_id(transaction_id, user_id)
            if not transaction:
                return None

            currency_code = update_data.get("currency", transaction.currency)
            amount = update_data.get("amount", transaction.amount)

            if currency_code != "USD":
                currency = await self.get_currency(currency_code)
                if currency:
                    update_data["amount_usd"] = amount * currency.exchange_rate_usd
                    update_data["exchange_rate"] = currency.exchange_rate_usd
                else:
                    update_data["amount_usd"] = amount
                    update_data["exchange_rate"] = Decimal("1.0")
            else:
                update_data["amount_usd"] = amount
                update_data["exchange_rate"] = Decimal("1.0")

        _forget_day_position_on_move(update_data)
        update_data["updated_at"] = datetime.now(timezone.utc)

        stmt = (
            update(Transaction)
            .where(
                and_(
                    Transaction.id == transaction_id_uuid,
                    Transaction.user_id == user_id_uuid,
                    Transaction.is_deleted == False,
                )
            )
            .values(**update_data)
            .returning(Transaction)
        )

        result = await self.db.execute(stmt)
        await self.db.flush()

        return result.scalar_one_or_none()

    async def get_by_transfer_group(
        self, group_id: str, user_id: str
    ) -> List[Transaction]:
        """Both legs of a wallet transfer (see create_transfer / update_transfer)."""
        group_id_uuid = (
            uuid_module.UUID(group_id) if isinstance(group_id, str) else group_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = select(Transaction).where(
            and_(
                Transaction.transfer_group_id == group_id_uuid,
                Transaction.user_id == user_id_uuid,
                Transaction.is_deleted == False,
            )
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def soft_delete(self, transaction_id: str, user_id: str) -> bool:
        """Soft delete a transaction"""
        # Convert string UUIDs to UUID objects
        transaction_id_uuid = (
            uuid_module.UUID(transaction_id)
            if isinstance(transaction_id, str)
            else transaction_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = (
            update(Transaction)
            .where(
                and_(
                    Transaction.id == transaction_id_uuid,
                    Transaction.user_id == user_id_uuid,
                    Transaction.is_deleted == False,
                )
            )
            .values(
                is_deleted=True,
                deleted_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )

        result = await self.db.execute(stmt)
        await self.db.commit()

        return result.rowcount > 0

    async def create_flush(self, transaction_data: dict, user_id: str) -> "Transaction":
        """
        Like create() but uses flush() instead of commit().

        Use inside multi-step operations that need atomicity — the caller is
        responsible for the final commit (or rollback on error).
        """
        import uuid as uuid_module
        from decimal import Decimal

        if isinstance(user_id, str):
            transaction_data["user_id"] = uuid_module.UUID(user_id)
        else:
            transaction_data["user_id"] = user_id

        if "category_id" in transaction_data and isinstance(transaction_data["category_id"], str):
            transaction_data["category_id"] = uuid_module.UUID(transaction_data["category_id"])

        if not transaction_data.get("amount_usd"):
            if transaction_data.get("currency") == "USD":
                transaction_data["amount_usd"] = transaction_data["amount"]
                transaction_data["exchange_rate"] = Decimal("1.0")
            else:
                currency = await self.get_currency(transaction_data["currency"])
                if currency:
                    transaction_data["amount_usd"] = transaction_data["amount"] * currency.exchange_rate_usd
                    transaction_data["exchange_rate"] = currency.exchange_rate_usd
                else:
                    transaction_data["amount_usd"] = transaction_data["amount"]
                    transaction_data["exchange_rate"] = Decimal("1.0")

        transaction = Transaction(**transaction_data)
        self.db.add(transaction)
        await self.db.flush()
        await self.db.refresh(transaction)
        return transaction

    async def get_currency(self, currency_code: str) -> Optional[Currency]:
        """Get currency by code"""
        stmt = select(Currency).where(
            and_(Currency.code == currency_code, Currency.is_active == True)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def twd_rates_for_conditions(self, conditions) -> Dict[str, Decimal]:
        """Rates for the currencies these conditions actually select.

        Returns {} for a single-currency account, which is what `in_twd` needs
        to leave the query it wraps completely untouched.
        """
        stmt = select(Transaction.currency).where(and_(*conditions)).distinct()
        result = await self.db.execute(stmt)
        return await twd_rates_for(self.db, [row[0] for row in result.all()])

    @staticmethod
    def countable_conditions() -> list:
        """The rows any total may count, whoever's they are: not deleted, completed.

        Deleted rows are gone, and pending, failed or cancelled ones are money
        that did not move. For queries that scope the user some other way — the
        reports' own row filter is this.
        """
        return [
            Transaction.is_deleted == False,  # noqa: E712
            Transaction.status == TransactionStatus.COMPLETED,
        ]

    # The category names a transfer leg carries when it predates transfer_group_id.
    #
    # The frontend's TRANSFER_PATTERN (expenseGroups.ts) is a regex and therefore a
    # superset: it also takes an open-ended destination, as in "Transfer to
    # Emergency". This list enumerates every shape SQL can compare cheaply, matched
    # case-insensitively, and the two agree on all of them. Deliberately absent:
    # 薪資轉帳 (salary paid by bank transfer), 轉帳手續費 (the fee) and 調帳 (a
    # bookkeeping correction) — all real money.
    TRANSFER_CATEGORY_NAMES = (
        "transfer",
        "transfers",
        "bank transfer",
        "wallet transfer",
        "internal transfer",
        "account transfer",
        "轉帳",
        "轉賬",
        "轉移",
        "轉入",
        "轉出",
        "轉帳支出",
        "轉帳收入",
        "轉賬支出",
        "轉賬收入",
    )

    @staticmethod
    def transfer_leg():
        """True for either leg of a wallet transfer.

        `create_transfer` stamps `transfer_group_id` on both rows; the category
        check catches legs written before that column existed (the four-wallet
        migration left some).
        """
        return or_(
            Transaction.transfer_group_id.isnot(None),
            Transaction.category_id.in_(
                select(TransactionCategory.id).where(
                    func.lower(func.trim(TransactionCategory.name)).in_(
                        TransactionRepository.TRANSFER_CATEGORY_NAMES
                    )
                )
            ),
        )

    @staticmethod
    def is_transfer_leg(txn) -> bool:
        """`transfer_leg()` for a row already loaded, rather than in SQL.

        Same rule: the group id if it has one, otherwise the category name. The
        name has to BE a transfer, not merely mention one — 薪資轉帳 is salary paid
        by bank transfer, and 轉帳手續費 is what the bank charged for it.
        """
        if getattr(txn, "transfer_group_id", None) is not None:
            return True
        category = getattr(txn, "category_obj", None)
        name = (getattr(category, "name", "") or "").strip().lower()
        return name in TransactionRepository.TRANSFER_CATEGORY_NAMES

    @staticmethod
    def counted_conditions(user_id) -> list:
        """The rows every total and balance counts: this user's, not deleted, completed.

        Flows (get_summary, the reports) and balances (the wallets, wallet
        trends, the peer comparison) share it, so a pending, failed or cancelled
        transaction can never move one figure while leaving another alone.
        """
        if isinstance(user_id, str):
            # The column is a UUID; Postgres tolerates the string, SQLite does not.
            user_id = uuid_module.UUID(user_id)
        return [Transaction.user_id == user_id, *TransactionRepository.countable_conditions()]

    async def signed_amount_twd(self, conditions, rates: Optional[Dict[str, Decimal]] = None):
        """Each row's cash effect in TWD: income adds, every other type subtracts.

        This is what a wallet balance sums. Without `rates` they are looked up
        for the currencies `conditions` actually select, so a TWD-only account
        gets the bare column back (see in_twd); a caller running several queries
        over the same rows passes the rates it already has.
        """
        if rates is None:
            rates = await self.twd_rates_for_conditions(conditions)
        amount = in_twd(Transaction.amount, Transaction.currency, rates)
        return case((Transaction.type == TransactionType.INCOME, amount), else_=-amount)

    async def cash_balances_twd(
        self, user_id, *extra_conditions, rates: Optional[Dict[str, Decimal]] = None
    ) -> Dict[Any, Decimal]:
        """Every cash wallet's balance in TWD, keyed by wallet type, in one query.

        Over the counted rows (see counted_conditions), narrowed by
        `extra_conditions` such as a date bound. The dashboard wallets, wallet
        trends, the peer comparison, the portfolio page and the comprehensive
        report all read Life and Emergency from here, so they cannot drift apart
        again. A wallet with no rows is absent: read it with .get(wallet, 0).
        """
        conditions = [*self.counted_conditions(user_id), *extra_conditions]
        signed = await self.signed_amount_twd(conditions, rates)
        result = await self.db.execute(
            select(Transaction.wallet_type, func.coalesce(func.sum(signed), 0))
            .where(and_(*conditions))
            .group_by(Transaction.wallet_type)
        )
        return {row[0]: Decimal(str(row[1] or 0)) for row in result.all()}

    async def get_summary(
        self,
        user_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        currency: str = BASE_CURRENCY,
    ) -> dict:
        """Money in and money out for a date range, in one aggregation query.

        `total_income` and `total_expenses` count every row that moved a wallet,
        transfers and holding purchases included — /review reads wallet balances
        beside these figures and the two have to explain each other
        (tests/test_reports_counts_every_row.py). `living_expenses` is the other
        question, and answers it below.
        """
        # Callers pass user_id as a str (the dashboard service stringifies it).
        # Postgres coerces that against a uuid column, but SQLAlchemy's Uuid type
        # calls .hex on the bound value for other dialects, so a bare str raises
        # AttributeError there. Normalise at the boundary.
        user_id = (
            user_id
            if isinstance(user_id, uuid_module.UUID)
            else uuid_module.UUID(str(user_id))
        )
        conditions = self.counted_conditions(user_id)

        if date_from:
            conditions.append(Transaction.transaction_date >= date_from)
        if date_to:
            conditions.append(Transaction.transaction_date <= date_to)

        # Every figure below is in TWD. The column holds whatever currency the
        # row was entered in, so summing it raw added NT$ to US$ — and the
        # dashboard's totals are the figures the rest of the app is checked
        # against.
        rates = await self.twd_rates_for_conditions(conditions)
        amount_twd = in_twd(Transaction.amount, Transaction.currency, rates)

        # Single query with CASE expressions — one DB roundtrip instead of three
        stmt = select(
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.INCOME, amount_twd), else_=0)
                ),
                0,
            ).label("total_income"),
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.EXPENSE, amount_twd), else_=0)
                ),
                0,
            ).label("total_expenses"),
            # The same expenses with investment purchases and wallet transfers
            # taken out.
            #
            # Buying a holding debits the Life wallet as an expense — the bridge
            # that stops the three wallets double-counting — but it is not
            # spending in the sense of "how long could I live on my reserves".
            # One lump sum otherwise makes an emergency fund look like it
            # evaporated: NT$1.95M of an August's NT$2.28M of "expenses" were
            # holdings, reading as 0.2 months of cover where living costs alone
            # give 1.7.
            #
            # A wallet transfer comes out for the same reason and then some: the
            # money did not leave at all, it only changed pocket, and counting the
            # expense leg invented spending of the same size — which is what
            # pinned /housing's affordability ceiling at NT$0.
            #
            # Loan payments deliberately stay in — they keep arriving whether or
            # not there is an emergency.
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                Transaction.type == TransactionType.EXPENSE,
                                Transaction.holding_id.is_(None),
                                ~TransactionRepository.transfer_leg(),
                            ),
                            amount_twd,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("living_expenses"),
            func.count(Transaction.id).label("transaction_count"),
        ).where(and_(*conditions))

        result = await self.db.execute(stmt)
        row = result.first()

        total_income = row.total_income or Decimal("0")
        total_expenses = row.total_expenses or Decimal("0")

        return {
            "total_income": total_income,
            "total_expenses": total_expenses,
            "living_expenses": row.living_expenses or Decimal("0"),
            "net_amount": total_income - total_expenses,
            "transaction_count": row.transaction_count or 0,
            "currency": currency,
        }

    async def get_filtered_summary(
        self,
        user_id: str,
        filter_params: Optional[TransactionFilter] = None,
    ) -> List[dict]:
        """Per-currency income/expense aggregates for the current filter view.

        Mirrors get_all's visibility rules (is_deleted only, no status filter) so
        the stat cards match what the paginated list shows — with one deliberate
        exception: `exclude_transfers` drops both legs of a wallet transfer from
        the totals while the list still shows them, which is the point of asking
        and what the toggle's own caption says.
        """
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = (
            select(
                Transaction.currency,
                func.coalesce(
                    func.sum(
                        case(
                            (Transaction.type == TransactionType.INCOME, Transaction.amount),
                            else_=0,
                        )
                    ),
                    0,
                ).label("income"),
                func.coalesce(
                    func.sum(
                        case(
                            (Transaction.type == TransactionType.EXPENSE, Transaction.amount),
                            else_=0,
                        )
                    ),
                    0,
                ).label("expenses"),
                func.coalesce(func.sum(Transaction.amount), 0).label("total_amount"),
                func.count(Transaction.id).label("transaction_count"),
            )
            .where(
                and_(
                    Transaction.user_id == user_id_uuid, Transaction.is_deleted == False
                )
            )
            .group_by(Transaction.currency)
        )
        if filter_params:
            stmt = self._apply_filters(stmt, filter_params)

        result = await self.db.execute(stmt)
        return [
            {
                "currency": row.currency,
                "income": row.income or Decimal("0"),
                "expenses": row.expenses or Decimal("0"),
                "total_amount": row.total_amount or Decimal("0"),
                "transaction_count": row.transaction_count or 0,
            }
            for row in result.fetchall()
        ]

    async def get_filtered_category_breakdown(
        self,
        user_id: str,
        filter_params: Optional[TransactionFilter] = None,
    ) -> List[dict]:
        """Per-(category, type, currency) sums for the current filter view."""
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )
        from sqlalchemy import join as sql_join

        stmt = (
            select(
                TransactionCategory.name.label("category_name"),
                Transaction.type.label("txn_type"),
                Transaction.currency,
                func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
            )
            .select_from(
                sql_join(
                    Transaction,
                    TransactionCategory,
                    Transaction.category_id == TransactionCategory.id,
                )
            )
            .where(
                and_(
                    Transaction.user_id == user_id_uuid, Transaction.is_deleted == False
                )
            )
            .group_by(
                TransactionCategory.name, Transaction.type, Transaction.currency
            )
        )
        if filter_params:
            stmt = self._apply_filters(stmt, filter_params)

        result = await self.db.execute(stmt)
        return [
            {
                "category": row.category_name,
                "type": (
                    row.txn_type.value
                    if hasattr(row.txn_type, "value")
                    else row.txn_type
                ),
                "currency": row.currency,
                "amount": row.amount or Decimal("0"),
            }
            for row in result.fetchall()
        ]

    async def get_top_transactions(
        self,
        user_id: str,
        filter_params: Optional[TransactionFilter] = None,
        transaction_type: Optional[TransactionType] = None,
        limit: int = 20,
    ) -> List[Transaction]:
        """Largest transactions in the current filter view, by raw amount.

        Callers that need cross-currency ranking should over-fetch (e.g. 20) and
        re-rank after FX conversion, since raw amounts aren't comparable across
        currencies.
        """
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )
        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category_obj),
                joinedload(Transaction.currency_obj),
            )
            .where(
                and_(
                    Transaction.user_id == user_id_uuid, Transaction.is_deleted == False
                )
            )
        )
        if transaction_type:
            stmt = stmt.where(Transaction.type == transaction_type)
        if filter_params:
            stmt = self._apply_filters(stmt, filter_params)
        stmt = stmt.order_by(desc(Transaction.amount)).limit(limit)

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_category_breakdown(
        self,
        user_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        transaction_type: Optional[TransactionType] = None,
        amount_field: str = "amount",
    ) -> List[dict]:
        """Get spending breakdown by category with optimized query.

        amount_field selects the unit: "amount" (the default) converts each row
        to TWD, the unit of get_summary and every card; "amount_usd" sums the
        stored USD column for a caller that wants USD on purpose. The default
        used to be USD, which put the analytics endpoint's breakdown in a
        different unit from the summary returned beside it.
        """
        # Build conditions efficiently
        base_conditions = self.counted_conditions(user_id)

        if date_from:
            base_conditions.append(Transaction.transaction_date >= date_from)
        if date_to:
            base_conditions.append(Transaction.transaction_date <= date_to)
        if transaction_type:
            base_conditions.append(Transaction.type == transaction_type)

        # Optimized query with explicit join and column selection
        from sqlalchemy import join as sql_join

        amount_column = getattr(Transaction, amount_field)
        if amount_field == "amount":
            # The native-amount callers are the ones that must agree with
            # get_summary, which is now in TWD. amount_usd callers are asking
            # for USD on purpose and are left alone.
            amount_column = in_twd(
                amount_column, Transaction.currency, await self.twd_rates_for_conditions(base_conditions)
            )
        stmt = (
            select(
                TransactionCategory.id.label("category_id"),
                TransactionCategory.name.label("category_name"),
                TransactionCategory.type.label("category_type"),
                func.coalesce(func.sum(amount_column), 0).label("amount"),
                func.count(Transaction.id).label("transaction_count"),
            )
            .select_from(
                sql_join(
                    Transaction,
                    TransactionCategory,
                    Transaction.category_id == TransactionCategory.id,
                )
            )
            .where(and_(*base_conditions))
            .group_by(
                TransactionCategory.id,
                TransactionCategory.name,
                TransactionCategory.type,
            )
            .order_by(desc("amount"))
        )

        result = await self.db.execute(stmt)
        all_rows = result.fetchall()

        if not all_rows:
            return []

        # Total across ALL categories so percentages sum to 100%
        total = sum(row.amount for row in all_rows if row.amount)
        # Return only top 20 for display, but percentages are relative to the full total
        breakdown = all_rows[:20]

        return [
            {
                "category_id": str(row.category_id),
                "category_name": row.category_name,
                "category_type": (
                    row.category_type.value
                    if hasattr(row.category_type, "value")
                    else row.category_type
                ),
                "amount": float(row.amount) if row.amount else 0.0,
                "percentage": (
                    round((float(row.amount) / float(total) * 100), 2)
                    if total > 0 and row.amount
                    else 0.0
                ),
                "transaction_count": row.transaction_count,
                "currency": "USD" if amount_field == "amount_usd" else BASE_CURRENCY,
            }
            for row in breakdown
        ]

    async def get_monthly_trends(self, user_id: str, months: int = 12) -> List[dict]:
        """Get monthly spending trends with optimized query"""
        # Convert string UUID to UUID object
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        end_date = business_today()
        start_date = end_date - relativedelta(months=months)

        month_expr = func.date_trunc("month", Transaction.transaction_date)
        conditions = [
            *self.counted_conditions(user_id_uuid),
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        ]
        # In TWD, like get_summary. The amount_usd column put this series in a
        # different unit from every other figure the dashboard shows.
        amount_twd = in_twd(
            Transaction.amount,
            Transaction.currency,
            await self.twd_rates_for_conditions(conditions),
        )

        stmt = (
            select(
                month_expr.label("month"),
                func.coalesce(
                    func.sum(case((Transaction.type == TransactionType.INCOME, amount_twd), else_=0)),
                    0,
                ).label("income"),
                func.coalesce(
                    func.sum(case((Transaction.type == TransactionType.EXPENSE, amount_twd), else_=0)),
                    0,
                ).label("expenses"),
                func.count(Transaction.id).label("transaction_count"),
            )
            .where(and_(*conditions))
            .group_by(month_expr)
            .order_by(month_expr)
        )

        result = await self.db.execute(stmt)
        trends = result.fetchall()

        return [
            {
                "month": row.month.strftime("%Y-%m"),
                "income": float(row.income) if row.income else 0.0,
                "expenses": float(row.expenses) if row.expenses else 0.0,
                "net_amount": float((row.income or 0) - (row.expenses or 0)),
                "transaction_count": row.transaction_count,
            }
            for row in trends
        ]

    async def get_payment_method_breakdown(
        self,
        user_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[dict]:
        """Payment method usage, in TWD"""
        conditions = [
            *self.counted_conditions(user_id),
            Transaction.payment_method.is_not(None),
        ]

        if date_from:
            conditions.append(Transaction.transaction_date >= date_from)
        if date_to:
            conditions.append(Transaction.transaction_date <= date_to)

        amount_twd = in_twd(
            Transaction.amount,
            Transaction.currency,
            await self.twd_rates_for_conditions(conditions),
        )
        stmt = (
            select(
                Transaction.payment_method,
                func.sum(amount_twd).label("amount"),
                func.count(Transaction.id).label("transaction_count"),
            )
            .where(and_(*conditions))
            .group_by(Transaction.payment_method)
            .order_by(desc("amount"))
        )

        result = await self.db.execute(stmt)
        breakdown = result.fetchall()

        # Calculate total for percentage calculation
        total = sum(row.amount for row in breakdown)

        return [
            {
                "payment_method": row.payment_method,
                "amount": row.amount,
                "percentage": (row.amount / total * 100) if total > 0 else 0,
                "transaction_count": row.transaction_count,
            }
            for row in breakdown
        ]

    async def get_currency_breakdown(
        self,
        user_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[dict]:
        """Each currency the user transacts in: its native total and that total in TWD.

        Income and expenses together, as the analytics payload has always
        reported it, but per currency. It used to be one row labelled USD
        holding the summary's TWD total.
        """
        conditions = self.counted_conditions(user_id)
        if date_from:
            conditions.append(Transaction.transaction_date >= date_from)
        if date_to:
            conditions.append(Transaction.transaction_date <= date_to)

        # Grouped on the raw column and folded upper-case here: grouping on
        # upper(coalesce(currency, 'TWD')) binds 'TWD' separately in SELECT and
        # GROUP BY, which Postgres rejects as two different expressions.
        rows = (
            await self.db.execute(
                select(
                    Transaction.currency,
                    func.coalesce(func.sum(Transaction.amount), 0),
                    func.count(Transaction.id),
                )
                .where(and_(*conditions))
                .group_by(Transaction.currency)
            )
        ).all()

        totals: Dict[str, dict] = {}
        for currency, amount, count in rows:
            code = (currency or BASE_CURRENCY).upper()
            entry = totals.setdefault(
                code, {"currency": code, "amount": Decimal("0"), "transaction_count": 0}
            )
            entry["amount"] += Decimal(str(amount or 0))
            entry["transaction_count"] += int(count or 0)

        rates = await twd_rates_for(self.db, totals.keys())
        for entry in totals.values():
            entry["amount_twd"] = to_twd(entry["amount"], entry["currency"], rates)
        return sorted(totals.values(), key=lambda entry: entry["amount_twd"], reverse=True)

    async def get_top_merchants(
        self,
        user_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 10,
    ) -> List[dict]:
        """Top merchants by spending, in TWD"""
        conditions = [
            *self.counted_conditions(user_id),
            Transaction.merchant_name.is_not(None),
            Transaction.type == TransactionType.EXPENSE,
        ]

        if date_from:
            conditions.append(Transaction.transaction_date >= date_from)
        if date_to:
            conditions.append(Transaction.transaction_date <= date_to)

        amount_twd = in_twd(
            Transaction.amount,
            Transaction.currency,
            await self.twd_rates_for_conditions(conditions),
        )
        stmt = (
            select(
                Transaction.merchant_name,
                func.sum(amount_twd).label("total_spent"),
                func.count(Transaction.id).label("transaction_count"),
                func.avg(amount_twd).label("average_amount"),
            )
            .where(and_(*conditions))
            .group_by(Transaction.merchant_name)
            .order_by(desc("total_spent"))
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        merchants = result.fetchall()

        return [
            {
                "merchant_name": row.merchant_name,
                "total_spent": row.total_spent,
                "transaction_count": row.transaction_count,
                "average_amount": row.average_amount,
            }
            for row in merchants
        ]

    async def search_similar_transactions(
        self,
        user_id: str,
        description: str,
        amount: Optional[Decimal] = None,
        limit: int = 5,
    ) -> List[Transaction]:
        """Search for similar transactions for auto-categorization"""
        conditions = [
            Transaction.user_id == user_id,
            Transaction.is_deleted == False,
            Transaction.reviewed_by_user
            == True,  # Only use user-reviewed transactions for training
        ]

        # Use PostgreSQL's similarity function for description matching
        stmt = (
            select(Transaction)
            .options(joinedload(Transaction.category_obj))
            .where(and_(*conditions))
            .order_by(
                func.similarity(Transaction.description, description).desc(),
                Transaction.created_at.desc(),
            )
            .limit(limit * 2)
        )  # Get more results to filter by amount similarity

        result = await self.db.execute(stmt)
        transactions = result.scalars().all()

        # If amount is provided, prioritize transactions with similar amounts
        if amount and transactions:

            def amount_similarity(t):
                if t.amount == 0:
                    return 0
                return 1 - abs(float(amount - t.amount)) / max(
                    float(amount), float(t.amount)
                )

            transactions = sorted(transactions, key=amount_similarity, reverse=True)

        return list(transactions[:limit])


class TransactionCategoryRepository:
    """Repository for transaction category database operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, category_data: dict) -> TransactionCategory:
        """Create a new transaction category.

        Idempotent on (lower(name), type): if an active category with the same
        case-insensitive name and type already exists, return it instead of
        inserting a duplicate. Duplicate active categories break name-based
        lookups (get_by_name raises MultipleResultsFound) and split a category's
        transactions across two ids. A partial unique index enforces the same
        rule at the DB level as a hard backstop.
        """
        name = (category_data.get("name") or "").strip()
        ctype = category_data.get("type")
        if name and ctype is not None:
            existing = (
                await self.db.execute(
                    select(TransactionCategory).where(
                        func.lower(TransactionCategory.name) == name.lower(),
                        TransactionCategory.type == ctype,
                        TransactionCategory.is_active == True,  # noqa: E712
                    )
                )
            ).scalars().first()
            if existing is not None:
                return existing

        category = TransactionCategory(**category_data)
        self.db.add(category)
        await self.db.commit()
        await self.db.refresh(category)
        return category

    async def create_flush(self, category_data: dict) -> TransactionCategory:
        """Like create() but flushes instead of committing.

        Mirrors ``TransactionRepository.create_flush``. Needed by the portfolio
        wallet bridge: it auto-creates its "Investment Purchase" / "Investment
        Sale" category on first use, and the committing variant would commit the
        caller's whole session — including a buy's freshly flushed holding —
        making the rest of the operation impossible to roll back. The caller owns
        the final commit.
        """
        name = (category_data.get("name") or "").strip()
        ctype = category_data.get("type")
        if name and ctype is not None:
            existing = (
                await self.db.execute(
                    select(TransactionCategory).where(
                        func.lower(TransactionCategory.name) == name.lower(),
                        TransactionCategory.type == ctype,
                        TransactionCategory.is_active == True,  # noqa: E712
                    )
                )
            ).scalars().first()
            if existing is not None:
                return existing

        category = TransactionCategory(**category_data)
        self.db.add(category)
        await self.db.flush()
        await self.db.refresh(category)
        return category

    async def get_by_name(
        self, name: str, category_type: Optional[str] = None
    ) -> Optional[TransactionCategory]:
        """Get category by name (case-insensitive)"""
        conditions = [
            func.lower(TransactionCategory.name) == name.lower(),
            TransactionCategory.is_active == True,
        ]

        if category_type:
            conditions.append(TransactionCategory.type == category_type)

        stmt = select(TransactionCategory).where(and_(*conditions))
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_ids_by_names(self, names: List[str]) -> List[str]:
        """Return every active category id whose name matches any of `names`
        (case-insensitive).

        A category name can map to more than one row when duplicate categories
        exist (e.g. two active "Dining" rows). ``get_by_name`` would raise on
        that, so name-based filters used to swallow the error and silently drop
        the filter — returning every category instead of the requested one.
        Resolving to the full set of matching ids keeps the filter correct.
        """
        lowered = [n.strip().lower() for n in names if n and n.strip()]
        if not lowered:
            return []
        stmt = select(TransactionCategory.id).where(
            func.lower(TransactionCategory.name).in_(lowered),
            TransactionCategory.is_active == True,  # noqa: E712
        )
        result = await self.db.execute(stmt)
        return [str(row[0]) for row in result.all()]

    async def get_by_id(self, category_id: str) -> Optional[TransactionCategory]:
        """Get category by ID"""
        import uuid

        # Convert string to UUID if needed
        try:
            if isinstance(category_id, str):
                category_uuid = uuid.UUID(category_id)
            else:
                category_uuid = category_id
        except (ValueError, AttributeError):
            return None

        stmt = (
            select(TransactionCategory)
            .options(selectinload(TransactionCategory.subcategories))
            .where(
                and_(
                    TransactionCategory.id == category_uuid,
                    TransactionCategory.is_active == True,
                )
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_all(
        self, category_type: Optional[str] = None, include_inactive: bool = False
    ) -> List[TransactionCategory]:
        """Get all categories with optional filtering"""
        conditions = []

        if not include_inactive:
            conditions.append(TransactionCategory.is_active == True)

        if category_type:
            conditions.append(TransactionCategory.type == category_type)

        stmt = select(TransactionCategory).options(
            selectinload(TransactionCategory.subcategories)
        )

        if conditions:
            stmt = stmt.where(and_(*conditions))

        stmt = stmt.order_by(
            TransactionCategory.usage_count.desc(), TransactionCategory.name
        )

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, category_id: str) -> bool:
        """Soft-delete a category: it stops being offered, its transactions keep it."""
        category = await self.get_by_id(category_id)
        if category is None:
            return False
        category.is_active = False
        category.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        return True

    async def update(
        self, category_id: str, update_data: dict
    ) -> Optional[TransactionCategory]:
        """Update a category"""
        import uuid

        try:
            category_uuid = uuid.UUID(category_id) if isinstance(category_id, str) else category_id
        except ValueError:
            return None
        update_data["updated_at"] = datetime.now(timezone.utc)

        stmt = (
            update(TransactionCategory)
            .where(TransactionCategory.id == category_uuid)
            .values(**update_data)
            .returning(TransactionCategory)
        )

        result = await self.db.execute(stmt)
        await self.db.commit()

        if result.scalar_one_or_none() is None:
            return None
        # Re-read through get_by_id so subcategories is loaded: the response
        # model reads it, and a lazy load there fails outside the greenlet.
        return await self.get_by_id(category_uuid)

    async def increment_usage(self, category_id: str):
        """Increment category usage count"""
        stmt = (
            update(TransactionCategory)
            .where(TransactionCategory.id == category_id)
            .values(
                usage_count=TransactionCategory.usage_count + 1,
                updated_at=datetime.now(timezone.utc),
            )
        )

        await self.db.execute(stmt)
        await self.db.commit()

    async def get_popular_categories(
        self, user_id: str, category_type: Optional[str] = None, limit: int = 10
    ) -> List[TransactionCategory]:
        """Get popular categories based on user's transaction history"""
        conditions = [Transaction.user_id == user_id, Transaction.is_deleted == False]

        if category_type:
            conditions.append(TransactionCategory.type == category_type)

        stmt = (
            select(TransactionCategory)
            .options(selectinload(TransactionCategory.subcategories))
            .select_from(TransactionCategory.__table__.join(Transaction.__table__))
            .where(and_(*conditions))
            .group_by(TransactionCategory.id)
            .order_by(
                func.count(Transaction.id).desc(),
                TransactionCategory.usage_count.desc(),
            )
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        return list(result.scalars().all())


class RecurringTransactionRepository:
    """Repository for recurring transaction database operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, recurring_data: dict, user_id: str) -> RecurringTransaction:
        """Create a new recurring transaction"""
        # Convert string UUIDs to UUID objects
        recurring_data["user_id"] = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        # Convert category_id if present
        if "category_id" in recurring_data and isinstance(
            recurring_data["category_id"], str
        ):
            recurring_data["category_id"] = uuid_module.UUID(
                recurring_data["category_id"]
            )

        recurring = RecurringTransaction(**recurring_data)
        self.db.add(recurring)
        await self.db.commit()
        await self.db.refresh(recurring)
        return recurring

    async def get_by_id(
        self, recurring_id: str, user_id: str
    ) -> Optional[RecurringTransaction]:
        """Get recurring transaction by ID"""
        # Convert string UUIDs to UUID objects
        recurring_id_uuid = (
            uuid_module.UUID(recurring_id)
            if isinstance(recurring_id, str)
            else recurring_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = (
            select(RecurringTransaction)
            .options(joinedload(RecurringTransaction.category))
            .where(
                and_(
                    RecurringTransaction.id == recurring_id_uuid,
                    RecurringTransaction.user_id == user_id_uuid,
                )
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_due_transactions(self, max_date: date) -> List[RecurringTransaction]:
        """Get recurring transactions due for processing"""
        stmt = (
            select(RecurringTransaction)
            .options(joinedload(RecurringTransaction.category))
            .where(
                and_(
                    RecurringTransaction.is_active == True,
                    RecurringTransaction.is_paused == False,
                    RecurringTransaction.next_occurrence <= max_date,
                )
            )
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def update_next_occurrence(self, recurring_id: str, next_date: date):
        """Update next occurrence date"""
        # Convert string UUID to UUID object
        recurring_id_uuid = (
            uuid_module.UUID(recurring_id)
            if isinstance(recurring_id, str)
            else recurring_id
        )

        stmt = (
            update(RecurringTransaction)
            .where(RecurringTransaction.id == recurring_id_uuid)
            .values(
                next_occurrence=next_date,
                occurrence_count=RecurringTransaction.occurrence_count + 1,
                updated_at=datetime.now(timezone.utc),
            )
        )

        await self.db.execute(stmt)
        await self.db.commit()

    async def get_all_by_user(self, user_id: str) -> List[RecurringTransaction]:
        """Get all recurring transactions for a user"""
        # Convert string UUID to UUID object
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = (
            select(RecurringTransaction)
            .options(joinedload(RecurringTransaction.category))
            .where(RecurringTransaction.user_id == user_id_uuid)
            .order_by(RecurringTransaction.next_occurrence)
        )

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def update(
        self, recurring_id: str, user_id: str, update_data: dict
    ) -> Optional[RecurringTransaction]:
        """Update a recurring transaction"""
        # Convert string UUIDs to UUID objects
        recurring_id_uuid = (
            uuid_module.UUID(recurring_id)
            if isinstance(recurring_id, str)
            else recurring_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        # Convert category_id if present in update_data
        if "category_id" in update_data and isinstance(update_data["category_id"], str):
            update_data["category_id"] = uuid_module.UUID(update_data["category_id"])

        update_data["updated_at"] = datetime.now(timezone.utc)

        stmt = (
            update(RecurringTransaction)
            .where(
                and_(
                    RecurringTransaction.id == recurring_id_uuid,
                    RecurringTransaction.user_id == user_id_uuid,
                )
            )
            .values(**update_data)
            .returning(RecurringTransaction)
        )

        result = await self.db.execute(stmt)
        await self.db.commit()

        updated_recurring = result.scalar_one_or_none()
        if updated_recurring:
            await self.db.refresh(updated_recurring)

        return updated_recurring

    async def delete(self, recurring_id: str, user_id: str) -> bool:
        """Delete a recurring transaction"""
        # Convert string UUIDs to UUID objects
        recurring_id_uuid = (
            uuid_module.UUID(recurring_id)
            if isinstance(recurring_id, str)
            else recurring_id
        )
        user_id_uuid = (
            uuid_module.UUID(user_id) if isinstance(user_id, str) else user_id
        )

        stmt = delete(RecurringTransaction).where(
            and_(
                RecurringTransaction.id == recurring_id_uuid,
                RecurringTransaction.user_id == user_id_uuid,
            )
        )

        result = await self.db.execute(stmt)
        await self.db.commit()

        return result.rowcount > 0
