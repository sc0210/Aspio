"""
Pydantic schemas for the Loans / Debt Accounts module.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.modules.loans.models import LoanAccountType, LoanStatus


# ── Create ────────────────────────────────────────────────────────────────────

class DebtAccountCreate(BaseModel):
    name: str = Field(..., max_length=200, examples=["CTBC Car Loan"])
    lender_name: Optional[str] = Field(None, max_length=200, examples=["CTBC Bank"])
    account_type: LoanAccountType
    principal_amount: Decimal = Field(..., gt=0, examples=[1_000_000])
    interest_rate: Decimal = Field(..., ge=0, examples=[2.75], description="Annual APR %")
    minimum_payment: Decimal = Field(..., gt=0, examples=[30_000])
    payment_due_day: int = Field(..., ge=1, le=31, examples=[15])
    start_date: date
    term_months: Optional[int] = Field(None, gt=0, examples=[60])
    currency: str = Field("TWD", max_length=3)
    notes: Optional[str] = None

    # current_balance defaults to principal_amount on creation
    current_balance: Optional[Decimal] = Field(
        None,
        description="Remaining balance — defaults to principal_amount when creating a new loan",
    )

    @model_validator(mode="after")
    def set_balance_default(self) -> "DebtAccountCreate":
        if self.current_balance is None:
            self.current_balance = self.principal_amount
        return self


# ── Update ────────────────────────────────────────────────────────────────────

class DebtAccountUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    lender_name: Optional[str] = Field(None, max_length=200)
    interest_rate: Optional[Decimal] = Field(None, ge=0)
    minimum_payment: Optional[Decimal] = Field(None, gt=0)
    payment_due_day: Optional[int] = Field(None, ge=1, le=31)
    term_months: Optional[int] = Field(None, gt=0)
    status: Optional[LoanStatus] = None
    notes: Optional[str] = None


# ── Read ──────────────────────────────────────────────────────────────────────

class DebtAccountResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    lender_name: Optional[str]
    account_type: LoanAccountType
    principal_amount: Decimal
    current_balance: Decimal
    interest_rate: Decimal
    minimum_payment: Decimal
    payment_due_day: int
    start_date: date
    term_months: Optional[int]
    currency: str
    status: LoanStatus
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    # Computed fields (populated by service layer)
    progress_pct: Optional[float] = Field(
        None, description="Percentage of principal already repaid (0–100)"
    )
    months_remaining: Optional[int] = Field(
        None,
        description=(
            "Months left on the contract term (term_months minus elapsed periods). "
            "Falls back to payoff_months_estimate for revolving credit, which has no term."
        ),
    )
    payoff_months_estimate: Optional[int] = Field(
        None,
        description=(
            "Months to pay off at the current minimum payment. Diverges from "
            "months_remaining when the payment does not amortise the balance over the term."
        ),
    )
    total_interest_remaining: Optional[Decimal] = Field(
        None, description="Estimated total interest left to pay"
    )
    next_payment_date: Optional[date] = Field(
        None, description="Date of the next scheduled payment"
    )

    model_config = {"from_attributes": True}


class DebtAccountSummary(BaseModel):
    """Lightweight summary used on the dashboard."""
    total_debt: Decimal = Field(..., description="Sum of current_balance across all active loans")
    loan_count: int
    next_payment_date: Optional[date]
    next_payment_amount: Optional[Decimal]
    loans: List[DebtAccountResponse]


# ── Payment recording ─────────────────────────────────────────────────────────

class LoanPaymentCreate(BaseModel):
    """
    Records a single repayment against a loan.
    Creates a linked expense Transaction and reduces current_balance by principal_portion.
    """
    payment_date: date
    total_amount: Decimal = Field(..., gt=0, description="Total payment sent to the bank")
    principal_portion: Decimal = Field(..., ge=0, description="Amount that reduces the loan balance")
    interest_portion: Decimal = Field(..., ge=0, description="Interest cost component")
    notes: Optional[str] = None

    @model_validator(mode="after")
    def portions_sum_to_total(self) -> "LoanPaymentCreate":
        if abs((self.principal_portion + self.interest_portion) - self.total_amount) > Decimal("0.01"):
            raise ValueError(
                f"principal_portion ({self.principal_portion}) + interest_portion "
                f"({self.interest_portion}) must equal total_amount ({self.total_amount})"
            )
        return self


class LoanPaymentResponse(BaseModel):
    """Returned after a payment is recorded."""
    transaction_id: UUID
    loan_id: UUID
    payment_date: date
    total_amount: Decimal
    principal_portion: Decimal
    interest_portion: Decimal
    new_balance: Decimal
    is_paid_off: bool


# ── Payment history / editing ─────────────────────────────────────────────────

class LoanPaymentRecord(BaseModel):
    """One payment entry in the history table."""
    transaction_id: UUID
    loan_id: UUID
    payment_date: date
    total_amount: Decimal
    principal_portion: Decimal
    interest_portion: Decimal
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class LoanPaymentUpdate(BaseModel):
    """Fields the user can edit on a recorded payment."""
    payment_date: Optional[date] = None
    total_amount: Optional[Decimal] = Field(None, gt=0)
    principal_portion: Optional[Decimal] = Field(None, ge=0)
    interest_portion: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def portions_consistent(self) -> "LoanPaymentUpdate":
        if (
            self.total_amount is not None
            and self.principal_portion is not None
            and self.interest_portion is not None
        ):
            if abs((self.principal_portion + self.interest_portion) - self.total_amount) > Decimal("0.01"):
                raise ValueError("principal_portion + interest_portion must equal total_amount")
        return self
