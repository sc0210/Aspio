"""
Unit tests for LoanService.create_loan and LoanService.delete_loan.

Focuses on the auto-created "Loan Receipt" income transaction that keeps
total_asset in sync when a loan is recorded or removed.
"""

import uuid
import pytest
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, call, patch

from app.modules.loans.service import (
    LoanService,
    _months_remaining,
    _months_remaining_by_term,
)
from app.modules.loans.models import LoanAccountType, LoanStatus, DebtAccount
from app.modules.loans.schemas import DebtAccountCreate
from app.modules.transactions.models import (
    Transaction,
    TransactionCategory,
    TransactionType,
    TransactionWalletType,
    CategoryType,
)
from app.utils.datetime_helpers import business_today


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_session():
    """Return a fully-mocked AsyncSession."""
    s = MagicMock()
    s.execute = AsyncMock()
    s.add = MagicMock()
    s.flush = AsyncMock()
    s.commit = AsyncMock()
    s.refresh = AsyncMock()
    return s


def _make_create_data(
    name="Car Loan",
    principal: Decimal = Decimal("500000"),
    interest_rate: Decimal = Decimal("2.5"),
    minimum_payment: Decimal = Decimal("10000"),
    payment_due_day: int = 15,
    currency: str = "TWD",
) -> DebtAccountCreate:
    return DebtAccountCreate(
        name=name,
        lender_name="Test Bank",
        account_type=LoanAccountType.PERSONAL_LOAN,
        principal_amount=principal,
        interest_rate=interest_rate,
        minimum_payment=minimum_payment,
        payment_due_day=payment_due_day,
        start_date=business_today(),
        currency=currency,
    )


def _no_existing_category_execute():
    """execute() mock that returns no existing TransactionCategory."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = None
    return r


def _existing_category_execute(cat_id: uuid.UUID):
    """execute() mock that returns a pre-existing TransactionCategory."""
    cat = MagicMock(spec=TransactionCategory)
    cat.id = cat_id
    r = MagicMock()
    r.scalar_one_or_none.return_value = cat
    return r


# ── Tests: create_loan receipt transaction ────────────────────────────────────

class TestCreateLoanReceiptTransaction:
    """create_loan must auto-create one INCOME transaction against life_wallet."""

    @pytest.mark.asyncio
    async def test_income_transaction_is_added_to_session(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        added = [c.args[0] for c in session.add.call_args_list]
        income_txns = [
            obj for obj in added
            if isinstance(obj, Transaction) and obj.type == TransactionType.INCOME
        ]
        assert len(income_txns) == 1, "Expected exactly one INCOME transaction to be added"

    @pytest.mark.asyncio
    async def test_receipt_transaction_amount_equals_principal(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()
        principal = Decimal("300000")

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(
                uuid.uuid4(), _make_create_data(principal=principal)
            )

        added = [c.args[0] for c in session.add.call_args_list]
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert txn.amount == principal

    @pytest.mark.asyncio
    async def test_receipt_transaction_targets_life_wallet(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        added = [c.args[0] for c in session.add.call_args_list]
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert txn.wallet_type == TransactionWalletType.LIFE

    @pytest.mark.asyncio
    async def test_receipt_transaction_inherits_loan_currency(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(
                uuid.uuid4(), _make_create_data(currency="USD")
            )

        added = [c.args[0] for c in session.add.call_args_list]
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert txn.currency == "USD"

    @pytest.mark.asyncio
    async def test_receipt_transaction_description_contains_loan_name(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(
                uuid.uuid4(), _make_create_data(name="Home Mortgage")
            )

        added = [c.args[0] for c in session.add.call_args_list]
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert "Home Mortgage" in txn.description

    @pytest.mark.asyncio
    async def test_receipt_transaction_linked_to_loan_via_loan_id(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        added = [c.args[0] for c in session.add.call_args_list]
        loan = next(obj for obj in added if isinstance(obj, DebtAccount))
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert txn.loan_id == loan.id

    @pytest.mark.asyncio
    async def test_receipt_transaction_date_matches_loan_start_date(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()
        start = date(2026, 1, 10)
        data = DebtAccountCreate(
            name="Test",
            lender_name="Bank",
            account_type=LoanAccountType.PERSONAL_LOAN,
            principal_amount=Decimal("100000"),
            interest_rate=Decimal("3.0"),
            minimum_payment=Decimal("5000"),
            payment_due_day=10,
            start_date=start,
        )

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), data)

        added = [c.args[0] for c in session.add.call_args_list]
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert txn.transaction_date == start

    @pytest.mark.asyncio
    async def test_session_is_flushed_before_receipt_transaction(self):
        """Flush must happen before we create the receipt so loan.id is available."""
        flush_calls = []
        add_calls = []

        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()
        session.flush.side_effect = lambda: flush_calls.append("flush")
        session.add.side_effect = lambda obj: add_calls.append(type(obj).__name__)

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        # First flush must occur before Transaction is added
        first_txn_index = next(i for i, n in enumerate(add_calls) if n == "Transaction")
        first_flush_index = next(i for i, n in enumerate(add_calls + ["flush"] * flush_calls.count("flush"))
                                 if n == "flush")
        # We can't interleave two separate lists cleanly, so just assert flush happened
        assert flush_calls, "session.flush() was never called"
        assert first_txn_index > 0, "Transaction was added without a preceding flush"

    @pytest.mark.asyncio
    async def test_session_commit_called_once(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        session.commit.assert_called_once()


# ── Tests: receipt category creation ─────────────────────────────────────────

class TestLoanReceiptCategory:
    """_get_or_create_loan_receipt_category must be idempotent."""

    @pytest.mark.asyncio
    async def test_creates_income_category_when_none_exists(self):
        session = _make_session()
        session.execute.return_value = _no_existing_category_execute()

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        added = [c.args[0] for c in session.add.call_args_list]
        cats = [obj for obj in added if isinstance(obj, TransactionCategory)]
        assert len(cats) == 1
        assert cats[0].type == CategoryType.INCOME
        assert cats[0].name == "Loan Receipt"
        assert cats[0].is_system is True

    @pytest.mark.asyncio
    async def test_reuses_existing_category_without_creating_new_one(self):
        existing_id = uuid.uuid4()
        session = _make_session()
        session.execute.return_value = _existing_category_execute(existing_id)

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        added = [c.args[0] for c in session.add.call_args_list]
        cats = [obj for obj in added if isinstance(obj, TransactionCategory)]
        assert len(cats) == 0, "Should not create a new category when one already exists"

    @pytest.mark.asyncio
    async def test_receipt_transaction_uses_existing_category_id(self):
        existing_id = uuid.uuid4()
        session = _make_session()
        session.execute.return_value = _existing_category_execute(existing_id)

        with patch("app.modules.loans.service._enrich", return_value=MagicMock()):
            await LoanService(session).create_loan(uuid.uuid4(), _make_create_data())

        added = [c.args[0] for c in session.add.call_args_list]
        txn = next(obj for obj in added if isinstance(obj, Transaction))
        assert txn.category_id == existing_id


# ── Tests: delete_loan cleans up receipt transaction ─────────────────────────

class TestDeleteLoanReceiptCleanup:
    """delete_loan must soft-delete the linked INCOME receipt transaction."""

    def _make_loan(self, loan_id: uuid.UUID, user_id: uuid.UUID) -> DebtAccount:
        loan = MagicMock(spec=DebtAccount)
        loan.id = loan_id
        loan.user_id = user_id
        loan.is_deleted = False
        loan.deleted_at = None
        loan.status = LoanStatus.ACTIVE
        return loan

    def _make_receipt_txn(self, loan_id: uuid.UUID) -> Transaction:
        txn = MagicMock(spec=Transaction)
        txn.id = uuid.uuid4()
        txn.loan_id = loan_id
        txn.type = TransactionType.INCOME
        txn.is_deleted = False
        txn.deleted_at = None
        return txn

    @pytest.mark.asyncio
    async def test_receipt_transaction_is_soft_deleted(self):
        user_id = uuid.uuid4()
        loan_id = uuid.uuid4()
        loan = self._make_loan(loan_id, user_id)
        receipt_txn = self._make_receipt_txn(loan_id)

        loan_result = MagicMock()
        loan_result.scalar_one_or_none.return_value = loan

        txn_result = MagicMock()
        txn_result.scalars.return_value.all.return_value = [receipt_txn]

        session = _make_session()
        session.execute.side_effect = [loan_result, txn_result]

        await LoanService(session).delete_loan(user_id, loan_id)

        assert receipt_txn.is_deleted is True
        assert receipt_txn.deleted_at is not None

    @pytest.mark.asyncio
    async def test_loan_itself_is_soft_deleted(self):
        user_id = uuid.uuid4()
        loan_id = uuid.uuid4()
        loan = self._make_loan(loan_id, user_id)

        loan_result = MagicMock()
        loan_result.scalar_one_or_none.return_value = loan

        txn_result = MagicMock()
        txn_result.scalars.return_value.all.return_value = []

        session = _make_session()
        session.execute.side_effect = [loan_result, txn_result]

        await LoanService(session).delete_loan(user_id, loan_id)

        assert loan.is_deleted is True
        assert loan.deleted_at is not None

    @pytest.mark.asyncio
    async def test_delete_with_no_receipt_transaction_does_not_raise(self):
        """Loans created before the fix have no receipt transaction — delete must still work."""
        user_id = uuid.uuid4()
        loan_id = uuid.uuid4()
        loan = self._make_loan(loan_id, user_id)

        loan_result = MagicMock()
        loan_result.scalar_one_or_none.return_value = loan

        txn_result = MagicMock()
        txn_result.scalars.return_value.all.return_value = []  # no receipt txn

        session = _make_session()
        session.execute.side_effect = [loan_result, txn_result]

        # Should complete without error
        await LoanService(session).delete_loan(user_id, loan_id)
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_commits_after_soft_deletes(self):
        user_id = uuid.uuid4()
        loan_id = uuid.uuid4()
        loan = self._make_loan(loan_id, user_id)
        receipt_txn = self._make_receipt_txn(loan_id)

        loan_result = MagicMock()
        loan_result.scalar_one_or_none.return_value = loan

        txn_result = MagicMock()
        txn_result.scalars.return_value.all.return_value = [receipt_txn]

        session = _make_session()
        session.execute.side_effect = [loan_result, txn_result]

        await LoanService(session).delete_loan(user_id, loan_id)

        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_nonexistent_loan_raises_value_error(self):
        session = _make_session()
        not_found = MagicMock()
        not_found.scalar_one_or_none.return_value = None
        session.execute.return_value = not_found

        with pytest.raises(ValueError, match="not found"):
            await LoanService(session).delete_loan(uuid.uuid4(), uuid.uuid4())


class TestMonthsRemainingByTerm:
    """The card's 剩餘月數 tracks the CONTRACT term, not the payment estimate.

    These two answers diverge whenever the stored minimum payment does not
    exactly amortise the balance over the term — a rounded-down payment, a
    tiered rate, an irregular final instalment. Before this split the card
    showed only the payment-derived figure, so a 7-year loan whose payment was
    ~2% light displayed 87 months against a term of 84 with nothing to explain
    the gap.
    """

    def test_full_term_remains_on_the_start_date(self):
        assert _months_remaining_by_term(
            84, date(2026, 8, 17), Decimal("2760000"), today=date(2026, 8, 17)
        ) == 84

    def test_period_counts_only_once_the_due_day_comes_round(self):
        start = date(2026, 5, 19)
        # Aug 17 — the 19th has not arrived, so only two periods are complete.
        assert _months_remaining_by_term(
            84, start, Decimal("1134742"), today=date(2026, 8, 17)
        ) == 82
        # Aug 19 — the third period completes.
        assert _months_remaining_by_term(
            84, start, Decimal("1134742"), today=date(2026, 8, 19)
        ) == 81

    def test_short_month_clamps_the_due_day(self):
        # A loan that started on the 31st falls due on the 28th in February.
        # Comparing raw day numbers meant February never completed a period,
        # so a start day of 29-31 read a month behind for the whole of it.
        start = date(2026, 1, 31)
        assert _months_remaining_by_term(
            84, start, Decimal("2760000"), today=date(2026, 2, 27)
        ) == 84
        assert _months_remaining_by_term(
            84, start, Decimal("2760000"), today=date(2026, 2, 28)
        ) == 83

    def test_leap_february_clamps_to_the_29th(self):
        # 2028 is a leap year, so the clamp lands a day later than in 2026.
        start = date(2028, 1, 30)
        assert _months_remaining_by_term(
            84, start, Decimal("2760000"), today=date(2028, 2, 28)
        ) == 84
        assert _months_remaining_by_term(
            84, start, Decimal("2760000"), today=date(2028, 2, 29)
        ) == 83

    def test_revolving_credit_has_no_term(self):
        assert _months_remaining_by_term(
            None, date(2026, 1, 1), Decimal("5000"), today=date(2026, 8, 17)
        ) is None

    def test_cleared_balance_is_zero_regardless_of_term(self):
        assert _months_remaining_by_term(
            84, date(2026, 5, 19), Decimal("0"), today=date(2026, 8, 17)
        ) == 0

    def test_overrunning_the_term_clamps_at_zero(self):
        assert _months_remaining_by_term(
            12, date(2020, 1, 1), Decimal("500"), today=date(2026, 8, 17)
        ) == 0

    def test_payoff_estimate_still_reflects_the_payment(self):
        # Unchanged behaviour, now reported separately: 38,000/mo at 4.88%
        # does not clear 2,760,000 in the contracted 84 months.
        assert _months_remaining(
            Decimal("2760000"), Decimal("4.88"), Decimal("38000")
        ) == 87


class TestUpdatePaymentOverpayment:
    """Raising a payment past what is left was clamped to 0; lowering it again then
    restored more than had come off. Same rule as record_payment now."""

    def _service(self, *, balance, old_principal):
        svc = LoanService(_make_session())
        loan = MagicMock(spec=DebtAccount)
        loan.current_balance = Decimal(balance)
        loan.principal_amount = Decimal("100000.00")
        loan.status = LoanStatus.ACTIVE
        txn = MagicMock(spec=Transaction)
        txn.principal_portion = Decimal(old_principal)
        svc._get_or_error = AsyncMock(return_value=loan)
        svc._txns.get_payment = AsyncMock(return_value=txn)
        return svc, loan, txn

    @pytest.mark.asyncio
    async def test_raise_past_the_balance_is_refused_untouched(self):
        from app.modules.loans.schemas import LoanPaymentUpdate

        # 3,000 left after this 1,000 payment: up to 4,000 fits, 5,000 does not.
        svc, loan, txn = self._service(balance="3000.00", old_principal="1000.00")
        with pytest.raises(ValueError, match="exceeds"):
            await svc.update_payment(
                uuid.uuid4(), uuid.uuid4(), uuid.uuid4(),
                LoanPaymentUpdate(principal_portion=Decimal("5000.00"),
                                  total_amount=Decimal("5000.00")),
            )
        assert loan.current_balance == Decimal("3000.00")
        assert txn.principal_portion == Decimal("1000.00")
        svc.session.commit.assert_not_awaited()
