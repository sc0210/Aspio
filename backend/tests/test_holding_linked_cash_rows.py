"""A holding's Life Wallet leg changes and goes only with its holding.

Through the real endpoints: the transaction API refuses deleting the leg alone or
changing its money, GET reports whether it is the lot's only purchase leg (the rule
the holding update uses to decide whether it rewrites the leg), and the symbol guess
on PUT leaves linked rows alone.
"""

from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from sqlalchemy import select

from app.modules.portfolio.models import PortfolioHolding
from app.modules.transactions.models import Transaction, TransactionStatus
from app.modules.transactions.repositories import TransactionRepository

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

PORTFOLIO = "/api/v1/portfolio"
TXNS = "/api/v1/transactions"


@pytest.fixture(autouse=True)
def no_price_fetch():
    with patch("app.modules.portfolio.routers.holdings.fetch_historical_data_background", new=AsyncMock()):
        yield


def buy(c, qty="10", cost="100", aggregate=False):
    body = {"symbol": "0050", "name": "0050", "type": "etf", "exchange": "TWSE", "market": "TW",
            "currency": "TWD", "quantity": qty, "average_cost": cost,
            "purchase_date": "2026-03-02T04:00:00+00:00"}
    r = c.post(f"{PORTFOLIO}/holdings?aggregate={'true' if aggregate else 'false'}", json=body)
    assert r.status_code == 201, r.text[:300]
    return r.json()


async def legs_of(session, holding_id):
    rows = (await session.execute(
        select(Transaction).where(Transaction.holding_id == UUID(str(holding_id))).order_by(Transaction.created_at)
    )).scalars().all()
    # The app shares this session in tests: rows loaded here without their category
    # would be the ones the endpoint serializes, and lazy-load outside the loop.
    for row in rows:
        session.expunge(row)
    return rows


async def test_a_lone_buy_is_its_lots_sole_purchase_leg(authenticated_client, async_session):
    h = buy(authenticated_client)
    (leg,) = await legs_of(async_session, h["id"])
    got = authenticated_client.get(f"{TXNS}/{leg.id}").json()
    assert got["holding_id"] == h["id"]
    assert got["holding_sole_purchase"] is True


async def test_a_buy_folded_into_a_lot_with_another_is_not(authenticated_client, async_session):
    first = buy(authenticated_client)
    second = buy(authenticated_client, qty="5", aggregate=True)
    assert second["id"] == first["id"], "the second buy should merge into the same lot"
    legs = await legs_of(async_session, first["id"])
    assert len(legs) == 2
    for leg in legs:
        assert authenticated_client.get(f"{TXNS}/{leg.id}").json()["holding_sole_purchase"] is False


async def test_the_partition_ignores_cancelled_legs(authenticated_client, async_session):
    first = buy(authenticated_client)
    buy(authenticated_client, qty="5", aggregate=True)
    keep, cancel = await legs_of(async_session, first["id"])
    cancel = await async_session.merge(cancel)
    cancel.status = TransactionStatus.CANCELLED
    await async_session.commit()

    _, legs, offsetting = await TransactionRepository(async_session).holding_purchase_legs(
        first["id"], str(keep.user_id)
    )
    assert [str(row.id) for row in legs] == [str(keep.id)] and offsetting == []
    assert authenticated_client.get(f"{TXNS}/{keep.id}").json()["holding_sole_purchase"] is True


async def test_the_leg_cannot_be_deleted_alone(authenticated_client, async_session):
    h = buy(authenticated_client)
    (leg,) = await legs_of(async_session, h["id"])
    r = authenticated_client.delete(f"{TXNS}/{leg.id}")
    assert r.status_code == 400, r.text[:300]
    still = await async_session.get(Transaction, leg.id)
    await async_session.refresh(still)
    assert still.is_deleted is False


async def test_its_money_cannot_change_alone_but_its_own_fields_can(authenticated_client, async_session):
    h = buy(authenticated_client)
    (leg,) = await legs_of(async_session, h["id"])

    # A refusal with its own status, not the update handler's catch-all 500.
    assert authenticated_client.put(f"{TXNS}/{leg.id}", json={"amount": 999}).status_code == 400
    assert authenticated_client.put(f"{TXNS}/{leg.id}", json={"transaction_date": "2026-01-01"}).status_code == 400

    # Its own fields save, and resending the money as it stands is not a change.
    r = authenticated_client.put(f"{TXNS}/{leg.id}", json={
        "tags": ["etf"], "description": "Monthly 0050",
        "amount": str(leg.amount), "currency": leg.currency.lower(),
        "transaction_date": leg.transaction_date.isoformat(),
    })
    assert r.status_code == 200, r.text[:300]


async def test_a_save_on_a_merged_lots_leg_leaves_the_lot_alone(authenticated_client, async_session):
    # The symbol-and-date guess on PUT used to write this one buy's quantity
    # (from its description) onto the whole merged lot.
    first = buy(authenticated_client)
    buy(authenticated_client, qty="5", aggregate=True)
    leg = (await legs_of(async_session, first["id"]))[0]

    assert authenticated_client.put(f"{TXNS}/{leg.id}", json={"tags": ["x"]}).status_code == 200
    lot = await async_session.get(PortfolioHolding, leg.holding_id)
    await async_session.refresh(lot)
    assert float(lot.quantity) == 15
