#!/usr/bin/env bash
# Decide whether this deploy runs the Cloudflare Tunnel, and with what token.
#
# `cloudflared` sits behind the `tunnel` compose profile. Both deploy paths pass
# --remove-orphans, so the answer matters in both directions:
#
#   say "no" when a tunnel is running  -> compose deletes it, and once DNS points at
#                                         the tunnel that is the only way in
#   say "yes" with an unusable value   -> `tunnel run` exits at once and the restart
#                                         policy turns it into a crash loop
#
# Compose interpolates env-file values literally: it does not trim whitespace and
# does not treat a trailing `# comment` as anything but text. So this reads the
# token itself, trims it, rejects placeholders, and exports the cleaned value —
# the string the container gets is then exactly the one that passed the check
# (a shell variable wins over the env files during interpolation).
#
# Source it from a directory holding .env and caddy/cf.vars:
#     . scripts/pi/tunnel_token.sh
#
# Checked against: absent, real, empty, whitespace-only, padded, `# paste here`
# placeholder, CRLF line endings — see tunnel_token_test.sh.

_aspiro_read_tunnel_token() {
  local raw
  # Last definition wins, matching how the files are layered on the compose line —
  # which is `--env-file .env --env-file caddy/cf.vars`, so cf.vars must be read
  # SECOND or this would resolve a different value than the container receives.
  # `|| true`: sourced into scripts that run under `set -e`, and sed exits non-zero
  # when a file is absent — which is a normal state here, not a failure.
  raw=$(sed -n 's/^[[:space:]]*CF_TUNNEL_TOKEN=//p' .env caddy/cf.vars 2>/dev/null || true)
  raw=$(printf '%s' "$raw" | tail -1)
  raw=${raw%$'\r'}                      # a file saved with CRLF
  raw=${raw#"${raw%%[![:space:]]*}"}    # leading whitespace
  raw=${raw%"${raw##*[![:space:]]}"}    # trailing whitespace
  printf '%s' "$raw"
}

CF_TUNNEL_TOKEN=$(_aspiro_read_tunnel_token)
unset -f _aspiro_read_tunnel_token

case "$CF_TUNNEL_TOKEN" in
  '' | '#'*)
    # No token, or a commented-out placeholder: leave the tunnel out entirely.
    unset CF_TUNNEL_TOKEN
    ;;
  *)
    export CF_TUNNEL_TOKEN
    export COMPOSE_PROFILES=tunnel
    ;;
esac
