#!/usr/bin/env bash
# Drives the real deploy-local.sh with docker and rsync stubbed, and asserts which
# commands it would actually run.
#
# Run by hand from the repo root:  bash scripts/pi/deploy_local_plan_test.sh
#
# rebuild_scope_test.sh pins the decision; this pins what the decision is turned
# into. They are different failures: the scope can be right while the script builds
# the wrong set, aborts under `set -e`, applies a Caddyfile with a command that
# silently does nothing, ships a config that will not start, or decides from this
# run's rsync delta instead of the state of the box. This script has taken production
# down before, and the cheap way to keep it honest is to run it for real against
# stubs rather than to read it.
#
# Three different Caddyfiles matter here, and the cases below set each one:
#   incoming   $SRC/caddy/Caddyfile  — the repo's, fixed; what a deploy would copy
#   disk       $PI_DIR/caddy/Caddyfile — what the live tree holds now
#   container  what `docker exec … cat` returns — what Caddy is actually serving
set -u
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
cleanup() { [ -n "${work:-}" ] && [ -d "$work" ] && /bin/rm -rf -- "$work"; }
trap cleanup EXIT

mkdir -p "$work/pi/caddy" "$work/bin"
: > "$work/pi/.env"
echo 'APP_DOMAIN=home.aspiro.dev' > "$work/pi/caddy/cf.vars"
# Same Dockerfile as the repo, so the pre-rsync gate is not skipped for the wrong
# reason (it stands down when caddy/Dockerfile is also changing).
cp "$repo_root/caddy/Dockerfile" "$work/pi/caddy/Dockerfile"

cp "$repo_root/caddy/Caddyfile" "$work/same-as-incoming"
echo 'a different Caddyfile' > "$work/differs"

# Stubs. Each logs its argv; nothing touches a real daemon or a real tree.
#   FAKE_CONTAINER_CADDYFILE  what `docker exec … cat` returns ('' = exec fails)
#   FAKE_NO_IMAGE=1           model a fresh Pi with no aspiro-caddy image yet
#   FAKE_VALIDATE_FAIL=1      model a Caddyfile that would not start Caddy
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
# FAKE_NO_IMAGE and FAKE_IMAGE_MISMATCH model Caddy's image only; the app containers
# are modelled by FAKE_APP_STALE / FAKE_APP_STATE (release_checks.sh's verification).
is_caddy() { case "$*" in *aspiro-caddy*) return 0 ;; esac; return 1; }
if [ "${1:-}" = image ] && [ "${2:-}" = inspect ]; then
  [ "${FAKE_NO_IMAGE:-0}" = 1 ] && is_caddy "$@" && exit 1
  # `-f {{.Id}}` is the tag's id, used to compare against the running container.
  if [ "${3:-}" = -f ]; then
    case "${4:-}" in
      *.Id*) [ "${FAKE_IMAGE_MISMATCH:-0}" = 1 ] && is_caddy "$@" && echo 'sha256:newbuild' || echo 'sha256:same' ;;
      *)     echo 'unexpected-template' ;;
    esac
    exit 0
  fi
  exit 0
fi
if [ "${1:-}" = inspect ]; then
  # `docker inspect -f '{{.Image}}' aspiro-caddy` -> flag is $2, template $3.
  if [ "${2:-}" = -f ]; then
    case "${3:-}" in
      *State*)  echo "${FAKE_APP_STATE:-healthy}" ;;
      *.Image*)
        if is_caddy "$@"; then
          [ "${FAKE_IMAGE_MISMATCH:-0}" = 1 ] && echo 'sha256:oldbuild' || echo 'sha256:same'
        else
          # until-rollback: stale until a rollback re-tags :previous over :latest.
          if [ "${FAKE_APP_STALE:-0}" = 1 ] || { [ "${FAKE_APP_STALE:-0}" = until-rollback ] \
               && ! grep -q "docker tag ${4:-x}:previous ${4:-x}:latest" "$STUB_LOG"; }; then
            echo 'sha256:oldbuild'
          else
            echo 'sha256:same'
          fi
        fi ;;
      *)        echo 'unexpected-template' ;;
    esac
  fi
  exit 0
fi
# Schema gate: what alembic_version holds, and the new image's verdict on it.
if [ "${1:-}" = exec ] && [ "${2:-}" = aspiro-postgres ]; then
  [ "${FAKE_DB_REV-rev_head}" = '' ] && exit 1
  echo "${FAKE_DB_REV-rev_head}"
  exit 0
fi
if [ "${1:-}" = run ]; then
  case "$*" in *aspiro-backend:latest*)
    echo "${FAKE_SCHEMA_VERDICT:-current}"
    exit 0 ;;
  esac
fi
if [ "${1:-}" = exec ]; then
  # No file configured models a container that is down or crash-looping: `docker
  # exec` fails and prints nothing.
  [ -z "${FAKE_CONTAINER_CADDYFILE:-}" ] && exit 1
  cat "$FAKE_CONTAINER_CADDYFILE"
  exit 0
fi
if [ "${1:-}" = system ] && [ "${2:-}" = df ]; then
  # Real shape: "Build Cache" is two columns, so the sizes are $5 and $6.
  printf 'TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE\n'
  printf 'Images          7         4         3.374GB   874.3MB (25%%)\n'
  printf 'Containers      4         4         57.34kB   0B (0%%)\n'
  printf 'Local Volumes   6         4         742.1MB   665.3MB (89%%)\n'
  printf 'Build Cache     76        0         5.175GB   3.684GB\n'
  exit 0
fi
if [ "${FAKE_PRUNE_FAIL:-0}" = 1 ] && [ "${1:-}" = builder ]; then
  echo "prune exploded" >&2
  exit 1
fi
if [ "${FAKE_VALIDATE_FAIL:-0}" = 1 ]; then
  for a in "$@"; do [ "$a" = validate ] && exit 1; done
fi
exit 0
STUB
cat > "$work/bin/rsync" <<'STUB'
#!/usr/bin/env bash
echo "rsync ran" >> "$STUB_LOG"
echo "rsync args: $*" >> "$STUB_LOG"
# Land the incoming Caddyfile the way the real rsync would, so the case where a good
# config arrives and then has to be applied is actually exercised.
for p in $FAKE_CHANGED; do
  [ "$p" = caddy/Caddyfile ] && cp "$INCOMING_CADDYFILE" "$DISK_CADDYFILE"
  echo ">f.st...... $p"
done
exit 0
STUB
chmod +x "$work/bin/docker" "$work/bin/rsync"

fail=0

# What each image was last built from. Seeded to the checkout's current tree hashes so
# the baseline is "both images are up to date"; STALE_SVC marks one as built from
# something else, which is what a deploy that died mid-build leaves behind.
seed_markers() {  # seed_markers [service to mark stale]
  mkdir -p "$work/pi/.deploy-state"
  for svc in backend frontend; do
    if [ "${1:-}" = "$svc" ]; then
      echo 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' > "$work/pi/.deploy-state/$svc.tree"
    else
      git -C "$repo_root" rev-parse "HEAD:$svc" > "$work/pi/.deploy-state/$svc.tree"
    fi
  done
}

deploy() {  # deploy <changed> <disk caddyfile> <container caddyfile>
  seed_markers "${STALE_SVC:-}"
  cp "$2" "$work/pi/caddy/Caddyfile"
  : > "$work/log"
  STUB_LOG="$work/log" FAKE_CHANGED="$1" FAKE_CONTAINER_CADDYFILE="$3" PI_DIR="$work/pi" \
    INCOMING_CADDYFILE="$repo_root/caddy/Caddyfile" DISK_CADDYFILE="$work/pi/caddy/Caddyfile" \
    FAKE_NO_IMAGE="${FAKE_NO_IMAGE:-0}" FAKE_VALIDATE_FAIL="${FAKE_VALIDATE_FAIL:-0}" \
    FAKE_IMAGE_MISMATCH="${FAKE_IMAGE_MISMATCH:-0}" FAKE_PRUNE_FAIL="${FAKE_PRUNE_FAIL:-0}" \
    FAKE_DB_REV="${FAKE_DB_REV-rev_head}" FAKE_SCHEMA_VERDICT="${FAKE_SCHEMA_VERDICT:-current}" \
    FAKE_APP_STATE="${FAKE_APP_STATE:-healthy}" FAKE_APP_STALE="${FAKE_APP_STALE:-0}" \
    ASPIRO_VERIFY_TIMEOUT="${ASPIRO_VERIFY_TIMEOUT:-0}" ASPIRO_SKIP_SCHEMA_GATE="${ASPIRO_SKIP_SCHEMA_GATE:-0}" \
    PATH="$work/bin:$PATH" bash "$repo_root/scripts/pi/deploy-local.sh" >"$work/out" 2>&1
  rc=$?
}

check() {  # check <desc> <changed> <disk> <container> <build|NONE> <yes|no> <restart|none>
  local desc=$1 changed=$2 disk=$3 cont=$4 want_build=$5 want_validate=$6 want_apply=$7
  deploy "$changed" "$disk" "$cont"

  local got_build
  got_build=$(grep -oE 'docker compose .* build .*' "$work/log" | sed -E 's/.* build //' | tr '\n' ' ')
  got_build="${got_build% }"
  [ -z "$got_build" ] && got_build='NONE'

  local got_validate=no got_apply=none
  grep -q 'caddy validate' "$work/log" && got_validate=yes
  grep -q 'docker restart aspiro-caddy' "$work/log" && got_apply=restart

  # A `caddy reload` here would be a silent no-op: the Caddyfile is a single-file
  # bind mount and rsync replaces it by rename, so the running container keeps the
  # old inode. Fail loudly if anyone reintroduces it.
  if grep -q 'caddy reload' "$work/log"; then
    printf '  FAIL  %-34s uses `caddy reload`, which cannot see a renamed bind mount\n' "$desc"
    fail=1; return
  fi

  if [ "$rc" -eq 0 ] && [ "$got_build" = "$want_build" ] \
     && [ "$got_validate" = "$want_validate" ] && [ "$got_apply" = "$want_apply" ]; then
    printf '  ok    %-34s build=%-18s validate=%-3s apply=%s\n' \
      "$desc" "$got_build" "$got_validate" "$got_apply"
  else
    printf '  FAIL  %-34s build=%-18s validate=%-3s apply=%-7s rc=%s (wanted %s / %s / %s)\n' \
      "$desc" "$got_build" "$got_validate" "$got_apply" "$rc" \
      "$want_build" "$want_validate" "$want_apply"
    sed 's/^/          /' "$work/out" | tail -8
    fail=1
  fi
}

IN="$work/same-as-incoming"   # disk already equals what the repo would copy
DF="$work/differs"

echo '  -- steady state: incoming == disk == what Caddy serves --'
#     description                       changed                            disk  cont  build              val apply
check 'docs only'                       'README.md'                        "$IN" "$IN" 'NONE'             no  none
check 'backend code'                    'backend/app/main.py'              "$IN" "$IN" 'backend'          no  none
check 'frontend code'                   'frontend/src/app/page.tsx'        "$IN" "$IN" 'frontend'         no  none
check 'both apps'                       'backend/a.py frontend/b.tsx'      "$IN" "$IN" 'backend frontend' no  none
check 'unknown path -> apps only'       'docker-compose.pi.yml'            "$IN" "$IN" 'backend frontend' no  none
# The deploy machinery reaches no image and takes effect by being run, so it must not
# cost a ~15 min ARM rebuild. This session paid that three times before it was fixed.
check 'deploy script -> nothing'        'scripts/pi/deploy-local.sh'       "$IN" "$IN" 'NONE'             no  none
check 'backend/scripts -> backend'      'backend/scripts/run_job.py'       "$IN" "$IN" 'backend'          no  none
check 'nothing changed'                 ''                                 "$IN" "$IN" 'NONE'             no  none

echo
echo '  -- an image not built from the source on disk is rebuilt, whatever changed --'
# A deploy that synced backend/ then died leaves new code with an old image, and every
# later deploy sees no delta for it. Before this was level-triggered, a scripts-only
# follow-up — the most likely next commit after a failed deploy — went green while
# production served pre-failure code.
STALE_SVC=backend check 'stale backend, docs-only delta'  'README.md'                  "$IN" "$IN" 'backend'          no  none
STALE_SVC=backend check 'stale backend, scripts delta'    'scripts/pi/deploy-local.sh' "$IN" "$IN" 'backend'          no  none
STALE_SVC=frontend check 'stale frontend, nothing changed' ''                          "$IN" "$IN" 'frontend'         no  none
# ...and a successful build must record what it built from, or the next deploy
# rebuilds forever.
STALE_SVC=backend deploy 'README.md' "$IN" "$IN"
if [ "$(cat "$work/pi/.deploy-state/backend.tree" 2>/dev/null)" = "$(git -C "$repo_root" rev-parse HEAD:backend)" ]; then
  echo '  ok    a successful build records the tree it built'
else
  echo '  FAIL  marker not updated after building — every deploy would rebuild' >&2; fail=1
fi
unset STALE_SVC

echo
echo '  -- an incoming Caddyfile is checked BEFORE it lands --'
# The rsync stub lands the repo's Caddyfile, so disk ends up matching incoming while
# the container is still on the old one: checked first, then applied.
check 'incoming Caddyfile differs'      'caddy/Caddyfile'                  "$DF" "$DF" 'NONE'             yes restart
# ...and the check must happen against the INCOMING copy, before rsync runs. Without
# this, the gate could regress to validating the on-disk file and every case above
# would still pass.
gate_line=$(grep -n -- "-v $repo_root/caddy/Caddyfile:/tmp/Caddyfile" "$work/log" | head -1 | cut -d: -f1)
rsync_line=$(grep -n 'rsync ran' "$work/log" | head -1 | cut -d: -f1)
if [ -n "$gate_line" ] && [ -n "$rsync_line" ] && [ "$gate_line" -lt "$rsync_line" ]; then
  echo '  ok    checked the incoming copy before the rsync'
elif [ -z "$gate_line" ]; then
  echo '  FAIL  the gate did not validate $SRC/caddy/Caddyfile (wrong file?)' >&2; fail=1
else
  echo '  FAIL  the gate ran after the rsync, so a bad config lands first' >&2; fail=1
fi

echo
echo '  -- Caddy serving something other than disk: check, then restart (never reload) --'
check 'container stale'                 'caddy/Caddyfile'                  "$IN" "$DF" 'NONE'             yes restart
# The regression that matters: a deploy that died after rsync left the edit on disk,
# so there is no delta this run. Deciding from the delta would skip it forever.
check 'no delta, but container stale'   ''                                 "$IN" "$DF" 'NONE'             yes restart
check 'stale + unrelated code change'   'backend/app/main.py'              "$IN" "$DF" 'backend'          yes restart
# `docker exec` failing (container down / crash-looping) reads as stale, so the
# deploy still checks the config and restarts rather than silently doing nothing.
check 'container down (exec fails)'     ''                                 "$IN" ''    'NONE'             yes restart

echo
echo '  -- a rebuilt Caddy image is checked even when the Caddyfile did not change --'
# A plugin bump can stop a untouched Caddyfile parsing; `up` would then recreate
# Caddy onto a config that crash-loops.
check 'caddy Dockerfile only'           'caddy/Dockerfile'                 "$IN" "$IN" 'caddy'            yes none
check 'both caddy files'                'caddy/Dockerfile caddy/Caddyfile' "$IN" "$IN" 'caddy'            yes none

echo
echo '  -- when caddy/Dockerfile is also changing, the pre-rsync gate stands down --'
# The old image cannot judge a config written for the new one, so the check waits for
# the build. Modelled by making the Pi's Dockerfile differ from the repo's.
echo '# a local difference' >> "$work/pi/caddy/Dockerfile"
deploy 'caddy/Dockerfile caddy/Caddyfile' "$DF" "$DF"
gate_before_rsync=no
gl=$(grep -n -- "-v $repo_root/caddy/Caddyfile:/tmp/Caddyfile" "$work/log" | head -1 | cut -d: -f1)
rl=$(grep -n 'rsync ran' "$work/log" | head -1 | cut -d: -f1)
[ -n "$gl" ] && [ -n "$rl" ] && [ "$gl" -lt "$rl" ] && gate_before_rsync=yes
if [ "$gate_before_rsync" = no ] && [ "$rc" -eq 0 ]; then
  echo '  ok    stood down, left the check until after the build'
else
  echo "  FAIL  validated the incoming copy against the OLD caddy image (rc=$rc)" >&2; fail=1
fi
cp "$repo_root/caddy/Dockerfile" "$work/pi/caddy/Dockerfile"

echo
echo '  -- Caddy running an image other than :latest is checked too --'
# A failed earlier deploy can leave a new build tagged latest; the next unrelated
# deploy would recreate Caddy onto it, so it must be checked even with no delta at all.
FAKE_IMAGE_MISMATCH=1 check 'container on a different image'  ''            "$IN" "$IN" 'NONE'             yes none
unset FAKE_IMAGE_MISMATCH

echo
echo '  -- a fresh Pi has no image to check with, so it must not block the deploy --'
FAKE_NO_IMAGE=1 check 'no caddy image yet'  ''                             "$IN" "$DF" 'NONE'             no  restart
unset FAKE_NO_IMAGE

echo
echo '  -- a Caddyfile that would not start Caddy must stop the deploy dead --'
FAKE_VALIDATE_FAIL=1 deploy 'caddy/Caddyfile' "$DF" "$DF"
if [ "$rc" -ne 0 ] && ! grep -q 'rsync ran' "$work/log" \
   && ! grep -qE 'docker compose .* (build|up) ' "$work/log" \
   && ! grep -q 'docker restart aspiro-caddy' "$work/log"; then
  echo '  ok    incoming invalid                 aborted before the rsync; the live tree is untouched'
elif [ "$rc" -eq 0 ]; then
  echo '  FAIL  incoming invalid                 deploy exited 0' >&2; fail=1
else
  echo '  FAIL  incoming invalid                 aborted, but only after rsync/build/up had run' >&2
  sed 's/^/          /' "$work/log" | head -6; fail=1
fi
unset FAKE_VALIDATE_FAIL

# And one already on disk (arrived by hand, or via deploy.sh) must abort before the
# long ARM build rather than after it.
FAKE_VALIDATE_FAIL=1 deploy 'backend/app/main.py' "$IN" "$DF"
if [ "$rc" -ne 0 ] && ! grep -qE 'docker compose .* build ' "$work/log"; then
  echo '  ok    on-disk invalid                  aborted before the build, not after ~15min'
else
  echo '  FAIL  on-disk invalid                  built first, wasting the ARM build' >&2; fail=1
fi
unset FAKE_VALIDATE_FAIL

# A rebuilt image that rejects an untouched Caddyfile must abort, not build.
FAKE_IMAGE_MISMATCH=1 FAKE_VALIDATE_FAIL=1 deploy '' "$IN" "$IN"
if [ "$rc" -ne 0 ] && ! grep -qE 'docker compose .* (build|up) ' "$work/log"; then
  echo '  ok    image rejects the config        aborted before building or starting'
else
  echo "  FAIL  image rejects the config        rc=$rc and it carried on" >&2; fail=1
fi
unset FAKE_IMAGE_MISMATCH FAKE_VALIDATE_FAIL

echo
echo '  -- the rsync protects the Pi-local state it must not delete --'
# --delete is live, so an exclude removed here deletes real data on the next deploy.
# Losing .deploy-state in particular would wipe both build markers and rebuild backend
# and frontend every single time (~15 min on ARM), quietly undoing the point of them.
deploy 'README.md' "$IN" "$IN"
rsync_args=$(grep -m1 '^rsync args: ' "$work/log" | sed 's/^rsync args: //')
if [ -z "$rsync_args" ]; then
  echo '  FAIL  the deploy ran no rsync' >&2; fail=1
else
  missing=''
  for want in '--delete' '--exclude .deploy-state' '--exclude .env' '--exclude .env.*' \
              '--exclude caddy/cf.vars' '--exclude backups' '--exclude logs'; do
    case " $rsync_args " in *" $want "*) ;; *) missing="$missing  $want" ;; esac
  done
  # --delete-excluded would delete the very files the excludes protect.
  case " $rsync_args " in
    *' --delete-excluded '*) missing="$missing  (--delete-excluded must NOT be passed)" ;;
  esac
  if [ -z "$missing" ]; then
    echo '  ok    --delete is paired with every exclude that protects Pi-local state'
  else
    echo '  FAIL  rsync is missing protection:' >&2
    printf '        %s\n' "$missing" >&2
    fail=1
  fi
fi

echo
echo '  -- images a deploy supersedes are pruned, dangling ones only --'
deploy 'README.md' "$IN" "$IN"
iprune=$(grep -oE 'docker image prune.*' "$work/log" | head -1)
if [ -z "$iprune" ]; then
  echo '  FAIL  no dangling-image prune runs, so every deploy strands the old images' >&2; fail=1
elif printf '%s' "$iprune" | grep -qE -- '(^| )(-a|--all)( |$)'; then
  echo "  FAIL  image prune would remove tagged images too: $iprune" >&2; fail=1
else
  echo "  ok    $iprune"
fi

echo
echo '  -- the build cache is capped, never wiped --'
# `builder prune -af` deletes every cached layer, so the next deploy recompiles
# everything on four ARM cores — the build that hard-reset this Pi on 2026-08-15.
# The cap must therefore be bounded, not absolute.
deploy 'README.md' "$IN" "$IN"
cap=$(grep -oE 'docker builder prune .*' "$work/log" | head -1)
if [ -z "$cap" ]; then
  echo '  FAIL  no build-cache prune runs at all' >&2; fail=1
elif printf '%s' "$cap" | grep -qE -- '(^| )(--all|-[a-z]*a[a-z]*)( |$)'; then
  echo "  FAIL  prune wipes the whole cache: $cap" >&2; fail=1
else
  # A cap only bounds anything if it is well under the card. An extra zero, or
  # "100GB", never evicts on a 29GB SD card — which is the disk-fill this exists to
  # prevent, so check the value and not just the flag.
  bytes=$(printf '%s' "$cap" | sed -nE 's/.*--max-used-space[= ]([0-9]+)( |$).*/\1/p')
  if [ -z "$bytes" ] && ! printf '%s' "$cap" | grep -q -- '--max-used-space'; then
    # Dropping the flag entirely is a different bug from spelling it with units, and
    # blaming the wrong one sends the reader in the wrong direction.
    echo "  FAIL  prune has no --max-used-space cap: $cap" >&2; fail=1
  elif [ -z "$bytes" ]; then
    # Unanchored extraction would turn "5GB" into 5 and fail as "too small".
    echo "  FAIL  cap must be a plain byte count (units parse as GiB, not GB): $cap" >&2
    fail=1
  elif [ "$bytes" -gt 8000000000 ]; then
    echo "  FAIL  cap of $bytes bytes is too large to bound a 29GB card: $cap" >&2; fail=1
  elif [ "$bytes" -lt 1000000000 ]; then
    echo "  FAIL  cap of $bytes bytes would evict the layers that keep deploys fast" >&2; fail=1
  else
    echo "  ok    prune runs with a cap of $bytes bytes"
  fi
fi

# The size line has to name the columns the cap governs. Reading $4/$5 instead of
# $5/$6 prints the ACTIVE count as "total" and the total as "reclaimable" — the
# misreading that produced a wrong "the cap is broken" conclusion once already.
if grep -q 'build cache: 5.175GB total, 3.684GB reclaimable' "$work/out"; then
  echo '  ok    logs total and reclaimable from the right columns'
else
  echo '  FAIL  build-cache size line is wrong:' >&2
  # Capture first: `grep | sed || echo` takes sed's status, which is always 0, so the
  # fallback could never fire and a missing line printed as blank.
  line=$(grep -o 'build cache:.*' "$work/out" || true)
  printf '          %s\n' "${line:-(absent — deploy rc=$rc, so it either stopped before the prune or the awk matched nothing)}" >&2
  fail=1
fi

# The prune is housekeeping and runs AFTER the stack is up, so a failure must warn
# rather than turn a live, healthy deploy red under `set -e`.
FAKE_PRUNE_FAIL=1 deploy 'README.md' "$IN" "$IN"
if [ "$rc" -eq 0 ] && grep -q 'WARNING: build cache prune failed' "$work/out"; then
  echo '  ok    a failing prune warns without failing the deploy'
elif [ "$rc" -ne 0 ]; then
  echo "  FAIL  a failing prune took the whole deploy down (rc=$rc)" >&2; fail=1
else
  echo '  FAIL  a failing prune was silent' >&2; fail=1
fi
unset FAKE_PRUNE_FAIL

echo '  -- schema gate: the old containers keep serving until the database has caught up --'
went_up() { grep -q 'docker compose .* up -d' "$work/log"; }
gate_case() {  # gate_case <desc> <want rc 0|1> <want up yes|no> [output text that must appear]
  deploy 'backend/a.py' "$IN" "$IN"
  local up=no; went_up && up=yes
  local got_rc=0; [ "$rc" -ne 0 ] && got_rc=1
  if [ "$got_rc" = "$2" ] && [ "$up" = "$3" ] && { [ -z "${4:-}" ] || grep -q -- "$4" "$work/out"; }; then
    printf '  ok    %-34s rc=%s up=%s\n' "$1" "$got_rc" "$up"
  else
    printf '  FAIL  %-34s rc=%s up=%s (wanted rc=%s up=%s%s)\n' "$1" "$got_rc" "$up" "$2" "$3" "${4:+, output \"$4\"}"
    sed 's/^/          /' "$work/out" | tail -8
    fail=1
  fi
}
gate_case 'schema current'                 0 yes 'schema gate: database is at'
FAKE_SCHEMA_VERDICT='behind rev_new' gate_case 'schema behind -> refuse' 1 no 'database is behind'
FAKE_SCHEMA_VERDICT='behind rev_new' ASPIRO_SKIP_SCHEMA_GATE=1 \
  gate_case 'schema behind, override'      0 yes 'schema gate skipped'
FAKE_SCHEMA_VERDICT='unknown rev_old' gate_case 'schema unknown (rollback)' 0 yes 'does not know'
FAKE_DB_REV='' gate_case 'no alembic_version -> warn'   0 yes 'could not read alembic_version'
FAKE_SCHEMA_VERDICT=' ' gate_case 'no verdict from image -> warn'  0 yes 'could not read the migration head'

echo '  -- verification: a green deploy means the new containers are what is serving --'
gate_case 'apps healthy on new images'     0 yes 'verified: backend and frontend'
FAKE_APP_STALE=1 gate_case 'old container still serving' 1 yes 'is not serving this deploy'
FAKE_APP_STATE=unhealthy gate_case 'backend unhealthy'    1 yes 'state=unhealthy'
FAKE_APP_STATE=running gate_case 'no healthcheck, running' 0 yes 'verified'

echo '  -- a deploy whose new containers fail verification puts the previous images back --'
rb_case() {  # rb_case <desc> <want rc> <must-appear text> [log text that must appear]
  local desc=$1
  deploy 'backend/a.py frontend/b.tsx' "$IN" "$IN"
  local got_rc=0; [ "$rc" -ne 0 ] && got_rc=1
  if [ "$got_rc" = "$2" ] && grep -q -- "$3" "$work/out" && { [ -z "${4:-}" ] || grep -q -- "$4" "$work/log"; }; then
    printf '  ok    %-34s rc=%s\n' "$desc" "$got_rc"
  else
    printf '  FAIL  %-34s rc=%s (wanted rc=%s, output "%s"%s)\n' "$desc" "$got_rc" "$2" "$3" "${4:+, log \"$4\"}"
    sed 's/^/          /' "$work/out" | tail -8
    fail=1
  fi
}
FAKE_APP_STALE=until-rollback rb_case 'verify fails -> rollback recovers' 1 \
  'rolled back: production is on the previous images' 'docker tag aspiro-backend:previous aspiro-backend:latest'
FAKE_APP_STALE=1 rb_case 'rollback cannot recover'      1 'rollback did not recover'
# The snapshot happens before anything replaces :latest, for each app being replaced.
deploy 'backend/a.py' "$IN" "$IN"
snap=$(grep -n 'docker tag aspiro-backend:latest aspiro-backend:previous' "$work/log" | head -1 | cut -d: -f1)
build=$(grep -n 'docker compose .* build ' "$work/log" | head -1 | cut -d: -f1)
if [ -n "$snap" ] && [ -n "$build" ] && [ "$snap" -lt "$build" ] \
   && ! grep -q 'aspiro-frontend:latest aspiro-frontend:previous' "$work/log"; then
  echo '  ok    snapshot: only the app being replaced, before its build'
else
  echo "  FAIL  snapshot order/scope wrong (snapshot line ${snap:-none}, build line ${build:-none})" >&2
  fail=1
fi
deploy 'README.md' "$IN" "$IN"
if grep -q ':previous' "$work/log"; then
  echo '  FAIL  a deploy replacing nothing still touched :previous' >&2; fail=1
else
  echo '  ok    nothing replaced, nothing snapshotted'
fi

echo
if [ "$fail" -eq 0 ]; then
  echo 'deploy-local.sh turns every scope into the right commands'
else
  echo 'deploy-local.sh issues the wrong commands for at least one case' >&2
  exit 1
fi
