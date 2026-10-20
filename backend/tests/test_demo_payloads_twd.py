"""Demo payloads describe the same NT$ account the frontend fixture does.

An E2E pass on 2026-10-09 found the dashboard's Cash Flow card ranking a
"Salary +4,200" (a USD mock printed as NT$) beside a NT$63,000 salary, the
Investments card reading "Annual Income NT$176" on a NT$2M portfolio, the
portfolio chart drawn from the retired NT$28,450 AAPL/GOOGL account, and 0050
flagged as a US listing. Each assertion below is one of those.
"""

import json
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.common import demo_fixtures
from app.modules.portfolio.routers._shared import (
    DEMO_HOLDINGS,
    DEMO_PORTFOLIO,
    demo_value_series,
)

pytestmark = pytest.mark.unit

FIXTURE_PORTFOLIO_VALUE = demo_fixtures.DEMO_PORTFOLIO_WALLET  # NT$2,000,000


def _body(response):
    return json.loads(response.body)


# ── Item 20: holdings ────────────────────────────────────────────────────────


def test_0050_is_a_taiwan_listing_and_vt_a_us_one():
    by_symbol = {h["symbol"]: h for h in DEMO_HOLDINGS}
    assert by_symbol["0050"]["market"] == "TW"
    assert by_symbol["0050"]["exchange"] == "TWSE"
    assert by_symbol["VT"]["market"] == "US"


def test_the_market_survives_serialisation():
    """The field reached HoldingResponse missing, which defaulted it to "US"."""
    from app.modules.portfolio.schemas import HoldingResponse

    for holding in DEMO_HOLDINGS:
        served = HoldingResponse(**holding).model_dump(by_alias=True)
        assert served["market"] == holding["market"]


def test_gain_percentages_are_computed_from_cost_and_value():
    for h in DEMO_HOLDINGS:
        expected = (h["gain_loss"] / h["total_cost"] * 100).quantize(Decimal("0.01"))
        assert h["gain_loss_percentage"] == expected, h["symbol"]
    assert {h["symbol"]: h["gain_loss_percentage"] for h in DEMO_HOLDINGS} == {
        "0050": Decimal("3.45"),
        "VT": Decimal("5.26"),
    }


def test_annual_dividend_is_per_share():
    """get_dividend_data multiplies it by quantity, as the column means."""
    for h in DEMO_HOLDINGS:
        yearly = h["annual_dividend"] * h["quantity"]
        assert yearly == (h["dividend_yield"] / 100 * h["total_value"]).quantize(
            Decimal("0.01")
        ), h["symbol"]


# ── Item 19: the value series ────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("days", [7, 30, 365, 9999])
async def test_daily_performance_ends_at_the_fixture_portfolio_value(days):
    from app.modules.portfolio.routers.performance_history import (
        get_daily_performance,
    )

    response = await get_daily_performance(
        background_tasks=None, days=days, current_user=None, session=None
    )
    points = response.data

    assert points, "demo series is empty"
    assert points[-1]["value"] == pytest.approx(FIXTURE_PORTFOLIO_VALUE)
    assert points[-1]["costBasis"] == float(DEMO_PORTFOLIO["total_cost"])
    # Same order of magnitude everywhere, not just at the end: the chart axis
    # read 23.6K-25.2K beside NT$2M.
    assert min(p["value"] for p in points) > FIXTURE_PORTFOLIO_VALUE * 0.8
    assert max(p["value"] for p in points) < FIXTURE_PORTFOLIO_VALUE * 1.2
    # Every holding is in topHoldings, and they add up to the day's value.
    for p in points:
        assert {m["symbol"] for m in p["topHoldings"]} == {"0050", "VT"}
        assert sum(m["value"] for m in p["topHoldings"]) == pytest.approx(
            p["value"], abs=0.05
        )
    assert all(date.fromisoformat(p["date"]).weekday() < 5 for p in points)


def test_the_series_is_deterministic_and_windows_agree():
    """Refetching, or widening the window, must not redraw a day already shown."""
    short, long_ = demo_value_series(30), demo_value_series(365)
    assert short == demo_value_series(30)
    by_date = {p["date"]: p["value"] for p in long_}
    for p in short:
        assert by_date[p["date"]] == p["value"]


def test_the_series_never_starts_before_the_demo_account_opened():
    from app.modules.portfolio.routers._shared import DEMO_SERIES_START

    assert demo_value_series(9999)[0]["date"] >= DEMO_SERIES_START


@pytest.mark.parametrize("today", [date(2026, 10, 12), date(2026, 10, 14)])  # Mon, Wed
def test_one_day_return_moves_against_the_previous_trading_day(monkeypatch, today):
    """On a Monday the 1-day window held only Monday, so oneDay read 0.00% every week."""
    from app.modules.portfolio.routers import _shared

    monkeypatch.setattr(_shared, "business_today", lambda: today)
    series = demo_value_series(10, end=today)
    prev, last = series[-2]["value"], series[-1]["value"]
    assert prev != last  # the fixture series moves day to day
    assert _shared.demo_period_return_pct(1) == round((last / prev - 1) * 100, 2)


def test_a_caller_cannot_corrupt_the_cached_series():
    demo_value_series(30)[-1]["holdings"]["0050"] = 0
    assert demo_value_series(30)[-1]["holdings"]["0050"] == 1_500_000.0


@pytest.mark.asyncio
async def test_historical_demo_ends_at_the_fixture_value():
    from app.modules.portfolio.routers.performance_history import (
        get_portfolio_historical_data,
    )

    response = await get_portfolio_historical_data(days=365, current_user=None, session=None)
    assert response.data[-1]["value"] == pytest.approx(FIXTURE_PORTFOLIO_VALUE)


@pytest.mark.asyncio
async def test_twr_and_historical_describe_the_fixture():
    from app.modules.portfolio.routers.performance import (
        get_historical_performance,
        get_time_weighted_return,
    )

    twr = _body(
        await get_time_weighted_return(
            start_date=None, end_date=None, current_user=None, session=None
        )
    )["data"]
    assert twr["current_value"] == FIXTURE_PORTFOLIO_VALUE
    assert twr["total_invested"] == float(DEMO_PORTFOLIO["total_cost"])
    assert twr["twr"] == pytest.approx(float(DEMO_PORTFOLIO["total_gain_loss_percentage"]), abs=0.01)

    hist = _body(
        await get_historical_performance(interval="monthly", current_user=None, session=None)
    )["data"]
    assert len(hist) == 12
    assert hist[-1]["value"] == pytest.approx(FIXTURE_PORTFOLIO_VALUE)
    assert hist[-1]["cost"] == float(DEMO_PORTFOLIO["total_cost"])


# ── Item 18: dividends and the cash-flow categories ──────────────────────────


def test_demo_dividends_are_twd_and_sized_to_the_portfolio():
    from app.modules.portfolio.routers.dividends import demo_dividend_payload

    payload = demo_dividend_payload("1y")
    projected = sum(h["annual_dividend"] * h["quantity"] for h in DEMO_HOLDINGS)

    assert payload["currency"] == "TWD"
    assert {p["currency"] for p in payload["payments"]} == {"TWD"}
    assert {p["symbol"] for p in payload["payments"]} <= {h["symbol"] for h in DEMO_HOLDINGS}
    assert payload["projected_annual"] == float(projected) == 56_500.0
    # The last twelve months of payments are the projected year.
    assert payload["total_dividends"] == pytest.approx(payload["projected_annual"])
    assert payload["yield_on_cost"] == pytest.approx(
        payload["projected_annual"] / float(DEMO_PORTFOLIO["total_cost"]) * 100, abs=1e-4
    )
    # A shorter window holds fewer payments, never more.
    assert len(demo_dividend_payload("3m")["payments"]) < len(payload["payments"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("endpoint", "monthly_total"),
    [
        ("get_spending_by_category", demo_fixtures.DEMO_MONTHLY_EXPENSES),
        ("get_income_by_category", demo_fixtures.DEMO_MONTHLY_INCOME),
    ],
)
@pytest.mark.parametrize("period", ["month", "7d", "90d", "1y", "ytd"])
async def test_cash_flow_categories_are_twd_and_add_up_to_the_stats(endpoint, monthly_total, period):
    import importlib

    # `from app.modules.dashboard import router` is the APIRouter, not the module.
    dashboard = importlib.import_module("app.modules.dashboard.router")
    _DEMO_PERIOD_MULTIPLIERS = dashboard._DEMO_PERIOD_MULTIPLIERS

    handler = getattr(dashboard, endpoint)
    kwargs = dict(request=None, period=period, current_user=None, db=None)
    if endpoint == "get_spending_by_category":
        kwargs["force_refresh"] = False

    first = _body(await handler(**kwargs))["data"]
    second = _body(await handler(**kwargs))["data"]

    assert {c["currency"] for c in first} == {"TWD"}
    assert sum(c["amount"] for c in first) == pytest.approx(
        monthly_total * _DEMO_PERIOD_MULTIPLIERS[period]
    )
    assert sum(c["percentage"] for c in first) == pytest.approx(100, abs=0.1)
    # Repeat requests answer the same: the spending branch used to scale the
    # shared module-level dicts in place, compounding on every call.
    assert first == second


def test_top_income_is_the_fixture_salary():
    from app.modules.dashboard.router import MOCK_INCOME_CATEGORIES

    top = max(MOCK_INCOME_CATEGORIES, key=lambda c: c["amount"])
    assert (top["name"], top["amount"]) == ("Salary", 63_000.0)


@pytest.mark.asyncio
async def test_demo_analytics_allocation_is_the_two_etfs():
    from app.modules.portfolio.routers.allocation_analytics import router

    # The module defines two `get_asset_allocation`s (the rebalancing one later
    # shadows this name), so reach the /allocation handler through its route.
    endpoint = next(r.endpoint for r in router.routes if r.path == "/allocation")
    data = (await endpoint(current_user=None, session=None)).data
    assert [(a.type, a.percentage) for a in data["by_region"]] == [
        ("Taiwan", Decimal("75.0")),
        ("Global", Decimal("25.0")),
    ]
    assert sum(a.value for a in data["by_type"]) == DEMO_PORTFOLIO["total_value"]


@pytest.mark.asyncio
async def test_a_failed_dividend_query_is_an_error_not_no_dividends(monkeypatch):
    """It answered 200 with null figures, which a caller cannot tell from a user
    who has no dividends; the performance endpoint was fixed the same way."""
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.modules.portfolio.routers import dividends

    async def failing(self, **_):
        raise RuntimeError("price provider down")

    # Patch the method on the real class: a stand-in service accepted a call to a
    # method PortfolioService does not have, and every request 500'd behind it.
    monkeypatch.setattr(dividends.AnalyticsService, "get_dividend_data", failing)
    with pytest.raises(HTTPException) as caught:
        await dividends.get_dividends_demo(
            period="1y", current_user=SimpleNamespace(id=1), session=None
        )
    assert caught.value.status_code == 500
