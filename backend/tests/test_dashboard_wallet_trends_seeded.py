"""Wallet trends against real rows: holdings value and loan balance paths."""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.modules.loans.models import DebtAccount, LoanAccountType
from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _trend(client, period="14d"):
    r = client.get(f"/api/v1/dashboard/wallet-trends?period={period}")
    assert r.status_code == 200, r.text
    return r.json()["data"]["dataPoints"]


async def test_holding_is_valued_only_from_its_purchase_day(authenticated_client, test_user, async_session):
    today = business_today()
    pf = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(pf)
    await async_session.flush()
    async_session.add(PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=test_user.id, symbol="0050", name="ETF",
        type="etf", exchange="TWSE", currency="TWD", market="TW",
        wallet_type=HoldingWalletType.PORTFOLIO, quantity=Decimal("10"),
        average_cost=Decimal("100"), current_price=Decimal("150"), total_cost=Decimal("1000"),
        total_value=Decimal("1500"), gain_loss=Decimal("500"), gain_loss_percentage=Decimal("50"),
        is_active=True, purchase_date=today - timedelta(days=3)))
    await async_session.commit()

    points = await _trend(authenticated_client)
    by_date = {pt["date"]: pt for pt in points}
    before = by_date[(today - timedelta(days=4)).isoformat()]
    after = by_date[(today - timedelta(days=3)).isoformat()]
    assert before["portfolioWallet"] == 0
    assert after["portfolioWallet"] > 0
    assert points[-1]["portfolioWallet"] == pytest.approx(1500)  # 10 × live price 150
    assert points[-1]["investmentTotal"] == pytest.approx(1500)


async def test_loan_balance_falls_by_principal_paid(authenticated_client, test_user, async_session, test_category):
    today = business_today()
    loan = DebtAccount(
        id=uuid4(), user_id=test_user.id, name="Loan", account_type=LoanAccountType.PERSONAL_LOAN,
        principal_amount=Decimal("100000"), current_balance=Decimal("100000"),
        interest_rate=Decimal("3"), minimum_payment=Decimal("1000"), payment_due_day=5,
        start_date=today - timedelta(days=10), is_deleted=False)
    async_session.add(loan)
    await async_session.flush()
    async_session.add(Transaction(
        id=uuid4(), user_id=test_user.id, amount=Decimal("5000"), type=TransactionType.EXPENSE,
        wallet_type=TransactionWalletType.LIFE, category_id=test_category.id,
        transaction_date=today - timedelta(days=2), description="pay", loan_id=loan.id,
        principal_portion=Decimal("4000")))
    await async_session.commit()

    points = await _trend(authenticated_client)
    assert points[0]["debtBalance"] == 0  # window opens before the loan exists
    by_date = {pt["date"]: pt for pt in points}
    assert by_date[(today - timedelta(days=10)).isoformat()]["debtBalance"] == pytest.approx(100000)
    assert by_date[(today - timedelta(days=3)).isoformat()]["debtBalance"] == pytest.approx(100000)
    assert by_date[(today - timedelta(days=2)).isoformat()]["debtBalance"] == pytest.approx(96000)
    assert points[-1]["debtBalance"] == pytest.approx(96000)
    assert points[-1]["debtByLoan"] == {str(loan.id): pytest.approx(96000)}
