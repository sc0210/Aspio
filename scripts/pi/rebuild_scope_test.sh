#!/usr/bin/env bash
# Pins what each kind of change costs on the Pi.
#
# Run by hand from the repo root:  bash scripts/pi/rebuild_scope_test.sh
#
# The two failures it guards against are opposites, and this repo has hit both:
#   too eager  -> a docs commit recompiles Next on four ARM cores (~15 min) and
#                 has hard-reset the box
#   too clever -> an unrecognised path is assumed inert, the image that needed
#                 rebuilding is skipped, and the Pi serves stale code
set -u
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
. "$repo_root/scripts/pi/rebuild_scope.sh"

fail=0

check() {  # check <description> <expect "build|caddy_image|caddy_config|global"> <paths...>
  local desc=$1 want=$2; shift 2
  aspiro_rebuild_scope "$@"
  local got="${SCOPE_BUILD}|${SCOPE_CADDY_IMAGE}|${SCOPE_CADDY_CONFIG}|${SCOPE_GLOBAL}"
  if [ "$got" = "$want" ]; then
    printf '  ok    %-34s %s\n' "$desc" "$got"
  else
    printf '  FAIL  %-34s got %-28s wanted %s\n' "$desc" "$got" "$want"
    fail=1
  fi
}

#                                              build            img rel glb
check 'nothing changed'          '|0|0|0'
check 'docs only'                '|0|0|0'                 README.md docs/DEPLOYMENT.md
check 'rsync dir entry'          '|0|0|0'                 ./
check 'playwright screenshot'    '|0|0|0'                 .playwright-mcp/shot.png
# On the inert list for the same --delete reason, and previously unpinned.
check 'ai_docs'                  '|0|0|0'                 ai_docs/notes.md
check 'workflow file'            '|0|0|0'                 .github/workflows/ci.yml
check 'backend code'             'backend|0|0|0'          backend/app/main.py
check 'frontend code'            'frontend|0|0|0'         frontend/src/app/page.tsx
check 'both apps'                'backend frontend|0|0|0' backend/app/main.py frontend/src/app/page.tsx
check 'backend twice, deduped'   'backend|0|0|0'          backend/a.py backend/b.py
check 'Caddyfile only'           '|0|1|0'                 caddy/Caddyfile
check 'caddy Dockerfile'         '|1|0|0'                 caddy/Dockerfile
check 'both caddy files'         '|1|1|0'                 caddy/Dockerfile caddy/Caddyfile
# The conservative branch: unknown paths rebuild the app images, and deliberately
# leave Caddy alone — nothing outside caddy/Dockerfile can change its image.
check 'compose file (unknown)'   'backend frontend|0|0|1' docker-compose.pi.yml
# The deploy machinery cannot reach an image, and takes effect by being run.
check 'deploy script'            '|0|0|0'                 scripts/pi/deploy-local.sh
check 'deploy script + helper'   '|0|0|0'                 scripts/pi/deploy.sh scripts/pi/caddy_config.sh
# ...but backend/scripts/ IS inside the backend build context.
check 'backend/scripts is not'   'backend|0|0|0'          backend/scripts/run_historical_sync_job.py
check 'root script is unknown'   'backend frontend|0|0|1' start-local.sh
check 'unknown + caddy config'   'backend frontend|0|1|1' docker-compose.pi.yml caddy/Caddyfile
check 'unknown wins over docs'   'backend frontend|0|0|1' README.md .env.example

# The optimisation above is only sound while the Caddy image is a pure function of
# caddy/Dockerfile. Assert that rather than trust it: the moment that Dockerfile
# copies anything in from its build context, or compose points at a different
# dockerfile, a change to that file would be classified caddy/* (config-only) or
# unknown (app images only) and the Pi would quietly serve a stale Caddy.
echo
echo '  -- invariant the scope rules depend on --'
if grep -niE '^[[:space:]]*(COPY|ADD)[[:space:]]' "$repo_root/caddy/Dockerfile" | grep -iv -- '--from=' ; then
  echo '  FAIL  caddy/Dockerfile now copies from its build context — rebuild_scope.sh' >&2
  echo '        treats caddy/* as config-only, so that file would not trigger a rebuild.' >&2
  fail=1
else
  echo '  ok    caddy/Dockerfile copies nothing from its build context'
fi
if grep -qE '^[[:space:]]*dockerfile:[[:space:]]*Dockerfile[[:space:]]*$' "$repo_root/docker-compose.pi.yml"; then
  echo '  ok    docker-compose.pi.yml still builds caddy from caddy/Dockerfile'
else
  echo '  FAIL  the caddy build no longer uses caddy/Dockerfile — update rebuild_scope.sh' >&2
  fail=1
fi
# Treating scripts/* as inert rests on every build context being a subdirectory. A
# context of "." would pull the whole repo — scripts/ included — into an image, and
# then skipping the rebuild would ship stale code with a green deploy.
bad_ctx=$(grep -E '^[[:space:]]*context:' "$repo_root/docker-compose.pi.yml" | grep -vE 'context:[[:space:]]*\./[a-z]' || true)
# `build: .` (short form) and `build: {context: .}` (flow style) have no `context:`
# line of their own, so counting them separately is what catches them.
n_build=$(grep -cE '^[[:space:]]*build:[[:space:]]*$' "$repo_root/docker-compose.pi.yml" || true)
n_ctx=$(grep -cE '^[[:space:]]*context:[[:space:]]*\./[a-z]' "$repo_root/docker-compose.pi.yml" || true)
inline_build=$(grep -E '^[[:space:]]*build:[[:space:]]*[^[:space:]#]' "$repo_root/docker-compose.pi.yml" || true)
if [ -n "$inline_build" ]; then
  echo '  FAIL  a service uses an inline build: value, which may be the repo root:' >&2
  printf '        %s\n' "$inline_build" >&2
  fail=1
elif [ "$n_build" != "$n_ctx" ]; then
  echo "  FAIL  $n_build build: blocks but $n_ctx subdirectory contexts — one is unaccounted for" >&2
  fail=1
elif [ -z "$bad_ctx" ]; then
  echo '  ok    every build context is a subdirectory, so scripts/ reaches no image'
else
  echo '  FAIL  a build context is not a subdirectory — scripts/* may now reach an image:' >&2
  printf '        %s\n' "$bad_ctx" >&2
  fail=1
fi
echo

if [ "$fail" -eq 0 ]; then
  echo 'rebuild scope behaves for every case'
else
  echo 'rebuild scope is wrong for at least one case' >&2
  exit 1
fi
