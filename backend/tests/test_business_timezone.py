"""Which calendar day is "today"?

`date.today()` reads the container's clock. Nothing in the prod stack sets TZ —
docker-compose.pi.yml, backend/Dockerfile and frontend/Dockerfile all leave it unset —
so python:3.11-slim's default applies and production runs UTC, while the app's day is
Asia/Taipei (UTC+8). From 16:00 UTC until midnight, which is 00:00–08:00 the next day
in Taipei, `date.today()` returns YESTERDAY.

A third of every day, therefore: "today's spending" is yesterday's, "this month" ends a
day early, and day counts are off by one. Nothing raises — the rows being compared are
UTC-stamped, so the mismatch is silent. Two instances of this class have already been
fixed by hand (the FX cache missing ~8h of every day, and a portfolio test that was
green locally and red on CI).

Local dev hides it: a developer in Taipei has a machine clock that agrees with the
business timezone, so `date.today()` looks right on every run.
"""

import os
import subprocess
import sys
from types import SimpleNamespace
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.utils.datetime_helpers import business_now, business_timezone, business_today

pytestmark = pytest.mark.unit

TAIPEI = ZoneInfo("Asia/Taipei")


class TestTheRule:
    def test_the_business_timezone_is_configured_not_hardcoded(self):
        from app.core.config import get_settings

        assert str(business_timezone()) == get_settings().APP_TIMEZONE

    def test_business_now_is_timezone_aware(self):
        # A naive datetime compared against a DateTime(timezone=True) column is the
        # other half of this bug class.
        assert business_now().tzinfo is not None

    def test_today_matches_the_business_timezone(self):
        assert business_today() == datetime.now(TAIPEI).date()


class TestTheWindowWhereItGoesWrong:
    """The eight hours a UTC clock and a Taipei clock disagree about the date."""

    @pytest.mark.parametrize(
        "utc_instant,utc_date,taipei_date",
        [
            # 16:00 UTC is midnight in Taipei: the day rolls over there, not here.
            ("2026-09-24T16:00:00", "2026-09-24", "2026-09-25"),
            ("2026-09-24T23:59:59", "2026-09-24", "2026-09-25"),
            # Month boundary: "this month" would end a day early.
            ("2026-09-30T16:30:00", "2026-09-30", "2026-10-01"),
            # Year boundary, which also moves YTD day counts.
            ("2026-12-31T18:00:00", "2026-12-31", "2027-01-01"),
            # And the other two thirds of the day, where they agree.
            ("2026-09-25T00:00:00", "2026-09-25", "2026-09-25"),
            ("2026-09-25T15:59:59", "2026-09-25", "2026-09-25"),
        ],
    )
    def test_a_utc_clock_reports_the_wrong_day(self, utc_instant, utc_date, taipei_date):
        moment = datetime.fromisoformat(utc_instant).replace(tzinfo=timezone.utc)

        assert moment.date().isoformat() == utc_date
        assert moment.astimezone(TAIPEI).date().isoformat() == taipei_date

    def test_the_disagreement_is_exactly_eight_hours_wide(self):
        differing = sum(
            1
            for hour in range(24)
            if datetime(2026, 9, 24, hour, tzinfo=timezone.utc).date()
            != datetime(2026, 9, 24, hour, tzinfo=timezone.utc).astimezone(TAIPEI).date()
        )
        assert differing == 8


class TestItIgnoresTheContainersClock:
    """The point of the helper: the answer must not depend on TZ."""

    @staticmethod
    def _in_subprocess(tz: str) -> tuple[str, str]:
        """Return (business_today, date.today) as seen by a process running in `tz`."""
        env = {**os.environ, "TZ": tz}
        out = subprocess.run(
            [
                sys.executable,
                "-c",
                "import time; time.tzset()\n"
                "from datetime import date\n"
                "from app.utils.datetime_helpers import business_today\n"
                "print(business_today().isoformat(), date.today().isoformat())",
            ],
            capture_output=True,
            text=True,
            env=env,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        assert out.returncode == 0, out.stderr
        a, b = out.stdout.split()
        return a, b

    @staticmethod
    def _taipei_dates_around(fn):
        """Run `fn`, bracketed by the Taipei date, and return (result, acceptable).

        The subprocess takes a second or two. Comparing its answer against a clock
        read only afterwards fails if Taipei crosses midnight in between — a mystery
        CI failure once a day. Either side of the call is a correct answer.
        """
        before = datetime.now(TAIPEI).date().isoformat()
        result = fn()
        after = datetime.now(TAIPEI).date().isoformat()
        return result, {before, after}

    def test_utc_container_still_gets_the_taipei_day(self):
        # This is what production actually runs.
        (business, _), acceptable = self._taipei_dates_around(
            lambda: self._in_subprocess("UTC")
        )
        assert business in acceptable

    @pytest.mark.parametrize("tz", ["Pacific/Kiritimati", "Pacific/Pago_Pago"])
    def test_a_wildly_wrong_container_clock_changes_nothing(self, tz):
        # The two extremes of the tz database: UTC+14 and UTC-11. The helper must not
        # care which one the container happens to be set to.
        (business, _), acceptable = self._taipei_dates_around(
            lambda: self._in_subprocess(tz)
        )
        assert business in acceptable

    def test_the_harness_really_does_move_the_clock(self):
        """Otherwise the tests above could pass by not exercising anything.

        Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours apart, so a naive
        clock reads a different calendar day in the two ALWAYS — no hour-of-day
        condition, which is what made an earlier version of this assertion red for
        six hours a day. Taipei against Honolulu is only 18 hours apart and their
        dates agree whenever Taipei reads 18:00 or later.
        """
        _, kiritimati_naive = self._in_subprocess("Pacific/Kiritimati")
        _, pago_naive = self._in_subprocess("Pacific/Pago_Pago")
        assert kiritimati_naive != pago_naive


class TestAtAFixedInstant:
    """business_today() itself, at instants chosen to land on each side of the line.

    The parametrised cases above only exercise stdlib arithmetic. These freeze the
    clock the helper reads, so they fail if it stops converting.
    """

    @staticmethod
    def _frozen(monkeypatch, iso_utc: str):
        fixed = datetime.fromisoformat(iso_utc).replace(tzinfo=timezone.utc)

        class FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

        import app.utils.datetime_helpers as helpers

        monkeypatch.setattr(helpers, "datetime", FrozenDatetime)

    @pytest.mark.parametrize(
        "utc_instant,expected",
        [
            # 16:00 UTC is midnight in Taipei: the business day has already rolled.
            ("2026-09-24T16:00:00", date(2026, 9, 25)),
            ("2026-09-24T23:59:59", date(2026, 9, 25)),
            # Just before the line, both agree.
            ("2026-09-24T15:59:59", date(2026, 9, 24)),
            # Month boundary: "this month" would otherwise end a day early.
            ("2026-09-30T16:30:00", date(2026, 10, 1)),
            # Year boundary, which also moves YTD day counts and the monthly-summary
            # default year.
            ("2026-12-31T18:00:00", date(2027, 1, 1)),
        ],
    )
    def test_business_today_at(self, monkeypatch, utc_instant, expected):
        self._frozen(monkeypatch, utc_instant)
        assert business_today() == expected

    def test_business_now_keeps_the_offset(self, monkeypatch):
        self._frozen(monkeypatch, "2026-09-24T16:00:00")
        now = business_now()
        assert now.utcoffset().total_seconds() == 8 * 3600
        assert (now.hour, now.minute) == (0, 0)


class TestTheSettingIsValidated:
    """A typo must stop the app at boot, not at request time.

    Unvalidated, `Asia/Taipe` loads fine and then raises ZoneInfoNotFoundError inside
    business_today() — turning every dashboard, transaction, loan and reminder
    endpoint into a 500 the first time someone asks what day it is.
    """

    @pytest.fixture(autouse=True)
    def _isolate(self, monkeypatch):
        """Scoped to this class, and restored.

        An earlier version popped APP_TIMEZONE from os.environ inside the helper and
        never put it back, so a developer with it exported lost it for every later
        test in the session — including the subprocess ones, which copy os.environ.
        """
        monkeypatch.delenv("APP_TIMEZONE", raising=False)

    @staticmethod
    def _settings(**overrides):
        """Shipped defaults only — never the developer's .env, as siblings do."""
        from app.core.config import Settings

        base = dict(
            DATABASE_URL="postgresql+asyncpg://user:pass@localhost/db",
            SECRET_KEY="x" * 32,
        )
        return Settings(_env_file=None, **{**base, **overrides})

    def test_a_real_zone_loads(self):
        assert self._settings(APP_TIMEZONE="Asia/Singapore").APP_TIMEZONE == "Asia/Singapore"

    def test_the_shipped_default_is_taipei(self):
        assert self._settings().APP_TIMEZONE == "Asia/Taipei"

    @pytest.mark.parametrize("bad", ["Asia/Taipe", "Not/AZone", "", "UTC+8"])
    def test_a_typo_is_refused(self, bad):
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="not a known IANA timezone"):
            self._settings(APP_TIMEZONE=bad)


class TestTheDefaultsThatDependOnIt:
    """The request-time defaults that were on the container clock.

    The transfer date is the most user-visible of them: a transfer made between
    midnight and 08:00 Taipei would be stamped with yesterday.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("handler,method", [("create", "create_transfer"),
                                                ("update", "update_transfer")])
    async def test_a_transfer_with_no_date_gets_the_business_day(
        self, monkeypatch, handler, method
    ):
        from unittest.mock import create_autospec

        import app.modules.transactions.router as txn_router
        from app.modules.transactions.services import TransactionService

        monkeypatch.setattr(txn_router, "business_today", lambda: date(2027, 1, 1))
        # Autospec, not a bare AsyncMock: an unspecced mock accepts any keyword, so a
        # rename in TransactionService.create_transfer would keep this green while
        # every real transfer raised TypeError.
        service = create_autospec(TransactionService, instance=True)
        getattr(service, method).return_value = {"id": "t1"}

        kwargs = dict(
            transaction_service=service,
            current_user=SimpleNamespace(id="u1"),
            from_wallet="life",
            to_wallet="emergency",
            amount=1000,
            currency="TWD",
            transaction_date=None,
            notes=None,
        )
        if handler == "create":
            await txn_router.create_wallet_transfer(**kwargs)
        else:
            # The PUT path carries the same default and had no test of its own.
            await txn_router.update_wallet_transfer(group_id="g1", **kwargs)

        assert getattr(service, method).await_args.kwargs["transaction_date"] == date(
            2027, 1, 1
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "business_day,expected_year",
        [
            # 1 January, 00:30 Taipei: a UTC clock is still on 31 December.
            (date(2027, 1, 1), 2027),
            (date(2026, 12, 31), 2026),
        ],
    )
    async def test_monthly_summary_defaults_to_the_business_year(
        self, monkeypatch, business_day, expected_year
    ):
        """Drives the handler, so reverting to datetime.now().year fails this.

        An earlier version patched business_today and then asserted on its own
        lambda, which passed no matter what the handler did.
        """
        from unittest.mock import AsyncMock

        import app.modules.transactions.router as txn_router

        monkeypatch.setattr(txn_router, "business_today", lambda: business_day)
        summary = AsyncMock(return_value=[])
        monkeypatch.setattr(
            txn_router.demo_transaction_service, "get_monthly_summary", summary
        )

        # current_user=None takes the demo branch, which needs no database.
        await txn_router.get_monthly_summary(
            transaction_service=None, db=None, current_user=None, year=None
        )

        summary.assert_awaited_once_with(expected_year)


class TestDailyCacheKeys:
    """The market-data cache key carries the business day, not the container's.

    Keyed on the UTC date it turns over eight hours late, so a quote fetched early in
    a Taipei morning can be served from the previous day's entry — for as long as the
    entry's own TTL outlives the rollover, which is the case that matters.
    """

    @pytest.mark.asyncio
    async def test_the_yahoo_key_carries_the_business_day(self, monkeypatch):
        """Drives _get_yahoo_historical and captures the key it looks up.

        Deliberately not built by the test: an earlier version composed the key
        itself and asserted on its own f-string, which passed however the module
        keyed it.
        """
        import app.modules.portfolio.market_data_service as mds

        seen = []
        monkeypatch.setattr(mds, "business_today", lambda: date(2027, 1, 1))
        monkeypatch.setattr(mds, "_sym_cache_get", lambda key: seen.append(key) or [])

        service = mds.MarketDataService(enable_finlab=False, enable_yahoo=True)
        await service._get_yahoo_historical("AAPL", 30)

        assert seen and seen[0] == "yahoo_market_data:AAPL:30d:2027-01-01"


class TestReturnTypes:
    def test_business_today_is_a_date_not_a_datetime(self):
        # `date.today()` returns a date; a drop-in replacement must too, or callers
        # comparing against a date column start comparing datetimes.
        assert isinstance(business_today(), date)
        assert not isinstance(business_today(), datetime)
