"""Repaying a loan is not discretionary spending.

/transactions/monthly-summary summed loan repayments into "others", so a column meant
to read as day-to-day spending was mostly 信貸 servicing — on the live 2026 data, four
fifths of one month's "others". Debt gets its own bucket now.

These drive the endpoint and the demo service, not just the classifier: the two paths
have drifted before (the demo copy once counted a transfer's inflow as earnings), and a
typo in `txn.loan_id` or in the `**empty_buckets()` merge would not show up in a unit
test of `bucket_for` alone.
"""

import json
import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.modules.loans.models import DebtAccount, LoanAccountType, LoanStatus
from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.router import get_monthly_summary

YEAR = 2026
MONTH = 8


def _category(name, kind=CategoryType.EXPENSE):
    return TransactionCategory(id=uuid_module.uuid4(), name=name, type=kind)


def _loan(user_id, account_type=LoanAccountType.PERSONAL_LOAN):
    return DebtAccount(
        id=uuid_module.uuid4(),
        user_id=user_id,
        name="Test loan",
        account_type=account_type,
        principal_amount=Decimal("1000000"),
        current_balance=Decimal("900000"),
        interest_rate=Decimal("2.5"),
        minimum_payment=Decimal("16000"),
        payment_due_day=5,
        start_date=date(2025, 1, 1),
        currency="TWD",
        status=LoanStatus.ACTIVE,
        is_deleted=False,
    )


def _txn(user_id, amount, category, loan_id=None):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category.id,
        type=TransactionType.EXPENSE,
        status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)),
        currency="TWD",
        description="test",
        transaction_date=datetime(YEAR, MONTH, 10, tzinfo=timezone.utc),
        wallet_type=TransactionWalletType.LIFE,
        loan_id=loan_id,
        is_deleted=False,
    )


async def _august(session, user_id):
    await session.commit()
    # Load from the database rather than the identity map, which is what exposed a
    # lazy load of `category_obj` that 500s under the async session.
    session.expunge_all()
    response = await get_monthly_summary(
        transaction_service=MagicMock(),
        db=session,
        current_user=SimpleNamespace(id=user_id),
        year=YEAR,
    )
    months = json.loads(response.body)["data"]
    return next(m for m in months if m["month"] == f"{YEAR}-{MONTH:02d}")


@pytest.mark.asyncio
@pytest.mark.database
async def test_both_signals_land_in_debt_and_leave_others_empty(async_session):
    """Category name and loan link, because the live data has each without the other.

    Of the seven loan payments on the box, five carry `loan_id` and two only the
    category — so either signal alone would miss real rows.
    """
    user_id = uuid_module.uuid4()
    loan = _loan(user_id)
    loan_payment = _category("Loan Payment")
    misc = _category("Miscellaneous")
    async_session.add_all([loan, loan_payment, misc])
    async_session.add_all([
        _txn(user_id, 16_634, loan_payment),                    # category only
        _txn(user_id, 25_634, misc, loan_id=loan.id),           # link only
    ])

    august = await _august(async_session, user_id)

    assert august["debt"] == 16_634 + 25_634
    assert august["others"] == 0
    assert august["total"] == 16_634 + 25_634


@pytest.mark.asyncio
@pytest.mark.database
async def test_ordinary_spending_is_untouched(async_session):
    user_id = uuid_module.uuid4()
    groceries = _category("Groceries")
    gifts = _category("Gifts")
    async_session.add_all([groceries, gifts])
    async_session.add_all([
        _txn(user_id, 4_200, groceries),
        _txn(user_id, 900, gifts),
    ])

    august = await _august(async_session, user_id)

    assert august["debt"] == 0
    assert august["eat"] == 4_200
    assert august["others"] == 900


@pytest.mark.asyncio
@pytest.mark.database
async def test_linking_a_housing_expense_to_a_loan_does_not_move_it(async_session):
    """The carve-out, end to end: Housing cannot shrink because someone linked a row.

    A hand-entered "Mortgage" (or "Rent") carrying a loan link stays in housing. If the
    link outranked the category, attaching a loan to an existing housing expense would
    silently drop the Housing column.
    """
    user_id = uuid_module.uuid4()
    loan = _loan(user_id, account_type=LoanAccountType.MORTGAGE)
    mortgage = _category("Mortgage")
    async_session.add_all([loan, mortgage])
    async_session.add(_txn(user_id, 31_000, mortgage, loan_id=loan.id))

    august = await _august(async_session, user_id)

    assert august["housing"] == 31_000
    assert august["debt"] == 0


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_loans_page_mortgage_payment_is_debt(async_session):
    """And the other direction, which is deliberate rather than an oversight.

    `LoanService.record_payment` files every payment under the system "Loan Payment"
    category whatever the loan's `account_type` is, so a mortgage paid through the
    Loans page does NOT match the housing carve-out and lands in debt.

    That is the right outcome here: such a row was in `others` before this bucket
    existed, never in `housing`. Routing it to `housing` would GROW that column, which
    is exactly the silent change the carve-out exists to prevent. Housing is untouched
    either way — only Others shrinks.
    """
    user_id = uuid_module.uuid4()
    loan = _loan(user_id, account_type=LoanAccountType.MORTGAGE)
    # The category the Loans page actually writes — not "Mortgage".
    loan_payment = _category("Loan Payment")
    async_session.add_all([loan, loan_payment])
    async_session.add(_txn(user_id, 31_000, loan_payment, loan_id=loan.id))

    august = await _august(async_session, user_id)

    assert august["debt"] == 31_000
    assert august["housing"] == 0
    assert august["others"] == 0


@pytest.mark.asyncio
@pytest.mark.database
async def test_every_month_reports_the_bucket_even_when_empty(async_session):
    """A missing key renders as a blank cell rather than NT$0."""
    user_id = uuid_module.uuid4()
    groceries = _category("Groceries")
    async_session.add(groceries)
    async_session.add(_txn(user_id, 100, groceries))

    await async_session.commit()
    async_session.expunge_all()
    response = await get_monthly_summary(
        transaction_service=MagicMock(),
        db=async_session,
        current_user=SimpleNamespace(id=user_id),
        year=YEAR,
    )
    months = json.loads(response.body)["data"]

    assert len(months) == 12
    assert all("debt" in m for m in months)


@pytest.mark.asyncio
async def test_the_demo_path_follows_the_same_rule():
    """Demo mode builds this summary from fixtures, by its own code path."""
    from app.modules.transactions.demo_service import DemoTransactionService

    service = DemoTransactionService()
    groceries_id = service.demo_categories[0]["id"]
    loan_category = {"id": "cat-loan", "name": "Loan Payment", "type": "expense"}
    service.demo_categories = [*service.demo_categories, loan_category]

    when = datetime(YEAR, MONTH, 10)
    service.demo_transactions = [
        {
            "id": "d1", "transaction_date": when, "amount": 4_200,
            "type": TransactionType.EXPENSE, "category_id": groceries_id,
            "transfer_group_id": None,
        },
        {   # by category
            "id": "d2", "transaction_date": when, "amount": 16_634,
            "type": TransactionType.EXPENSE, "category_id": "cat-loan",
            "transfer_group_id": None,
        },
        {   # by link, with an unrelated category
            "id": "d3", "transaction_date": when, "amount": 25_634,
            "type": TransactionType.EXPENSE, "category_id": groceries_id,
            "transfer_group_id": None, "loan_id": "loan-1",
        },
    ]

    months = await service.get_monthly_summary(YEAR)
    august = next(m for m in months if m["month"] == f"{YEAR}-{MONTH:02d}")

    assert august["debt"] == 16_634 + 25_634
    assert august["others"] == 0
