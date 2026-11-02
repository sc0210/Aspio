"""Concurrent writes to one portfolio position, on real Postgres.

SQLite ignores row and advisory locks, so the rest of the suite cannot see any of
this. Promise: every writer of a (user, symbol) position — add (aggregate), sell,
edit, delete — takes `lock_position` first, so they apply in turn and each reads
what the previous one committed; and the price write computes from the committed
row, so a sale that lands while a refresh waits on a quote is not overwritten.

    ASPIRO_PG_LOCK_TEST_URL=postgresql+asyncpg://user:pass@host:5432/postgres \\
        python -m pytest tests/test_portfolio_position_lock_postgres.py -m integration -o "addopts="
"""

import asyncio
import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("ASPIRO_PG_LOCK_TEST_URL", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio,
    pytest.mark.skipif(not URL.startswith("postgresql"), reason="needs ASPIRO_PG_LOCK_TEST_URL"),
]

# How long the first writer holds the position, giving the second a chance to
# slip past a lock it should be waiting on.
WINDOW = 0.5
BOUGHT = datetime(2026, 9, 1, 2, 0, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def world():
    import asyncpg

    import app.main  # noqa: F401  registers every model
    from app.core.database import Base
    from app.modules.portfolio.models import Portfolio, PortfolioHolding
    from app.modules.users.models import User, UserRole, UserStatus

    name = f"aspiro_pos_{uuid4().hex[:8]}"
    server = make_url(URL)
    admin = server.set(drivername="postgresql").render_as_string(hide_password=False)

    async def admin_exec(sql):
        conn = await asyncpg.connect(admin)
        try:
            await conn.execute(sql)
        finally:
            await conn.close()

    await admin_exec(f"CREATE DATABASE {name}")
    engine = create_async_engine(server.set(database=name), connect_args={"statement_cache_size": 0})
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as s:
            user = User(id=uuid4(), email="pos@example.com", name="Pos", hashed_password="x",
                        is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
                        preferred_currency="TWD", timezone="Asia/Taipei", experience_points=0, level=1)
            s.add(user)
            await s.flush()
            portfolio = Portfolio(id=uuid4(), user_id=user.id, name="P", is_default=True, currency="TWD")
            s.add(portfolio)
            await s.flush()
            lot = PortfolioHolding(
                id=uuid4(), portfolio_id=portfolio.id, user_id=user.id, symbol="0050", name="0050",
                quantity=Decimal("10"), average_cost=Decimal("100"), current_price=Decimal("100"),
                currency="TWD", market="TW", type="etf", exchange="TWSE", wallet_type="portfolio",
                total_cost=Decimal("1000"), total_value=Decimal("1000"), purchase_date=BOUGHT,
                is_active=True,
            )
            s.add(lot)
            await s.commit()
        yield maker, user.id, portfolio.id, lot.id
    finally:
        await engine.dispose()
        await admin_exec(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


async def _quantity(maker, lot_id):
    from app.modules.portfolio.models import PortfolioHolding

    async with maker() as s:
        return (await s.execute(
            select(PortfolioHolding.quantity, PortfolioHolding.is_active).where(PortfolioHolding.id == lot_id)
        )).one()


async def _sell_holding_position(maker, uid, lot_id, to_quantity, *, close=False):
    """What the sell route does to the lot: position lock, then its lots FOR UPDATE
    (fresh), then the draw-down after WINDOW — the slow part of a real sale."""
    from app.modules.portfolio.repositories import HoldingRepository

    async with maker() as s:
        repo = HoldingRepository(s)
        holding = await repo.get_by_id_locked(lot_id, uid)
        (lot,) = await repo.get_sellable_lots(holding.portfolio_id, holding.symbol, uid)
        await asyncio.sleep(WINDOW)
        lot.quantity = Decimal(to_quantity)
        lot.total_cost = lot.quantity * lot.average_cost
        lot.total_value = lot.quantity * lot.current_price
        if close:
            lot.is_active = False
        await s.commit()


async def test_an_aggregate_buy_during_a_sale_keeps_both(world):
    """The buy used to write back `10 + 5` read before the sale: sold shares
    reappeared while their proceeds were already in the Life Wallet."""
    from app.modules.portfolio.repositories import HoldingRepository

    maker, uid, pid, lot_id = world

    async def buy_five():
        await asyncio.sleep(WINDOW / 5)  # start once the sale holds the position
        async with maker() as s:
            await HoldingRepository(s).create_or_aggregate_holding(
                portfolio_id=pid, user_id=uid, aggregate=True,
                holding_data={"symbol": "0050", "quantity": Decimal("5"), "average_cost": Decimal("100"),
                              "purchase_date": BOUGHT, "currency": "TWD", "wallet_type": "portfolio",
                              "portfolio_id": pid, "user_id": uid, "name": "0050", "type": "etf",
                              "market": "TW", "exchange": "TWSE", "current_price": Decimal("100"),
                              "total_cost": Decimal("500"), "total_value": Decimal("500"),
                              "is_active": True},
            )
            await s.commit()

    await asyncio.gather(_sell_holding_position(maker, uid, lot_id, "4"), buy_five())
    quantity, _ = await _quantity(maker, lot_id)
    assert quantity == Decimal("9")  # 10 − 6 sold + 5 bought


async def test_a_delete_racing_a_full_sale_finds_nothing_to_delete(world):
    """The delete used to proceed on the lot it read before the sale, refunding
    the purchase on top of the proceeds the sale had just credited."""
    from app.modules.portfolio.repositories import HoldingRepository

    maker, uid, _, lot_id = world
    seen = {}

    async def delete():
        await asyncio.sleep(WINDOW / 5)
        async with maker() as s:
            seen["lot"] = await HoldingRepository(s).get_by_id_locked(lot_id, uid)

    await asyncio.gather(_sell_holding_position(maker, uid, lot_id, "0", close=True), delete())
    assert seen["lot"] is None  # the route answers 404


async def test_a_price_write_after_a_sale_uses_the_sold_quantity(world):
    """apply_quote computes value and cost from the row as committed."""
    from app.modules.portfolio.models import PortfolioHolding
    from app.modules.portfolio.price_update_service import PriceUpdateService

    maker, uid, _, lot_id = world

    async def refresh():
        await asyncio.sleep(WINDOW / 5)
        async with maker() as s:
            await PriceUpdateService(s).apply_quote(
                "0050", Decimal("120"), None, datetime.now(timezone.utc), user_id=str(uid)
            )
            await s.commit()

    await asyncio.gather(_sell_holding_position(maker, uid, lot_id, "4"), refresh())
    async with maker() as s:
        lot = (await s.execute(select(PortfolioHolding).where(PortfolioHolding.id == lot_id))).scalar_one()
    assert (lot.quantity, lot.total_value, lot.total_cost) == (Decimal("4"), Decimal("480"), Decimal("400"))
