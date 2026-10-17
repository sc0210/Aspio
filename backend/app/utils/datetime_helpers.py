"""
Date and time utility functions for Aspiro FastAPI Backend

Provides timezone-aware datetime operations, formatting, and calculations
commonly used in personal finance applications.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo
import pytz


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
    it unset, so python:3.11-slim's default applies and the container runs UTC. The
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


def from_utc(dt: datetime, target_tz: str = "UTC") -> datetime:
    """Convert UTC datetime to target timezone"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    
    target_timezone = pytz.timezone(target_tz)
    return dt.astimezone(target_timezone)


def start_of_day(dt: datetime, tz: Optional[str] = None) -> datetime:
    """Get start of day (00:00:00) for given datetime"""
    if tz:
        dt = from_utc(dt, tz)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def end_of_day(dt: datetime, tz: Optional[str] = None) -> datetime:
    """Get end of day (23:59:59.999999) for given datetime"""
    if tz:
        dt = from_utc(dt, tz)
    return dt.replace(hour=23, minute=59, second=59, microsecond=999999)


def start_of_month(dt: datetime, tz: Optional[str] = None) -> datetime:
    """Get start of month for given datetime"""
    if tz:
        dt = from_utc(dt, tz)
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def end_of_month(dt: datetime, tz: Optional[str] = None) -> datetime:
    """Get end of month for given datetime"""
    if tz:
        dt = from_utc(dt, tz)
    
    # Get first day of next month, then subtract one microsecond
    if dt.month == 12:
        next_month = dt.replace(year=dt.year + 1, month=1, day=1)
    else:
        next_month = dt.replace(month=dt.month + 1, day=1)
    
    next_month = next_month.replace(hour=0, minute=0, second=0, microsecond=0)
    return next_month - timedelta(microseconds=1)


def start_of_year(dt: datetime, tz: Optional[str] = None) -> datetime:
    """Get start of year for given datetime"""
    if tz:
        dt = from_utc(dt, tz)
    return dt.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def end_of_year(dt: datetime, tz: Optional[str] = None) -> datetime:
    """Get end of year for given datetime"""
    if tz:
        dt = from_utc(dt, tz)
    return dt.replace(month=12, day=31, hour=23, minute=59, second=59, microsecond=999999)


def days_between(start: datetime, end: datetime) -> int:
    """Calculate number of days between two dates"""
    return (end.date() - start.date()).days


def months_between(start: datetime, end: datetime) -> int:
    """Calculate number of months between two dates"""
    return (end.year - start.year) * 12 + (end.month - start.month)


def add_months(dt: datetime, months: int) -> datetime:
    """Add months to a datetime, handling month overflow"""
    year = dt.year + (dt.month + months - 1) // 12
    month = (dt.month + months - 1) % 12 + 1
    
    # Handle day overflow (e.g., Jan 31 + 1 month = Feb 28/29)
    import calendar
    max_day = calendar.monthrange(year, month)[1]
    day = min(dt.day, max_day)
    
    return dt.replace(year=year, month=month, day=day)


def format_datetime(dt: datetime, format_type: str = "iso") -> str:
    """Format datetime according to different standards"""
    if format_type == "iso":
        return dt.isoformat()
    elif format_type == "api":
        return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    elif format_type == "date":
        return dt.strftime("%Y-%m-%d")
    elif format_type == "time":
        return dt.strftime("%H:%M:%S")
    elif format_type == "human":
        return dt.strftime("%B %d, %Y at %I:%M %p")
    elif format_type == "asian":
        return dt.strftime("%Y年%m月%d日 %H:%M")
    else:
        return dt.isoformat()


def parse_datetime(dt_str: str, tz: Optional[str] = None) -> datetime:
    """Parse datetime string with optional timezone"""
    # Try different formats
    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ", 
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d"
    ]
    
    dt = None
    for fmt in formats:
        try:
            dt = datetime.strptime(dt_str, fmt)
            break
        except ValueError:
            continue
    
    if dt is None:
        raise ValueError(f"Unable to parse datetime: {dt_str}")
    
    # Add timezone if specified
    if tz and dt.tzinfo is None:
        target_tz = pytz.timezone(tz)
        dt = target_tz.localize(dt)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    
    return dt


def is_weekend(dt: datetime) -> bool:
    """Check if datetime falls on weekend (Saturday=5, Sunday=6)"""
    return dt.weekday() >= 5


def is_business_day(dt: datetime) -> bool:
    """Check if datetime falls on a business day (Monday-Friday)"""
    return dt.weekday() < 5


def next_business_day(dt: datetime) -> datetime:
    """Get next business day from given datetime"""
    next_day = dt + timedelta(days=1)
    while not is_business_day(next_day):
        next_day += timedelta(days=1)
    return next_day


def previous_business_day(dt: datetime) -> datetime:
    """Get previous business day from given datetime"""
    prev_day = dt - timedelta(days=1)
    while not is_business_day(prev_day):
        prev_day -= timedelta(days=1)
    return prev_day


# Asian timezone helpers
ASIAN_TIMEZONES = {
    "singapore": "Asia/Singapore",
    "malaysia": "Asia/Kuala_Lumpur", 
    "thailand": "Asia/Bangkok",
    "vietnam": "Asia/Ho_Chi_Minh",
    "indonesia": "Asia/Jakarta",
    "philippines": "Asia/Manila",
    "hong_kong": "Asia/Hong_Kong",
    "taiwan": "Asia/Taipei",
    "japan": "Asia/Tokyo",
    "korea": "Asia/Seoul"
}


def get_asian_timezone(country: str) -> str:
    """Get timezone string for Asian countries"""
    return ASIAN_TIMEZONES.get(country.lower(), "UTC")


def format_for_region(dt: datetime, region: str = "western") -> str:
    """Format datetime according to regional preferences"""
    if region == "asian":
        return dt.strftime("%Y年%m月%d日")
    elif region == "roc":  # Republic of China calendar
        year = dt.year - 1911  # ROC calendar starts from 1912
        return f"民國{year}年{dt.month}月{dt.day}日"
    else:  # western
        return dt.strftime("%B %d, %Y")


__all__ = [
    "utc_now",
    "to_utc", 
    "from_utc",
    "start_of_day",
    "end_of_day",
    "start_of_month",
    "end_of_month", 
    "start_of_year",
    "end_of_year",
    "days_between",
    "months_between",
    "add_months",
    "format_datetime",
    "parse_datetime",
    "is_weekend",
    "is_business_day",
    "next_business_day",
    "previous_business_day",
    "get_asian_timezone",
    "format_for_region",
    "ASIAN_TIMEZONES"
]