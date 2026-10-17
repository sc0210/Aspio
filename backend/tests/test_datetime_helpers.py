"""
Unit tests for datetime_helpers.py — pure functions, no DB required.
"""

import pytest
from datetime import datetime, timezone, timedelta
import pytz

from app.utils.datetime_helpers import (
    utc_now,
    to_utc,
    from_utc,
    start_of_day,
    end_of_day,
    start_of_month,
    end_of_month,
    start_of_year,
    end_of_year,
    days_between,
    months_between,
    add_months,
    format_datetime,
    parse_datetime,
    is_weekend,
    is_business_day,
    next_business_day,
    previous_business_day,
    get_asian_timezone,
    format_for_region,
    ASIAN_TIMEZONES,
)


# ── utc_now ───────────────────────────────────────────────────────────────────

class TestUtcNow:
    def test_returns_utc(self):
        now = utc_now()
        assert now.tzinfo is not None
        assert now.utcoffset() == timedelta(0)

    def test_close_to_real_now(self):
        now = utc_now()
        real_now = datetime.now(timezone.utc)
        assert abs((real_now - now).total_seconds()) < 1


# ── to_utc ────────────────────────────────────────────────────────────────────

class TestToUtc:
    def test_naive_treated_as_utc(self):
        naive = datetime(2024, 6, 15, 12, 0, 0)
        result = to_utc(naive)
        assert result.tzinfo == timezone.utc
        assert result.hour == 12

    def test_tz_aware_converted(self):
        sg = pytz.timezone("Asia/Singapore")
        dt_sg = sg.localize(datetime(2024, 6, 15, 20, 0, 0))
        result = to_utc(dt_sg)
        assert result.utcoffset() == timedelta(0)
        assert result.hour == 12  # SGT is UTC+8


# ── from_utc ──────────────────────────────────────────────────────────────────

class TestFromUtc:
    def test_utc_to_singapore(self):
        utc = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        sg = from_utc(utc, "Asia/Singapore")
        assert sg.hour == 20

    def test_naive_utc_assumed(self):
        naive = datetime(2024, 6, 15, 0, 0, 0)
        result = from_utc(naive, "Asia/Singapore")
        assert result.hour == 8


# ── start/end of day ──────────────────────────────────────────────────────────

class TestDayBoundaries:
    def test_start_of_day(self):
        dt = datetime(2024, 3, 15, 14, 30, 45, 123456)
        result = start_of_day(dt)
        assert result == datetime(2024, 3, 15, 0, 0, 0, 0)

    def test_end_of_day(self):
        dt = datetime(2024, 3, 15, 8, 0, 0)
        result = end_of_day(dt)
        assert result == datetime(2024, 3, 15, 23, 59, 59, 999999)

    def test_start_of_day_with_tz(self):
        utc = datetime(2024, 6, 15, 20, 0, 0, tzinfo=timezone.utc)
        result = start_of_day(utc, "Asia/Singapore")
        # SGT is UTC+8, so 20:00 UTC = 04:00 next day SGT → start of that day
        assert result.hour == 0
        assert result.minute == 0


# ── start/end of month ────────────────────────────────────────────────────────

class TestMonthBoundaries:
    def test_start_of_month(self):
        dt = datetime(2024, 6, 15, 14, 30)
        result = start_of_month(dt)
        assert result == datetime(2024, 6, 1, 0, 0, 0, 0)

    def test_end_of_month_regular(self):
        dt = datetime(2024, 6, 15)
        result = end_of_month(dt)
        assert result.month == 6
        assert result.day == 30
        assert result.hour == 23
        assert result.microsecond == 999999

    def test_end_of_month_december(self):
        dt = datetime(2024, 12, 15)
        result = end_of_month(dt)
        assert result.year == 2024
        assert result.month == 12
        assert result.day == 31

    def test_end_of_month_february_leap(self):
        dt = datetime(2024, 2, 1)  # 2024 is a leap year
        result = end_of_month(dt)
        assert result.day == 29

    def test_end_of_month_february_non_leap(self):
        dt = datetime(2023, 2, 1)
        result = end_of_month(dt)
        assert result.day == 28


# ── start/end of year ─────────────────────────────────────────────────────────

class TestYearBoundaries:
    def test_start_of_year(self):
        dt = datetime(2024, 8, 20, 14, 30)
        result = start_of_year(dt)
        assert result == datetime(2024, 1, 1, 0, 0, 0, 0)

    def test_end_of_year(self):
        dt = datetime(2024, 3, 15)
        result = end_of_year(dt)
        assert result == datetime(2024, 12, 31, 23, 59, 59, 999999)


# ── days_between / months_between ─────────────────────────────────────────────

class TestBetweenCalculations:
    def test_days_between(self):
        start = datetime(2024, 1, 1)
        end = datetime(2024, 1, 31)
        assert days_between(start, end) == 30

    def test_days_between_same_day(self):
        dt = datetime(2024, 6, 15)
        assert days_between(dt, dt) == 0

    def test_months_between_same_month(self):
        start = datetime(2024, 6, 1)
        end = datetime(2024, 6, 30)
        assert months_between(start, end) == 0

    def test_months_between_year_span(self):
        start = datetime(2023, 11, 1)
        end = datetime(2024, 3, 1)
        assert months_between(start, end) == 4

    def test_months_between_exact_year(self):
        start = datetime(2023, 1, 1)
        end = datetime(2024, 1, 1)
        assert months_between(start, end) == 12


# ── add_months ────────────────────────────────────────────────────────────────

class TestAddMonths:
    def test_add_one_month(self):
        dt = datetime(2024, 1, 15)
        result = add_months(dt, 1)
        assert result.month == 2
        assert result.day == 15

    def test_add_month_clamps_to_month_end(self):
        dt = datetime(2024, 1, 31)
        result = add_months(dt, 1)
        assert result.month == 2
        assert result.day == 29  # 2024 is leap year

    def test_add_months_crosses_year(self):
        dt = datetime(2024, 11, 15)
        result = add_months(dt, 3)
        assert result.year == 2025
        assert result.month == 2

    def test_add_zero_months(self):
        dt = datetime(2024, 6, 15)
        result = add_months(dt, 0)
        assert result == dt


# ── format_datetime ───────────────────────────────────────────────────────────

class TestFormatDatetime:
    def _dt(self):
        return datetime(2024, 6, 15, 14, 30, 45, 123456)

    def test_iso(self):
        result = format_datetime(self._dt(), "iso")
        assert "2024-06-15" in result

    def test_api(self):
        result = format_datetime(self._dt(), "api")
        assert result.endswith("Z")
        assert "2024-06-15" in result

    def test_date_only(self):
        assert format_datetime(self._dt(), "date") == "2024-06-15"

    def test_time_only(self):
        assert format_datetime(self._dt(), "time") == "14:30:45"

    def test_human(self):
        result = format_datetime(self._dt(), "human")
        assert "June" in result
        assert "2024" in result

    def test_asian(self):
        result = format_datetime(self._dt(), "asian")
        assert "年" in result
        assert "月" in result
        assert "日" in result

    def test_unknown_format_falls_back_to_iso(self):
        result = format_datetime(self._dt(), "unknown")
        assert "2024" in result


# ── parse_datetime ────────────────────────────────────────────────────────────

class TestParseDatetime:
    def test_iso_with_microseconds_and_z(self):
        dt = parse_datetime("2024-06-15T14:30:45.123456Z")
        assert dt.year == 2024
        assert dt.hour == 14

    def test_iso_without_z(self):
        dt = parse_datetime("2024-06-15T14:30:45")
        assert dt.day == 15

    def test_date_only(self):
        dt = parse_datetime("2024-06-15")
        assert dt.month == 6

    def test_with_timezone(self):
        dt = parse_datetime("2024-06-15T00:00:00", tz="Asia/Singapore")
        assert dt.tzinfo is not None

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            parse_datetime("not-a-date")

    def test_space_separated(self):
        dt = parse_datetime("2024-06-15 14:30:00")
        assert dt.hour == 14


# ── is_weekend / is_business_day ─────────────────────────────────────────────

class TestWeekendBusinessDay:
    # 2024-06-15 is Saturday
    def test_saturday_is_weekend(self):
        assert is_weekend(datetime(2024, 6, 15)) is True

    def test_sunday_is_weekend(self):
        assert is_weekend(datetime(2024, 6, 16)) is True

    def test_monday_is_not_weekend(self):
        assert is_weekend(datetime(2024, 6, 17)) is False

    def test_friday_is_business_day(self):
        assert is_business_day(datetime(2024, 6, 14)) is True

    def test_saturday_not_business_day(self):
        assert is_business_day(datetime(2024, 6, 15)) is False


# ── next/previous business day ────────────────────────────────────────────────

class TestNextPrevBusinessDay:
    def test_next_from_friday(self):
        # Friday 2024-06-14 → Monday 2024-06-17
        result = next_business_day(datetime(2024, 6, 14))
        assert result.weekday() == 0  # Monday
        assert result.day == 17

    def test_next_from_saturday(self):
        # Saturday → Monday
        result = next_business_day(datetime(2024, 6, 15))
        assert result.weekday() == 0

    def test_next_from_sunday(self):
        result = next_business_day(datetime(2024, 6, 16))
        assert result.weekday() == 0

    def test_previous_from_monday(self):
        # Monday 2024-06-17 → Friday 2024-06-14
        result = previous_business_day(datetime(2024, 6, 17))
        assert result.weekday() == 4  # Friday

    def test_previous_from_sunday(self):
        result = previous_business_day(datetime(2024, 6, 16))
        assert result.weekday() == 4


# ── get_asian_timezone ────────────────────────────────────────────────────────

class TestGetAsianTimezone:
    def test_singapore(self):
        assert get_asian_timezone("singapore") == "Asia/Singapore"

    def test_case_insensitive(self):
        assert get_asian_timezone("JAPAN") == "Asia/Tokyo"

    def test_unknown_returns_utc(self):
        assert get_asian_timezone("atlantis") == "UTC"

    def test_all_countries_covered(self):
        for country, tz in ASIAN_TIMEZONES.items():
            assert get_asian_timezone(country) == tz


# ── format_for_region ─────────────────────────────────────────────────────────

class TestFormatForRegion:
    def _dt(self):
        return datetime(2024, 6, 15)

    def test_western(self):
        result = format_for_region(self._dt(), "western")
        assert "June" in result
        assert "2024" in result

    def test_asian(self):
        result = format_for_region(self._dt(), "asian")
        assert "年" in result
        assert "月" in result

    def test_roc_calendar(self):
        result = format_for_region(self._dt(), "roc")
        assert "民國" in result
        assert "113" in result  # 2024 - 1911 = 113

    def test_default_is_western(self):
        result = format_for_region(self._dt())
        assert "June" in result
