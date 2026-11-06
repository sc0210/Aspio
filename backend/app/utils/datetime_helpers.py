"""
Date and time utility functions for Aspiro FastAPI Backend

Provides timezone-aware datetime operations, formatting, and calculations
commonly used in personal finance applications.
"""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


def utc_now() -> datetime:
    """Get current UTC datetime with timezone info"""
    return datetime.now(timezone.utc)


def business_timezone() -> ZoneInfo:
    """The timezone this app's *days* are measured in.

    Not a display preference: it decides which calendar day a transaction belongs
    to, when "this month" starts and ends, and whether a streak survived the night.
    """
    from app.core.config import get_settings

    return ZoneInfo(get_settings().APP_TIMEZONE)


def business_now() -> datetime:
    """Current time in the business timezone, as an aware datetime."""
    return datetime.now(business_timezone())


def business_day_of(value):
    """The calendar day a stored instant belongs to, in the business timezone.

    `.date()` on an AWARE datetime reads the day in whatever offset it carries. A
    purchase stamped 2026-08-31T20:00Z is 2026-09-01 04:00 in Taipei, so dating a
    Life Wallet leg from it directly books the expense in the previous month — and
    the previous month's reports.

    Naive values pass through: they were never in another timezone to begin with.
    Anything that is not a datetime passes through too, since callers hand this
    plain `date` objects as well.
    """
    if isinstance(value, datetime):
        return (
            value.astimezone(business_timezone()) if value.tzinfo else value
        ).date()
    return value


def business_today() -> date:
    """Today's calendar date in the business timezone.

    Use this instead of `date.today()` anywhere the answer is shown to a user or
    compared against stored data.

    `date.today()` reads the *container's* clock, and nothing in the prod stack sets
    TZ — docker-compose.pi.yml, backend/Dockerfile and frontend/Dockerfile all leave
    it unset, so python:3.14-slim's default applies and the container runs UTC. The
    app's day is Asia/Taipei (UTC+8), so from 16:00 UTC until midnight — 00:00 to
    08:00 the next day in Taipei — `date.today()` returns YESTERDAY. Every "today",
    "this month" and day-count computed from it is off by one for a third of each
    day, and the stored rows it is compared against are UTC-stamped
    (DateTime(timezone=True)), so the mismatch is silent.
    """
    return business_now().date()


def to_utc(dt: datetime) -> datetime:
    """Convert datetime to UTC timezone"""
    if dt.tzinfo is None:
        # Assume naive datetime is UTC
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


__all__ = [
    "utc_now",
    "to_utc",
]
