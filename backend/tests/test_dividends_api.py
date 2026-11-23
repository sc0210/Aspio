"""
Dividend records: create, read back through the analytics the dashboard shows,
and delete — each scoped to its owner.

POST /portfolio/dividends is the only writer of Dividend rows, and
GET /portfolio/dividends?period= (AnalyticsService.get_dividend_data) is what
the frontend reads. Net amount defaults to total minus tax withheld.
"""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.models import Portfolio
from app.modules.users.models import User, UserRole, UserStatus
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.database
BASE = "/api/v1/portfolio/dividends"


@pytest_asyncio.fixture
async def default_portfolio(async_session, test_user):
    portfolio = Portfolio(id=uuid4(), user_id=test_user.id, name="Main", currency="TWD",
                          is_active=True, is_default=True)
    async_session.add(portfolio)
    await async_session.commit()
    return portfolio


@pytest_asyncio.fixture
async def other_user(async_session):
    user = User(id=uuid4(), email="other-div@example.com", name="Other", hashed_password="x",
                is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE)
    async_session.add(user)
    await async_session.commit()
    return user


def _dividend(**overrides):
    body = {
        "symbol": "0056", "payment_date": (business_today() - timedelta(days=10)).isoformat(),
        "amount_per_share": "1.5", "shares_owned": "1000", "total_amount": "1500",
        "tax_withheld": "30", "currency": "TWD",
    }
    body.update(overrides)
    return body


def _as(client, user):
    from app.modules.users.security import jwt_manager

    client.headers["Authorization"] = "Bearer " + jwt_manager.create_access_token(
        {"sub": str(user.id), "email": user.email})


def test_create_nets_out_tax_and_shows_in_the_analytics(authenticated_client, default_portfolio):
    client = authenticated_client
    r = client.post(BASE, json=_dividend())
    assert r.status_code == 201, r.text
    created = r.json()["data"]
    assert Decimal(str(created["net_amount"])) == Decimal("1470")

    data = client.get(BASE, params={"period": "1y"}).json()["data"]
    assert data["total_dividends"] == pytest.approx(1470)
    assert [p["symbol"] for p in data["payments"]] == ["0056"]


def test_an_explicit_net_amount_is_kept(authenticated_client, default_portfolio):
    r = authenticated_client.post(BASE, json=_dividend(net_amount="1400"))
    assert Decimal(str(r.json()["data"]["net_amount"])) == Decimal("1400")


def test_a_payment_outside_the_period_is_not_counted(authenticated_client, default_portfolio):
    client = authenticated_client
    old = (business_today() - timedelta(days=200)).isoformat()
    client.post(BASE, json=_dividend(payment_date=old))
    client.post(BASE, json=_dividend(symbol="0050", total_amount="200", tax_withheld="0"))

    three_months = client.get(BASE, params={"period": "3m"}).json()["data"]
    assert [p["symbol"] for p in three_months["payments"]] == ["0050"]
    assert three_months["total_dividends"] == pytest.approx(200)


def test_another_users_holding_cannot_be_attached(authenticated_client, default_portfolio):
    r = authenticated_client.post(BASE, json=_dividend(holding_id=str(uuid4())))
    assert r.status_code == 404


def test_delete_is_owner_only(authenticated_client, default_portfolio, other_user):
    client = authenticated_client
    dividend_id = client.post(BASE, json=_dividend()).json()["data"]["id"]
    own = client.headers["Authorization"]

    _as(client, other_user)
    try:
        assert client.delete(f"{BASE}/{dividend_id}").status_code == 404
    finally:
        client.headers["Authorization"] = own

    assert client.delete(f"{BASE}/{dividend_id}").status_code == 204
    assert client.delete(f"{BASE}/{dividend_id}").status_code == 404
    assert client.get(BASE, params={"period": "1y"}).json()["data"]["payments"] == []


def test_another_users_dividends_stay_out_of_my_analytics(authenticated_client, default_portfolio, other_user):
    client = authenticated_client
    own = client.headers["Authorization"]
    _as(client, other_user)
    try:
        client.post(BASE, json=_dividend())
    finally:
        client.headers["Authorization"] = own

    assert client.get(BASE, params={"period": "1y"}).json()["data"]["payments"] == []
