"""The spending report counts every row in its window, whatever moved the money.

A loan received, a transfer between the wallets and an investment purchase all
move the wallet balances /review shows beside these figures. An `everyday`
filter briefly left them out, and the two cards then could not explain each
other: August read NT$158k of income beside a Life wallet up NT$635k. This pins
the default, because that is the parity the page depends on.
"""

import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.reports.services import ReportsService
from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)


def _category(name, kind):
    return TransactionCategory(id=uuid_module.uuid4(), name=name, type=kind)


def _txn(user_id, amount, kind, category, *, wallet=TransactionWalletType.LIFE, **links):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=category.id,
        type=kind,
        status=TransactionStatus.COMPLETED,
        amount=Decimal(str(amount)),
        currency="TWD",
        description="test",
        transaction_date=datetime(2026, 8, 10, tzinfo=timezone.utc),
        wallet_type=wallet,
        is_deleted=False,
        **links,
    )


@pytest_asyncio.fixture
async def august(async_session):
    user_id = uuid_module.uuid4()
    salary = _category("Salary", CategoryType.INCOME)
    housing = _category("Housing", CategoryType.EXPENSE)
    loan = _category("Loan Receipt", CategoryType.INCOME)
    transfer_out = _category("Transfer", CategoryType.EXPENSE)
    buy = _category("Investment Purchase", CategoryType.EXPENSE)
    transfer = uuid_module.uuid4()
    async_session.add_all([salary, housing, loan, transfer_out, buy])
    async_session.add_all([
        _txn(user_id, 60_000, TransactionType.INCOME, salary),
        _txn(user_id, 30_000, TransactionType.EXPENSE, housing),
        _txn(user_id, 1_000_000, TransactionType.INCOME, loan, loan_id=uuid_module.uuid4()),
        _txn(user_id, 50_000, TransactionType.EXPENSE, transfer_out, transfer_group_id=transfer),
        _txn(user_id, 300_000, TransactionType.EXPENSE, buy, holding_id=uuid_module.uuid4()),
    ])
    await async_session.commit()
    return user_id


@pytest.mark.asyncio
@pytest.mark.database
async def test_borrowed_transferred_and_invested_money_all_count(async_session, august):
    report = await ReportsService(async_session).get_spending_report(
        str(august), date(2026, 8, 1), date(2026, 8, 31), detailed=False
    )

    assert report.total_income == pytest.approx(60_000 + 1_000_000)
    assert report.total_expenses == pytest.approx(30_000 + 50_000 + 300_000)
    assert {c.category for c in report.income_breakdown} == {"Salary", "Loan Receipt"}
    assert {c.category for c in report.category_breakdown} == {"Housing", "Transfer", "Investment Purchase"}
