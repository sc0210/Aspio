#!/usr/bin/env bash
# Exercises caddy_config.sh's env reader and its container-vs-disk comparison.
#
# Run by hand from the repo root:  bash scripts/pi/caddy_config_test.sh
#
# The env reader matters because `caddy validate` provisions the Cloudflare module
# and rejects an implausible token: read the wrong value and a perfectly good
# Caddyfile blocks the deploy. Precedence in particular is easy to get backwards —
# compose is given `--env-file .env --env-file caddy/cf.vars`, so cf.vars wins.
set -u
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
cleanup() { [ -n "${work:-}" ] && [ -d "$work" ] && /bin/rm -rf -- "$work"; }
trap cleanup EXIT
mkdir -p "$work/caddy" "$work/bin"

fail=0

env_case() {  # env_case <desc> <.env contents> <cf.vars contents> <key> <default> <expected>
  local desc=$1 envc=$2 vars=$3 key=$4 default=$5 want=$6
  printf '%b' "$envc" > "$work/.env"
  printf '%b' "$vars" > "$work/caddy/cf.vars"
  local got
  got=$(cd "$work" && . "$repo_root/scripts/pi/caddy_config.sh" && _aspiro_caddy_env "$key" "$default")
  if [ "$got" = "$want" ]; then
    printf '  ok    %-34s %s=%s\n' "$desc" "$key" "'$got'"
  else
    printf '  FAIL  %-34s %s=%s (wanted %s)\n' "$desc" "$key" "'$got'" "'$want'"
    fail=1
  fi
}

echo '  -- env reader --'
env_case 'from cf.vars'              ''                        'APP_DOMAIN=a.example\n'      APP_DOMAIN d.example a.example
env_case 'from .env'                 'APP_DOMAIN=b.example\n'  ''                            APP_DOMAIN d.example b.example
# The one that was backwards: compose layers cf.vars last, so cf.vars must win.
env_case 'cf.vars beats .env'        'APP_DOMAIN=b.example\n'  'APP_DOMAIN=a.example\n'      APP_DOMAIN d.example a.example
env_case 'absent -> default'         ''                        ''                            APP_DOMAIN d.example d.example
env_case 'empty value -> default'    ''                        'APP_DOMAIN=\n'               APP_DOMAIN d.example d.example
env_case 'padding trimmed'           ''                        'APP_DOMAIN=   a.example  \n' APP_DOMAIN d.example a.example
env_case 'double quotes stripped'    ''                        'APP_DOMAIN="a.example"\n'    APP_DOMAIN d.example a.example
env_case 'single quotes stripped'    ''                        "APP_DOMAIN='a.example'\n"    APP_DOMAIN d.example a.example
env_case 'CRLF file'                 ''                        'APP_DOMAIN=a.example\r\n'    APP_DOMAIN d.example a.example
env_case 'commented out -> default'  ''                        '# APP_DOMAIN=a.example\n'    APP_DOMAIN d.example d.example
env_case 'token with no default'     ''                        'CF_API_TOKEN=cfut_abc123\n'  CF_API_TOKEN ''      cfut_abc123
env_case 'later line in one file'    ''                        'APP_DOMAIN=x\nAPP_DOMAIN=y\n' APP_DOMAIN d.example y

echo
echo '  -- container vs disk --'
: > "$work/.env"
echo 'APP_DOMAIN=a.example' > "$work/caddy/cf.vars"
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = exec ]; then
  [ -z "${FAKE_CONTAINER_CADDYFILE:-}" ] && exit 1
  cat "$FAKE_CONTAINER_CADDYFILE"
  exit 0
fi
exit 0
STUB
chmod +x "$work/bin/docker"
echo 'config A' > "$work/caddy/Caddyfile"
echo 'config A' > "$work/matching"
echo 'config B' > "$work/other"

pending_case() {  # pending_case <desc> <container file or ''> <yes|no>
  local desc=$1 cfile=$2 want=$3 got
  if (cd "$work" && PATH="$work/bin:$PATH" FAKE_CONTAINER_CADDYFILE="$cfile" \
      bash -c ". '$repo_root/scripts/pi/caddy_config.sh'; aspiro_caddy_config_pending"); then
    got=yes
  else
    got=no
  fi
  if [ "$got" = "$want" ]; then
    printf '  ok    %-34s pending=%s\n' "$desc" "$got"
  else
    printf '  FAIL  %-34s pending=%s (wanted %s)\n' "$desc" "$got" "$want"
    fail=1
  fi
}

pending_case 'container matches disk'       "$work/matching" no
pending_case 'container serving something else' "$work/other" yes
# A container that is down or crash-looping must read as pending, not as "fine":
# `up` will start it and the apply step is then a no-op.
pending_case 'docker exec fails'            ''               yes

echo
if [ "$fail" -eq 0 ]; then
  echo 'caddy_config.sh reads its env and compares state correctly'
else
  echo 'caddy_config.sh is wrong for at least one case' >&2
  exit 1
fi
