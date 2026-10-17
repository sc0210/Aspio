#!/usr/bin/env bash
# Point this clone's git hooks at the committed .githooks/ directory.
#
# core.hooksPath is per-clone local config, so every clone (this Mac, the Pi,
# a worktree) has to run this once. The hooks themselves are version-controlled,
# which .git/hooks/ can never be.
#
# Undo with:  git config --unset core.hooksPath
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

chmod +x .githooks/* scripts/commit_review.py
git config core.hooksPath .githooks

echo "git hooks installed -> .githooks/"
echo "  post-commit : background review of each commit (desktop notification)"
echo "  pre-push    : synchronous review of the outgoing range (advisory, never blocks)"
echo
echo "reports  : logs/commit-reviews/   (gitignored; latest.md is always the newest)"
echo "skip once: ASPIRO_SKIP_REVIEW=1 git push"
echo "model    : \${ASPIRO_REVIEW_MODEL:-sonnet}"
