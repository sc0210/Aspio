"""
Unit tests for DashboardService.
Pure methods are tested directly; methods with DB access are tested with mocked repos.
"""

import pytest
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.modules.dashboard.services import DashboardService
from app.modules.dashboard.schemas import PeriodEnum
from app.utils.datetime_helpers import business_today


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_service(db=None):
    """Create a DashboardService with all dependencies mocked."""
    mock_db = db or MagicMock()
    with (
        patch("app.modules.dashboard.services.TransactionRepository"),
        patch("app.modules.dashboard.services.TransactionCategoryRepository"),
        patch("app.modules.dashboard.services.PortfolioRepository"),
        patch("app.modules.dashboard.services.UserRepository"),
    ):
        svc = DashboardService(mock_db)

    # Replace the auto-created mocks with fresh AsyncMock instances
    svc.transaction_repo = MagicMock()
    svc.category_repo = MagicMock()
    svc.portfolio_repo = MagicMock()
    svc.user_repo = MagicMock()
    return svc


# ─── DashboardService._get_relative_time ─────────────────────────────────────

class TestGetRelativeTime:
    """Tests for the pure _get_relative_time helper."""

    def setup_method(self):
        self.svc = make_service()

    def test_today(self):
        assert self.svc._get_relative_time(business_today()) == "Today"

    def test_yesterday(self):
        assert self.svc._get_relative_time(business_today() - timedelta(days=1)) == "Yesterday"

    def test_3_days_ago(self):
        assert self.svc._get_relative_time(business_today() - timedelta(days=3)) == "3 days ago"

    def test_6_days_ago(self):
        assert self.svc._get_relative_time(business_today() - timedelta(days=6)) == "6 days ago"

    def test_1_week_ago(self):
        result = self.svc._get_relative_time(business_today() - timedelta(days=7))
        assert result == "1 week ago"

    def test_2_weeks_ago(self):
        result = self.svc._get_relative_time(business_today() - timedelta(days=14))
        assert result == "2 weeks ago"

    def test_1_month_ago(self):
        result = self.svc._get_relative_time(business_today() - timedelta(days=30))
        assert result == "1 month ago"

    def test_3_months_ago(self):
        result = self.svc._get_relative_time(business_today() - timedelta(days=90))
        assert result == "3 months ago"

    def test_1_year_ago(self):
        result = self.svc._get_relative_time(business_today() - timedelta(days=365))
        assert result == "1 year ago"

    def test_2_years_ago(self):
        result = self.svc._get_relative_time(business_today() - timedelta(days=730))
        assert result == "2 years ago"


# ─── DashboardService._period_to_months ──────────────────────────────────────

# ─── DashboardService._get_date_range ────────────────────────────────────────

class TestGetDateRange:

    def setup_method(self):
        self.svc = make_service()

    def test_seven_days_range(self):
        date_from, date_to = self.svc._get_date_range(PeriodEnum.SEVEN_DAYS)
        today = business_today()
        assert date_to == today
        assert (today - date_from).days >= 6

    def test_thirty_days_range(self):
        date_from, date_to = self.svc._get_date_range(PeriodEnum.THIRTY_DAYS)
        today = business_today()
        assert date_to == today
        assert (today - date_from).days >= 29

    def test_month_range_starts_on_first(self):
        date_from, date_to = self.svc._get_date_range(PeriodEnum.MONTH)
        today = business_today()
        assert date_from.day == 1
        assert date_from.month == today.month
        assert date_from.year == today.year

    def test_ninety_days_range(self):
        date_from, date_to = self.svc._get_date_range(PeriodEnum.NINETY_DAYS)
        today = business_today()
        assert date_to == today
        assert (today - date_from).days >= 89


# ─── DashboardService.get_spending_by_category ───────────────────────────────

class TestGetSpendingByCategory:

    @pytest.mark.asyncio
    async def test_fetches_from_repo_on_cache_miss(self):
        svc = make_service()

        breakdown = [
            {
                "category_name": "Food & Dining",
                "amount": Decimal("300"),
                "percentage": 60.0,
                "transaction_count": 10,
                "currency": "USD",
            },
            {
                "category_name": "Transportation",
                "amount": Decimal("200"),
                "percentage": 40.0,
                "transaction_count": 5,
                "currency": "USD",
            },
        ]
        svc.transaction_repo.get_category_breakdown = AsyncMock(return_value=breakdown)

        result = await svc.get_spending_by_category("user-id", PeriodEnum.THIRTY_DAYS)

        assert len(result.categories) == 2
        assert result.total_amount == Decimal("500")

    @pytest.mark.asyncio
    async def test_returns_empty_on_repo_error(self):
        svc = make_service()
        svc.transaction_repo.get_category_breakdown = AsyncMock(
            side_effect=Exception("DB error")
        )

        result = await svc.get_spending_by_category("user-id")

        assert result.categories == []
        assert result.total_amount == Decimal("0")

    @pytest.mark.asyncio
    async def test_uses_correct_color_for_known_category(self):
        svc = make_service()

        breakdown = [
            {
                "category_name": "Food & Dining",
                "amount": Decimal("100"),
                "percentage": 100.0,
                "transaction_count": 3,
                "currency": "USD",
            }
        ]
        svc.transaction_repo.get_category_breakdown = AsyncMock(return_value=breakdown)

        result = await svc.get_spending_by_category("user-id")

        assert result.categories[0].color == "#FF6B6B"  # predefined color

    @pytest.mark.asyncio
    async def test_uses_default_color_for_unknown_category(self):
        svc = make_service()

        breakdown = [
            {
                "category_name": "Unknown Custom Category",
                "amount": Decimal("50"),
                "percentage": 100.0,
                "transaction_count": 1,
                "currency": "USD",
            }
        ]
        svc.transaction_repo.get_category_breakdown = AsyncMock(return_value=breakdown)

        result = await svc.get_spending_by_category("user-id")

        assert result.categories[0].color == "#6B7280"  # default grey


# ─── DashboardService.get_recent_activity ────────────────────────────────────

class TestGetRecentActivity:

    def _make_tx(self, desc="Coffee", amount=Decimal("10"), days_ago=0):
        tx = MagicMock()
        tx.id = uuid4()
        tx.description = desc
        tx.amount = amount
        tx.currency = "USD"
        tx.type = MagicMock()
        tx.type.value = "expense"
        tx.category_obj = None
        tx.transaction_date = business_today() - timedelta(days=days_ago)
        tx.created_at = datetime.now(timezone.utc)
        return tx

    @pytest.mark.asyncio
    async def test_fetches_from_repo_on_cache_miss(self):
        svc = make_service()

        txs = [self._make_tx("Coffee", Decimal("5"), 0)]
        svc.transaction_repo.get_all = AsyncMock(return_value=(txs, 1))

        result = await svc.get_recent_activity("user-id", limit=10)

        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_returns_empty_on_repo_error(self):
        svc = make_service()
        svc.transaction_repo.get_all = AsyncMock(side_effect=Exception("DB error"))

        result = await svc.get_recent_activity("user-id")

        assert result == []

    @pytest.mark.asyncio
    async def test_relative_time_shown_correctly(self):
        svc = make_service()

        txs = [
            self._make_tx("Today's coffee", days_ago=0),
            self._make_tx("Yesterday's lunch", days_ago=1),
            self._make_tx("Last week's dinner", days_ago=8),
        ]
        svc.transaction_repo.get_all = AsyncMock(return_value=(txs, 3))

        result = await svc.get_recent_activity("user-id")

        times = [r.time for r in result]
        assert "Today" in times
        assert "Yesterday" in times
        assert any("week" in t for t in times)


# ─── DashboardService.get_monthly_trends ─────────────────────────────────────

class TestGetMonthlyTrends:

    @pytest.mark.asyncio
    async def test_fetches_from_repo_on_cache_miss(self):
        svc = make_service()

        trends = [
            {
                "month": "2026-01",
                "income": Decimal("2000"),
                "expenses": Decimal("1500"),
                "net_amount": Decimal("500"),
                "transaction_count": 15,
            },
            {
                "month": "2026-02",
                "income": Decimal("2100"),
                "expenses": Decimal("1400"),
                "net_amount": Decimal("700"),
                "transaction_count": 18,
            },
        ]
        svc.transaction_repo.get_monthly_trends = AsyncMock(return_value=trends)

        result = await svc.get_monthly_trends("user-id", months=6)

        assert len(result.trends) == 2
        assert result.trends[0].income == Decimal("2000")

    @pytest.mark.asyncio
    async def test_returns_empty_on_repo_error(self):
        svc = make_service()
        svc.transaction_repo.get_monthly_trends = AsyncMock(
            side_effect=Exception("DB error")
        )

        result = await svc.get_monthly_trends("user-id")
        assert result.trends == []


# ─── DashboardService.invalidate_user_cache ──────────────────────────────────

# ─── DashboardService._get_goals_summary ─────────────────────────────────────

class TestGetGoalsSummary:

    @pytest.mark.asyncio
    async def test_returns_goals_stub(self):
        svc = make_service()
        result = await svc._get_goals_summary("user-id")
        # Goals module removed; returns stub with zero values
        assert result["active_goals"] == 0
        assert result["completed_goals"] == 0
        assert result["total_target"] == Decimal("0")
        assert result["total_current"] == Decimal("0")


class TestEmergencyFundMonthsScaling:
    """The window has to be measured before dividing.

    A static period→months table listed three of the eight periods the selector
    offers and defaulted the rest to one month, so the same fund and the same
    spending rate read six times shorter on 6M than on 30D — the number moved
    when only the selector had. The window is now derived from the same date
    range that selected the expenses, so no period can be missing from it.
    """

    FUND = Decimal("560000")
    PER_MONTH = Decimal("100000")

    @staticmethod
    def _inclusive_days(date_from, date_to) -> int:
        """Days in a range whose ends are both inclusive.

        Stated once, here, and anchored against a real calendar by
        `test_windows_resolve_to_the_days_a_calendar_would_count` below — an
        earlier version of these tests re-derived the span exactly as the code
        did, so an off-by-one cancelled between numerator and denominator and
        every assertion passed while the window ran a day short.
        """
        return (date_to - date_from).days + 1

    def _months_for(self, period):
        """Cover reported for one steady 100k/month rate over `period`."""
        service = make_service()
        date_from, date_to = service._get_date_range(period)
        days = self._inclusive_days(date_from, date_to)
        spend = self.PER_MONTH * Decimal(days) / Decimal("30")
        return service._calc_emergency_fund_months(self.FUND, spend, period)

    @pytest.mark.unit
    @pytest.mark.parametrize("period", list(PeriodEnum))
    def test_one_spend_rate_reads_the_same_in_every_window(self, period):
        # Every period the enum defines, so a new one cannot be forgotten.
        assert self._months_for(period) == pytest.approx(5.6, abs=0.05)

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "period,expected_from,expected_days",
        [
            # Counted off a calendar by hand, not derived from the code: on the
            # 15th, month-to-date is the 1st through the 15th, which is fifteen
            # days — the span the previous version divided by fourteen.
            (PeriodEnum.MONTH, date(2026, 8, 1), 15),
            (PeriodEnum.SEVEN_DAYS, date(2026, 8, 9), 7),
            (PeriodEnum.THIRTY_DAYS, date(2026, 7, 17), 30),
            (PeriodEnum.YEAR_TO_DATE, date(2026, 1, 1), 227),
        ],
    )
    def test_windows_resolve_to_the_days_a_calendar_would_count(
        self, period, expected_from, expected_days
    ):
        service = make_service()
        # Patch only "what day is it", not the date class. The old form replaced
        # `date` wholesale and needed a side_effect to keep `date(y, m, 1)` working;
        # business_today() is the single seam now, so the construction is left alone.
        with patch("app.utils.date_utils.business_today", return_value=date(2026, 8, 15)):
            date_from, date_to = service._get_date_range(period)
            assert (date_from, date_to) == (expected_from, date(2026, 8, 15))
            assert self._inclusive_days(date_from, date_to) == expected_days

            # And the cover reported for a steady 100k/month over that many days
            # is 5.6 — computed here from the hand-counted span, so a wrong
            # divisor in the service cannot cancel out.
            spend = self.PER_MONTH * Decimal(expected_days) / Decimal(30)
            assert service._calc_emergency_fund_months(
                self.FUND, spend, period
            ) == pytest.approx(5.6, abs=0.05)

    @pytest.mark.unit
    def test_no_spending_reports_zero_rather_than_dividing(self):
        service = make_service()
        assert service._calc_emergency_fund_months(
            self.FUND, Decimal("0"), PeriodEnum.THIRTY_DAYS
        ) == 0.0
