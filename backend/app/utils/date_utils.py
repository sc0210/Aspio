"""
Shared date range utilities for consistent date filtering across the application.

This module provides standardized date range calculations to ensure
dashboard stats and transaction filters use the same date logic.
"""

from datetime import date, timedelta
from typing import Tuple
from enum import Enum
from app.utils.datetime_helpers import business_today


class DateRangePeriod(str, Enum):
    """Standardized date range periods"""
    TODAY = "today"
    YESTERDAY = "yesterday"
    THIS_WEEK = "this_week"
    THIS_MONTH = "this_month"
    LAST_7_DAYS = "7d"
    LAST_30_DAYS = "30d"
    LAST_90_DAYS = "90d"
    LAST_6_MONTHS = "6m"
    LAST_YEAR = "1y"
    THIS_YEAR = "this_year"
    CUSTOM = "custom"


class DateRangeCalculator:
    """
    Centralized date range calculations for consistent filtering across
    dashboard, transactions, budgets, and other modules.
    """

    @staticmethod
    def get_current_month() -> Tuple[date, date]:
        """
        Get the start and end date of the current calendar month (up to today).

        Returns:
            Tuple of (start_date, end_date) for current month

        Example:
            For March 15, 2025: (2025-03-01, 2025-03-15)
            This returns from the 1st of the month to TODAY, not the last day.
        """
        today = business_today()
        start_date = date(today.year, today.month, 1)
        end_date = today  # End at today, not the last day of the month

        return start_date, end_date

    @staticmethod
    def get_last_n_days(n: int) -> Tuple[date, date]:
        """
        Get date range for the last N days (including today).

        Args:
            n: Number of days to look back

        Returns:
            Tuple of (start_date, end_date)

        Example:
            get_last_n_days(30) on 2025-03-15 returns:
            (2025-02-13, 2025-03-15)
        """
        today = business_today()
        start_date = today - timedelta(days=n - 1)  # -1 to include today
        return start_date, today

    @staticmethod
    def get_current_week() -> Tuple[date, date]:
        """
        Get the start and end date of the current week (Monday-Sunday).

        Returns:
            Tuple of (start_date, end_date) for current week
        """
        today = business_today()
        # Monday is 0, Sunday is 6
        days_since_monday = today.weekday()
        start_date = today - timedelta(days=days_since_monday)
        end_date = start_date + timedelta(days=6)
        return start_date, end_date

    @staticmethod
    def get_current_year() -> Tuple[date, date]:
        """
        Get the year-to-date range: Jan 1 of the current year through today.

        Returns:
            Tuple of (start_date, end_date) for current year to date
        """
        today = business_today()
        start_date = date(today.year, 1, 1)
        return start_date, today

    @staticmethod
    def get_today() -> Tuple[date, date]:
        """Get today's date as both start and end"""
        today = business_today()
        return today, today

    @staticmethod
    def get_yesterday() -> Tuple[date, date]:
        """Get yesterday's date as both start and end"""
        yesterday = business_today() - timedelta(days=1)
        return yesterday, yesterday

    @staticmethod
    def get_last_6_months() -> Tuple[date, date]:
        """Get date range for the last 6 months"""
        today = business_today()
        # Go back 6 months
        if today.month > 6:
            start_date = date(today.year, today.month - 6, 1)
        else:
            start_date = date(today.year - 1, today.month + 6, 1)
        return start_date, today

    @staticmethod
    def get_range_for_dashboard_period(period: str) -> Tuple[date, date]:
        """
        Resolve a dashboard PeriodEnum value ("7d", "14d", "month", "30d",
        "90d", "6m", "1y", "ytd") to a (start_date, end_date) range.

        This is the single source of truth for that vocabulary — every
        endpoint that accepts a dashboard period string (stats,
        spending-by-category, income-by-category, wallet-trends, ...) must
        call this instead of hand-rolling its own period→date-range mapping.
        A prior duplication bug: /income-by-category and
        /spending-by-category each re-implemented this with only
        7d/30d/90d/6m/1y support, silently treating "month" (the dashboard's
        default period) as a rolling 30-day window instead of the calendar
        month /dashboard/stats uses for the same selector — so the "top
        income" list and the income total disagreed for most users on first
        load.

        Unrecognized values fall back to the last 30 days, matching the
        historical default of the endpoints being consolidated onto this.
        """
        if period == "7d":
            return DateRangeCalculator.get_last_n_days(7)
        elif period == "14d":
            return DateRangeCalculator.get_last_n_days(14)
        elif period == "month":
            return DateRangeCalculator.get_current_month()
        elif period == "30d":
            return DateRangeCalculator.get_last_n_days(30)
        elif period == "90d":
            return DateRangeCalculator.get_last_n_days(90)
        elif period == "6m":
            return DateRangeCalculator.get_last_6_months()
        elif period == "1y":
            return DateRangeCalculator.get_last_n_days(365)
        elif period == "ytd":
            return DateRangeCalculator.get_current_year()
        else:
            return DateRangeCalculator.get_last_n_days(30)

    @staticmethod
    def get_date_range(period: DateRangePeriod) -> Tuple[date, date]:
        """
        Get date range for a standardized period.

        Args:
            period: DateRangePeriod enum value

        Returns:
            Tuple of (start_date, end_date)

        Example:
            get_date_range(DateRangePeriod.THIS_MONTH) returns current month range
            get_date_range(DateRangePeriod.LAST_30_DAYS) returns last 30 days
        """
        if period == DateRangePeriod.TODAY:
            return DateRangeCalculator.get_today()
        elif period == DateRangePeriod.YESTERDAY:
            return DateRangeCalculator.get_yesterday()
        elif period == DateRangePeriod.THIS_WEEK:
            return DateRangeCalculator.get_current_week()
        elif period == DateRangePeriod.THIS_MONTH:
            return DateRangeCalculator.get_current_month()
        elif period == DateRangePeriod.LAST_7_DAYS:
            return DateRangeCalculator.get_last_n_days(7)
        elif period == DateRangePeriod.LAST_30_DAYS:
            return DateRangeCalculator.get_last_n_days(30)
        elif period == DateRangePeriod.LAST_90_DAYS:
            return DateRangeCalculator.get_last_n_days(90)
        elif period == DateRangePeriod.LAST_6_MONTHS:
            return DateRangeCalculator.get_last_6_months()
        elif period == DateRangePeriod.LAST_YEAR:
            return DateRangeCalculator.get_last_n_days(365)
        elif period == DateRangePeriod.THIS_YEAR:
            return DateRangeCalculator.get_current_year()
        else:
            # Default to current month
            return DateRangeCalculator.get_current_month()

