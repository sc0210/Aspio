"""Regression tests for scripts/commit_review.py (the commit/push AI review hook).

This lives under backend/tests/ because that is the only place CI runs pytest —
the module under test is a repo-root dev tool, not backend code, so it is loaded
by path rather than imported.

Both areas covered here have already regressed once each:

  * `resolve_push_range` picked the wrong ref, so `git push origin hotfix:main`
    reviewed the wrong branch — silently skipping the one that auto-deploys.
  * `review`'s lock path went quiet when the peer holding the lock failed, so a
    push went out unreviewed and the silence read as "clean".

They are string-matching and racy control flow respectively, which is exactly the
shape that regresses without anyone noticing.
"""

import importlib.util
import io
import json
import threading
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "commit_review.py"

pytestmark = pytest.mark.unit


@pytest.fixture(scope="module")
def cr():
    """The review script, loaded by path."""
    if not SCRIPT.exists():
        pytest.skip(f"{SCRIPT} not present")
    spec = importlib.util.spec_from_file_location("commit_review", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HEAD = "a" * 40
PREV = "b" * 40
OLD = "c" * 40
ZEROS = "0" * 40


@pytest.fixture
def stub_git(cr, monkeypatch):
    """Every ref exists; merge-base answers with a fixed fork point."""
    monkeypatch.setattr(cr, "rev_exists", lambda ref: True)
    monkeypatch.setattr(
        cr, "git", lambda *a, **k: OLD if a and a[0] == "merge-base" else "stub"
    )


# --------------------------------------------------------------- push range


class TestResolvePushRange:
    def test_single_ref(self, cr, stub_git):
        assert (
            cr.resolve_push_range(f"refs/heads/main {HEAD} refs/heads/main {PREV}")
            == f"{PREV}..{HEAD}"
        )

    def test_asymmetric_refspec_follows_the_destination(self, cr, stub_git):
        """`git push origin hotfix:main` deploys — the local ref is not what counts.

        Deliberately multi-ref. With a single line the first-ref fallback returns
        the right range by accident, so a single-line case passes even against the
        bug it is meant to catch. Only a competing ref ahead of the deploying one
        distinguishes "matched the destination" from "took whatever came first".
        """
        stdin = (
            f"refs/heads/feature {HEAD} refs/heads/feature {OLD}\n"
            f"refs/heads/hotfix {HEAD} refs/heads/main {PREV}\n"
        )
        assert cr.resolve_push_range(stdin) == f"{PREV}..{HEAD}"

    def test_multi_ref_prefers_main_over_first_line(self, cr, stub_git):
        stdin = (
            f"refs/heads/feature {HEAD} refs/heads/feature {OLD}\n"
            f"refs/heads/main {HEAD} refs/heads/main {PREV}\n"
        )
        assert cr.resolve_push_range(stdin) == f"{PREV}..{HEAD}"

    def test_multi_ref_without_main_falls_back_to_first(self, cr, stub_git):
        stdin = (
            f"refs/heads/feature {HEAD} refs/heads/feature {OLD}\n"
            f"refs/heads/other {HEAD} refs/heads/other {PREV}\n"
        )
        assert cr.resolve_push_range(stdin) == f"{OLD}..{HEAD}"

    def test_branch_deletion_is_skipped(self, cr, stub_git):
        """A zero local sha is a delete; there is no diff to review."""
        out = cr.resolve_push_range(f"(delete) {ZEROS} refs/heads/gone {PREV}")
        assert out and f"..{ZEROS}" not in out

    def test_new_remote_branch_uses_merge_base(self, cr, stub_git):
        """A brand-new branch must not resolve to the repo's entire history."""
        line = f"refs/heads/feat {HEAD} refs/heads/feat {ZEROS}"
        assert cr.resolve_push_range(line) == f"{OLD}..{HEAD}"

    @pytest.mark.parametrize("junk", ["", "nonsense", "too few fields", "\n\n"])
    def test_unparseable_stdin_falls_back(self, cr, stub_git, junk):
        assert ".." in cr.resolve_push_range(junk)


class TestResolvePushTarget:
    """The local ref has to survive alongside the range.

    The Claude-side hook re-resolves this push's tip later, and the checked-out
    branch is not always the one that was pushed.
    """

    def test_returns_the_local_ref_behind_the_destination(self, cr, stub_git):
        stdin = (
            f"refs/heads/feature {HEAD} refs/heads/feature {OLD}\n"
            f"refs/heads/hotfix {HEAD} refs/heads/main {PREV}\n"
        )
        ref, rng = cr.resolve_push_target(stdin)
        assert ref == "refs/heads/hotfix"
        assert rng == f"{PREV}..{HEAD}"

    def test_inferred_range_reports_no_ref(self, cr, stub_git):
        ref, rng = cr.resolve_push_target("garbage")
        assert ref == "" and ".." in rng

    def test_range_wrapper_still_returns_just_the_range(self, cr, stub_git):
        stdin = f"refs/heads/main {HEAD} refs/heads/main {PREV}"
        assert cr.resolve_push_range(stdin) == cr.resolve_push_target(stdin)[1]


# ------------------------------------------------------------- review/lock


@pytest.fixture
def isolated_reports(cr, monkeypatch, tmp_path):
    monkeypatch.setattr(cr, "REPORT_DIR", tmp_path)
    monkeypatch.setattr(cr, "LATEST", tmp_path / "latest.md")
    monkeypatch.setattr(cr, "PUSH_HANDOFF", tmp_path / "last-push.json")
    monkeypatch.setattr(cr, "range_shas", lambda rng: rng)
    return tmp_path


@pytest.fixture
def ctx(cr):
    return {
        "range": f"{PREV}..{HEAD}",
        "stat": "1 file changed",
        "diff": "diff --git a/x b/x\n+one line\n",
        "truncated": False,
        "commits": "abc123 do a thing",
        "branch_history": "abc123 2026-08-16 do a thing",
        "file_history": "x:\n  abc123 2026-08-16 do a thing",
        "files": ["x"],
    }


GOOD = "VERDICT: SHIP\nfine\n"


class TestReviewCache:
    def test_success_is_cached_and_costs_one_call(self, cr, monkeypatch, isolated_reports, ctx):
        calls = []
        monkeypatch.setattr(cr, "run_claude", lambda p, budget=None: (calls.append(1), (GOOD, None))[1])

        first_text, first_path = cr.review(ctx, "t")
        second_text, second_path = cr.review(ctx, "t")

        assert len(calls) == 1
        assert first_path == second_path and first_text == second_text
        assert cr.verdict_of(first_text) == "SHIP"

    def test_failure_is_never_cached(self, cr, monkeypatch, isolated_reports, ctx):
        """Caching a failure would pin it to this diff forever.

        A rate limit is transient; writing it as the report means every later
        caller serves the failure from cache instead of retrying.
        """
        calls = []
        monkeypatch.setattr(
            cr, "run_claude", lambda p, budget=None: (calls.append(1), (None, "rate limited"))[1]
        )

        text, path = cr.review(ctx, "t")

        assert path is None
        assert cr.failed(text)
        assert not list(isolated_reports.glob("*.md")), "a failure was written to cache"

        cr.review(ctx, "t")
        assert len(calls) == 2, "second call served a cached failure instead of retrying"


class TestReviewLock:
    def test_peer_failure_is_taken_over_instead_of_waited_out(
        self, cr, monkeypatch, isolated_reports, ctx
    ):
        """A peer that dies without a report must not stall the waiter.

        The waiter used to poll only for the report, so it kept polling a job
        that was never coming back until LOCK_WAIT expired, then returned
        nothing — and a push went out silently unreviewed.
        """
        monkeypatch.setattr(cr, "LOCK_WAIT", 120)
        monkeypatch.setattr(cr, "run_claude", lambda p, budget=None: (GOOD, None))

        lock = isolated_reports / f"{cr.cache_key(ctx)}.lock"
        lock.write_text("1234")
        threading.Thread(
            target=lambda: (time.sleep(1), lock.unlink(missing_ok=True)), daemon=True
        ).start()

        started = time.time()
        text, path = cr.review(ctx, "t")
        elapsed = time.time() - started

        assert text and path, "waiter gave up instead of taking the review over"
        assert elapsed < 30, f"waiter stalled for {elapsed:.0f}s instead of taking over"

    def test_takeover_inherits_only_the_remaining_wait(
        self, cr, monkeypatch, isolated_reports, ctx
    ):
        """Otherwise a hung peer buys the waiter a fresh full timeout on top."""
        monkeypatch.setattr(cr, "LOCK_WAIT", 60)
        seen = {}

        def record(prompt, budget=None):
            seen["budget"] = budget
            return GOOD, None

        monkeypatch.setattr(cr, "run_claude", record)

        lock = isolated_reports / f"{cr.cache_key(ctx)}.lock"
        lock.write_text("1234")
        threading.Thread(
            target=lambda: (time.sleep(1), lock.unlink(missing_ok=True)), daemon=True
        ).start()
        cr.review(ctx, "t")

        assert seen["budget"] is not None
        assert seen["budget"] < cr.CLAUDE_TIMEOUT

    def test_uncontended_review_gets_the_full_budget(
        self, cr, monkeypatch, isolated_reports, ctx
    ):
        seen = {}

        def record(prompt, budget=None):
            seen["budget"] = budget
            return GOOD, None

        monkeypatch.setattr(cr, "run_claude", record)
        cr.review(ctx, "t")
        assert seen["budget"] is None, "normal path should not be budget-capped"

    def test_stale_lock_is_reclaimed(self, cr, monkeypatch, isolated_reports, ctx):
        """A lock left by a killed process must not wedge every later review."""
        import os

        monkeypatch.setattr(cr, "run_claude", lambda p, budget=None: (GOOD, None))
        lock = isolated_reports / f"{cr.cache_key(ctx)}.lock"
        lock.write_text("99999")
        os.utime(lock, (0, 0))

        text, path = cr.review(ctx, "t")
        assert text and path

    def test_waiter_that_times_out_reports_unavailable_not_silence(
        self, cr, monkeypatch, isolated_reports, ctx
    ):
        """mode_push must say the range is unreviewed rather than print nothing."""
        monkeypatch.setattr(cr, "LOCK_WAIT", 1)
        (isolated_reports / f"{cr.cache_key(ctx)}.lock").write_text("1")

        # mode_push reads the pre-push refs off stdin, which pytest captures.
        monkeypatch.setattr(cr.sys, "stdin", io.StringIO(""))
        monkeypatch.setattr(cr, "collect", lambda rng: ctx)
        monkeypatch.setattr(cr, "resolve_push_target", lambda s: ("refs/heads/x", ctx["range"]))
        printed = []
        monkeypatch.setattr(cr, "print_terminal", lambda t, p: printed.append(t))

        class Args:
            notify = False

        cr.mode_push(Args())

        assert printed, "push produced no output at all"
        assert cr.failed(printed[0])


# ------------------------------------------------------- push handoff (hook)


def _hook_output(cr, monkeypatch, capsys, command):
    """Run mode_claude_hook with a fake Bash payload; return parsed JSON or None."""
    monkeypatch.setattr(
        cr.sys,
        "stdin",
        io.StringIO(json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})),
    )

    class Args:
        notify = False

    cr.mode_claude_hook(Args())
    out = capsys.readouterr().out.strip()
    return json.loads(out) if out else None


class TestPushHandoff:
    """The Claude-facing hook must report what pre-push actually reviewed.

    It used to infer the push from latest.md by checking the report's range ended
    at HEAD. A single-commit review also ends at HEAD, so a multi-commit push
    whose own review had timed out was served the last commit's report and
    announced as SHIP — a confident clean verdict for a review that never ran.
    """

    def test_ok_handoff_surfaces_that_report(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        report = isolated_reports / "r.md"
        report.write_text("head\n\n---\n\nVERDICT: SHIP\nclean\n")
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {"range": f"{PREV}..{HEAD}", "report": str(report), "status": "ok", "ts": time.time()}
            )
        )

        monkeypatch.setattr(cr, "git", lambda *a, **k: HEAD)
        out = _hook_output(cr, monkeypatch, capsys, "git push origin main")

        assert out is not None
        assert "SHIP" in out["systemMessage"]
        assert "clean" in out["hookSpecificOutput"]["additionalContext"]

    def test_failed_handoff_reports_unreviewed_not_some_other_report(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        """The regression: a stale-but-tip-matching report must not stand in."""
        stale = isolated_reports / "latest.md"
        stale.write_text("head\n\n---\n\nVERDICT: SHIP\nclean\n")
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {
                    "range": f"{PREV}..{HEAD}",
                    "report": None,
                    "status": "unavailable",
                    "detail": "review timed out after 300s",
                    "ts": time.time(),
                }
            )
        )

        monkeypatch.setattr(cr, "git", lambda *a, **k: HEAD)
        out = _hook_output(cr, monkeypatch, capsys, "git push")

        assert out is not None
        assert cr.REVIEW_FAILED in out["systemMessage"]
        assert "SHIP" not in out["systemMessage"]
        assert "UNREVIEWED" in out["hookSpecificOutput"]["additionalContext"]

    def test_handoff_pointing_at_a_missing_report_is_not_trusted(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {
                    "range": f"{PREV}..{HEAD}",
                    "report": str(isolated_reports / "gone.md"),
                    "status": "ok",
                    "ts": time.time(),
                }
            )
        )

        monkeypatch.setattr(cr, "git", lambda *a, **k: HEAD)
        out = _hook_output(cr, monkeypatch, capsys, "git push")
        assert out is not None and cr.REVIEW_FAILED in out["systemMessage"]

    def test_stale_handoff_is_ignored(self, cr, monkeypatch, isolated_reports, capsys):
        import os

        cr.PUSH_HANDOFF.write_text(json.dumps({"range": "x..y", "status": "ok", "report": None}))
        os.utime(cr.PUSH_HANDOFF, (0, 0))
        assert _hook_output(cr, monkeypatch, capsys, "git push") is None

    def test_missing_handoff_stays_silent(self, cr, monkeypatch, isolated_reports, capsys):
        assert _hook_output(cr, monkeypatch, capsys, "git push") is None

    def test_corrupt_handoff_stays_silent(self, cr, monkeypatch, isolated_reports, capsys):
        cr.PUSH_HANDOFF.write_text("{not json")
        assert _hook_output(cr, monkeypatch, capsys, "git push") is None

    def test_non_git_command_is_ignored(self, cr, monkeypatch, isolated_reports, capsys):
        assert _hook_output(cr, monkeypatch, capsys, "npm run build") is None

    def test_dry_run_is_ignored(self, cr, monkeypatch, isolated_reports, capsys):
        cr.PUSH_HANDOFF.write_text(
            json.dumps({"range": "x..y", "status": "ok", "report": None, "ts": time.time()})
        )
        assert _hook_output(cr, monkeypatch, capsys, "git push --dry-run") is None


class TestHandoffCannotOutliveItsPush:
    """A fresh handoff from a *different* push must never stand in for this one."""

    def test_push_with_no_reviewable_diff_clears_the_previous_verdict(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        """Push A reviewed clean; push B changes only excluded paths.

        mode_push used to return before recording anything when collect() found
        nothing, leaving A's fresh "ok" handoff in place for B to be reported with.
        """
        report = isolated_reports / "a.md"
        report.write_text("head\n\n---\n\nVERDICT: SHIP\nclean\n")
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {"range": f"{PREV}..{HEAD}", "report": str(report), "status": "ok", "ts": time.time()}
            )
        )

        monkeypatch.setattr(cr.sys, "stdin", io.StringIO(""))
        monkeypatch.setattr(cr, "resolve_push_target", lambda s: ("refs/heads/x", f"{HEAD}..{OLD}"))
        monkeypatch.setattr(cr, "collect", lambda rng: None)

        class Args:
            notify = False

        cr.mode_push(Args())

        saved = json.loads(cr.PUSH_HANDOFF.read_text())
        assert saved["status"] == "nothing-to-review", "previous push's verdict survived"

        monkeypatch.setattr(cr, "git", lambda *a, **k: OLD)
        assert _hook_output(cr, monkeypatch, capsys, "git push") is None

    def test_handoff_whose_tip_is_not_head_is_rejected(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        """Covers a push where pre-push never ran at all (--no-verify, skip flag)."""
        report = isolated_reports / "a.md"
        report.write_text("head\n\n---\n\nVERDICT: SHIP\nclean\n")
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {"range": f"{PREV}..{OLD}", "report": str(report), "status": "ok", "ts": time.time()}
            )
        )
        monkeypatch.setattr(cr, "git", lambda *a, **k: HEAD)  # HEAD != recorded tip

        assert _hook_output(cr, monkeypatch, capsys, "git push") is None

    def test_pushed_ref_is_resolved_not_the_checked_out_branch(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        """`git push origin hotfix:main` from another branch must still surface.

        The tip check compared against checked-out HEAD, which sits on a different
        commit than the ref being pushed — so a valid, fresh review of the code
        that just deployed was silently discarded.
        """
        report = isolated_reports / "a.md"
        report.write_text("head\n\n---\n\nVERDICT: SHIP\nclean\n")
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {
                    "range": f"{PREV}..{HEAD}",
                    "ref": "refs/heads/hotfix",
                    "report": str(report),
                    "status": "ok",
                    "ts": time.time(),
                }
            )
        )

        # HEAD is on some other branch; only refs/heads/hotfix is at the pushed tip.
        def fake_git(*args, **kwargs):
            if args[:1] == ("rev-parse",) and len(args) > 1:
                return HEAD if args[1] == "refs/heads/hotfix" else OLD
            return ""

        monkeypatch.setattr(cr, "git", fake_git)

        out = _hook_output(cr, monkeypatch, capsys, "git push origin hotfix:main")
        assert out is not None, "a valid review of the deploying ref was discarded"
        assert "SHIP" in out["systemMessage"]

    def test_unresolvable_recorded_ref_falls_back_to_head(
        self, cr, monkeypatch, isolated_reports, capsys
    ):
        """A ref deleted since the push must not crash or wrongly surface."""
        report = isolated_reports / "a.md"
        report.write_text("head\n\n---\n\nVERDICT: SHIP\nclean\n")
        cr.PUSH_HANDOFF.write_text(
            json.dumps(
                {
                    "range": f"{PREV}..{HEAD}",
                    "ref": "refs/heads/deleted",
                    "report": str(report),
                    "status": "ok",
                    "ts": time.time(),
                }
            )
        )
        monkeypatch.setattr(
            cr, "git", lambda *a, **k: "" if len(a) > 1 and a[1] == "refs/heads/deleted" else HEAD
        )

        out = _hook_output(cr, monkeypatch, capsys, "git push")
        assert out is not None and "SHIP" in out["systemMessage"]


class TestRecordPushOutcome:
    def test_records_ok(self, cr, monkeypatch, isolated_reports):
        report = isolated_reports / "r.md"
        report.write_text("x")
        cr.record_push_outcome(f"{PREV}..{HEAD}", "VERDICT: SHIP\n", report)
        saved = json.loads(cr.PUSH_HANDOFF.read_text())
        assert saved["status"] == "ok" and saved["report"] == str(report)

    def test_ref_round_trips_into_the_handoff(self, cr, monkeypatch, isolated_reports):
        """Without this, dropping `ref=local_ref` from mode_push goes unnoticed.

        The hook tests hand-write the handoff JSON, so they would keep passing
        while the thing that writes it in production had stopped recording the ref.
        """
        report = isolated_reports / "r.md"
        report.write_text("x")
        cr.record_push_outcome(f"{PREV}..{HEAD}", "VERDICT: SHIP\n", report, ref="refs/heads/x")
        assert json.loads(cr.PUSH_HANDOFF.read_text())["ref"] == "refs/heads/x"

    def test_mode_push_records_the_ref_it_resolved(self, cr, monkeypatch, isolated_reports, ctx):
        """Pins the wiring itself: mode_push must pass its ref through, both paths."""
        monkeypatch.setattr(cr.sys, "stdin", io.StringIO(""))
        monkeypatch.setattr(
            cr, "resolve_push_target", lambda s: ("refs/heads/hotfix", ctx["range"])
        )
        monkeypatch.setattr(cr, "collect", lambda rng: ctx)
        monkeypatch.setattr(cr, "run_claude", lambda p, budget=None: (GOOD, None))
        monkeypatch.setattr(cr, "print_terminal", lambda t, p: None)

        class Args:
            notify = False

        cr.mode_push(Args())
        assert json.loads(cr.PUSH_HANDOFF.read_text())["ref"] == "refs/heads/hotfix"

        # and the nothing-to-review path
        monkeypatch.setattr(cr, "collect", lambda rng: None)
        cr.mode_push(Args())
        saved = json.loads(cr.PUSH_HANDOFF.read_text())
        assert saved["status"] == "nothing-to-review" and saved["ref"] == "refs/heads/hotfix"

    def test_records_failure_with_no_report(self, cr, monkeypatch, isolated_reports):
        cr.record_push_outcome(
            f"{PREV}..{HEAD}", f"{cr.REVIEW_FAILED}\n\nreview timed out after 300s\n", None
        )
        saved = json.loads(cr.PUSH_HANDOFF.read_text())
        assert saved["status"] == "unavailable"
        assert saved["report"] is None
        assert "timed out" in saved["detail"]


# ----------------------------------------------------------------- parsing


class TestReportParsing:
    def test_verdict_and_severity_tally(self, cr):
        report = (
            "header\n\n---\n\nVERDICT: HOLD\nbecause\n\n"
            "### [CRITICAL] `a.py:1` — boom\n"
            "### [LOW] `b.py:2` — meh\n"
        )
        assert cr.verdict_of(report) == "HOLD"
        assert cr.one_line_summary(report) == "1 critical, 1 low"

    def test_clean_report(self, cr):
        assert cr.one_line_summary("VERDICT: SHIP\nnothing\n") == "no findings"

    def test_failure_never_reads_as_clean(self, cr):
        text = f"{cr.REVIEW_FAILED}\n\nYou've hit your session limit\n"
        assert cr.failed(text)
        assert cr.verdict_of(text) == cr.REVIEW_FAILED
        assert cr.one_line_summary(text) != "no findings"


class TestWorktreeAwareness:
    """The Claude Code hook must follow the command to its actual checkout.

    It is registered in settings.json with an absolute path to ONE checkout, so
    `Path(__file__).parents[1]` names that tree regardless of where the command
    ran. Before this was fixed, a commit made in a worktree was reported using a
    concurrent session's commit from the main checkout — someone else's work
    presented as yours — and the real commit went unreviewed.
    """

    def test_repo_root_of_resolves_a_checkout(self, cr):
        assert cr.repo_root_of(str(REPO_ROOT)) is not None

    def test_repo_root_of_returns_none_outside_a_repo(self, cr):
        assert cr.repo_root_of("/") is None

    def test_repo_root_of_tolerates_missing_cwd(self, cr):
        assert cr.repo_root_of(None) is None
        assert cr.repo_root_of("/nonexistent/path/xyz") is None

    def test_retarget_moves_every_derived_path(self, cr, tmp_path, monkeypatch):
        """REPORT_DIR/LATEST/PUSH_HANDOFF must follow REPO, or the hook would
        read one tree's commits and another tree's reports."""
        original = cr.REPO
        try:
            cr.retarget_repo(tmp_path)
            assert cr.REPO == tmp_path
            assert cr.REPORT_DIR == tmp_path / "logs" / "commit-reviews"
            assert cr.LATEST.parent == cr.REPORT_DIR
            assert cr.PUSH_HANDOFF.parent == cr.REPORT_DIR
        finally:
            cr.retarget_repo(original)

    def test_claude_hook_retargets_to_the_payload_cwd(
        self, cr, tmp_path, monkeypatch, capsys
    ):
        """A payload whose cwd is a different checkout must move REPO there."""
        seen = {}
        monkeypatch.setattr(cr, "repo_root_of", lambda p: str(tmp_path) if p else None)
        monkeypatch.setattr(
            cr, "retarget_repo", lambda root: seen.update(root=str(root))
        )
        monkeypatch.setattr(
            cr.sys, "stdin",
            io.StringIO(json.dumps({
                "tool_name": "Bash",
                "cwd": "/somewhere/else",
                "tool_input": {"command": "git commit -m x"},
            })),
        )

        # Stop before the review itself — retargeting is the subject here, and a
        # real review would fire a model call.
        monkeypatch.setattr(cr, "collect", lambda rng: None)
        monkeypatch.setattr(cr, "resolve_commit_range", lambda: "a..b")

        class Args:
            notify = False

        cr.mode_claude_hook(Args())

        assert seen.get("root") == str(tmp_path), "hook did not follow the payload cwd"
