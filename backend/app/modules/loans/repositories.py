"""
Repository layer for the Loans / Debt Accounts module.

Owns all raw database access for:
  - DebtAccount records (CRUD + soft-delete)
  - Transaction rows that are linked to a loan (payments + receipt)
  - The TransactionCategory look-up / create for loan-specific system categories

No business logic here — that lives in service.py.
The caller (service) is responsible for commit() / rollback().
"""

import uuid
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.loans.models import DebtAccount, LoanStatus
from app.modules.transactions.models import (
    Transaction,
    TransactionType,
    TransactionWalletType,
    TransactionStatus,
    TransactionCategory,
    CategoryType,
)

logger = logging.getLogger(__name__)


class DebtAccountRepository:
    """Raw DB operations for DebtAccount rows."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(
        self, user_id: uuid.UUID, loan_id: uuid.UUID
    ) -> Optional[DebtAccount]:
        """Return the loan if it belongs to user and is not soft-deleted."""
        result = await self.session.execute(
            select(DebtAccount).where(
                and_(
                    DebtAccount.id == loan_id,
                    DebtAccount.user_id == user_id,
                    DebtAccount.is_deleted == False,
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_by_user(self, user_id: uuid.UUID) -> List[DebtAccount]:
        """Return all non-deleted loans for a user, ordered by creation time."""
        result = await self.session.execute(
            select(DebtAccount)
            .where(
                and_(
                    DebtAccount.user_id == user_id,
                    DebtAccount.is_deleted == False,
                )
            )
            .order_by(DebtAccount.created_at.asc())
        )
        return list(result.scalars().all())

    async def add(self, loan: DebtAccount) -> None:
        """Stage a new DebtAccount for insertion (caller must flush/commit)."""
        self.session.add(loan)

    async def soft_delete(self, loan: DebtAccount) -> None:
        """Mark the loan as deleted without removing the row."""
        loan.is_deleted = True
        loan.deleted_at = datetime.now(timezone.utc)

    async def refresh(self, loan: DebtAccount) -> None:
        """Reload the ORM object from the database."""
        await self.session.refresh(loan)


class LoanTransactionRepository:
    """Raw DB operations for Transaction rows that are linked to a loan."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def add(self, txn: Transaction) -> None:
        """Stage a new linked Transaction (caller must flush/commit)."""
        self.session.add(txn)

    async def get_payment(
        self,
        transaction_id: uuid.UUID,
        loan_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Optional[Transaction]:
        """Return a payment Transaction that matches loan + user ownership."""
        result = await self.session.execute(
            select(Transaction).where(
                and_(
                    Transaction.id == transaction_id,
                    Transaction.loan_id == loan_id,
                    Transaction.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_payment_for_delete(
        self,
        transaction_id: uuid.UUID,
        loan_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Optional[Transaction]:
        """Return an active EXPENSE payment transaction for deletion."""
        result = await self.session.execute(
            select(Transaction).where(
                and_(
                    Transaction.id == transaction_id,
                    Transaction.loan_id == loan_id,
                    Transaction.user_id == user_id,
                    Transaction.type == TransactionType.EXPENSE,
                    Transaction.is_deleted == False,
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_payments(
        self, loan_id: uuid.UUID, user_id: uuid.UUID
    ) -> List[Transaction]:
        """Return all EXPENSE transactions for a loan, newest first."""
        stmt = (
            select(Transaction)
            .where(
                and_(
                    Transaction.loan_id == loan_id,
                    Transaction.user_id == user_id,
                    Transaction.type == TransactionType.EXPENSE,
                )
            )
            .order_by(
                Transaction.transaction_date.desc(),
                Transaction.created_at.desc(),
            )
        )
        if hasattr(Transaction, "is_deleted"):
            stmt = stmt.where(Transaction.is_deleted == False)

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def soft_delete_all_linked(
        self, loan_id: uuid.UUID
    ) -> None:
        """Soft-delete every active Transaction linked to this loan."""
        linked_result = await self.session.execute(
            select(Transaction).where(
                and_(
                    Transaction.loan_id == loan_id,
                    Transaction.is_deleted == False,
                )
            )
        )
        now = datetime.now(timezone.utc)
        for txn in linked_result.scalars().all():
            txn.is_deleted = True
            txn.deleted_at = now

    async def refresh(self, txn: Transaction) -> None:
        """Reload the ORM object from the database."""
        await self.session.refresh(txn)


class LoanCategoryRepository:
    """Look-up / create system TransactionCategory rows used by loans."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_or_create_payment_category(self) -> uuid.UUID:
        """Return the id of the system 'Loan Payment' expense category."""
        result = await self.session.execute(
            select(TransactionCategory).where(
                and_(
                    TransactionCategory.name == "Loan Payment",
                    TransactionCategory.is_system == True,
                )
            )
        )
        cat = result.scalar_one_or_none()
        if cat:
            return cat.id

        cat = TransactionCategory(
            id=uuid.uuid4(),
            name="Loan Payment",
            name_en="Loan Payment",
            type=CategoryType.EXPENSE,
            color="#8b5cf6",
            icon="bank",
            is_default=False,
            is_active=True,
            is_system=True,
        )
        self.session.add(cat)
        await self.session.flush()
        return cat.id

    async def get_or_create_receipt_category(self) -> uuid.UUID:
        """Return the id of the system 'Loan Receipt' income category."""
        result = await self.session.execute(
            select(TransactionCategory).where(
                and_(
                    TransactionCategory.name == "Loan Receipt",
                    TransactionCategory.is_system == True,
                )
            )
        )
        cat = result.scalar_one_or_none()
        if cat:
            return cat.id

        cat = TransactionCategory(
            id=uuid.uuid4(),
            name="Loan Receipt",
            name_en="Loan Receipt",
            type=CategoryType.INCOME,
            color="#8b5cf6",
            icon="bank",
            is_default=False,
            is_active=True,
            is_system=True,
        )
        self.session.add(cat)
        await self.session.flush()
        return cat.id
