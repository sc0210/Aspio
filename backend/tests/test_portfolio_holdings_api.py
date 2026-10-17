"""/portfolio/holdings: add, read, per-symbol edits and lots, delete, realized P&L, cash wallet."""

from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.modules.transactions.models import Transaction

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

BASE = "/api/v1/portfolio"


@pytest.fixture(autouse=True)
def no_price_fetch():
    with patch("app.modules.portfolio.routers.holdings.fetch_historical_data_background", new=AsyncMock()) as m:
        yield m


def body(symbol="0050", qty="10", cost="100", **kw):
    data = {"symbol": symbol, "name": symbol, "type": "etf", "exchange": "TWSE", "market": "TW",
            "currency": "TWD", "quantity": qty, "average_cost": cost,
            "purchase_date": "2026-03-02T04:00:00+00:00"}
    data.update(kw)
    return data


def ok(r, code=200):
    assert r.status_code == code, (r.request.url, r.status_code, r.text[:300])
    return r.json() if r.content else None


def add(c, **kw):
    return ok(c.post(f"{BASE}/holdings", json=body(**kw)), 201)


async def life_legs(session, holding_id):
    rows = (await session.execute(select(Transaction).where(Transaction.holding_id == holding_id))).scalars().all()
    return rows


async def test_add_creates_a_lot_and_debits_life(authenticated_client, async_session, no_price_fetch):
    h = add(authenticated_client)
    total_cost = h.get("total_cost", h.get("totalCost"))
    assert (h["symbol"], Decimal(str(h["quantity"])), Decimal(str(total_cost))) == ("0050", 10, 1000)
    legs = await life_legs(async_session, UUID(h["id"]))
    assert len(legs) == 1 and legs[0].amount == Decimal("1000") and legs[0].type.value == "expense"
    no_price_fetch.assert_called_once()
    assert no_price_fetch.call_args.kwargs["market"] == "TW"


async def test_cash_like_symbols_skip_the_price_fetch(authenticated_client, no_price_fetch):
    add(authenticated_client, symbol="CASH", type="cash")
    no_price_fetch.assert_not_called()


async def test_get_one_holding_and_scoping(authenticated_client, client):
    h = add(authenticated_client)
    got = ok(authenticated_client.get(f"{BASE}/holdings/{h['id']}"))
    assert got["id"] == h["id"] and got["symbol"] == "0050"
    assert authenticated_client.get(f"{BASE}/holdings/{uuid4()}").status_code == 404


async def test_rename_every_lot_of_a_symbol(authenticated_client):
    c = authenticated_client
    add(c)
    add(c, purchase_date="2026-04-01T04:00:00+00:00")
    add(c, symbol="2330")
    out = ok(c.patch(f"{BASE}/holdings/symbol/0050", json={"name": "Yuanta 50", "sector": "Index"}))
    assert out["data"]["updated_count"] == 2

    lots = ok(c.get(f"{BASE}/holdings/symbol/0050/lots"))["data"]
    assert len(lots) == 2 and {(l["name"], l["sector"]) for l in lots} == {("Yuanta 50", "Index")}
    assert {l["purchaseDate"][:10] for l in lots} == {"2026-03-02", "2026-04-01"}
    assert ok(c.get(f"{BASE}/holdings/symbol/2330/lots"))["data"][0]["name"] == "2330"

    assert ok(c.patch(f"{BASE}/holdings/symbol/0050", json={"name": ""}))["data"]["updated_count"] == 0
    assert c.patch(f"{BASE}/holdings/symbol/NOPE", json={"name": "x"}).status_code == 404


async def test_symbol_transactions_list_the_buys(authenticated_client):
    c = authenticated_client
    add(c)
    add(c, qty="5", cost="110", purchase_date="2026-04-01T04:00:00+00:00")
    r = ok(c.get(f"{BASE}/holdings/symbol/0050/transactions"))
    assert sorted(t["quantity"] for t in r["data"]) == [5.0, 10.0]
    assert {t["type"] for t in r["data"]} == {"buy"} and r["meta"]["total"] == 2
    assert ok(c.get(f"{BASE}/holdings/symbol/0050/transactions", params={"transaction_type": "sell"}))["data"] == []


async def test_delete_withdraws_the_purchase_from_life(authenticated_client, async_session):
    c = authenticated_client
    h = add(c)
    assert c.delete(f"{BASE}/holdings/{h['id']}").status_code == 204
    assert c.get(f"{BASE}/holdings/{h['id']}").status_code == 404
    legs = await life_legs(async_session, UUID(h["id"]))
    for leg in legs:
        await async_session.refresh(leg)
    assert legs and all(leg.is_deleted for leg in legs)
    assert c.delete(f"{BASE}/holdings/{uuid4()}").status_code == 404


async def test_realized_pnl_after_a_sell(authenticated_client):
    c = authenticated_client
    assert ok(c.get(f"{BASE}/realized-pnl"))["data"] == {"realized_gain_loss": 0.0, "realized_count": 0}
    h = add(c)
    ok(c.post(f"{BASE}/holdings/{h['id']}/sell", json={"quantity": "4", "price": "130"}))
    d = ok(c.get(f"{BASE}/realized-pnl"))["data"]
    assert d["realized_count"] == 1 and d["realized_gain_loss"] == pytest.approx(120)


async def test_cash_wallet_lists_active_cash_lots(authenticated_client):
    c = authenticated_client
    assert ok(c.get(f"{BASE}/cash-wallet"))["data"] == {"wallets": []}
    add(c, symbol="CASH", type="cash", qty="500", cost="1")
    add(c)
    wallets = ok(c.get(f"{BASE}/cash-wallet"))["data"]["wallets"]
    assert [(w["symbol"], w["balance"], w["currency"]) for w in wallets] == [("CASH", 500.0, "TWD")]


@pytest.mark.parametrize("method,path", [
    ("patch", "/holdings/symbol/0050"), ("post", "/portfolio/calculate-irr"), ("get", "/cash-wallet"),
])
async def test_routes_that_need_a_user(client, method, path):
    kwargs = {"json": {"name": "x"}} if method == "patch" else {}
    assert getattr(client, method)(f"{BASE}{path}", **kwargs).status_code == 401


async def test_demo_callers_get_placeholders(client):
    assert ok(client.get(f"{BASE}/holdings/symbol/0050/lots"))["data"] == []
    assert ok(client.get(f"{BASE}/holdings/symbol/0050/transactions"))["data"] == []
    assert ok(client.get(f"{BASE}/realized-pnl"))["data"]["realized_count"] == 0
    assert ok(client.get(f"{BASE}/holdings/{uuid4()}"))["symbol"] == "DEMO"
    assert client.delete(f"{BASE}/holdings/{uuid4()}").status_code == 204


async def test_irr_needs_a_portfolio(authenticated_client):
    assert authenticated_client.post(f"{BASE}/portfolio/calculate-irr").status_code == 404


async def test_irr_runs_over_the_default_portfolio(authenticated_client):
    add(authenticated_client)
    r = ok(authenticated_client.post(f"{BASE}/portfolio/calculate-irr"))
    assert r["message"] == "IRR calculation completed" and r["summary"]
