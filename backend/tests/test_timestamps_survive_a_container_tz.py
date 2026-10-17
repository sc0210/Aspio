"""Setting TZ on the container must not move any stored instant.

This is the trap the APP_TIMEZONE work makes more likely. Having read that the app's
day is Asia/Taipei, the obvious next move is to set `TZ=Asia/Taipei` on the container
— and that is precisely what must not change the data.

Postgres stores a NAIVE datetime as if it were UTC (`show timezone` is UTC, and
'2026-09-25 10:00:00'::timestamptz becomes 10:00+00). So `datetime.now()` was
*accidentally* correct while the container ran UTC, and would have been eight hours
in the future the moment TZ was set, with nothing raising.

`utc_now()` is an aware instant, so the container's clock cannot enter into it.
"""

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

from app.utils.datetime_helpers import utc_now

pytestmark = pytest.mark.unit


def _instant_in(tz: str) -> tuple[str, str]:
    """(utc_now, naive datetime.now) as seen by a process running in `tz`."""
    out = subprocess.run(
        [
            sys.executable,
            "-c",
            "import time; time.tzset()\n"
            "from datetime import datetime, timezone\n"
            "from app.utils.datetime_helpers import utc_now\n"
            "print(utc_now().astimezone(timezone.utc).isoformat(),\n"
            "      datetime.now().isoformat())",
        ],
        capture_output=True,
        text=True,
        env={**os.environ, "TZ": tz},
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert out.returncode == 0, out.stderr
    aware, naive = out.stdout.split()
    return aware, naive


class TestTheContainerClockCannotMoveAnInstant:
    @pytest.mark.parametrize("tz", ["UTC", "Asia/Taipei", "Pacific/Honolulu"])
    def test_utc_now_is_the_same_instant_everywhere(self, tz):
        aware, _ = _instant_in(tz)
        drift = abs(
            (datetime.fromisoformat(aware) - utc_now()).total_seconds()
        )
        # Subprocess startup, not timezone drift.
        assert drift < 30, f"{tz}: {drift}s"

    def test_the_naive_clock_is_what_moves(self):
        """Proves the harness exercises the difference, and shows the damage.

        A naive value is stored as if UTC, so under TZ=Asia/Taipei every written
        timestamp would land eight hours in the future.
        """
        _, utc_naive = _instant_in("UTC")
        _, taipei_naive = _instant_in("Asia/Taipei")

        gap = datetime.fromisoformat(taipei_naive) - datetime.fromisoformat(utc_naive)
        assert timedelta(hours=7, minutes=55) < gap < timedelta(hours=8, minutes=5), gap


class TestTheHelperItself:
    def test_utc_now_is_aware(self):
        assert utc_now().tzinfo is not None
        assert utc_now().utcoffset() == timedelta(0)

    def test_it_is_comparable_with_a_stored_aware_value(self):
        """A naive value here raises TypeError — loudly, which is the point.

        The FinLab cooldown was seeded naive in a test and compared against
        utc_now(); the raise was swallowed by the fetch's except, so the cooldown
        silently never expired.
        """
        stored = datetime(2026, 9, 25, 8, 0, tzinfo=timezone.utc)
        assert (utc_now() - stored).total_seconds() > 0

        with pytest.raises(TypeError):
            utc_now() - datetime(2026, 9, 25, 8, 0)
