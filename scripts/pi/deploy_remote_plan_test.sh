#!/usr/bin/env bash
# Checks the remote payload scripts/pi/deploy.sh sends over ssh — by capturing it and
# then RUNNING it against stubs, not by reading it.
#
# Run by hand from the repo root:  bash scripts/pi/deploy_remote_plan_test.sh
#
# deploy.sh is the manual fallback, so it is the path least likely to be exercised
# and most likely to rot. Its payload is a shell string inside a double-quoted ssh
# argument, where `\"\$@\"` has to survive one round of expansion, and it has to do
# the same things in the same order as deploy-local.sh: refuse a Caddyfile that would
# not start Caddy, build the app images BY NAME (never a blanket --build, which
# recompiles Caddy from Go source), then apply the config by restarting Caddy.
set -u
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
cleanup() { [ -n "${work:-}" ] && [ -d "$work" ] && /bin/rm -rf -- "$work"; }
trap cleanup EXIT

mkdir -p "$work/bin" "$work/pi/caddy" "$work/pi/scripts/pi"
cp "$repo_root"/scripts/pi/*.sh "$work/pi/scripts/pi/"
: > "$work/pi/.env"
echo 'APP_DOMAIN=home.aspiro.dev' > "$work/pi/caddy/cf.vars"
echo 'config A' > "$work/pi/caddy/Caddyfile"
echo 'config A' > "$work/matching"
echo 'config B' > "$work/other"

# Capture the payload: stub ssh to print its second argument, rsync to do nothing.
cat > "$work/bin/ssh" <<'STUB'
#!/usr/bin/env bash
printf '%s' "$2" > "$PAYLOAD_OUT.$$"
cat "$PAYLOAD_OUT.$$" >> "$PAYLOAD_OUT"
printf '\n---payload-end---\n' >> "$PAYLOAD_OUT"
STUB
cat > "$work/bin/rsync" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$work/bin/ssh" "$work/bin/rsync"

: > "$work/payloads"
PATH="$work/bin:$PATH" PAYLOAD_OUT="$work/payloads" \
  PI_HOST=stub-host PI_DIR="$work/pi" \
  bash "$repo_root/scripts/pi/deploy.sh" >/dev/null 2>&1

# The first payload is the deploy; the second is the container-health one-liner.
awk 'BEGIN{n=0} /---payload-end---/{n++; next} n==0{print}' "$work/payloads" > "$work/payload.sh"

fail=0
say() {  # say <ok|FAIL> <message>
  if [ "$1" = ok ]; then printf '  ok    %s\n' "$2"; else printf '  FAIL  %s\n' "$2" >&2; fail=1; fi
}

echo '  -- the payload itself --'
if [ -s "$work/payload.sh" ]; then say ok 'a payload was captured'; else say FAIL 'no payload captured'; fi
if bash -n "$work/payload.sh" 2>/dev/null; then say ok 'parses as bash'; else say FAIL 'does not parse as bash'; fi
if grep -q 'compose() { docker compose .* "\$@"; }' "$work/payload.sh"; then
  say ok 'the "$@" in the compose helper survived ssh quoting'
else
  say FAIL 'the compose helper lost its "$@" to quoting'
fi
if grep -qE 'up -d.*--build|--build.*up -d' "$work/payload.sh"; then
  say FAIL 'passes a blanket --build, which recompiles Caddy (~10min on ARM)'
else
  say ok 'no blanket --build'
fi
if grep -q 'caddy reload' "$work/payload.sh"; then
  say FAIL 'uses `caddy reload`, which cannot see a renamed single-file bind mount'
else
  say ok 'no `caddy reload`'
fi

# Now run it. Stubs log what was asked for, so ordering can be asserted.
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [ "${1:-}" = image ] && [ "${2:-}" = inspect ]; then
  # `docker image inspect -f '{{.Id}}' aspiro-caddy:latest` -> flag $3, template $4.
  if [ "${3:-}" = -f ]; then
    case "${4:-}" in
      *.Id*) [ "${FAKE_IMAGE_MISMATCH:-0}" = 1 ] && echo 'sha256:newbuild' || echo 'sha256:same' ;;
      *)     echo 'unexpected-template' ;;
    esac
  fi
  exit 0
fi
if [ "${1:-}" = inspect ]; then
  # `docker inspect -f '{{.Image}}' aspiro-caddy` -> flag $2, template $3.
  if [ "${2:-}" = -f ]; then
    case "${3:-}" in
      *.Image*) [ "${FAKE_IMAGE_MISMATCH:-0}" = 1 ] && echo 'sha256:oldbuild' || echo 'sha256:same' ;;
      *)        echo 'unexpected-template' ;;
    esac
  fi
  exit 0
fi
if [ "${1:-}" = exec ]; then
  [ -z "${FAKE_CONTAINER_CADDYFILE:-}" ] && exit 1
  cat "$FAKE_CONTAINER_CADDYFILE"
  exit 0
fi
if [ "${FAKE_VALIDATE_FAIL:-0}" = 1 ]; then
  for a in "$@"; do [ "$a" = validate ] && exit 1; done
fi
exit 0
STUB
chmod +x "$work/bin/docker"

run_payload() {  # run_payload <container file or ''> ; sets rc, fills $work/log
  : > "$work/log"
  STUB_LOG="$work/log" FAKE_CONTAINER_CADDYFILE="$1" \
    FAKE_VALIDATE_FAIL="${FAKE_VALIDATE_FAIL:-0}" \
    FAKE_IMAGE_MISMATCH="${FAKE_IMAGE_MISMATCH:-0}" \
    PATH="$work/bin:$PATH" bash "$work/payload.sh" >"$work/out" 2>&1
  rc=$?
}

echo
echo '  -- running it: Caddy already serving what is on disk --'
run_payload "$work/matching"
[ "$rc" -eq 0 ] && say ok 'exits 0' || say FAIL "exits $rc"
grep -q 'caddy validate' "$work/log" \
  && say FAIL 'validates even though nothing is pending (an env hiccup would block a hotfix)' \
  || say ok 'skips the check when nothing is pending'
grep -q 'docker restart aspiro-caddy' "$work/log" \
  && say FAIL 'restarts Caddy for no reason' || say ok 'no needless restart'
if grep -q 'docker compose .* build backend frontend' "$work/log"; then
  say ok 'builds backend and frontend by name'
else
  say FAIL 'did not build the app images by name'
fi
grep -qE 'docker compose .* build .*caddy' "$work/log" \
  && say FAIL 'rebuilt caddy' || say ok 'left caddy alone'

echo
echo '  -- running it: Caddy stale --'
run_payload "$work/other"
[ "$rc" -eq 0 ] && say ok 'exits 0' || say FAIL "exits $rc"
grep -q 'caddy validate' "$work/log" && say ok 'checks the config' || say FAIL 'skipped the check'
grep -q 'docker restart aspiro-caddy' "$work/log" && say ok 'restarts Caddy' || say FAIL 'never applied the config'
# Order matters: validate, then build, then up, then restart.
order=$(grep -oE 'caddy validate|build backend frontend|up -d|restart aspiro-caddy' "$work/log" | tr '\n' '|')
if [ "$order" = 'caddy validate|build backend frontend|up -d|restart aspiro-caddy|' ]; then
  say ok 'order is validate -> build -> up -> restart'
else
  say FAIL "order is '$order'"
fi

echo
echo '  -- running it: Caddy on an image other than :latest --'
# The runner being down is exactly when someone reaches for deploy.sh, and a previous
# auto-deploy may have left a rejected build tagged latest. `up` would recreate Caddy
# onto it, so this path has to check even when the Caddyfile matches.
FAKE_IMAGE_MISMATCH=1 run_payload "$work/matching"
grep -q 'caddy validate' "$work/log" \
  && say ok 'checks the config even though the Caddyfile matches' \
  || say FAIL 'skipped the check, so `up` would recreate Caddy onto an unchecked image'
FAKE_IMAGE_MISMATCH=1 FAKE_VALIDATE_FAIL=1 run_payload "$work/matching"
if [ "$rc" -ne 0 ] && ! grep -qE 'docker compose .* (build|up) ' "$work/log"; then
  say ok 'aborts when that image rejects the config'
else
  say FAIL "carried on with an image that rejects the config (rc=$rc)"
fi
unset FAKE_IMAGE_MISMATCH FAKE_VALIDATE_FAIL

echo
echo '  -- running it: a config that would not start Caddy --'
FAKE_VALIDATE_FAIL=1 run_payload "$work/other"
if [ "$rc" -ne 0 ] \
   && ! grep -qE 'docker compose .* build ' "$work/log" \
   && ! grep -q 'docker restart aspiro-caddy' "$work/log"; then
  say ok 'aborts before building or restarting anything'
elif [ "$rc" -eq 0 ]; then
  say FAIL 'exited 0 with an unstartable config'
else
  say FAIL 'aborted, but only after build/restart had run'
fi
unset FAKE_VALIDATE_FAIL

echo
if [ "$fail" -eq 0 ]; then
  echo "deploy.sh's remote payload does the right things in the right order"
else
  echo "deploy.sh's remote payload is wrong in at least one way" >&2
  exit 1
fi
