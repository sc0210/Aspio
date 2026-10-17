#!/usr/bin/env bash
# Exercises tunnel_token.sh against every shape cf.vars has actually taken.
#
# Run by hand from the repo root:  bash scripts/pi/tunnel_token_test.sh
#
# It exists because this decision has been got wrong three times in a row — first
# starting the tunnel with no token (crash loop), then refusing a padded one (which
# would let --remove-orphans delete a working tunnel), then passing the padding
# through to the container (crash loop again).

set -u
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/caddy"
: > "$work/$(printf '.env')"

fail=0

check() {  # check <description> <cf.vars contents> <expect-profile> <expect-token>
  local desc=$1 contents=$2 want_profile=$3 want_token=$4
  printf '%b' "$contents" > "$work/caddy/cf.vars"
  local out
  out=$(cd "$work" && unset CF_TUNNEL_TOKEN COMPOSE_PROFILES; \
        . "$repo_root/scripts/pi/tunnel_token.sh"; \
        printf '%s|%s' "${COMPOSE_PROFILES:-}" "${CF_TUNNEL_TOKEN:-}")
  local got_profile=${out%%|*} got_token=${out#*|}
  if [ "$got_profile" = "$want_profile" ] && [ "$got_token" = "$want_token" ]; then
    printf '  ok    %-22s profile=%-6s token=%s\n' "$desc" "'${got_profile}'" "'${got_token}'"
  else
    printf '  FAIL  %-22s got profile=%s token=%s (wanted %s / %s)\n' \
      "$desc" "'$got_profile'" "'$got_token'" "'$want_profile'" "'$want_token'"
    fail=1
  fi
}

TOKEN='eyJhbGciOiJIUzI1NiJ9'

check 'absent'          'APP_DOMAIN=x\n'                               ''       ''
check 'real token'      "APP_DOMAIN=x\nCF_TUNNEL_TOKEN=$TOKEN\n"       'tunnel' "$TOKEN"
check 'empty value'     'APP_DOMAIN=x\nCF_TUNNEL_TOKEN=\n'             ''       ''
check 'whitespace only' 'APP_DOMAIN=x\nCF_TUNNEL_TOKEN=   \n'          ''       ''
check 'leading space'   "APP_DOMAIN=x\nCF_TUNNEL_TOKEN=  $TOKEN\n"     'tunnel' "$TOKEN"
check 'trailing space'  "APP_DOMAIN=x\nCF_TUNNEL_TOKEN=$TOKEN   \n"    'tunnel' "$TOKEN"
check 'placeholder'     'APP_DOMAIN=x\nCF_TUNNEL_TOKEN=# paste here\n' ''       ''
check 'commented out'   "APP_DOMAIN=x\n# CF_TUNNEL_TOKEN=$TOKEN\n"     ''       ''
check 'CRLF file'       "APP_DOMAIN=x\r\nCF_TUNNEL_TOKEN=$TOKEN\r\n"   'tunnel' "$TOKEN"

# Precedence. Compose is given `--env-file .env --env-file caddy/cf.vars`, so the
# value the container actually receives is cf.vars'. Reading the files the other way
# round would hand the tunnel a different token than compose resolved, and the
# failure would look like a tunnel that just will not connect.
printf 'CF_TUNNEL_TOKEN=from-dot-env\n' > "$work/.env"
printf 'CF_TUNNEL_TOKEN=from-cf-vars\n' > "$work/caddy/cf.vars"
got=$(cd "$work" && unset CF_TUNNEL_TOKEN COMPOSE_PROFILES; \
      . "$repo_root/scripts/pi/tunnel_token.sh"; printf '%s' "${CF_TUNNEL_TOKEN:-}")
if [ "$got" = 'from-cf-vars' ]; then
  printf '  ok    %-22s token=%s\n' 'cf.vars beats .env' "'$got'"
else
  printf '  FAIL  %-22s token=%s (wanted %s)\n' 'cf.vars beats .env' "'$got'" "'from-cf-vars'"
  fail=1
fi
: > "$work/.env"

if [ "$fail" -eq 0 ]; then
  echo 'all token-detection cases behave'
else
  echo 'token detection is wrong for at least one case' >&2
  exit 1
fi
