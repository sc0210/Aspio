"""
Unit tests for DashboardService.
Pure methods are tested directly; methods with DB access are tested with mocked repos.
"""

import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

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


# ─── DashboardService.get_recent_activity ────────────────────────────────────


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
