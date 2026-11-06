"""
Unit tests for datetime_helpers.py — pure functions, no DB required.
"""

from datetime import datetime, timezone, timedelta
import pytz

from app.utils.datetime_helpers import utc_now, to_utc


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

