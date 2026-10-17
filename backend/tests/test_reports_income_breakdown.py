"""The spending report breaks income down by category too.

/review shows where the month's money came from beneath where it went, and
both cards read the same shape. The breakdown used to be expense-only, so the
income card had nothing to draw.
"""

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.modules.reports.services import ReportsService
from app.modules.transactions.models import TransactionType


def _tx(kind, amount, category, color="#10B981"):
    tx = MagicMock()
    tx.type = kind
    tx.amount = Decimal(str(amount))
    tx.category_obj = MagicMock()
    tx.category_obj.name = category
    tx.category_obj.color = color
    return tx


TRANSACTIONS = [
    _tx(TransactionType.INCOME, 72_000, "Salary"),
    _tx(TransactionType.INCOME, 6_000, "Freelance"),
    _tx(TransactionType.INCOME, 2_000, "Freelance"),
    _tx(TransactionType.EXPENSE, 10_000, "Housing"),
]
# Each row's TWD value, as the spending report passes them in (all TWD here).
AMOUNTS = {tx.id: float(tx.amount) for tx in TRANSACTIONS}


@pytest.mark.asyncio
async def test_income_is_broken_down_by_category_apart_from_spending():
    svc = ReportsService(MagicMock())

    income = await svc._get_category_breakdown(TRANSACTIONS, AMOUNTS, TransactionType.INCOME)

    assert [(c.category, c.amount, c.transaction_count) for c in income] == [
        ("Salary", 72_000.0, 1),
        ("Freelance", 8_000.0, 2),
    ]
    assert income[0].percentage == pytest.approx(90)


@pytest.mark.asyncio
async def test_the_spending_breakdown_is_unchanged_by_default():
    svc = ReportsService(MagicMock())

    spending = await svc._get_category_breakdown(TRANSACTIONS, AMOUNTS)

    assert [(c.category, c.amount) for c in spending] == [("Housing", 10_000.0)]
