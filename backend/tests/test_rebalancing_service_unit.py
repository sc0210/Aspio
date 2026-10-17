"""RebalancingService maths, with the repositories stubbed (no DB)."""

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.core.exceptions import NotFoundException
from app.modules.portfolio.rebalancing_schemas import ActionType, AlertType
from app.modules.portfolio.rebalancing_service import (
    RebalancingService,
    get_rebalancing_service,
    safe_decimal,
    safe_decimal_division,
)
from app.modules.portfolio.repositories import HoldingRepository, PortfolioRepository

pytestmark = pytest.mark.unit

D = Decimal
USER = uuid4()


def holding(symbol, value, type_="stock", active=True, metadata=None):
    return SimpleNamespace(
        symbol=symbol, type=type_, total_value=value, is_active=active,
        item_metadata=metadata if metadata is not None else {},
    )


def portfolio(meta=None, last_rebalance=None):
    return SimpleNamespace(
        id=uuid4(), metadata=meta, last_rebalance_at=last_rebalance,
        total_value=D("1000"), total_gain_loss_percentage=D("4.5"),
    )


def make_service(holdings, pf=None):
    svc = RebalancingService(MagicMock())
    svc.portfolio_repo = AsyncMock(spec=PortfolioRepository)
    svc.holding_repo = AsyncMock(spec=HoldingRepository)
    pf = pf if pf is not None else portfolio()
    svc.portfolio_repo.get_default_portfolio.return_value = pf
    svc.portfolio_repo.get_by_id.return_value = pf
    svc.holding_repo.get_portfolio_holdings.return_value = (holdings, len(holdings))
    return svc


class TestSafeDecimal:
    @pytest.mark.parametrize("value", [None, float("nan"), float("inf"), "abc", D("NaN")])
    def test_bad_input_returns_default(self, value):
        assert safe_decimal(value, D("7")) == D("7")

    def test_good_input(self):
        assert safe_decimal("1.5") == D("1.5")
        assert safe_decimal(D("2")) == D("2")

    def test_division(self):
        assert safe_decimal_division(D("10"), D("4")) == D("2.5")
        assert safe_decimal_division(D("10"), D("0"), D("-1")) == D("-1")
        assert safe_decimal_division(None, D("2")) == D("0")


class TestCategorise:
    svc = RebalancingService(MagicMock())

    @pytest.mark.parametrize("symbol,type_,meta,bucket", [
        ("0050", "etf", {}, "0050"),
        ("vt", "etf", {}, "VT"),
        ("BTC-USD", "crypto", {}, "CRYPTO"),
        ("ETH", "Cryptocurrency", {}, "CRYPTO"),
        ("TWD-CASH", "cash", {}, "CASH"),
        ("EMERGENCY-CASH", "cash", {}, "SAVINGS"),
        ("2330", "stock", {"locked": True}, "STOCK_LOCKED"),
        ("LOCKED-1", "stock", {}, "STOCK_LOCKED"),
        ("2330", "stock", {}, "0050"),
    ])
    def test_bucket(self, symbol, type_, meta, bucket):
        assert self.svc._categorize_holding(holding(symbol, 1, type_, metadata=meta)) == bucket

    def test_fee_rates(self):
        s = self.svc
        assert s._get_fee_rate("etf") == s.TW_STOCK_FEE_RATE
        assert s._get_fee_rate("stock") == s.TW_STOCK_FEE_RATE
        assert s._get_fee_rate("crypto") == s.CRYPTO_FEE_RATE
        assert s._get_fee_rate("cash") == D("0")


class TestTargets:
    svc = RebalancingService(MagicMock())

    def test_defaults_when_no_metadata(self):
        assert self.svc._get_target_allocations(portfolio()) is self.svc.DEFAULT_TARGETS
        assert sum(t["target_percentage"] for t in self.svc.DEFAULT_TARGETS) == D("100.0")

    def test_saved_new_and_old_formats(self):
        pf = portfolio({"target_allocations": {
            "VT": {"targetPct": 0.3, "assetName": "World", "assetType": "etf"},
            "CASH": 0.1,
            "MYSTERY": 0.05,
        }})
        by_symbol = {t["asset_symbol"]: t for t in self.svc._get_target_allocations(pf)}
        assert by_symbol["VT"]["target_percentage"] == D("30.0")
        assert by_symbol["VT"]["asset_name"] == "World"
        assert by_symbol["CASH"]["asset_name"] == "現金與活存"
        assert by_symbol["CASH"]["target_percentage"] == D("10.0")
        assert by_symbol["MYSTERY"]["asset_type"] == "unknown"


@pytest.mark.asyncio
class TestAllocation:
    async def test_no_portfolio_raises(self):
        svc = make_service([])
        svc.portfolio_repo.get_default_portfolio.return_value = None
        with pytest.raises(NotFoundException):
            await svc.get_current_allocation(USER)

    async def test_empty_portfolio_is_in_balance_at_zero(self):
        summary = await make_service([]).get_current_allocation(USER)
        assert summary.total_portfolio_value == D("0.00")
        # 0% current vs 45% target is a 45-point deviation: not "in balance".
        assert summary.requires_rebalancing

    async def test_balanced_portfolio_holds_everything(self):
        holdings = [
            holding("0050", D("450"), "etf"), holding("VT", D("200"), "etf"),
            holding("BTC", D("100"), "crypto"), holding("CASH", D("100"), "cash"),
            holding("SAVINGS-CASH", D("100"), "cash"), holding("LOCKED", D("50")),
        ]
        summary = await make_service(holdings).get_current_allocation(USER)
        assert summary.in_balance and not summary.requires_rebalancing
        assert all(a.action == ActionType.HOLD for a in summary.allocations)
        assert summary.largest_deviation == D("0.00")

    async def test_inactive_holdings_ignored_and_actions_assigned(self):
        holdings = [
            holding("0050", D("800"), "etf"), holding("VT", D("200"), "etf"),
            holding("GHOST", D("99999"), active=False),
        ]
        summary = await make_service(holdings).get_current_allocation(USER)
        assert summary.total_portfolio_value == D("1000.00")
        by = {a.asset_symbol: a for a in summary.allocations}
        assert by["0050"].action == ActionType.SELL and by["0050"].deviation == D("35.00")
        assert by["0050"].delta_amount == D("-350.00")
        assert by["CASH"].action == ActionType.BUY and by["CASH"].delta_amount == D("100.00")
        assert by["VT"].action == ActionType.HOLD

    async def test_result_is_memoised_per_service(self):
        svc = make_service([holding("0050", D("1"), "etf")])
        first = await svc.get_current_allocation(USER)
        assert await svc.get_current_allocation(USER) is first
        svc.holding_repo.get_portfolio_holdings.assert_awaited_once()

    async def test_cache_is_keyed_by_portfolio(self):
        svc = make_service([holding("0050", D("1"), "etf")])
        a, b = uuid4(), uuid4()
        assert await svc.get_current_allocation(USER, a) is not await svc.get_current_allocation(USER, b)
        assert svc.holding_repo.get_portfolio_holdings.await_count == 2

    async def test_explicit_portfolio_id_uses_get_by_id(self):
        svc = make_service([])
        pid = uuid4()
        await svc.get_current_allocation(USER, pid)
        svc.portfolio_repo.get_by_id.assert_awaited_once_with(pid, USER)


@pytest.mark.asyncio
class TestPlan:
    async def test_balanced_portfolio_has_empty_plan(self):
        holdings = [
            holding("0050", D("450"), "etf"), holding("VT", D("200"), "etf"),
            holding("BTC", D("100"), "crypto"), holding("CASH", D("100"), "cash"),
            holding("SAVINGS-CASH", D("100"), "cash"), holding("LOCKED", D("50")),
        ]
        plan = await make_service(holdings).calculate_rebalancing_plan(USER)
        assert plan.transactions == [] and plan.total_buy_amount == D("0")

    async def test_sells_fund_buys_and_fees_are_counted(self):
        holdings = [holding("0050", D("800"), "etf"), holding("VT", D("200"), "etf")]
        plan = await make_service(holdings).calculate_rebalancing_plan(USER)
        sells = [t for t in plan.transactions if t.action == ActionType.SELL]
        buys = [t for t in plan.transactions if t.action == ActionType.BUY]
        assert [t.asset_symbol for t in sells] == ["0050"]
        assert sells[0].amount == D("350.00")
        assert sells[0].estimated_fees == D("0.50")  # 350 * 0.1425%
        assert sells[0].priority == 1 and all(b.priority == 2 for b in buys)
        assert plan.total_sell_amount == D("350.00")
        assert plan.total_buy_amount == sum((b.amount for b in buys), D("0"))
        assert plan.available_funds == D("349.50")
        assert plan.target_cash_after == D("100.00")
        assert plan.net_cash_after == D("0") + plan.available_funds - plan.total_buy_amount

    async def test_overweight_cash_is_never_sold(self):
        holdings = [holding("CASH", D("1000"), "cash")]
        plan = await make_service(holdings).calculate_rebalancing_plan(USER)
        assert all(t.asset_symbol != "CASH" or t.action == ActionType.BUY
                   for t in plan.transactions)


@pytest.mark.asyncio
class TestFxAndAlerts:
    async def _fx(self, rate=None, exc=None):
        svc = make_service([])
        fake = MagicMock()
        if exc:
            fake.get_usd_to_twd_rate = AsyncMock(side_effect=exc)
        else:
            fake.get_usd_to_twd_rate = AsyncMock(return_value=rate)
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fake):
            return svc, await svc.calculate_fx_accumulation(USER)

    async def test_live_rate_above_threshold_is_ready(self):
        _, (fx,) = await self._fx(D("32"))
        assert fx.accumulated_twd == D("80000.00") and fx.ready_to_convert
        assert fx.estimated_conversion_fee == D("80.00")

    async def test_low_rate_is_not_ready_and_free(self):
        _, (fx,) = await self._fx(D("30"))
        assert not fx.ready_to_convert and fx.estimated_conversion_fee == D("0.00")

    @pytest.mark.parametrize("kwargs", [
        {"rate": None}, {"exc": asyncio.TimeoutError()}, {"exc": RuntimeError("down")},
    ])
    async def test_failures_fall_back_to_32_50(self, kwargs):
        _, (fx,) = await self._fx(**kwargs)
        assert fx.current_fx_rate == D("32.50")

    async def test_alerts_cover_rebalance_fx_and_low_cash(self):
        svc = make_service([holding("0050", D("1000"), "etf")])
        with patch.object(svc, "calculate_fx_accumulation", AsyncMock(return_value=[
            SimpleNamespace(ready_to_convert=True, currency="USD", accumulated_twd=D("90000"),
                            conversion_threshold=D("80000"), accumulated_amount=D("2500"))])):
            kinds = {a.alert_type for a in await svc.get_rebalancing_alerts(USER)}
        assert kinds == {AlertType.REBALANCE_REQUIRED, AlertType.FX_CONVERT_READY, AlertType.LOW_CASH}

    async def test_no_alerts_when_balanced_and_fx_not_ready(self):
        holdings = [
            holding("0050", D("450"), "etf"), holding("VT", D("200"), "etf"),
            holding("BTC", D("100"), "crypto"), holding("CASH", D("100"), "cash"),
            holding("SAVINGS-CASH", D("100"), "cash"), holding("LOCKED", D("50")),
        ]
        svc = make_service(holdings)
        with patch.object(svc, "calculate_fx_accumulation", AsyncMock(return_value=[
            SimpleNamespace(ready_to_convert=False, currency="USD")])):
            assert await svc.get_rebalancing_alerts(USER) == []


@pytest.mark.asyncio
class TestDashboard:
    async def test_missing_portfolio(self):
        svc = make_service([])
        svc.portfolio_repo.get_default_portfolio.return_value = None
        with pytest.raises(NotFoundException):
            await svc.get_dashboard_rebalancing_data(USER)

    async def test_assembles_everything(self):
        pf = portfolio(last_rebalance=datetime.now(timezone.utc) - timedelta(days=10, hours=1))
        svc = make_service([holding("0050", D("1000"), "etf")], pf)
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service") as g:
            g.return_value.get_usd_to_twd_rate = AsyncMock(return_value=D("30"))
            data = await svc.get_dashboard_rebalancing_data(USER)
        assert data.metrics.days_since_rebalance == 10
        assert data.metrics.rebalancing_required and data.rebalancing_plan is not None
        assert data.metrics.portfolio_growth == D("4.5")
        assert data.metrics.fx_accumulation_twd == D("75000.00")

    async def test_balanced_portfolio_omits_plan(self):
        holdings = [
            holding("0050", D("450"), "etf"), holding("VT", D("200"), "etf"),
            holding("BTC", D("100"), "crypto"), holding("CASH", D("100"), "cash"),
            holding("SAVINGS-CASH", D("100"), "cash"), holding("LOCKED", D("50")),
        ]
        svc = make_service(holdings)
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service") as g:
            g.return_value.get_usd_to_twd_rate = AsyncMock(return_value=D("30"))
            data = await svc.get_dashboard_rebalancing_data(USER)
        assert data.rebalancing_plan is None and data.metrics.days_since_rebalance is None


def test_factory():
    assert isinstance(get_rebalancing_service(MagicMock()), RebalancingService)
