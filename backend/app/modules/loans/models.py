"""
Loan / Debt Account models for Aspiro.

A DebtAccount represents a liability (bank loan, mortgage, credit card, etc.).
Each monthly repayment is recorded as a Transaction linked back to the loan,
with the payment split into principal_portion (reduces balance) and
interest_portion (pure expense shown in Cash Flow).
"""

import uuid
import enum
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    String,
    Text,
    Numeric,
    Date,
    DateTime,
    Boolean,
    Integer,
    SmallInteger,
    ForeignKey,
    Index,
    CheckConstraint,
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database.base import BaseModel


class LoanAccountType(str, enum.Enum):
    PERSONAL_LOAN = "personal_loan"
    MORTGAGE = "mortgage"
    AUTO_LOAN = "auto_loan"
    STUDENT_LOAN = "student_loan"
    CREDIT_CARD = "credit_card"
    OTHER = "other"


class LoanStatus(str, enum.Enum):
    ACTIVE = "active"
    PAID_OFF = "paid_off"
    PAUSED = "paused"


class DebtAccount(BaseModel):
    """Tracks a single loan / liability."""

    __tablename__ = "debt_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Identity
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    lender_name: Mapped[Optional[str]] = mapped_column(String(200))
    account_type: Mapped[LoanAccountType] = mapped_column(
        SAEnum(LoanAccountType, name="loan_account_type", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )

    # Balances
    principal_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, comment="Original loan amount — never changes"
    )
    current_balance: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, comment="Remaining principal owed — decreases after each payment"
    )

    # Loan terms
    interest_rate: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, comment="Annual interest rate (APR) as a percentage, e.g. 2.75"
    )
    minimum_payment: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, comment="Monthly minimum payment amount"
    )
    payment_due_day: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, comment="Day of month the payment is due (1–31)"
    )

    # Schedule
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    term_months: Mapped[Optional[int]] = mapped_column(
        Integer, comment="Total loan term in months (null for revolving credit)"
    )

    # Currency
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TWD")

    # Status
    status: Mapped[LoanStatus] = mapped_column(
        SAEnum(LoanStatus, name="loan_status", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=LoanStatus.ACTIVE,
    )

    # Extras
    notes: Mapped[Optional[str]] = mapped_column(Text)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    payments: Mapped[List["Transaction"]] = relationship(  # type: ignore[name-defined]
        "Transaction",
        primaryjoin="DebtAccount.id == foreign(Transaction.loan_id)",
        back_populates="loan",
        lazy="dynamic",
    )

    __table_args__ = (
        Index("idx_debt_accounts_user", "user_id"),
        Index("idx_debt_accounts_status", "status"),
        Index("idx_debt_accounts_user_status", "user_id", "status"),
        Index("idx_debt_accounts_deleted", "is_deleted"),
        CheckConstraint("principal_amount > 0", name="ck_debt_principal_positive"),
        CheckConstraint("current_balance >= 0", name="ck_debt_balance_non_negative"),
        CheckConstraint("interest_rate >= 0", name="ck_debt_rate_non_negative"),
        CheckConstraint("minimum_payment > 0", name="ck_debt_min_payment_positive"),
        CheckConstraint("payment_due_day >= 1 AND payment_due_day <= 31", name="ck_debt_due_day_range"),
    )
