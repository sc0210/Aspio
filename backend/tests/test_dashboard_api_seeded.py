"""Dashboard endpoints against a user with real income, spending, a holding and a loan."""

import json
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.loans.models import DebtAccount, LoanAccountType
from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding
from app.modules.transactions.models import (
    Transaction, TransactionCategory, TransactionType, TransactionWalletType,
)
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.database]
BASE = "/api/v1/dashboard"


@pytest_asyncio.fixture
async def world(async_session, test_user, seed_categories):
    cats = {c.name: c for c in (await async_session.execute(select(TransactionCategory))).scalars()}
    today = business_today()

    def txn(kind, amount, cat, days_ago, wallet=TransactionWalletType.LIFE, desc="x"):
        return Transaction(
            id=uuid4(), user_id=test_user.id, amount=Decimal(amount), type=kind, wallet_type=wallet,
            category_id=cats[cat].id, transaction_date=today - timedelta(days=days_ago), description=desc)

    async_session.add_all([
        txn(TransactionType.INCOME, "50000", "Salary", 3),
        txn(TransactionType.EXPENSE, "1200", "Food & Dining", 2),
        txn(TransactionType.EXPENSE, "800", "Food & Dining", 1),
        txn(TransactionType.EXPENSE, "3000", "Housing", 1),
        txn(TransactionType.INCOME, "5000", "Salary", 2, wallet=TransactionWalletType.EMERGENCY),
    ])
    pf = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(pf)
    await async_session.flush()
    async_session.add(PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=test_user.id, symbol="0050", name="ETF", type="etf",
        exchange="TWSE", currency="TWD", market="TW", wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal("10"), average_cost=Decimal("100"), current_price=Decimal("150"),
        total_cost=Decimal("1000"), total_value=Decimal("1500"), gain_loss=Decimal("500"),
        gain_loss_percentage=Decimal("50"), is_active=True,
        purchase_date=datetime.combine(today - timedelta(days=30), time.min, tzinfo=timezone.utc)))
    async_session.add(DebtAccount(
        id=uuid4(), user_id=test_user.id, name="Loan", account_type=LoanAccountType.PERSONAL_LOAN,
        principal_amount=Decimal("10000"), current_balance=Decimal("10000"), interest_rate=Decimal("2"),
        minimum_payment=Decimal("500"), payment_due_day=5, start_date=today - timedelta(days=60),
        is_deleted=False))
    await async_session.commit()


def get(client, path, **params):
    r = client.get(f"{BASE}{path}", params=params)
    assert r.status_code == 200, (path, params, r.status_code, r.text[:300])
    return r.json()["data"]


@pytest.mark.parametrize("period", ["7d", "14d", "month", "30d", "90d", "6m", "1y", "ytd"])
async def test_stats_every_period(authenticated_client, world, period):
    data = get(authenticated_client, "/stats", period=period)
    assert data


async def test_stats_report_cash_flow(authenticated_client, world):
    data = get(authenticated_client, "/stats", period="90d")
    flat = json.dumps(data)
    assert "55000" in flat or "50000" in flat  # income
    assert "5000" in flat  # expenses 1200 + 800 + 3000


@pytest.mark.parametrize("period", ["7d", "14d", "month", "30d", "90d", "6m", "1y", "ytd"])
async def test_historical_trends_every_period(authenticated_client, world, period):
    data = get(authenticated_client, "/historical-trends", period=period)
    assert data["dataPoints"]


async def test_historical_trends_income_and_expense_land_on_their_days(authenticated_client, world):
    points = {p["date"][:10]: p for p in get(authenticated_client, "/historical-trends", period="14d")["dataPoints"]}
    today = business_today()
    assert float(points[(today - timedelta(days=3)).isoformat()]["income"]) == 50000
    assert float(points[(today - timedelta(days=1)).isoformat()]["expenses"]) == 3800


async def test_spending_by_category_ranks_housing_first(authenticated_client, world):
    data = get(authenticated_client, "/spending-by-category", period="30d")
    cats = data["categories"] if isinstance(data, dict) and "categories" in data else data
    names = [c.get("category") or c.get("name") or c.get("categoryName") for c in cats]
    assert names[0] in ("Housing",) and "Food & Dining" in names


async def test_spending_by_category_force_refresh(authenticated_client, world):
    assert get(authenticated_client, "/spending-by-category", period="30d", force_refresh=True)


async def test_income_by_category(authenticated_client, world):
    data = get(authenticated_client, "/income-by-category", period="30d")
    assert "Salary" in json.dumps(data)


async def test_recent_activity_and_static_endpoints(authenticated_client, world):
    get(authenticated_client, "/recent-activity", limit=5)
    r = authenticated_client.get(f"{BASE}/health")
    assert r.status_code == 200
    assert authenticated_client.get(f"{BASE}/monthly-trend", params={"months": 3}).status_code == 200
    assert authenticated_client.get(f"{BASE}/upcoming-events", params={"days_ahead": 60}).status_code == 200
    assert authenticated_client.get(f"{BASE}/overview").status_code == 200
    assert authenticated_client.get(f"{BASE}/goals-overview").status_code == 200
    assert authenticated_client.post(f"{BASE}/refresh").status_code == 200


async def test_wallet_trends_include_all_three_wallets(authenticated_client, world):
    points = get(authenticated_client, "/wallet-trends", period="14d")["dataPoints"]
    last = points[-1]
    assert float(last["lifeWallet"]) == 50000 - 1200 - 800 - 3000
    assert float(last["emergencyWallet"]) == 5000
    assert float(last["debtBalance"]) == 10000
