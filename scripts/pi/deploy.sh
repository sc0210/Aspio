#!/usr/bin/env bash
# Deploy Aspiro to the Raspberry Pi (primary prod host). Runs on your Mac.
#
# rsyncs the source to the Pi — WITHOUT touching the Pi's own secrets
# (.env, caddy/cf.vars) or its backups — then rebuilds the production stack
# (docker-compose.pi.yml) and reports container health.
#
# Usage:
#   scripts/pi/deploy.sh              # deploy your current WORKING TREE
#   scripts/pi/deploy.sh --main       # deploy the exact tip of origin/main (clean)
#   scripts/pi/deploy.sh --dry-run    # preview only; no rebuild (combinable with --main)
#
# --main fetches origin and deploys a clean `git archive` export of origin/main,
# so it ships exactly the latest COMMITTED main — no uncommitted local cruft, and
# NO branch switching (safe when another session shares this worktree).
#
# Config via env: PI_HOST (default scdev@192.168.0.176), PI_DIR (default ~/Aspiro)
set -euo pipefail

PI_HOST="${PI_HOST:-scdev@192.168.0.176}"
PI_DIR="${PI_DIR:-~/Aspiro}"
DRY_RUN=0
FROM_MAIN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --main)    FROM_MAIN=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Decide the source tree: a clean origin/main export, or the local working tree.
if [ "$FROM_MAIN" = 1 ]; then
  echo "==> fetching origin/main..."
  git -C "$REPO_ROOT" fetch -q origin main
  REF="$(git -C "$REPO_ROOT" rev-parse --short origin/main)"
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  # git archive = only tracked files at exactly origin/main; no working-tree cruft.
  git -C "$REPO_ROOT" archive origin/main | tar -x -C "$STAGE"
  SRC="$STAGE/"
  WHAT="origin/main ($REF)"
else
  SRC="$REPO_ROOT/"
  WHAT="working tree ($(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?') on $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
fi

# NOTE: no --delete — we never remove the Pi's local-only files (.env, cf.vars, data).
RSYNC_OPTS=(-az --stats
  --exclude '.git'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude 'frontend/.next'
  --exclude '.venv'
  --exclude '__pycache__'
  --exclude '*.pyc'
  --exclude '.claude'
  --exclude '.DS_Store'
  --exclude '.vscode'
  --exclude '*.log'
  --exclude 'logs'
  --exclude '.pytest_cache'
  --exclude '*.tsbuildinfo'
  --exclude 'backups'
  --exclude '.env'
  --exclude '.env.*'
  --exclude 'caddy/cf.vars'
)
[ "$DRY_RUN" = 1 ] && RSYNC_OPTS+=(--dry-run --itemize-changes)

echo "==> deploying: $WHAT"
echo "==> rsync -> $PI_HOST:$PI_DIR   (dry-run=$DRY_RUN)"
rsync "${RSYNC_OPTS[@]}" "$SRC" "$PI_HOST:$PI_DIR/"

if [ "$DRY_RUN" = 1 ]; then
  echo "==> dry-run only; skipping rebuild."
  exit 0
fi

echo "==> rebuilding the production stack on the Pi (a few minutes on ARM)..."
# Same rule as deploy-local.sh, via the same helper: the tunnel joins the service
# set only when the Pi has a usable token, or --remove-orphans deletes the only way
# in from outside the house. `cd || exit 1` stays its own statement so a missing
# directory aborts before compose runs from $HOME against a stray project.
#
# This is the manual fallback path and has no rsync change list to reason from, so
# it refreshes both app images unconditionally. What it must NOT do is pass a
# blanket --build: that also recompiles Caddy from Go source (~10 min on ARM) for
# an image that only caddy/Dockerfile can change. `up` with no --build still
# builds any service whose image is genuinely missing, so a fresh Pi self-heals.
# To rebuild Caddy deliberately: docker compose ... build caddy
#
# A Caddyfile edit needs Caddy restarted, not reloaded — it is a single-file bind
# mount and rsync replaces it by rename, so the running container keeps the old
# inode. caddy_config.sh does that (and refuses a config that would not start), and
# is used here as well as by deploy-local.sh so this path is not a quieter version
# of the same deploy.
ssh "$PI_HOST" "
  cd $PI_DIR || exit 1
  . scripts/pi/tunnel_token.sh
  . scripts/pi/caddy_config.sh
  compose() { docker compose --env-file .env --env-file caddy/cf.vars -f docker-compose.pi.yml \"\$@\"; }
  if aspiro_caddy_config_pending || aspiro_caddy_image_pending; then
    if ! aspiro_caddy_config_valid; then
      if aspiro_caddy_config_pending; then aspiro_caddy_config_reject on-disk
      else aspiro_caddy_config_reject image; fi
      exit 1
    fi
  fi
  compose build backend frontend || exit 1
  compose up -d --remove-orphans || exit 1
  aspiro_caddy_config_apply
"

echo "==> container health:"
ssh "$PI_HOST" "docker ps --format '{{.Names}}: {{.Status}}' | grep aspiro || true"
echo "==> done — https://home.aspiro.dev  (deployed: $WHAT)"
