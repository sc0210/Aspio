"""`date.today()` must not come back.

It reads the container's clock. Production sets no TZ, so it runs UTC while the app's
day is Asia/Taipei — `date.today()` there is the previous day from 16:00 UTC until
midnight. Every use is silently wrong for a third of each day, and a developer in
Taipei never sees it, because their machine agrees with the business timezone.

The whole codebase was moved onto `business_today()` in one pass. This is what stops
the next one creeping back in, since nothing else would notice.
"""

import pathlib
import re

import pytest

pytestmark = pytest.mark.unit

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "app"
TESTS = ROOT / "tests"

# The two files whose PROSE names date.today() while explaining why not to call it.
ALLOWED = {
    "utils/datetime_helpers.py",   # defines business_today; its docstring names it
    "core/config.py",              # the APP_TIMEZONE comment names it
}

# Naive-clock formatting that is deliberate. An identifier is not a business date:
# `plan_20260925_143000` only has to be unique and to sort, and UTC gives that
# without a timezone's DST jumps. Listed rather than silently skipped.
# Keyed by file AND the text that makes it deliberate, so a date key added to the
# same file later is still caught.
ALLOWED_NAIVE_STRFTIME = {
    ("modules/portfolio/rebalancing_schemas.py", "plan_"),
}

# Same reasoning: an identifier's timestamp is not an instant anyone compares.
ALLOWED_NAIVE_NOW = {
    ("modules/portfolio/rebalancing_schemas.py", "plan_"),
}

NAIVE_TODAY = re.compile(r"\bdate\.today\(\)")
# The literal business_today() replaced. One definition, not one per call site.
INLINE_TAIPEI = re.compile(r"datetime\.now\(\s*ZoneInfo\(\s*[\"']Asia/Taipei[\"']\s*\)\s*\)\.date\(\)")
# Formatting the container's clock into a daily cache key or a date string is the
# same bug wearing different clothes: keyed on the UTC date, a cache turns over at
# 08:00 Taipei instead of midnight.
NAIVE_STRFTIME = re.compile(r"\bdatetime\.(?:utcnow|now)\(\)\.(?:strftime|date\(\)\.isoformat)")
# A naive instant written to a DateTime(timezone=True) column is stored AS IF UTC.
# That is accidentally correct while the container runs UTC — and silently eight
# hours wrong the moment anyone sets TZ on it, which this repo's own APP_TIMEZONE
# work makes someone more likely to try. utc_now() is correct either way.
NAIVE_NOW = re.compile(r"\bdatetime\.(?:now\(\)|utcnow\(\))")


# These two name date.today() on purpose: one contrasts it with business_today(),
# the other is this file's own patterns.
ALLOWED_TESTS = {"test_business_timezone.py", "test_no_naive_today.py"}


def _python_files():
    """App code AND tests.

    Tests matter as much as app code here. CI runs on ubuntu-latest with no TZ, so
    a test that builds "today" with date.today() while the code under it uses
    business_today() is red for the eight hours the two clocks disagree — green in
    Taipei, red on CI, which is the exact failure this change set out to remove.
    Reproduce it locally with: TZ=Pacific/Honolulu pytest
    """
    for path in sorted(APP.rglob("*.py")):
        rel = path.relative_to(APP).as_posix()
        if rel in ALLOWED:
            continue
        yield rel, path
    for path in sorted(TESTS.rglob("*.py")):
        if path.name in ALLOWED_TESTS:
            continue
        yield f"tests/{path.relative_to(TESTS).as_posix()}", path


def _offending_lines(pattern, source):
    return [
        (n, line.strip())
        for n, line in enumerate(source.split("\n"), start=1)
        if pattern.search(line) and not line.lstrip().startswith("#")
    ]


def test_no_naive_date_today_in_app_code():
    hits = []
    for rel, path in _python_files():
        for n, line in _offending_lines(NAIVE_TODAY, path.read_text()):
            hits.append(f"{rel}:{n}  {line}")

    assert not hits, (
        "date.today() reads the container's clock, which is UTC in production while "
        "the app's day is Asia/Taipei — so it returns yesterday from 16:00 UTC until "
        "midnight. Use business_today() from app.utils.datetime_helpers:\n  "
        + "\n  ".join(hits)
    )


def test_the_business_timezone_is_not_re_derived_inline():
    """One definition of 'today in Taipei' in APP code, not a literal per call site.

    Four of these had already accumulated, so a change of business timezone would
    have had to find them all.

    Tests are exempt, and should be: deriving the expected date independently is what
    makes an assertion worth anything. A test that asked business_today() what it
    expected would pass even if business_today() were wrong.
    """
    hits = []
    for rel, path in _python_files():
        if rel.startswith("tests/"):
            continue
        for n, line in _offending_lines(INLINE_TAIPEI, path.read_text()):
            hits.append(f"{rel}:{n}  {line}")

    assert not hits, (
        "Call business_today() rather than spelling the timezone out again:\n  "
        + "\n  ".join(hits)
    )


def test_the_guard_can_actually_see_app_code():
    """A guard that scans nothing passes forever."""
    files = list(_python_files())
    assert len(files) > 50, f"only found {len(files)} files under {APP}"
    assert any(rel.startswith("modules/transactions/") for rel, _ in files)
    assert any(rel.startswith("tests/") for rel, _ in files), "tests are not scanned"


def test_no_daily_key_is_cut_from_the_container_clock():
    """App code only, and behavioural tests cannot cover every key.

    A behavioural test drives one call path; this catches the next key someone adds.
    Both are wanted: the scan alone passed for a key that was never exercised, and
    the behavioural test alone left the FinLab key unguarded.
    """
    hits = []
    for rel, path in _python_files():
        if rel.startswith("tests/"):
            continue
        for n, line in _offending_lines(NAIVE_STRFTIME, path.read_text()):
            if any(f == rel and marker in line for f, marker in ALLOWED_NAIVE_STRFTIME):
                continue
            hits.append(f"{rel}:{n}  {line}")

    assert not hits, (
        "Format business_today()/business_now(), not the container's clock:\n  "
        + "\n  ".join(hits)
    )


def test_no_naive_instant_reaches_a_timezone_aware_column():
    """App code only.

    The database stores a naive value as if it were UTC (verified: `show timezone`
    is UTC, and '10:00'::timestamptz becomes 10:00+00). So `datetime.now()` in a UTC
    container happens to be right — and becomes eight hours wrong if TZ is ever set,
    with nothing raising. utc_now() does not depend on the container at all.
    """
    hits = []
    for rel, path in _python_files():
        if rel.startswith("tests/"):
            continue
        for n, line in _offending_lines(NAIVE_NOW, path.read_text()):
            if any(f == rel and marker in line for f, marker in ALLOWED_NAIVE_NOW):
                continue
            hits.append(f"{rel}:{n}  {line}")

    assert not hits, (
        "Use utc_now() (or business_now() for a business day). A naive instant is "
        "stored as if UTC, so it is correct only while the container is:\n  "
        + "\n  ".join(hits)
    )


def test_the_patterns_match_what_they_claim():
    assert NAIVE_TODAY.search("x = date.today()")
    assert NAIVE_TODAY.search("if a < date.today():")
    # Not a false positive on the replacement, nor on an unrelated .today
    assert not NAIVE_TODAY.search("x = business_today()")
    assert not NAIVE_TODAY.search("x = something.date.today_ish()")

    assert NAIVE_STRFTIME.search('k = datetime.now().strftime("%Y-%m-%d")')
    assert NAIVE_STRFTIME.search("k = datetime.utcnow().strftime('%Y-%m-%d')")
    assert NAIVE_STRFTIME.search("d = datetime.now().date().isoformat()")
    assert not NAIVE_STRFTIME.search('k = business_today().strftime("%Y-%m-%d")')
    assert not NAIVE_STRFTIME.search('k = datetime.now(timezone.utc).strftime("%Y")')

    assert NAIVE_NOW.search("t = datetime.now()")
    assert NAIVE_NOW.search("t = datetime.utcnow()")
    assert not NAIVE_NOW.search("t = datetime.now(timezone.utc)")
    assert not NAIVE_NOW.search("t = utc_now()")
    assert not NAIVE_NOW.search('t = datetime.now(ZoneInfo("Asia/Taipei"))')

    assert INLINE_TAIPEI.search('d = datetime.now(ZoneInfo("Asia/Taipei")).date()')
    assert INLINE_TAIPEI.search("d = datetime.now(ZoneInfo('Asia/Taipei')).date()")
    assert not INLINE_TAIPEI.search('d = datetime.now(ZoneInfo("Asia/Taipei"))')
