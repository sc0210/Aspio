"""Every route whose service lost its (no-op) cache calls still works end to end.

The cache services were stubs that did nothing, so removing them must change no
behaviour. These drive the real app — routing, dependency injection, services,
repositories — on the test database, one request per edited code path.
"""

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.asyncio


def _ok(response):
    assert response.status_code < 400, f"{response.request.url} → {response.status_code}: {response.text[:300]}"
    return response.json() if response.content else None


async def test_transaction_create_edit_delete(authenticated_client, test_category):
    c = authenticated_client
    created = _ok(c.post("/api/v1/transactions/", json={
        "type": "expense", "amount": "120.00", "currency": "TWD", "description": "Lunch",
        "transaction_date": business_today().isoformat(), "category_id": str(test_category.id),
        "wallet_type": "life",
    }))
    txn_id = (created.get("data") or created).get("id") or created["transaction"]["id"]

    _ok(c.put(f"/api/v1/transactions/{txn_id}", json={"amount": "150.00"}))
    # analytics/summary and auto-categorize are left out: they use Postgres-only
    # SQL (date_trunc, pg_trgm's similarity) that the SQLite test database lacks.
    _ok(c.delete(f"/api/v1/transactions/{txn_id}"))


async def test_dashboard_reads(authenticated_client):
    c = authenticated_client
    for path in ("/stats", "/recent-activity", "/spending-by-category", "/monthly-trend", "/overview"):
        _ok(c.get(f"/api/v1/dashboard{path}"))


async def test_loan_lifecycle(authenticated_client):
    c = authenticated_client
    loan = _ok(c.post("/api/v1/loans/", json={
        "name": "Car loan", "account_type": "auto_loan", "principal_amount": "100000",
        "interest_rate": "2.5", "minimum_payment": "3000", "payment_due_day": 15,
        "start_date": business_today().isoformat(),
    }))["data"]
    loan_id = loan["id"]

    _ok(c.post(f"/api/v1/loans/{loan_id}/payment", json={
        "total_amount": "3000", "principal_portion": "2800", "interest_portion": "200",
        "payment_date": business_today().isoformat(),
    }))
    payments = _ok(c.get(f"/api/v1/loans/{loan_id}/payments"))["data"]
    payment_id = payments[0]["transaction_id"] if "transaction_id" in payments[0] else payments[0]["id"]
    _ok(c.put(f"/api/v1/loans/{loan_id}/payments/{payment_id}", json={"notes": "edited"}))
    assert Decimal(str(_ok(c.get(f"/api/v1/loans/{loan_id}"))["data"]["current_balance"])) == Decimal("97200")

    _ok(c.delete(f"/api/v1/loans/{loan_id}/payments/{payment_id}"))
    assert Decimal(str(_ok(c.get(f"/api/v1/loans/{loan_id}"))["data"]["current_balance"])) == Decimal("100000")
    _ok(c.put(f"/api/v1/loans/{loan_id}", json={"notes": "renamed"}))
    _ok(c.delete(f"/api/v1/loans/{loan_id}"))


async def test_portfolio_read_sell_remove(authenticated_client, test_user, async_session):
    c = authenticated_client
    portfolio = Portfolio(
        id=uuid4(), user_id=test_user.id, name="Main", currency="TWD",
        is_active=True, is_default=True,
    )
    lots = [
        PortfolioHolding(
            id=uuid4(), portfolio_id=portfolio.id, user_id=test_user.id, symbol=symbol,
            name=symbol, type="stock", exchange="TWSE", currency="TWD", market="TW",
            wallet_type=HoldingWalletType.PORTFOLIO, quantity=Decimal("10"),
            average_cost=Decimal("100"), current_price=Decimal("120"),
            total_cost=Decimal("1000"), total_value=Decimal("1200"),
            gain_loss=Decimal("200"), gain_loss_percentage=Decimal("20"),
            is_active=True, purchase_date=datetime(2025, 1, 1),
        )
        for symbol in ("0050", "2330")
    ]
    async_session.add_all([portfolio, *lots])
    await async_session.commit()

    _ok(c.get("/api/v1/portfolio/"))
    sold = _ok(c.post(f"/api/v1/portfolio/holdings/{lots[0].id}/sell", json={
        "quantity": "4", "price": "130",
    }))
    assert "realized" in str(sold).lower()
    removed = c.delete(f"/api/v1/portfolio/holdings/{lots[1].id}")
    assert removed.status_code == 204, removed.text[:300]
