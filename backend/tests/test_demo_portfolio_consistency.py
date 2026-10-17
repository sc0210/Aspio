"""The demo portfolio must be one account, not several.

Before this, /portfolio served a USD portfolio of AAPL/GOOGL/BTC worth 28,450
while /dashboard/stats reported a portfolio wallet of NT$2,000,000 — the same
demo wallet, seventy times apart, on two screens a visitor sees one after the
other. The served holdings did not even sum to the total stated beside them, and
the fixture existed in four transcriptions: _shared.DEMO_HOLDINGS, an inline
copy in portfolio_root (the one actually served), DEMO_DASHBOARD_STATS, and the
frontend's demoData.ts.
"""

from decimal import Decimal

import pytest

from app.modules.dashboard.router import DEMO_DASHBOARD_STATS
from app.modules.portfolio.routers._shared import DEMO_HOLDINGS, DEMO_PORTFOLIO


@pytest.mark.unit
def test_each_holding_multiplies_out():
    """quantity x price = value, on every row a visitor can read."""
    for holding in DEMO_HOLDINGS:
        expected = holding["quantity"] * holding["current_price"]
        assert holding["total_value"] == expected, holding["symbol"]


@pytest.mark.unit
def test_holdings_sum_to_the_portfolio_total():
    assert sum(h["total_value"] for h in DEMO_HOLDINGS) == DEMO_PORTFOLIO["total_value"]
    assert sum(h["total_cost"] for h in DEMO_HOLDINGS) == DEMO_PORTFOLIO["total_cost"]


@pytest.mark.unit
def test_the_portfolio_is_the_dashboards_portfolio_wallet():
    """The two screens report the same wallet, so they must report one number."""
    assert DEMO_PORTFOLIO["total_value"] == Decimal(
        str(DEMO_DASHBOARD_STATS["portfolio_wallet"])
    )


@pytest.mark.unit
def test_the_demo_account_is_denominated_in_one_currency():
    """A TWD account with USD rows renders NT$ against dollar prices."""
    assert DEMO_PORTFOLIO["currency"] == "TWD"
    assert {h["currency"] for h in DEMO_HOLDINGS} == {"TWD"}


@pytest.mark.unit
def test_rebalancing_describes_the_same_portfolio():
    """A visitor lands on /rebalancing straight from /portfolio.

    This fixture used to be a third demo account — NT$28,450 across
    0050/VT/CRYPTO/CASH/SAVINGS, three of which do not exist in DEMO_HOLDINGS.
    """
    from app.modules.portfolio.routers._shared import DEMO_REBALANCING_DASHBOARD

    dashboard = DEMO_REBALANCING_DASHBOARD
    total = float(DEMO_PORTFOLIO["total_value"])

    # `metrics` states the account's net worth and cash flow rather than the
    # portfolio total — it is DashboardMetricsEnhanced, the same object the
    # authenticated endpoint returns. The two blocks that do carry the total:
    assert dashboard["allocation_summary"]["total_portfolio_value"] == total
    assert dashboard["rebalancing_plan"]["total_portfolio_value"] == total

    # Only assets the portfolio actually holds, and their values must add up.
    held = {h["symbol"] for h in DEMO_HOLDINGS}
    allocations = dashboard["allocation_summary"]["allocations"]
    assert {a["asset_symbol"] for a in allocations} == held
    assert sum(a["current_value"] for a in allocations) == total
    assert sum(a["current_percentage"] for a in allocations) == pytest.approx(100.0)


@pytest.mark.unit
def test_gain_is_value_minus_cost():
    for holding in DEMO_HOLDINGS:
        assert holding["gain_loss"] == holding["total_value"] - holding["total_cost"], (
            holding["symbol"]
        )
    assert (
        DEMO_PORTFOLIO["total_gain_loss"]
        == DEMO_PORTFOLIO["total_value"] - DEMO_PORTFOLIO["total_cost"]
    )


@pytest.mark.unit
def test_the_rebalancing_fixture_satisfies_the_schemas_it_stands_in_for():
    """Nothing validates this fixture at runtime, so validate it here.

    `/portfolio/rebalancing/dashboard` returns the demo dict raw — no
    response_model — so a missing field is invisible until a page reads it and
    gets nothing. Rewriting the fixture once dropped six:
    `requires_rebalancing`, `largest_deviation`, `last_rebalance_date`,
    `total_buy_amount`, `total_sell_amount`, `total_fees`. Those are the ones
    `rebalancingService.transformBackendResponse` reads *directly*, rather than
    the `metrics` copies that survived, so the page reported no drift at all —
    the opposite of what this fixture exists to show, and green on every value
    assertion above. Validating against the schemas the authenticated endpoint
    is built from catches a dropped field of any name.
    """
    from app.modules.portfolio.rebalancing_schemas import (
        AssetAllocationSummary,
        DashboardMetricsEnhanced,
        FXAccumulation,
        RebalancingPlan,
    )
    from app.modules.portfolio.routers._shared import DEMO_REBALANCING_DASHBOARD

    summary = AssetAllocationSummary(
        **DEMO_REBALANCING_DASHBOARD["allocation_summary"]
    )
    plan = RebalancingPlan(**DEMO_REBALANCING_DASHBOARD["rebalancing_plan"])
    metrics = DashboardMetricsEnhanced(**DEMO_REBALANCING_DASHBOARD["metrics"])
    fx = [FXAccumulation(**entry) for entry in DEMO_REBALANCING_DASHBOARD["fx_accumulation"]]

    # The plan is self-funding, minus what the sale costs to make.
    # `available_funds` was 0.00 beside a sell of exactly the buy's size, and
    # then briefly the gross proceeds beside a fee the same payload charged.
    assert plan.available_funds == plan.total_sell_amount - plan.total_fees
    assert plan.net_cash_after == plan.available_funds - plan.total_buy_amount
    assert plan.net_cash_after == -plan.total_fees
    assert metrics.available_funds == plan.available_funds

    # The FX tracker says the same thing in both places it appears.
    assert metrics.fx_accumulation_twd == fx[0].accumulated_twd
    assert metrics.fx_ready_to_convert == fx[0].ready_to_convert
    assert fx[0].accumulated_twd == fx[0].accumulated_amount * fx[0].current_fx_rate
    assert fx[0].next_conversion_target == fx[0].conversion_threshold - fx[0].accumulated_twd

    # And it must describe a portfolio with something to do: a demo of a
    # rebalancing tool that is already balanced demonstrates nothing.
    assert summary.requires_rebalancing is True
    assert summary.in_balance is False
    assert summary.largest_deviation > 0
    assert plan.total_buy_amount > 0
    assert plan.total_sell_amount > 0

    # Derived, not restated: the planner sets a 10% cash target, so a change to
    # the portfolio's size has to carry through to this field too.
    assert plan.target_cash_after == plan.total_portfolio_value * Decimal("0.10")
    assert {t.action.value for t in plan.transactions} == {"buy", "sell"}


@pytest.mark.unit
def test_the_demo_stats_add_up_and_derive_from_each_other():
    """The stats payload used to carry two answers for the same question.

    Beside the three-wallet figures sat a second set that disagreed with them:
    netWorth 23,400 against a NT$2.5M balance sheet, totalBalance 15,750.25
    against a NT$250K life wallet, and portfolioValue 28,450.75 — the exact
    figure the fixture reconciliation removed everywhere else. Both sets were
    served; the client happened to read the ones that were right.
    """
    from app.modules.dashboard.router import DEMO_DASHBOARD_STATS as stats

    assert stats["total_asset"] == (
        stats["life_wallet"] + stats["portfolio_wallet"] + stats["emergency_wallet"]
    )
    assert stats["investment_total"] == stats["portfolio_wallet"]

    # Every legacy field is now a view of the wallets, not a second opinion on
    # them — each by the definition services.py uses, so demo and authenticated
    # answer the same question. portfolioValue is the legacy SUM of the
    # portfolio and emergency wallets, not the portfolio wallet alone.
    assert stats["totalBalance"] == stats["life_wallet"]
    assert stats["portfolioValue"] == stats["portfolio_wallet"] + stats["emergency_wallet"]
    assert stats["netWorth"] == stats["total_asset"] - stats["total_debt"]

    income, expenses = stats["totalIncome"], stats["totalExpenses"]
    assert stats["monthlyChange"] == income - expenses
    assert stats["savingsRate"] == pytest.approx((income - expenses) / income * 100, abs=0.01)


@pytest.mark.unit
def test_both_branches_of_the_stats_endpoint_answer_in_one_shape():
    """A demo visitor and a signed-in user read the same screen.

    The two branches assembled their own dicts, so the demo one was free to
    drift — and did. They build from one function now, and this is what says so:
    a field added to the authenticated payload alone would fail here.
    """
    from app.modules.dashboard.router import DEMO_DASHBOARD_STATS, build_stats_payload

    authenticated = build_stats_payload(
        life_wallet=0.0,
        portfolio_wallet=0.0,
        emergency_wallet=0.0,
        total_debt=0.0,
        total_income=0.0,
        total_expenses=0.0,
        portfolio_value=0.0,
        emergency_fund_months=0.0,
    )

    assert set(DEMO_DASHBOARD_STATS) == set(authenticated)
    # A brand-new account: every figure zero, and nothing dividing by zero.
    assert authenticated["savingsRate"] == 0.0
    assert authenticated["totalIncome"] == 0.0


@pytest.mark.unit
@pytest.mark.parametrize("multiplier", [0.25, 1.0, 3.0, 12.0])
def test_scaling_the_window_scales_everything_that_depends_on_it(multiplier):
    """A 90-day request answered with three months of spending beside a
    one-month net figure, because scaling touched two fields and left the two
    derived from them alone."""
    from app.modules.dashboard.router import demo_stats

    base, scaled = demo_stats(), demo_stats(multiplier)

    assert scaled["totalIncome"] == pytest.approx(base["totalIncome"] * multiplier)
    assert scaled["totalExpenses"] == pytest.approx(base["totalExpenses"] * multiplier)
    assert scaled["monthlyChange"] == pytest.approx(
        scaled["totalIncome"] - scaled["totalExpenses"]
    )
    # A ratio, so it holds whatever the window is.
    assert scaled["savingsRate"] == pytest.approx(base["savingsRate"])

    # Balances are point-in-time: they do not move with the window.
    for balance in (
        "life_wallet", "portfolio_wallet", "emergency_wallet", "netWorth",
        "portfolioValue",
    ):
        assert scaled[balance] == base[balance]

    # Nor does coverage. A ratio against a MONTHLY spending rate, so the window
    # cannot move it: this read six times shorter on 6M than on 30D once, and
    # rederiving it from the window's expense total puts that straight back.
    assert scaled["emergencyFundMonths"] == base["emergencyFundMonths"]
    assert scaled["emergencyFundMonths"] == pytest.approx(
        base["emergency_wallet"] / base["totalExpenses"], abs=0.05
    )


@pytest.mark.unit
def test_emergency_cover_is_the_same_number_on_every_period():
    """The figure a reader compares against "six months of expenses".

    A static period→months table once made the same fund and the same spending
    rate read six times shorter on 6M than on 30D — the number moved when only
    the selector had. The demo branch reintroduced it the moment coverage was
    recomputed from the window's expense total instead of a monthly rate.
    """
    from app.modules.dashboard.router import _DEMO_PERIOD_MULTIPLIERS, demo_stats

    covers = {
        period: demo_stats(multiplier)["emergencyFundMonths"]
        for period, multiplier in _DEMO_PERIOD_MULTIPLIERS.items()
    }

    assert len(set(covers.values())) == 1, covers


@pytest.mark.unit
def test_the_two_demo_screens_report_one_account():
    """`/dashboard/stats` and `/portfolio/rebalancing/dashboard` are read one
    after the other, and both state the account's net worth, its cash flow and
    what the portfolio is worth.

    The rebalancing endpoint's `metrics` used to be a different object
    altogether — total_portfolio_value / total_cost / total_gain_loss, none of
    the nine fields `DashboardMetricsEnhanced` declares — so the question of
    whether the two agreed could not even be asked.
    """
    from app.modules.dashboard.router import DEMO_DASHBOARD_STATS as stats
    from app.modules.portfolio.routers._shared import DEMO_REBALANCING_DASHBOARD

    metrics = DEMO_REBALANCING_DASHBOARD["metrics"]

    assert metrics["net_worth"] == stats["netWorth"]
    assert metrics["total_balance"] == stats["totalBalance"]
    assert metrics["monthly_income"] == stats["totalIncome"]
    assert metrics["monthly_expenses"] == stats["totalExpenses"]
    assert metrics["savings_rate"] == stats["savingsRate"]
    assert metrics["portfolio_value"] == stats["portfolioValue"]
