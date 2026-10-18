"""HoldingRepository.create_or_aggregate_holding: new lots, same-day aggregation, CSV mode."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.models import HoldingWalletType, Portfolio
from app.modules.portfolio.repositories import HoldingRepository

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

DAY1 = datetime(2026, 3, 2, tzinfo=timezone.utc)
DAY2 = datetime(2026, 3, 9, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def pf(async_session, test_user):
    p = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(p)
    await async_session.flush()
    return p


@pytest.fixture
def repo(async_session):
    return HoldingRepository(async_session)


def lot(qty, cost, purchase_date=DAY1, symbol="0050", **kw):
    data = dict(symbol=symbol, name=symbol, type="etf", exchange="TWSE", currency="TWD", market="TW",
                wallet_type=HoldingWalletType.PORTFOLIO, quantity=Decimal(qty),
                average_cost=Decimal(cost), purchase_date=purchase_date)
    data.update(kw)
    return data


async def lots(repo, pf, user, symbol="0050"):
    return await repo.get_all_lots_by_symbol(pf.id, symbol, user.id)


async def test_new_lot_derives_cost_value_and_gain(repo, pf, test_user):
    h = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100", current_price=Decimal("120")))
    assert h.total_cost == Decimal("1000") and h.total_value == Decimal("1200")
    assert h.gain_loss == Decimal("200") and h.gain_loss_percentage == Decimal("20")
    assert h.portfolio_id == pf.id and h.user_id == test_user.id


async def test_zero_cost_lot_has_zero_gain_percentage(repo, pf, test_user):
    h = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("5", "0", current_price=Decimal("10")))
    assert h.total_cost == 0 and h.gain_loss == Decimal("50") and h.gain_loss_percentage == 0


async def test_missing_purchase_date_defaults_to_now(repo, pf, test_user):
    before = datetime.now(timezone.utc).replace(tzinfo=None)
    h = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("1", "1", purchase_date=None))
    assert h.purchase_date.replace(tzinfo=None) >= before.replace(microsecond=0)


async def test_same_day_buys_aggregate_at_weighted_average_cost(repo, pf, test_user):
    first = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("100", "50"))
    second = await repo.create_or_aggregate_holding(
        pf.id, test_user.id, lot("50", "60", current_price=Decimal("70")))
    assert second.id == first.id
    assert second.quantity == Decimal("150") and second.total_cost == Decimal("8000")
    assert second.average_cost.quantize(Decimal("0.01")) == Decimal("53.33")
    assert second.total_value == Decimal("10500") and second.gain_loss == Decimal("2500")
    assert second.gain_loss_percentage.quantize(Decimal("0.01")) == Decimal("31.25")
    assert len(await lots(repo, pf, test_user)) == 1


async def test_aggregation_keeps_the_old_price_when_none_given(repo, pf, test_user):
    await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "10", current_price=Decimal("12")))
    h = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "14"))
    assert h.current_price == Decimal("12") and h.total_value == Decimal("240")
    assert h.total_cost == Decimal("240") and h.gain_loss == 0


async def test_different_purchase_day_opens_a_new_lot(repo, pf, test_user):
    a = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100", purchase_date=DAY1))
    b = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("5", "200", purchase_date=DAY2))
    assert a.id != b.id
    assert a.quantity == Decimal("10") and a.average_cost == Decimal("100")
    assert sorted(h.quantity for h in await lots(repo, pf, test_user)) == [Decimal("5"), Decimal("10")]


async def test_csv_mode_never_aggregates(repo, pf, test_user):
    a = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100"), aggregate=False)
    b = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100"), aggregate=False)
    assert a.id != b.id and len(await lots(repo, pf, test_user)) == 2


async def test_undated_buy_aggregates_into_the_most_recent_lot(repo, pf, test_user):
    await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100", purchase_date=DAY1))
    newest = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "200", purchase_date=DAY2))
    h = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "300", purchase_date=None))
    assert h.id == newest.id and h.quantity == Decimal("20") and h.average_cost == Decimal("250")


async def test_lots_of_other_symbols_and_users_are_not_touched(repo, pf, test_user, async_session):
    await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100", symbol="2330"))
    h = await repo.create_or_aggregate_holding(pf.id, test_user.id, lot("10", "100"))
    assert h.quantity == Decimal("10")
    assert await repo.get_all_lots_by_symbol(pf.id, "0050", uuid4()) == []


@pytest.mark.parametrize("data", [{}, {"symbol": ""}, {"symbol": None}])
async def test_symbol_is_required(repo, pf, test_user, data):
    with pytest.raises(ValueError, match="Symbol is required"):
        await repo.create_or_aggregate_holding(pf.id, test_user.id, data)
