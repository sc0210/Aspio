"""The peer comparison shows the dashboard's own figures, in TWD.

It once converted holdings to USD and added the Life wallet's raw transaction
sum, a net worth in no currency at all. Then it was TWD but still total assets
under the Net Worth label, beside a chart interpolated from holdings alone, so
neither matched the dashboard for anyone with cash or a loan.
"""

import uuid as uuid_module
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.peers.schemas import WalletTotals
from app.modules.peers.service import PeerService
from app.modules.transactions.models import TransactionWalletType
from app.utils.datetime_helpers import business_today

RATES = {"USD": Decimal("31.5")}
CASH = "app.modules.transactions.repositories.TransactionRepository.cash_balances_twd"


def _service():
    svc = PeerService(MagicMock())
    svc._wallets = MagicMock()
    return svc


@pytest.mark.asyncio
async def test_wallet_totals_are_twd_and_net_worth_is_net_of_debt():
    svc = _service()
    svc._wallets.get_wallet_holdings_by_type = AsyncMock(return_value=[
        {"wallet_type": "portfolio", "type": "stock", "currency": "USD", "total_value": 1_000.0},
        {"wallet_type": "portfolio", "type": "etf", "currency": "TWD", "total_value": 50_000.0},
        {"wallet_type": "portfolio", "type": "cash", "currency": "twd", "total_value": 2_000.0},
        {"wallet_type": "emergency", "type": "etf", "currency": "USD", "total_value": 10.0},
    ])
    svc._wallets.get_total_debt = AsyncMock(return_value=40_000.0)
    cash = {TransactionWalletType.LIFE: Decimal("18500"), TransactionWalletType.EMERGENCY: Decimal("290")}

    with patch("app.utils.fx_sql.twd_rates_for", AsyncMock(return_value=RATES)), \
         patch(CASH, AsyncMock(return_value=cash)):
        totals = await svc._compute_wallet_totals(uuid_module.uuid4())

    assert totals.portfolio_total == pytest.approx(31_500 + 50_000)
    assert totals.cash_total == pytest.approx(2_000)
    # The emergency holding (US$10) plus the emergency cash from transactions.
    assert totals.emergency_total == pytest.approx(315 + 290)
    assert totals.life_total == pytest.approx(18_500)
    assert totals.debt_total == pytest.approx(40_000)
    # What the dashboard calls net worth: total assets less debt.
    assert totals.net_worth == pytest.approx(81_500 + 2_000 + 315 + 290 + 18_500 - 40_000)


@pytest.mark.asyncio
async def test_a_peer_with_no_cash_rows_and_no_loans_is_zero_not_an_error():
    svc = _service()
    svc._wallets.get_wallet_holdings_by_type = AsyncMock(return_value=[])
    svc._wallets.get_total_debt = AsyncMock(return_value=0.0)

    with patch(CASH, AsyncMock(return_value={})):
        totals = await svc._compute_wallet_totals(uuid_module.uuid4())

    assert (totals.life_total, totals.emergency_total, totals.debt_total, totals.net_worth) == (0, 0, 0, 0)


def _trends(*points):
    return SimpleNamespace(data_points=[
        SimpleNamespace(date=day, total_asset=Decimal(str(assets)), debt_balance=Decimal(str(debt)))
        for day, assets, debt in points
    ])


@pytest.mark.asyncio
async def test_the_chart_is_total_assets_less_debt_off_the_wallet_trends():
    me, peer = uuid_module.uuid4(), uuid_module.uuid4()
    today = business_today().isoformat()
    week_ago = (business_today() - timedelta(weeks=1)).isoformat()

    svc = _service()
    svc._connections = MagicMock(get_accepted_peer_ids=AsyncMock(return_value=[peer]))
    svc._users = MagicMock(get_full_profiles=AsyncMock(return_value={}))
    svc._compute_wallet_totals = AsyncMock(return_value=WalletTotals())

    by_user = {
        str(me): _trends((week_ago, 900_000, 310_000), (today, 1_000_000, 300_000)),
        str(peer): _trends((today, 500_000, 0)),
    }
    periods = []

    async def wallet_trends(self_, user_id, period, *args, **kwargs):
        periods.append(period.value)
        return by_user[user_id]

    with patch("app.modules.dashboard.services.DashboardService.get_wallet_trends", wallet_trends):
        result = await svc.get_compare_data(me)

    assert periods == ["90d", "90d"]
    assert len(result.chart) == 13
    last, previous = result.chart[-1].model_dump(), result.chart[-2].model_dump()
    assert last["date"] == today and previous["date"] == week_ago
    assert last[str(me)] == pytest.approx(700_000)
    assert previous[str(me)] == pytest.approx(590_000)
    assert last[str(peer)] == pytest.approx(500_000)
    # A day the trends do not cover is a gap in that line, not a fall to zero.
    assert str(peer) not in previous


def _compare_service(me, peer):
    svc = _service()
    svc.session = MagicMock(rollback=AsyncMock())
    svc._connections = MagicMock(get_accepted_peer_ids=AsyncMock(return_value=[peer]))
    svc._users = MagicMock(get_full_profiles=AsyncMock(return_value={}))
    return svc


@pytest.mark.asyncio
async def test_a_peer_whose_figures_fail_is_left_out_not_the_whole_page():
    me, peer = uuid_module.uuid4(), uuid_module.uuid4()
    today = business_today().isoformat()
    svc = _compare_service(me, peer)

    async def totals(uid):
        if uid == peer:
            raise RuntimeError("peer's holdings query failed")
        return WalletTotals()

    svc._compute_wallet_totals = totals

    async def wallet_trends(self_, user_id, period, *args, **kwargs):
        return _trends((today, 1_000, 0))

    with patch("app.modules.dashboard.services.DashboardService.get_wallet_trends", wallet_trends):
        result = await svc.get_compare_data(me)

    assert [card.user_id for card in result.users] == [me]
    assert str(peer) not in result.chart[-1].model_dump()
    assert result.chart[-1].model_dump()[str(me)] == pytest.approx(1_000)
    # The failed query's transaction is rolled back before the next participant.
    svc.session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_your_own_figures_failing_is_still_an_error():
    me, peer = uuid_module.uuid4(), uuid_module.uuid4()
    svc = _compare_service(me, peer)
    svc._compute_wallet_totals = AsyncMock(side_effect=RuntimeError("your holdings query failed"))

    with pytest.raises(RuntimeError):
        await svc.get_compare_data(me)
