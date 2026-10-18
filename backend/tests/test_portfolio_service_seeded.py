"""PortfolioService totals, allocation and dividends against the in-memory DB."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from app.modules.portfolio.models import (
    CurrencyRate, Dividend, HoldingWalletType, Portfolio, PortfolioHolding,
)
from app.modules.portfolio.services import AnalyticsService, get_portfolio_service
from app.modules.users.models import User, UserRole, UserStatus
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.database]
D = Decimal


def make_holding(pf, user, symbol, *, value, cost, currency="TWD", type_="etf", sector=None,
                 region=None, annual_dividend=None, qty="10", active=True):
    return PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=user.id, symbol=symbol, name=symbol, type=type_,
        exchange="TWSE", currency=currency, market="TW", wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=D(qty), average_cost=D(cost), current_price=D(value), total_cost=D(cost),
        total_value=D(value), gain_loss=D(value) - D(cost), gain_loss_percentage=D("0"),
        sector=sector, region=region, annual_dividend=annual_dividend, is_active=active,
        purchase_date=datetime(2026, 1, 2, tzinfo=timezone.utc))


@pytest_asyncio.fixture
async def pf(async_session, test_user):
    p = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(p)
    await async_session.commit()
    return p


def fake_fx(rate):
    return MagicMock(get_exchange_rate=AsyncMock(return_value=rate))


class TestUpdateTotals:
    async def test_same_currency_sums_and_computes_gain(self, async_session, test_user, pf):
        async_session.add_all([
            make_holding(pf, test_user, "0050", value="1500", cost="1000"),
            make_holding(pf, test_user, "0056", value="500", cost="600"),
        ])
        await async_session.commit()
        svc = get_portfolio_service(async_session)
        await svc._update_portfolio_totals(pf.id, test_user.id)
        await async_session.refresh(pf)
        assert (pf.total_value, pf.total_cost, pf.total_gain_loss) == (D("2000"), D("1600"), D("400"))
        assert pf.total_gain_loss_percentage == D("25")

    async def test_foreign_holding_uses_the_stored_rate(self, async_session, test_user, pf):
        async_session.add_all([
            make_holding(pf, test_user, "0050", value="1000", cost="1000"),
            make_holding(pf, test_user, "VT", value="100", cost="80", currency="USD"),
            CurrencyRate(id=uuid4(), from_currency="USD", to_currency="TWD", rate=D("30"),
                         source="test", rate_timestamp=datetime.now(timezone.utc)),
        ])
        await async_session.commit()
        await get_portfolio_service(async_session)._update_portfolio_totals(pf.id, test_user.id)
        await async_session.refresh(pf)
        assert (pf.total_value, pf.total_cost) == (D("4000"), D("3400"))

    async def test_missing_stored_rate_asks_the_exchange_service(self, async_session, test_user, pf):
        async_session.add(make_holding(pf, test_user, "VT", value="100", cost="80", currency="USD"))
        await async_session.commit()
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fake_fx(D("32"))):
            await get_portfolio_service(async_session)._update_portfolio_totals(pf.id, test_user.id)
        await async_session.refresh(pf)
        assert pf.total_value == D("3200")

    @pytest.mark.xfail(strict=True, raises=AssertionError, reason="no rate anywhere falls back to 1.0, so 100 USD is stored as NT$100")
    async def test_no_rate_at_all_does_not_treat_usd_as_twd(self, async_session, test_user, pf):
        async_session.add(make_holding(pf, test_user, "VT", value="100", cost="80", currency="USD"))
        await async_session.commit()
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fake_fx(None)):
            await get_portfolio_service(async_session)._update_portfolio_totals(pf.id, test_user.id)
        await async_session.refresh(pf)
        assert pf.total_value != D("100")

    async def test_zero_cost_gives_zero_percent(self, async_session, test_user, pf):
        async_session.add(make_holding(pf, test_user, "0050", value="100", cost="0"))
        await async_session.commit()
        await get_portfolio_service(async_session)._update_portfolio_totals(pf.id, test_user.id)
        await async_session.refresh(pf)
        assert pf.total_gain_loss_percentage == D("0")

    async def test_unknown_portfolio_is_a_quiet_noop(self, async_session, test_user):
        await get_portfolio_service(async_session)._update_portfolio_totals(uuid4(), test_user.id)


class TestAssetAllocation:
    async def test_no_portfolio(self, async_session, test_user):
        out = await AnalyticsService(async_session).get_asset_allocation(test_user.id)
        assert out["by_type"] == [] and out["base_currency"] == "TWD"

    async def test_groups_by_type_sector_and_region_in_twd(self, async_session, test_user, pf):
        async_session.add_all([
            make_holding(pf, test_user, "0050", value="600", cost="500", type_="etf", sector="Broad", region="TW"),
            make_holding(pf, test_user, "2330", value="200", cost="100", type_="stock", sector="Tech", region="TW"),
            make_holding(pf, test_user, "VT", value="5", cost="4", currency="USD", type_="etf", sector="Broad", region="Global"),
            make_holding(pf, test_user, "OLD", value="999", cost="1", active=False),
            make_holding(pf, test_user, "ZERO", value="0", cost="0"),
        ])
        await async_session.commit()
        fx = MagicMock(get_exchange_rate=AsyncMock(return_value=D("40")))
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fx):
            out = await AnalyticsService(async_session).get_asset_allocation(test_user.id)
        by_type = {r["type"]: r for r in out["by_type"]}
        assert by_type["Etf"]["value"] == 800.0  # 600 + 5 USD * 40
        assert by_type["Stock"]["percentage"] == pytest.approx(20.0)
        assert sum(r["percentage"] for r in out["by_type"]) == pytest.approx(100.0)
        assert {r["type"]: r["value"] for r in out["by_region"]} == {"TW": 800.0, "Global": 200.0}
        assert {r["type"] for r in out["by_sector"]} == {"Broad", "Tech"}
        assert out["exchange_rate"] == 40.0

    async def test_other_currency_is_converted_through_its_own_rate(self, async_session, test_user, pf):
        async_session.add(make_holding(pf, test_user, "NK", value="1000", cost="900", currency="JPY"))
        await async_session.commit()
        rates = {("USD", "TWD"): D("40"), ("JPY", "TWD"): D("0.2")}
        fx = MagicMock(get_exchange_rate=AsyncMock(side_effect=lambda f, t: rates[(f, t)]))
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fx):
            out = await AnalyticsService(async_session).get_asset_allocation(test_user.id)
        assert out["by_type"][0]["value"] == 200.0
        fx.get_exchange_rate.assert_any_await("JPY", "TWD")

    async def test_empty_portfolio_has_no_slices(self, async_session, test_user, pf):
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fake_fx(D("32"))):
            out = await AnalyticsService(async_session).get_asset_allocation(test_user.id)
        assert out["by_type"] == []


class TestDividends:
    def dividend(self, user, days_ago, amount, symbol="0056"):
        return Dividend(
            id=uuid4(), user_id=user.id, symbol=symbol, payment_date=business_today() - timedelta(days=days_ago),
            amount_per_share=D("1"), shares_owned=D(amount), total_amount=D(amount), net_amount=D(amount),
            currency="TWD")

    async def test_no_portfolio_returns_nulls(self, async_session, test_user):
        out = await AnalyticsService(async_session).get_dividend_data(test_user.id)
        assert out["total_dividends"] is None and out["payments"] == []

    async def test_period_total_and_trailing_year_fallback(self, async_session, test_user, pf):
        pf.total_cost, pf.total_value = D("10000"), D("20000")
        async_session.add_all([
            self.dividend(test_user, 10, "100"), self.dividend(test_user, 100, "200"),
            self.dividend(test_user, 300, "400"), make_holding(pf, test_user, "0056", value="1", cost="1")])
        await async_session.commit()
        svc = AnalyticsService(async_session)
        one_m = await svc.get_dividend_data(test_user.id, "1m")
        assert one_m["total_dividends"] == 100.0
        year = await svc.get_dividend_data(test_user.id, "1y")
        assert year["total_dividends"] == 700.0
        # No annual_dividend on the holding: projection falls back to trailing-12-month income.
        assert year["projected_annual"] == 700.0
        assert year["yield_on_cost"] == pytest.approx(7.0)
        assert year["yield_on_value"] == pytest.approx(3.5)
        assert [p["amount"] for p in year["payments"]] == [100.0, 200.0, 400.0]  # newest first

    async def test_holding_annual_dividend_wins_over_history(self, async_session, test_user, pf):
        pf.total_cost, pf.total_value = D("1000"), D("1000")
        async_session.add_all([
            make_holding(pf, test_user, "0056", value="1", cost="1", annual_dividend=D("2"), qty="50"),
            self.dividend(test_user, 10, "5")])
        await async_session.commit()
        out = await AnalyticsService(async_session).get_dividend_data(test_user.id)
        assert out["projected_annual"] == 100.0 and out["dividend_yield"] == pytest.approx(10.0)

    async def test_nothing_to_project_yields_nulls(self, async_session, test_user, pf):
        out = await AnalyticsService(async_session).get_dividend_data(test_user.id)
        assert out["projected_annual"] is None and out["yield_on_cost"] is None


class TestUserScoping:
    @pytest_asyncio.fixture
    async def other(self, async_session):
        u = User(id=uuid4(), email="other@example.com", name="Other", hashed_password="x", is_active=True,
                 is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE, preferred_currency="USD",
                 timezone="UTC", experience_points=0, level=1)
        p = Portfolio(id=uuid4(), user_id=u.id, name="Other", currency="TWD", is_active=True, is_default=True)
        async_session.add_all([u, p])
        await async_session.flush()
        async_session.add_all([
            make_holding(p, u, "9999", value="777", cost="1", type_="crypto", sector="Other", region="Mars"),
            Dividend(id=uuid4(), user_id=u.id, symbol="9999", payment_date=business_today(),
                     amount_per_share=D("1"), shares_owned=D("1"), total_amount=D("12345"), net_amount=D("12345"),
                     currency="TWD"),
        ])
        await async_session.commit()
        return u, p

    async def test_nothing_of_anothers_leaks(self, async_session, test_user, pf, other):
        async_session.add(make_holding(pf, test_user, "0050", value="100", cost="50", sector="Broad", region="TW"))
        await async_session.commit()
        analytics = AnalyticsService(async_session)
        with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=fake_fx(D("32"))):
            alloc = await analytics.get_asset_allocation(test_user.id)
        assert [r["value"] for r in alloc["by_type"]] == [100.0] and [r["type"] for r in alloc["by_region"]] == ["TW"]
        divs = await analytics.get_dividend_data(test_user.id)
        assert divs["payments"] == [] and divs["total_dividends"] is None

    async def test_totals_will_not_touch_another_users_portfolio(self, async_session, test_user, pf, other):
        _, other_pf = other  # holds a 777 holding that belongs to someone else
        await get_portfolio_service(async_session)._update_portfolio_totals(other_pf.id, test_user.id)
        await async_session.refresh(other_pf)
        assert other_pf.total_value == D("0")
