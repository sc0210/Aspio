"""
Business logic for the Loans / Debt Accounts module.

Key responsibilities:
- CRUD for debt_accounts
- Recording loan payments (creates a linked Transaction + reduces current_balance)
- Computing amortisation-based derived fields (months_remaining, total_interest_remaining, etc.)
"""

import uuid
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional
from calendar import monthrange

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.loans.models import DebtAccount, LoanStatus
from app.modules.loans.repositories import (
    DebtAccountRepository,
    LoanTransactionRepository,
    LoanCategoryRepository,
)
from app.modules.loans.schemas import (
    DebtAccountCreate,
    DebtAccountUpdate,
    DebtAccountResponse,
    DebtAccountSummary,
    LoanPaymentCreate,
    LoanPaymentResponse,
    LoanPaymentRecord,
    LoanPaymentUpdate,
)
from app.modules.transactions.models import (
    Transaction,
    TransactionType,
    TransactionWalletType,
    TransactionStatus,
)
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)


# ── Amortisation helpers ──────────────────────────────────────────────────────

def _monthly_rate(annual_pct: Decimal) -> Decimal:
    return annual_pct / Decimal("12") / Decimal("100")


def _months_remaining(balance: Decimal, annual_pct: Decimal, monthly_payment: Decimal) -> Optional[int]:
    """Estimate remaining months at the current minimum payment (simple iterative approach)."""
    if balance <= 0:
        return 0
    r = _monthly_rate(annual_pct)
    if r == 0:
        if monthly_payment <= 0:
            return None
        months = int((balance / monthly_payment).to_integral_value(ROUND_HALF_UP))
        return months
    # Monthly interest exceeds payment → loan will never pay off
    if r * balance >= monthly_payment:
        return None
    months = 0
    b = balance
    while b > 0 and months < 1200:  # cap at 100 years
        interest = (b * r).quantize(Decimal("0.01"), ROUND_HALF_UP)
        principal = monthly_payment - interest
        if principal <= 0:
            return None
        b -= principal
        months += 1
    return months


def _months_elapsed(start: date, today: date) -> int:
    """Whole payment periods completed since the loan started."""
    months = (today.year - start.year) * 12 + (today.month - start.month)
    # The period is only complete once the day-of-month has come round again,
    # with the due day clamped to the length of the current month: a loan that
    # started on the 31st falls due on the 28th in February. Comparing raw day
    # numbers means a short month never completes a period at all, so a start
    # day of 29-31 reads a month behind for the whole of every February.
    due_day = min(start.day, monthrange(today.year, today.month)[1])
    if today.day < due_day:
        months -= 1
    return max(0, months)


def _months_remaining_by_term(
    term_months: Optional[int],
    start: date,
    balance: Decimal,
    today: Optional[date] = None,
) -> Optional[int]:
    """Months left on the CONTRACT — the number the user agreed to with the bank.

    Distinct from `_months_remaining`, which estimates payoff from the current
    minimum payment. The two diverge whenever the stored payment does not
    exactly amortise the balance over the term (rounded payments, tiered rates,
    an irregular final instalment), and the contract figure is the one a user
    means by "months left". Returns None for revolving credit, which has no term.
    """
    if term_months is None:
        return None
    if balance <= 0:
        return 0
    return max(0, term_months - _months_elapsed(start, today or business_today()))


def _total_interest_remaining(balance: Decimal, annual_pct: Decimal, monthly_payment: Decimal) -> Optional[Decimal]:
    """Sum of future interest payments."""
    if balance <= 0:
        return Decimal("0")
    r = _monthly_rate(annual_pct)
    if r == 0:
        return Decimal("0")
    if r * balance >= monthly_payment:
        return None
    total_interest = Decimal("0")
    b = balance
    while b > 0:
        interest = (b * r).quantize(Decimal("0.01"), ROUND_HALF_UP)
        principal = monthly_payment - interest
        if principal <= 0:
            return None
        total_interest += interest
        b -= principal
        if len(str(total_interest)) > 20:  # safety
            return None
    return total_interest.quantize(Decimal("0.01"), ROUND_HALF_UP)


def _next_payment_date(due_day: int, today: Optional[date] = None) -> date:
    """Return the next calendar date matching the due_day.

    `today` defaults to the current date; it is injectable so callers such as
    the payment-reminder job can compute deterministically.
    """
    today = today or business_today()
    year, month = today.year, today.month
    # Clamp due_day to the actual days in this month
    max_day = monthrange(year, month)[1]
    clamped = min(due_day, max_day)
    candidate = today.replace(day=clamped)
    if candidate <= today:
        # Move to next month
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
        max_day = monthrange(year, month)[1]
        clamped = min(due_day, max_day)
        candidate = date(year, month, clamped)
    return candidate


def _enrich(loan: DebtAccount) -> DebtAccountResponse:
    """Attach computed fields to a DebtAccountResponse."""
    progress = None
    if loan.principal_amount > 0:
        paid = loan.principal_amount - loan.current_balance
        progress = float((paid / loan.principal_amount * 100).quantize(Decimal("0.01"), ROUND_HALF_UP))

    # Two different questions, deliberately kept apart: the contract term is what
    # the user agreed to and what they mean by "months left"; the payoff estimate
    # is what the stored minimum payment actually implies. They disagree whenever
    # the payment does not exactly amortise the balance over the term, and that
    # disagreement is worth showing rather than hiding behind one number.
    months = _months_remaining_by_term(
        loan.term_months, loan.start_date, loan.current_balance
    )
    payoff_estimate = _months_remaining(
        loan.current_balance, loan.interest_rate, loan.minimum_payment
    )
    if months is None:
        # Revolving credit has no term — fall back to the amortisation estimate
        # so the field is not simply blank.
        months = payoff_estimate
    total_int = _total_interest_remaining(loan.current_balance, loan.interest_rate, loan.minimum_payment)
    next_pay = _next_payment_date(loan.payment_due_day) if loan.status == LoanStatus.ACTIVE else None

    return DebtAccountResponse(
        id=loan.id,
        user_id=loan.user_id,
        name=loan.name,
        lender_name=loan.lender_name,
        account_type=loan.account_type,
        principal_amount=loan.principal_amount,
        current_balance=loan.current_balance,
        interest_rate=loan.interest_rate,
        minimum_payment=loan.minimum_payment,
        payment_due_day=loan.payment_due_day,
        start_date=loan.start_date,
        term_months=loan.term_months,
        currency=loan.currency,
        status=loan.status,
        notes=loan.notes,
        created_at=loan.created_at,
        updated_at=loan.updated_at,
        progress_pct=progress,
        months_remaining=months,
        payoff_months_estimate=payoff_estimate,
        total_interest_remaining=total_int,
        next_payment_date=next_pay,
    )


# ── Service class ─────────────────────────────────────────────────────────────

class LoanService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._loans = DebtAccountRepository(session)
        self._txns = LoanTransactionRepository(session)
        self._cats = LoanCategoryRepository(session)

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _get_or_error(self, user_id: uuid.UUID, loan_id: uuid.UUID) -> DebtAccount:
        loan = await self._loans.get_by_id(user_id, loan_id)
        if not loan:
            raise ValueError(f"Loan {loan_id} not found")
        return loan

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def list_loans(self, user_id: uuid.UUID) -> List[DebtAccountResponse]:
        loans = await self._loans.list_by_user(user_id)
        return [_enrich(loan) for loan in loans]

    async def get_loan(self, user_id: uuid.UUID, loan_id: uuid.UUID) -> DebtAccountResponse:
        loan = await self._get_or_error(user_id, loan_id)
        return _enrich(loan)

    async def create_loan(self, user_id: uuid.UUID, data: DebtAccountCreate) -> DebtAccountResponse:
        loan = DebtAccount(
            id=uuid.uuid4(),
            user_id=user_id,
            name=data.name,
            lender_name=data.lender_name,
            account_type=data.account_type,
            principal_amount=data.principal_amount,
            current_balance=data.current_balance,
            interest_rate=data.interest_rate,
            minimum_payment=data.minimum_payment,
            payment_due_day=data.payment_due_day,
            start_date=data.start_date,
            term_months=data.term_months,
            currency=data.currency,
            notes=data.notes,
            status=LoanStatus.ACTIVE,
        )
        await self._loans.add(loan)
        await self.session.flush()  # get loan.id without committing yet

        # Credit life_wallet with the loan proceeds so total_asset reflects the cash received
        receipt_category_id = await self._cats.get_or_create_receipt_category()
        receipt_txn = Transaction(
            id=uuid.uuid4(),
            user_id=user_id,
            type=TransactionType.INCOME,
            wallet_type=TransactionWalletType.LIFE,
            amount=loan.current_balance,
            currency=loan.currency,
            description=f"Loan received — {loan.name}",
            transaction_date=loan.start_date,
            category_id=receipt_category_id,
            status=TransactionStatus.COMPLETED,
            loan_id=loan.id,
        )
        self._txns.add(receipt_txn)

        await self.session.commit()
        await self._loans.refresh(loan)
        logger.info(
            f"Created loan {loan.id} for user {user_id}: {loan.name} "
            f"balance={loan.current_balance}; credited life_wallet via txn {receipt_txn.id}"
        )
        return _enrich(loan)

    async def update_loan(
        self, user_id: uuid.UUID, loan_id: uuid.UUID, data: DebtAccountUpdate
    ) -> DebtAccountResponse:
        loan = await self._get_or_error(user_id, loan_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(loan, field, value)
        await self.session.commit()
        await self._loans.refresh(loan)
        return _enrich(loan)

    async def delete_loan(self, user_id: uuid.UUID, loan_id: uuid.UUID) -> None:
        loan = await self._get_or_error(user_id, loan_id)
        await self._loans.soft_delete(loan)

        # Soft-delete ALL linked transactions (both the auto-created receipt
        # and every recorded payment) so wallets stay consistent.
        await self._txns.soft_delete_all_linked(loan_id)

        await self.session.commit()

    # ── Payment recording ─────────────────────────────────────────────────────

    async def record_payment(
        self, user_id: uuid.UUID, loan_id: uuid.UUID, data: LoanPaymentCreate
    ) -> LoanPaymentResponse:
        loan = await self._get_or_error(user_id, loan_id)

        if loan.status == LoanStatus.PAID_OFF:
            raise ValueError("This loan is already paid off")

        if data.principal_portion > loan.current_balance:
            raise ValueError(
                f"principal_portion ({data.principal_portion}) exceeds "
                f"current_balance ({loan.current_balance})"
            )

        category_id = await self._cats.get_or_create_payment_category()

        # Create the expense transaction linked to the loan
        txn = Transaction(
            id=uuid.uuid4(),
            user_id=user_id,
            type=TransactionType.EXPENSE,
            wallet_type=TransactionWalletType.LIFE,
            amount=data.total_amount,
            currency=loan.currency,
            description=f"Loan payment — {loan.name}",
            transaction_date=data.payment_date,
            category_id=category_id,
            status=TransactionStatus.COMPLETED,
            notes=data.notes,
            loan_id=loan.id,
            principal_portion=data.principal_portion,
            interest_portion=data.interest_portion,
        )
        self._txns.add(txn)

        # Reduce the balance
        loan.current_balance = (loan.current_balance - data.principal_portion).quantize(
            Decimal("0.01"), ROUND_HALF_UP
        )

        # Auto-mark as paid off
        if loan.current_balance <= 0:
            loan.current_balance = Decimal("0.00")
            loan.status = LoanStatus.PAID_OFF
            logger.info(f"Loan {loan.id} fully paid off")

        await self.session.commit()
        await self._txns.refresh(txn)
        await self._loans.refresh(loan)

        logger.info(
            f"Payment recorded for loan {loan.id}: total={data.total_amount} "
            f"principal={data.principal_portion} interest={data.interest_portion} "
            f"new_balance={loan.current_balance}"
        )

        return LoanPaymentResponse(
            transaction_id=txn.id,
            loan_id=loan.id,
            payment_date=data.payment_date,
            total_amount=data.total_amount,
            principal_portion=data.principal_portion,
            interest_portion=data.interest_portion,
            new_balance=loan.current_balance,
            is_paid_off=loan.status == LoanStatus.PAID_OFF,
        )

    # ── Payment history / editing ─────────────────────────────────────────────

    async def list_payments(
        self, user_id: uuid.UUID, loan_id: uuid.UUID
    ) -> List[LoanPaymentRecord]:
        """Return all payment (EXPENSE) transactions for a loan, newest first.
        INCOME receipt transactions are excluded from the history view."""
        await self._get_or_error(user_id, loan_id)

        transactions = await self._txns.list_payments(loan_id, user_id)

        return [
            LoanPaymentRecord(
                transaction_id=txn.id,
                loan_id=txn.loan_id,
                payment_date=txn.transaction_date,
                total_amount=txn.amount,
                principal_portion=txn.principal_portion,
                interest_portion=txn.interest_portion,
                notes=txn.notes,
                created_at=txn.created_at,
            )
            for txn in transactions
        ]

    async def update_payment(
        self,
        user_id: uuid.UUID,
        loan_id: uuid.UUID,
        transaction_id: uuid.UUID,
        data: LoanPaymentUpdate,
    ) -> LoanPaymentRecord:
        """Edit a recorded payment and recalculate the loan balance."""
        loan = await self._get_or_error(user_id, loan_id)

        txn = await self._txns.get_payment(transaction_id, loan_id, user_id)
        if not txn:
            raise ValueError("Payment not found")

        old_principal = txn.principal_portion or Decimal("0.00")

        # Same rule as record_payment: the clamp below would cut an overpayment
        # short, and undoing it later would then restore more than was taken off.
        if (
            data.principal_portion is not None
            and data.principal_portion - old_principal > loan.current_balance
        ):
            raise ValueError(
                f"principal_portion ({data.principal_portion}) exceeds "
                f"current_balance ({loan.current_balance + old_principal})"
            )

        # Apply only fields that were explicitly provided
        if data.total_amount is not None:
            txn.amount = data.total_amount
        if data.principal_portion is not None:
            txn.principal_portion = data.principal_portion
        if data.interest_portion is not None:
            txn.interest_portion = data.interest_portion
        if data.payment_date is not None:
            txn.transaction_date = data.payment_date
        if data.notes is not None:
            txn.notes = data.notes

        new_principal = txn.principal_portion or Decimal("0.00")

        # Adjust balance: if principal increased, balance decreases (and vice-versa)
        delta = new_principal - old_principal
        loan.current_balance = loan.current_balance - delta

        # Clamp to [0, principal_amount]
        loan.current_balance = max(Decimal("0.00"), min(loan.current_balance, loan.principal_amount))

        # Quantize to cents
        loan.current_balance = loan.current_balance.quantize(Decimal("0.01"), ROUND_HALF_UP)

        # Update loan status
        if loan.current_balance <= 0:
            loan.status = LoanStatus.PAID_OFF
        elif loan.current_balance > 0 and loan.status == LoanStatus.PAID_OFF:
            loan.status = LoanStatus.ACTIVE

        await self.session.commit()
        await self._txns.refresh(txn)
        await self._loans.refresh(loan)

        logger.info(
            f"Payment {transaction_id} updated for loan {loan_id}: "
            f"delta_principal={delta} new_balance={loan.current_balance}"
        )

        return LoanPaymentRecord(
            transaction_id=txn.id,
            loan_id=txn.loan_id,
            payment_date=txn.transaction_date,
            total_amount=txn.amount,
            principal_portion=txn.principal_portion,
            interest_portion=txn.interest_portion,
            notes=txn.notes,
            created_at=txn.created_at,
        )

    async def delete_payment(
        self,
        user_id: uuid.UUID,
        loan_id: uuid.UUID,
        transaction_id: uuid.UUID,
    ) -> None:
        """Soft-delete a recorded payment and reverse its effect on the loan balance."""
        loan = await self._get_or_error(user_id, loan_id)

        txn = await self._txns.get_payment_for_delete(transaction_id, loan_id, user_id)
        if not txn:
            raise ValueError("Payment not found")

        # Restore the principal that this payment reduced
        principal = txn.principal_portion or txn.amount
        loan.current_balance = min(
            loan.principal_amount,
            (loan.current_balance + principal).quantize(Decimal("0.01"), ROUND_HALF_UP),
        )
        if loan.status == LoanStatus.PAID_OFF and loan.current_balance > 0:
            loan.status = LoanStatus.ACTIVE

        txn.is_deleted = True
        txn.deleted_at = datetime.now(timezone.utc)

        await self.session.commit()

        logger.info(
            f"Payment {transaction_id} deleted for loan {loan_id}: "
            f"restored +{principal}, new_balance={loan.current_balance}"
        )

    # ── Summary (for dashboard Step 3) ───────────────────────────────────────

    async def get_summary(self, user_id: uuid.UUID) -> DebtAccountSummary:
        loans = await self.list_loans(user_id)
        active = [l for l in loans if l.status == LoanStatus.ACTIVE]

        total_debt = sum((l.current_balance for l in active), Decimal("0"))

        # Nearest upcoming payment
        next_date: Optional[date] = None
        next_amount: Optional[Decimal] = None
        if active:
            upcoming = sorted(
                [(l.next_payment_date, l.minimum_payment) for l in active if l.next_payment_date],
                key=lambda x: x[0],
            )
            if upcoming:
                next_date, next_amount = upcoming[0]

        return DebtAccountSummary(
            total_debt=total_debt,
            loan_count=len(active),
            next_payment_date=next_date,
            next_payment_amount=next_amount,
            loans=loans,
        )


def get_loan_service(session: AsyncSession) -> LoanService:
    return LoanService(session)
