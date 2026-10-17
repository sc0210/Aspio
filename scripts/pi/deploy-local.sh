#!/usr/bin/env bash
# Pi-side deploy — run by hand ON the Pi from a git checkout of the commit to ship
# (`git pull` first). Syncs the checked-out source into the live ~/Aspiro tree WITHOUT
# touching the Pi's own secrets or data (.env, caddy/cf.vars, backups), then builds
# what changed and restarts the production stack. Nothing deploys automatically.
#
# scripts/pi/deploy.sh is the same deploy pushed from a laptop over ssh. Both
# converge on the same ~/Aspiro + docker-compose.pi.yml.
#
# Usage (from the repo checkout root):  bash scripts/pi/deploy-local.sh
# Config via env: PI_DIR (default ~/Aspiro)
set -euo pipefail

PI_DIR="${PI_DIR:-$HOME/Aspiro}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root (the checkout)

echo "==> deploy-local: $SRC  ->  $PI_DIR"

cd "$PI_DIR"

# The Pi keeps its secrets in ~/Aspiro/.env and ~/Aspiro/caddy/cf.vars (not in
# git). Fail loudly if they're missing rather than build a broken stack. Checked
# before the rsync rather than after: rsync excludes both, so it cannot create them,
# and the Caddyfile gate below needs them to read the same values compose does.
[ -f .env ] || { echo "ERROR: $PI_DIR/.env missing — cannot deploy." >&2; exit 1; }
[ -f caddy/cf.vars ] || { echo "ERROR: $PI_DIR/caddy/cf.vars missing — cannot deploy." >&2; exit 1; }

. "$SRC/scripts/pi/caddy_config.sh"
. "$SRC/scripts/pi/release_checks.sh"

# Baked into any image this run builds on the Pi (compose passes it as a build arg),
# so /health names the commit the backend was built from either way.
GIT_SHA=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)
export GIT_SHA

# Refuse to even copy across a Caddyfile that would not start Caddy. Doing this
# before the rsync is what makes "production is untouched" true: once a bad config is
# on disk, the running container is only protected while it holds its old inode, and
# the next reboot — this Pi has hard-reset under ARM builds — would crash-loop Caddy.
# Skipped when caddy/Dockerfile is changing too, because the new image is what
# decides which directives parse; that case is checked after the build instead.
# The image check belongs here too, not only after the rsync: aborting later throws
# away CHANGED, so the app images this run was going to rebuild are silently skipped by
# every deploy after it (no delta any more) while the code sits on disk unbuilt.
if { ! cmp -s "$SRC/caddy/Caddyfile" caddy/Caddyfile || aspiro_caddy_image_pending; } \
   && cmp -s "$SRC/caddy/Dockerfile" caddy/Dockerfile; then
  echo "==> checking the Caddy config before anything lands"
  if ! aspiro_caddy_config_valid "$SRC/caddy/Caddyfile"; then
    # Which artifact to blame follows from which comparison brought us here, not from
    # image_pending — that is also true when the container merely does not exist.
    if ! cmp -s "$SRC/caddy/Caddyfile" caddy/Caddyfile; then aspiro_caddy_config_reject incoming
    else aspiro_caddy_config_reject image; fi
    exit 1
  fi
fi

# --delete, because ~/Aspiro is an rsync target and not a git checkout: without
# it, every file ever deleted in git stays on the Pi forever. That is not
# hypothetical — retiring /reports and /chat (#403) left 79 orphans behind, and
# the next deploy failed because the orphaned .tsx files no longer type-checked
# against the services that had been removed with them.
#
# It is safe with the excludes below: rsync does NOT delete receiver files that
# match an --exclude (that needs --delete-excluded, which we do not pass), so
# .env, .env.*, caddy/cf.vars, logs and backups are protected. An exclude
# without a leading slash matches the basename at any depth, so backend/.env is
# covered by `--exclude .env` too.
#
# Re-run the dry run whenever these excludes or rebuild_scope.sh's patterns change,
# and record what it found. It is a point-in-time check: a path that is gitignored
# but present on the Pi (as ai_docs/ and shared/ once were) shows up no other way.
#
#   Before enabling --delete: `rsync -ain --delete` against the Pi's ~/Aspiro listed
#   .playwright-mcp/, ai_docs/ and the retired root shared/ — no secrets, no data.
#   (Not the 79 orphans above: those are why --delete exists, a different set from
#   what this dry run happened to find still lying around.) Root shared/ was already
#   absent from the checkout when that dry run listed it — rsync only offers to
#   delete what the source lacks — and it is gone from the repo for good now.
#   Whether a copy still sits on the Pi is not recorded here, because nothing has
#   checked. If one does, deleting it takes the
#   unknown-path branch in rebuild_scope.sh and costs a full rebuild — not because
#   it can change an image (it cannot; every build context is a subdirectory) but
#   because it is not on the inert list. Add `shared/*` there if that ever bites.
#
#   2026-09-25, after adding --exclude '.deploy-state': 0 deletions. Run against a
#   throwaway target seeded with the Pi's local-only shape (.env, .env.production,
#   backend/.env, caddy/cf.vars, logs/, backups/, both .deploy-state markers), NOT
#   against the live box — a real --delete run on ~/Aspiro would be a deploy. Each of
#   those survived a real sync into that target with contents intact.
#
# Which excludes must be present is no longer only a comment: deploy_local_plan_test.sh
# reads the arguments this rsync is called with and fails if one of them, or --delete,
# goes missing — or if --delete-excluded ever appears, which would delete the very
# files the excludes protect.
#
# -i itemizes what actually changed; that list is what decides which images get
# rebuilt below, so this Pi never recompiles a service whose source is identical
# to what is already running.
CHANGED=$(rsync -ai --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'frontend/.next' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.pytest_cache' \
  --exclude '*.tsbuildinfo' \
  --exclude 'logs' \
  --exclude '*.log' \
  --exclude 'backups' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'caddy/cf.vars' \
  --exclude '.deploy-state' \
  "$SRC/" "$PI_DIR/" | awk '{print $2}')

# Rebuild only what changed. `up --build` rebuilt backend, frontend AND caddy on
# every deploy — a docs-only commit recompiled the whole stack. That matters more
# here than on a normal host: a full frontend build is `npm run build` on four
# ARM cores, which is both slow (~15 min) and heavy enough that this Pi has
# hard-reset under it. Which paths mean which rebuild now lives in
# rebuild_scope.sh, with a test.
#
# The tunnel runs exactly when there is a usable token to run it with.
#
# Every compose command below passes --remove-orphans, so this decision cuts both
# ways: skip the profile while a tunnel is running and compose deletes the only way
# in from outside the house; start it with an unusable value and `tunnel run` exits
# at once, which the restart policy turns into a crash loop. The helper reads the
# token, trims it, rejects placeholders, and exports the cleaned value, so what the
# container receives is exactly what was validated.
. "$SRC/scripts/pi/tunnel_token.sh"
if [ -n "${COMPOSE_PROFILES:-}" ]; then
  echo "==> tunnel token present — cloudflared included in this deploy"
fi

compose() {
  docker compose --env-file .env --env-file caddy/cf.vars \
    -f docker-compose.pi.yml "$@"
}

# Put back the images ROLLBACK recorded and recreate onto them. Runs only after the new
# containers failed verification; the database is untouched either way (deploys never
# migrate it), so the previous images are exactly what was serving before this run.
# The deploy still exits non-zero — the commit did NOT ship — but production keeps
# serving meanwhile.
aspiro_rollback_apps() {
  if [ -z "$ROLLBACK" ]; then
    echo "ERROR: nothing to roll back to (no app image was replaced this run)" >&2
    return 1
  fi
  echo "==> verification failed — rolling back: $ROLLBACK" >&2
  local svc
  for svc in $ROLLBACK; do
    docker tag "aspiro-$svc:previous" "aspiro-$svc:latest"
    cp "$STATE_DIR/$svc.tree.previous" "$STATE_DIR/$svc.tree"
  done
  compose up -d --remove-orphans
  if aspiro_verify_apps; then
    echo "==> rolled back: production is on the previous images; this commit did not ship" >&2
  else
    echo "ERROR: rollback did not recover the apps either — needs a person now" >&2
    return 1
  fi
}

# What each changed path costs is decided in one tested place — see
# rebuild_scope.sh for why caddy is handled apart from the other two.
. "$SRC/scripts/pi/rebuild_scope.sh"
# shellcheck disable=SC2086
aspiro_rebuild_scope $CHANGED

if [ "$SCOPE_GLOBAL" -eq 1 ]; then
  echo "==> shared files changed — rebuilding the app images"
fi
[ "$SCOPE_CADDY_IMAGE" -eq 1 ] && echo "==> caddy/Dockerfile changed — recompiling Caddy (~10min on ARM)"

BUILD="$SCOPE_BUILD"
[ "$SCOPE_CADDY_IMAGE" -eq 1 ] && BUILD="$BUILD caddy"
BUILD="${BUILD# }"

# The rsync delta says what changed THIS run; it cannot say whether the image on the
# box was ever built from what is now on disk. A deploy that syncs backend/ and then
# dies before the build finishes — a dropped ssh session, or this Pi hard-resetting under an
# ARM build — leaves new code with an old image, and every later deploy sees no delta
# for it. That is a green deploy serving stale code, the same shape caddy_config.sh
# note 2 describes, and the app images were never covered.
#
# So record what each image was built from and compare. The tree hash changes exactly
# when that directory's contents change, and comes from the checkout, so it
# needs no state the deploy cannot verify. Excluded from the rsync above, or --delete
# would remove it every run.
STATE_DIR="$PI_DIR/.deploy-state"
mkdir -p "$STATE_DIR"

_aspiro_tree_hash() {  # _aspiro_tree_hash <dir>   ('' when $SRC is not a git checkout)
  git -C "$SRC" rev-parse "HEAD:$1" 2>/dev/null || true
}

for _svc in backend frontend; do
  _want=$(_aspiro_tree_hash "$_svc")
  # deploy.sh ships a `git archive` export with no .git; it builds unconditionally
  # anyway, so having no hash here is not a reason to rebuild.
  [ -z "$_want" ] && continue
  _have=$(cat "$STATE_DIR/$_svc.tree" 2>/dev/null || true)
  if [ "$_want" != "$_have" ]; then
    case " $BUILD " in
      *" $_svc "*) ;;
      *) echo "==> $_svc image was not built from the current source — rebuilding"
         BUILD="$BUILD $_svc" ;;
    esac
  fi
done
BUILD="${BUILD# }"

# Backstop to the pre-rsync gate above, for a bad Caddyfile that got onto this box by
# some other route (a hand edit, or scripts/pi/deploy.sh). Level-triggered, so it
# still fires on a later run when the deploy that carried the file died — see
# caddy_config.sh note 2.
if { aspiro_caddy_config_pending || aspiro_caddy_image_pending; } \
   && [ "$SCOPE_CADDY_IMAGE" -eq 0 ]; then
  echo "==> Caddy is not running the config or image on disk — checking the config"
  if ! aspiro_caddy_config_valid; then
    if aspiro_caddy_config_pending; then aspiro_caddy_config_reject on-disk
    else aspiro_caddy_config_reject image; fi
    exit 1
  fi
fi

# Rollback point. Every app image this run is about to replace is tagged
# aspiro-<svc>:previous first, with its source marker kept beside it, so a deploy whose
# new containers fail verification can put the old ones back (aspiro_rollback_apps,
# below) instead of leaving production down until someone notices. One generation
# only: the next deploy overwrites :previous, and the image it displaced becomes
# dangling and is pruned like any other.
ROLLBACK=""
for _svc in $BUILD; do
  case "$_svc" in backend|frontend) ;; *) continue ;; esac
  if docker image inspect "aspiro-$_svc:latest" >/dev/null 2>&1; then
    docker tag "aspiro-$_svc:latest" "aspiro-$_svc:previous"
    cp "$STATE_DIR/$_svc.tree" "$STATE_DIR/$_svc.tree.previous" 2>/dev/null \
      || : > "$STATE_DIR/$_svc.tree.previous"
    ROLLBACK="$ROLLBACK $_svc"
  fi
done
ROLLBACK="${ROLLBACK# }"

if [ -n "${BUILD// /}" ]; then
  echo "==> building: $BUILD"
  # shellcheck disable=SC2086
  compose build $BUILD
  # Only now, and only for what actually built: `set -e` aborts above on failure, so a
  # half-finished deploy leaves the old marker and the next run rebuilds.
  for _svc in $BUILD; do
    [ "$_svc" = caddy ] && continue
    _h=$(_aspiro_tree_hash "$_svc")
    [ -n "$_h" ] && printf '%s\n' "$_h" > "$STATE_DIR/$_svc.tree"
  done
else
  echo "==> no image needs rebuilding"
fi

# Gated on the IMAGE, not on whether the Caddyfile changed: a new Caddy binary can
# stop parsing a Caddyfile that nobody touched (a plugin bump changing how
# `dns cloudflare` is read, say), and `up` would then recreate Caddy onto a config
# that crash-loops while the deploy went green.
if [ "$SCOPE_CADDY_IMAGE" -eq 1 ]; then
  echo "==> checking the Caddyfile against the freshly built Caddy"
  # The Caddyfile is already on disk here, so say so when it is the thing that moved.
  if ! aspiro_caddy_config_valid; then
    if [ "$SCOPE_CADDY_CONFIG" -eq 1 ]; then aspiro_caddy_config_reject on-disk
    else aspiro_caddy_config_reject image; fi
    exit 1
  fi
fi

# Last point at which the old containers are still serving: refuse to start code
# whose migrations the database has not had. Level-triggered — it reads the image and
# the database, not this run's delta — so a deploy it stopped is stopped again on
# every retry until the SQL is applied. See release_checks.sh.
aspiro_schema_gate || exit 1

# Never --build here: that is what recompiled Caddy on unrelated deploys. Any
# service whose image is genuinely missing (a fresh Pi) is still built by `up`
# from the build: stanza it kept.
compose up -d --remove-orphans

# Unconditional, and a no-op when Caddy already serves what is on disk — including
# the case where `up` just recreated the container.
aspiro_caddy_config_apply

# Cap the build cache rather than clearing it. Left alone it grows without
# bound — it reached 11.66GB and pushed this 29GB card to 82%, which is close
# enough to full that Postgres is at risk. But `builder prune -af` is the wrong
# correction: it deletes every cached layer, so the next deploy recompiles
# everything from scratch on four ARM cores. That is precisely the build that
# hard-reset the Pi on 2026-08-15.
#
# --max-used-space evicts oldest-first, so recent layers (the ones that make the next
# deploy fast) survive. Runs on every deploy, so disk stays bounded without anyone
# remembering to do it.
#
# Two things about that cap, both measured on the Pi rather than assumed:
#
#   It governs the RECLAIMABLE portion, not the total. Layers shared with the live
#   images are never evicted, so `docker system df` settles well above the number —
#   6.1GB total against 4.6GB reclaimable is the cap being satisfied, not ignored.
#   Read the reclaimable column when judging whether this is working.
#
#   The flag parses RAM-style units, so `5GB` would mean 5 GiB (5368709120), not
#   5e9. The cap below is deliberately a plain decimal 5e9 — slightly tighter than
#   `5GB`, and unambiguous, because "GB meaning GiB" is the trap that made an earlier
#   reading of this line wrong.
#
# `builder prune -af` remains the wrong correction, for the reason above.
# One place, so the message and the flag cannot drift apart.
BUILD_CACHE_CAP_BYTES=5000000000

# Images superseded by this deploy. A retag (or a rebuild) leaves the previous
# aspiro-*:latest untagged, and `builder prune` never touches images, so without this
# each deploy strands the last backend and frontend on the card. Dangling only: a
# tagged image, or one a container still uses, is never removed.
docker image prune -f >/dev/null \
  || echo "WARNING: dangling image prune failed — check disk with df -h / on the Pi" >&2

echo "==> capping build cache at ${BUILD_CACHE_CAP_BYTES} bytes of reclaimable layers"
docker builder prune -f --max-used-space "$BUILD_CACHE_CAP_BYTES" \
  || echo "WARNING: build cache prune failed — check disk with df -h / on the Pi" >&2
# Print what is left, so the deploy log carries the number the cap actually governs
# rather than leaving the next person to ssh in and work out which column to read.
# "Build Cache" is TWO awk fields, so the sizes are $5 and $6 — $4 is the ACTIVE
# count. Getting this wrong prints the total under the "reclaimable" label, which is
# the exact misreading this line exists to stop.
docker system df 2>/dev/null \
  | awk '/^Build Cache/{print "==> build cache: " $5 " total, " $6 " reclaimable"}' || true

echo "==> container health:"
docker ps --format '{{.Names}}: {{.Status}}' | grep aspiro || true

# Last, so the housekeeping above still runs when it fails. A red deploy here means the
# new code is not what is serving; see release_checks.sh.
if ! aspiro_verify_apps; then
  aspiro_rollback_apps
  exit 1
fi
echo "==> done — https://home.aspiro.dev"
