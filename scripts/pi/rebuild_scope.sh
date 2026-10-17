#!/usr/bin/env bash
# Decide what a deploy has to rebuild, from the list of files rsync actually changed.
#
# Extracted from deploy-local.sh so it can be tested: this decision is the one
# that costs real time on four ARM cores, and it has been wrong in both
# directions — a docs-only commit once recompiled the whole stack, and the
# conservative fix then rebuilt Caddy from Go source on every unrelated change.
#
# Source it, then call with the changed paths:
#     . scripts/pi/rebuild_scope.sh
#     aspiro_rebuild_scope $CHANGED
#
# It sets four variables and nothing else:
#     SCOPE_BUILD         services whose image must be rebuilt ("backend frontend")
#     SCOPE_CADDY_IMAGE   1 when caddy/Dockerfile changed, so Caddy must recompile
#     SCOPE_CADDY_CONFIG  1 when caddy/Caddyfile changed. Reporting only: whether
#                         Caddy needs restarting is decided from the state of the box
#                         (caddy_config.sh note 2), not from this run's delta. What
#                         matters here is that it does NOT land in SCOPE_BUILD.
#     SCOPE_GLOBAL        1 when an unrecognised path forced the conservative branch
#
# Why caddy is NOT in the conservative branch, when backend and frontend are:
# caddy/Dockerfile copies nothing from its build context (it builds Caddy in a
# builder stage and takes the binary across with COPY --from). Its image is
# therefore a pure function of that one file plus the upstream caddy:2 images —
# no other path in this repo can change what lands in it. The Caddyfile reaches
# the container as a bind mount, not a layer, so editing it needs Caddy restarted
# (see caddy_config.sh — a reload cannot even see the change), not a 10-minute
# recompile. Everything else stays "unknown means rebuild".
aspiro_rebuild_scope() {
  SCOPE_BUILD=""
  SCOPE_CADDY_IMAGE=0
  SCOPE_CADDY_CONFIG=0
  SCOPE_GLOBAL=0

  local path
  for path in "$@"; do
    case "$path" in
      backend/*)        SCOPE_BUILD="$SCOPE_BUILD backend" ;;
      frontend/*)       SCOPE_BUILD="$SCOPE_BUILD frontend" ;;
      caddy/Dockerfile) SCOPE_CADDY_IMAGE=1 ;;
      caddy/*)          SCOPE_CADDY_CONFIG=1 ;;
      ./|'')            ;;  # rsync emits the directory itself; not a source change
      # The deploy machinery itself. Every build context is a SUBDIRECTORY
      # (./backend, ./frontend, ./caddy), so each Dockerfile's `COPY . .` copies from
      # its own directory and top-level scripts/ cannot reach any image — nor is it
      # bind-mounted into any container (only caddy/Caddyfile is). A change here takes
      # effect by being run, not by being built: deploy-local.sh and the helpers it
      # sources run from the runner's checkout, on the very deploy that carries them.
      # Reached only after backend/* and frontend/*, so backend/scripts/ still
      # rebuilds the backend. rebuild_scope_test.sh pins both halves, and fails if a
      # build context stops being a subdirectory.
      scripts/*)        ;;
      # Cannot end up inside any image, so they cannot change one. Listed
      # explicitly rather than inferred: a docs commit rebuilding the whole stack
      # is the single most common wasted deploy, but guessing which unknown paths
      # are inert is how a needed rebuild gets skipped.
      # .playwright-mcp is test output that cannot reach an image. It matters
      # because --delete reports its removal, and an unrecognised path means
      # SCOPE_GLOBAL — a full ~15min ARM rebuild to delete a screenshot.
      *.md|docs/*|.github/*|.claude/*|.playwright-mcp/*|ai_docs/*|LICENSE|.gitignore) ;;
      *)                SCOPE_GLOBAL=1 ;;
    esac
  done

  if [ "$SCOPE_GLOBAL" -eq 1 ]; then
    # An unknown path can change how the app images are assembled, so rebuild
    # both regardless of which of them the changed paths named.
    SCOPE_BUILD="backend frontend"
  elif [ -n "${SCOPE_BUILD// /}" ]; then
    # shellcheck disable=SC2086
    SCOPE_BUILD=$(printf '%s\n' $SCOPE_BUILD | sort -u | tr '\n' ' ')
  fi
  SCOPE_BUILD="${SCOPE_BUILD#"${SCOPE_BUILD%%[![:space:]]*}"}"
  SCOPE_BUILD="${SCOPE_BUILD%"${SCOPE_BUILD##*[![:space:]]}"}"
}
