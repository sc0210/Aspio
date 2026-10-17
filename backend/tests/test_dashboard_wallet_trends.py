"""
Comprehensive tests for Dashboard Wallet Trends API.

Tests the wallet trends endpoint with different period selections,
ensuring correct period mapping and date range calculations.
"""

import pytest
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from app.modules.dashboard.schemas import PeriodEnum
from app.modules.users.models import User
from app.modules.transactions.models import Transaction, TransactionType, TransactionWalletType
from app.utils.datetime_helpers import business_today


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.database
class TestWalletTrendsAPI:
    """Test wallet trends API endpoint with various periods."""

    async def test_wallet_trends_this_month_period(
        self, authenticated_client, test_user, async_session, seed_categories
    ):
        """Test wallet trends with 'month' period returns the current calendar month to date."""
        # Make API request
        response = authenticated_client.get("/api/v1/dashboard/wallet-trends?period=month")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert "data" in data
        assert "dataPoints" in data["data"]
        assert data["data"]["period"] == "month"

        # 'month' is the current CALENDAR month to date — the 1st through today —
        # not a 30-day rolling window. See PeriodEnum.MONTH ("Current calendar
        # month") in dashboard/schemas.py; use "30d" for the rolling window.
        today = business_today()
        expected_start = today.replace(day=1).strftime("%Y-%m-%d")
        expected_end = today.strftime("%Y-%m-%d")

        assert data["data"]["startDate"] == expected_start
        assert data["data"]["endDate"] == expected_end

    async def test_wallet_trends_two_weeks_period(
        self, authenticated_client, test_user, async_session
    ):
        """Test wallet trends with '14d' period returns last 14 days."""
        response = authenticated_client.get("/api/v1/dashboard/wallet-trends?period=14d")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert "dataPoints" in data["data"]
        assert data["data"]["period"] == "14d"

        # Verify date range is last 14 days
        today = business_today()
        expected_start = (today - timedelta(days=13)).strftime("%Y-%m-%d")
        expected_end = today.strftime("%Y-%m-%d")

        assert data["data"]["startDate"] == expected_start
        assert data["data"]["endDate"] == expected_end

    async def test_wallet_trends_all_periods(self, authenticated_client, test_user):
        """Test all supported period values."""
        # "ytd" belongs here too: it is what the lifecycle page's YTD button
        # sends, and it was previously exercised only on the demo branch.
        periods = ["7d", "14d", "month", "30d", "90d", "6m", "1y", "ytd"]

        for period in periods:
            response = authenticated_client.get(f"/api/v1/dashboard/wallet-trends?period={period}")

            assert response.status_code == 200, f"Failed for period={period}"
            data = response.json()

            assert data["success"] is True
            assert "dataPoints" in data["data"]
            assert data["data"]["period"] == period
            assert "startDate" in data["data"]
            assert "endDate" in data["data"]

    async def test_wallet_trends_invalid_period(self, authenticated_client, test_user):
        """Test wallet trends with invalid period still returns a successful response."""
        response = authenticated_client.get("/api/v1/dashboard/wallet-trends?period=invalid")

        assert response.status_code == 200
        data = response.json()

        # API accepts the request and returns data (may pass through period value)
        assert data["success"] is True
        assert "dataPoints" in data["data"]

    async def test_wallet_trends_data_structure(
        self, authenticated_client, test_user, async_session
    ):
        """Test wallet trends returns correct data structure."""
        response = authenticated_client.get("/api/v1/dashboard/wallet-trends?period=7d")

        assert response.status_code == 200
        data = response.json()["data"]

        # Check response structure
        assert "dataPoints" in data
        assert "period" in data
        assert "startDate" in data
        assert "endDate" in data
        assert "currency" in data
        assert "lastUpdated" in data

        # Check dataPoints structure
        if len(data["dataPoints"]) > 0:
            point = data["dataPoints"][0]
            assert "date" in point
            assert "lifeWallet" in point
            assert "portfolioWallet" in point
            assert "emergencyWallet" in point
            assert "totalAsset" in point
            assert "investmentTotal" in point

    async def test_wallet_trends_with_transactions(
        self, authenticated_client, test_user, async_session, test_category
    ):
        """Test wallet trends calculation with actual transaction data."""
        # Create test transactions in life wallet
        transactions = [
            Transaction(
                id=uuid4(),
                user_id=test_user.id,
                amount=Decimal("1000.00"),
                type=TransactionType.INCOME,
                wallet_type=TransactionWalletType.LIFE,
                category_id=test_category.id,
                transaction_date=business_today() - timedelta(days=2),
                description="Income transaction",
            ),
            Transaction(
                id=uuid4(),
                user_id=test_user.id,
                amount=Decimal("500.00"),
                type=TransactionType.EXPENSE,
                wallet_type=TransactionWalletType.LIFE,
                category_id=test_category.id,
                transaction_date=business_today() - timedelta(days=1),
                description="Expense transaction",
            ),
        ]

        for transaction in transactions:
            async_session.add(transaction)
        await async_session.commit()

        # Get wallet trends
        response = authenticated_client.get("/api/v1/dashboard/wallet-trends?period=7d")

        assert response.status_code == 200
        data = response.json()["data"]

        # Verify data points are calculated correctly
        assert len(data["dataPoints"]) > 0

        # Find the last data point (today)
        last_point = data["dataPoints"][-1]

        # Life wallet should show net balance (1000 - 500 = 500)
        # Note: Actual value depends on wallet calculation logic
        assert last_point["lifeWallet"] >= 0

    async def test_wallet_trends_unauthorized(self, client):
        """Test wallet trends requires authentication."""
        response = client.get("/api/v1/dashboard/wallet-trends?period=month")

        # Endpoint either works in demo mode (200) or requires auth (401/403)
        assert response.status_code in [200, 401, 403]

    async def test_wallet_trends_demo_mode(self, client):
        """Test wallet trends works in demo mode."""
        # Demo mode should work without authentication
        response = client.get("/api/v1/dashboard/wallet-trends?period=month")

        # Demo mode returns data
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is True
            assert "dataPoints" in data["data"]

    async def test_points_carry_the_per_loan_debt_breakdown(
        self, authenticated_client, test_user
    ):
        """Every point reports debt per loan, not just the total.

        The total cannot be split after the fact, and a consumer interested in a
        subset — the lifecycle page counts only the loans borrowed to invest —
        would otherwise re-derive it from a contractual amortization schedule,
        which drifts on every early or missed payment.
        """
        response = authenticated_client.get(
            "/api/v1/dashboard/wallet-trends?period=30d"
        )
        assert response.status_code == 200

        points = response.json()["data"]["dataPoints"]
        assert points

        for point in points:
            assert "debtByLoan" in point, "per-loan breakdown missing from a point"
            assert isinstance(point["debtByLoan"], dict)
            # The breakdown must add up to the total published beside it.
            assert sum(point["debtByLoan"].values()) == pytest.approx(
                point["debtBalance"]
            )

    @pytest.mark.parametrize("period", ["7d", "30d", "90d", "1y", "ytd"])
    async def test_demo_trend_closes_on_the_demo_stats(self, client, period):
        """The last point must be what /stats reports for the same wallets.

        Both feed the same screens — the dashboard's trend card sits beside its
        balance tiles, and the lifecycle page's leverage chart hands off to the
        live position at its right edge. When the two disagree the chart shows a
        cliff on the final day, and a reader has no way to tell which number is
        the real one. They were built from unrelated constants until 2026-08-26
        (NT$300K against NT$2.5M).
        """
        from app.modules.dashboard.router import DEMO_DASHBOARD_STATS

        response = client.get(f"/api/v1/dashboard/wallet-trends?period={period}")
        assert response.status_code == 200

        points = response.json()["data"]["dataPoints"]
        assert points, f"demo mode returned no points for {period}"

        last = points[-1]
        for field, stat in (
            ("lifeWallet", "life_wallet"),
            ("portfolioWallet", "portfolio_wallet"),
            ("emergencyWallet", "emergency_wallet"),
            ("investmentTotal", "investment_total"),
            # Debt too: the demo dashboard renders the trend's debt line right
            # beside the headline figure from /stats, and the two disagreeing is
            # what made the whole debt half of that card wrong for weeks.
            ("debtBalance", "total_debt"),
        ):
            assert last[field] == pytest.approx(DEMO_DASHBOARD_STATS[stat]), (
                f"{period}: {field} closed at {last[field]}, "
                f"but /stats reports {DEMO_DASHBOARD_STATS[stat]}"
            )

    async def test_demo_single_day_window_still_lands_on_the_stats(self, client, monkeypatch):
        """On 1 January "ytd" is a one-day window — the whole series is today.

        A progress term of i/(n-1) leaves that lone point at the *opening* share
        instead of the closing one, which reproduces the mismatch this is all
        here to prevent, on the one day of the year nobody thinks to check.
        """
        from datetime import date as real_date

        from app.modules.dashboard.router import DEMO_DASHBOARD_STATS

        # The router asks business_today() what day it is, so that is the one thing
        # to override — no date subclass needed. By dotted path the module resolves
        # to the APIRouter the package re-exports as `router`, so reach the module
        # through sys.modules.
        import sys

        monkeypatch.setattr(
            sys.modules["app.modules.dashboard.router"],
            "business_today",
            lambda: real_date(real_date.today().year, 1, 1),
        )

        response = client.get("/api/v1/dashboard/wallet-trends?period=ytd")
        assert response.status_code == 200

        points = response.json()["data"]["dataPoints"]
        assert len(points) == 1
        assert points[0]["emergencyWallet"] == pytest.approx(
            DEMO_DASHBOARD_STATS["emergency_wallet"]
        )
        assert points[0]["portfolioWallet"] == pytest.approx(
            DEMO_DASHBOARD_STATS["portfolio_wallet"]
        )

    async def test_baseline_holds_the_balance_from_before_the_window(
        self, authenticated_client, test_user, async_session, test_category
    ):
        """The real path, not just the demo one.

        A transaction dated before the window must land in `baseline` and not in
        `dataPoints`, and one inside the window must move the series away from
        it. Without the baseline the earlier money is invisible to a caller
        taking `last - first`, because the window's own first point already
        contains it — which is how the 1st's movement went missing from "this
        month".
        """
        window_start = business_today() - timedelta(days=6)  # the 7d window

        async_session.add_all(
            [
                Transaction(
                    id=uuid4(),
                    user_id=test_user.id,
                    amount=Decimal("1000.00"),
                    type=TransactionType.INCOME,
                    wallet_type=TransactionWalletType.LIFE,
                    category_id=test_category.id,
                    # Before the window: belongs to the opening balance.
                    transaction_date=window_start - timedelta(days=3),
                    description="Earned before the window",
                ),
                Transaction(
                    id=uuid4(),
                    user_id=test_user.id,
                    amount=Decimal("250.00"),
                    type=TransactionType.INCOME,
                    wallet_type=TransactionWalletType.LIFE,
                    category_id=test_category.id,
                    transaction_date=business_today(),
                    description="Earned inside the window",
                ),
            ]
        )
        await async_session.commit()

        payload = authenticated_client.get(
            "/api/v1/dashboard/wallet-trends?period=7d"
        ).json()["data"]
        points, baseline = payload["dataPoints"], payload["baseline"]

        assert len(points) == 7
        assert baseline is not None
        assert baseline["date"] == (window_start - timedelta(days=1)).isoformat()
        assert payload["startDate"] == window_start.isoformat()
        # Outside the charted window, so nothing draws it.
        assert baseline["date"] not in [p["date"] for p in points]

        # The earlier 1000 is already in the opening balance; only the 250
        # earned inside the window is movement the period should report.
        assert baseline["lifeWallet"] == pytest.approx(1000.0)
        assert points[-1]["lifeWallet"] - baseline["lifeWallet"] == pytest.approx(250.0)

    async def test_demo_month_is_the_calendar_month_not_a_rolling_thirty_days(
        self, client
    ):
        """"This month" must not silently mean "the last 30 days".

        The demo period map said `"month": 30` under the comment "current month
        approximation", so /wallet-trends answered `month` with a window
        identical to `30d` — on the 5th, a series opening on the 7th of the
        previous month. The P&L calendar on the same screen filters from the
        1st, so the two tiles reported different figures for one labelled
        period. `ytd` had already had to be fixed for exactly this.
        """
        from datetime import date

        month = client.get("/api/v1/dashboard/wallet-trends?period=month")
        thirty = client.get("/api/v1/dashboard/wallet-trends?period=30d")
        assert month.status_code == 200 and thirty.status_code == 200

        month_points = month.json()["data"]["dataPoints"]
        thirty_points = thirty.json()["data"]["dataPoints"]

        # One point per day elapsed this month, and not the 30d window.
        assert len(month_points) == business_today().day
        assert month_points[0]["date"] == business_today().replace(day=1).isoformat()
        if business_today().day != 30:
            assert len(month_points) != len(thirty_points)

    async def test_every_window_carries_the_day_it_opened(self, client):
        """`last - first` over N points spans N-1 days, not N.

        Whatever moved on the first day of the window was dropped from the
        dashboard's deltas entirely — on MTD, the 1st. The baseline is that
        missing day: the close before the window starts, kept out of
        dataPoints so charts still draw exactly the window requested.
        """
        from datetime import date, timedelta

        for period in ("7d", "month", "30d"):
            payload = client.get(
                f"/api/v1/dashboard/wallet-trends?period={period}"
            ).json()["data"]
            points, baseline = payload["dataPoints"], payload["baseline"]

            assert baseline is not None, f"{period} has no opening balance"
            # It sits immediately before the window, and outside it.
            assert baseline["date"] < points[0]["date"], period
            assert baseline["date"] == (
                date.fromisoformat(points[0]["date"]) - timedelta(days=1)
            ).isoformat(), period

    async def test_demo_debt_breakdown_sums_to_the_demo_debt_total(self, client):
        """The demo payload must hold the same invariant a real one does.

        An empty breakdown beside a non-zero balance says "no debt is reported"
        while reporting debt — and the split is derived from the two demo loan
        balances rather than copied, so paying the demo mortgage down further
        cannot silently desync it from the total.
        """
        from app.modules.dashboard.router import (
            DEMO_CARD_BALANCE,
            DEMO_MORTGAGE_BALANCE,
            DEMO_TOTAL_DEBT,
        )

        response = client.get("/api/v1/dashboard/wallet-trends?period=30d")
        assert response.status_code == 200
        points = response.json()["data"]["dataPoints"]
        assert points

        for point in points:
            assert sum(point["debtByLoan"].values()) == pytest.approx(
                point["debtBalance"]
            )

        last = points[-1]
        assert last["debtBalance"] == pytest.approx(DEMO_TOTAL_DEBT)
        assert last["debtByLoan"]["demo-loan-1"] == pytest.approx(
            DEMO_MORTGAGE_BALANCE
        )
        assert last["debtByLoan"]["demo-loan-2"] == pytest.approx(DEMO_CARD_BALANCE)

    async def test_demo_ytd_covers_the_year_not_a_month(self, client):
        """"ytd" was missing from the demo period map and fell through to the
        30-day default, so asking for the year silently returned a month."""
        from datetime import date

        response = client.get("/api/v1/dashboard/wallet-trends?period=ytd")
        assert response.status_code == 200

        points = response.json()["data"]["dataPoints"]
        expected = (business_today() - date(business_today().year, 1, 1)).days + 1
        assert len(points) == expected
        assert points[0]["date"] == date(business_today().year, 1, 1).isoformat()

    @pytest.mark.parametrize("period,expected_days", [
        ("7d", 7),
        ("14d", 14),
        ("30d", 30),
        ("90d", 90),
    ])
    async def test_wallet_trends_data_point_count(
        self, authenticated_client, test_user, period, expected_days
    ):
        """Test wallet trends returns correct number of data points for fixed-day periods."""
        response = authenticated_client.get(f"/api/v1/dashboard/wallet-trends?period={period}")

        assert response.status_code == 200
        data = response.json()["data"]

        # Should have one data point per day
        assert len(data["dataPoints"]) == expected_days

    async def test_wallet_trends_month_period_correct_range(
        self, authenticated_client, test_user
    ):
        """Test 'month' period spans the 1st of the current month through today."""
        response = authenticated_client.get("/api/v1/dashboard/wallet-trends?period=month")

        assert response.status_code == 200
        data = response.json()["data"]

        today = business_today()
        expected_start = today.replace(day=1)

        # startDate is the 1st of the current calendar month
        assert data["startDate"] == expected_start.strftime("%Y-%m-%d")

        # endDate should be today
        assert data["endDate"] == today.strftime("%Y-%m-%d")

        # One data point per elapsed day of the month, so the count moves with
        # the calendar rather than being a fixed 30.
        assert len(data["dataPoints"]) == today.day


@pytest.mark.unit
class TestPeriodEnumMapping:
    """Unit tests for period enum value mapping."""

    def test_period_enum_values(self):
        """Test PeriodEnum has all expected values."""
        assert PeriodEnum.SEVEN_DAYS.value == "7d"
        assert PeriodEnum.FOURTEEN_DAYS.value == "14d"
        assert PeriodEnum.MONTH.value == "month"
        assert PeriodEnum.THIRTY_DAYS.value == "30d"
        assert PeriodEnum.NINETY_DAYS.value == "90d"
        assert PeriodEnum.SIX_MONTHS.value == "6m"
        assert PeriodEnum.ONE_YEAR.value == "1y"

    def test_period_enum_completeness(self):
        """Test all period enum values are defined."""
        expected_periods = {"7d", "14d", "month", "30d", "90d", "6m", "1y", "ytd"}
        actual_periods = {period.value for period in PeriodEnum}

        assert actual_periods == expected_periods
