#!/usr/bin/env bash
# Getting a changed caddy/Caddyfile safely onto the running Caddy.
#
# Source it from the live stack directory (the one holding .env, caddy/ and
# docker-compose.pi.yml), then:
#
#     . scripts/pi/caddy_config.sh
#     aspiro_caddy_config_pending          # does the running Caddy differ from disk?
#     aspiro_caddy_image_pending           # is it running an image other than :latest?
#     aspiro_caddy_config_valid [FILE]     # would that config actually start Caddy?
#     aspiro_caddy_config_reject [WHICH]   # explain a rejection: incoming|on-disk|image
#     aspiro_caddy_config_apply            # make disk live (no-op when already live)
#
# Five things here are counter-intuitive, and each was verified on the Pi rather
# than assumed:
#
# 1. The Caddyfile is a SINGLE-FILE bind mount, so the mount is pinned to that
#    file's inode. rsync (without --inplace) replaces it by writing a temp file and
#    renaming it over the target, which produces a new inode. The running container
#    therefore cannot see the edit at all:
#        after an rsync-style rename -> container still reads the OLD content
#        `caddy reload`              -> still the OLD content, and exits 0
#        `docker restart`            -> new content
#    So a reload here is worse than useless: it reports success while changing
#    nothing. Only a restart re-resolves the path.
#
# 2. These checks are LEVEL-triggered, off the state of the box, not EDGE-triggered
#    off what rsync happened to change this run. A deploy that dies after rsync (a
#    failed build, a runner that goes away) leaves the new file on disk; the next
#    deploy would see no delta and skip, leaving the edit stranded indefinitely and
#    the deploy green. Comparing container-vs-disk cannot drift.
#
# 3. `caddy validate` is used rather than `caddy adapt`. adapt only converts
#    Caddyfile to JSON, so it accepts a config that cannot actually start —
#    `reverse_proxy` with no upstream adapts fine (exit 0) and then crash-loops
#    Caddy. validate provisions the modules and catches it. The cost is that it
#    needs the real CF_API_TOKEN: the cloudflare DNS module rejects an implausible
#    one. That check is a local format check, not a call to Cloudflare, so this stays
#    deterministic and offline.
#
# 4. Validation is worth doing BEFORE the rsync, on the incoming copy. Once a bad
#    Caddyfile is on disk, the running container is only protected while it holds its
#    old inode — the next reboot (and this Pi has hard-reset under ARM builds) or
#    Docker restart re-resolves the path and `restart: unless-stopped` crash-loops
#    Caddy. Hence the FILE argument: the caller can check a file that has not landed
#    yet, while the env still comes from the live directory.
#
# 5. The IMAGE is state to check too, not just the config. A deploy that builds a new
#    Caddy and then rejects it has already moved the `aspiro-caddy:latest` tag, so a
#    later unrelated deploy would recreate Caddy onto the build that was rejected
#    without anything edge-triggered firing. Hence aspiro_caddy_image_pending.

# Read one key out of the same env files compose is given. Compose is invoked as
# `--env-file .env --env-file caddy/cf.vars`, and the LAST file wins, so cf.vars
# must be read after .env or validation would run against a different token or
# domain than the container actually gets. Trimmed and unquoted, because
# `docker run --env-file` (unlike compose) passes surrounding quotes through as
# part of the value.
_aspiro_caddy_env() {  # _aspiro_caddy_env KEY [default]
  local key=$1 default=${2:-} raw
  # `|| true`: sourced into scripts under `set -e`, and sed exits non-zero when a
  # file is absent, which is normal here rather than a failure.
  raw=$(sed -n "s/^[[:space:]]*${key}=//p" .env caddy/cf.vars 2>/dev/null | tail -1 || true)
  raw=${raw%$'\r'}                      # a file saved with CRLF
  raw=${raw#"${raw%%[![:space:]]*}"}    # leading whitespace
  raw=${raw%"${raw##*[![:space:]]}"}    # trailing whitespace
  case "$raw" in
    \"*\") raw=${raw#\"}; raw=${raw%\"} ;;
    \'*\') raw=${raw#\'}; raw=${raw%\'} ;;
  esac
  if [ -n "$raw" ]; then printf '%s' "$raw"; else printf '%s' "$default"; fi
}

# True when the running Caddy is not serving the Caddyfile that is on disk. Also
# true when the container is not running or not readable — in that case `up` will
# start it from the current file and the apply step below becomes a no-op.
aspiro_caddy_config_pending() {
  ! docker exec aspiro-caddy cat /etc/caddy/Caddyfile 2>/dev/null \
    | cmp -s - caddy/Caddyfile
}

# True when the running Caddy is not on the image `aspiro-caddy:latest` now points at,
# so the next `up` will recreate it onto a different build.
#
# This exists because a failed deploy can leave a NEW image tagged latest: deploy N
# bumps caddy/Dockerfile, builds, fails validation and exits — and the tag has already
# moved. Deploy N+1, an unrelated backend commit, has no Dockerfile delta and an
# unchanged Caddyfile, so nothing edge-triggered fires, yet `up` sees a different
# image id and recreates Caddy onto the build that was rejected. Checking the state of
# the box instead catches it before anything is started.
aspiro_caddy_image_pending() {
  [ "$(docker inspect -f '{{.Image}}' aspiro-caddy 2>/dev/null)" \
    != "$(docker image inspect -f '{{.Id}}' aspiro-caddy:latest 2>/dev/null)" ]
}

# True when the given Caddyfile (default: the one on disk here) would start Caddy.
# Checked in a throwaway container: `docker exec` on the running one would read the
# stale inode from note 1 and validate the previous content. The image must be this
# stack's own, because vanilla caddy:2 cannot parse `dns cloudflare`.
aspiro_caddy_config_valid() {  # aspiro_caddy_config_valid [caddyfile path]
  local file=${1:-caddy/Caddyfile}
  case "$file" in /*) ;; *) file="$PWD/$file" ;; esac

  # A Pi with no image yet has nothing to check with; the build is what surfaces
  # problems there, so do not fail the deploy over it.
  docker image inspect aspiro-caddy:latest >/dev/null 2>&1 || return 0

  # Exported by name rather than passed as `-e KEY=value`, so a DNS-edit token never
  # appears in this host's process list for the life of the container.
  APP_DOMAIN="$(_aspiro_caddy_env APP_DOMAIN home.aspiro.dev)" \
  CF_API_TOKEN="$(_aspiro_caddy_env CF_API_TOKEN)" \
  docker run --rm -e APP_DOMAIN -e CF_API_TOKEN \
    -v "$file":/tmp/Caddyfile:ro \
    aspiro-caddy:latest caddy validate --config /tmp/Caddyfile --adapter caddyfile
}

# Explain a rejection. The flavour decides what is actually actionable, because the
# same failed check means three different things:
#   incoming  the file has not landed; production is wholly untouched
#   on-disk   it is already in the live tree, so the old inode is the only protection
#   image     the CONFIG is fine as far as anyone changed it — a rebuilt Caddy is what
#             stopped accepting it, so telling someone to fix the Caddyfile (or to
#             recover it from the container, which would reproduce the identical file)
#             sends them in the wrong direction entirely
aspiro_caddy_config_reject() {  # aspiro_caddy_config_reject [incoming|on-disk|image]
  local flavour=${1:-incoming}

  if [ "$flavour" = image ]; then
    echo "ERROR: the Caddy image now tagged aspiro-caddy:latest will not accept the" >&2
    echo "       Caddyfile on disk, which nobody necessarily changed. Nothing was" >&2
    echo "       deployed: starting it would crash-loop Caddy and take out both LAN" >&2
    echo "       HTTPS and the tunnel origin." >&2
    echo "       This is usually a caddy/Dockerfile change whose new build no longer" >&2
    echo "       parses the existing config. Revert caddy/Dockerfile and deploy again." >&2
    # Only offer the tag rollback when there IS a running container to read an image
    # from; otherwise this would expand to `docker tag "" aspiro-caddy:latest`.
    if docker inspect -f '{{.Image}}' aspiro-caddy >/dev/null 2>&1; then
      echo "       Or point the tag back at the build Caddy is still running:" >&2
      echo "         docker tag \"\$(docker inspect -f '{{.Image}}' aspiro-caddy)\" aspiro-caddy:latest" >&2
    fi
    return
  fi

  echo "ERROR: that caddy/Caddyfile would not start Caddy. Nothing was deployed." >&2
  echo "       Fix it and deploy again. Shipping it would crash-loop Caddy the next" >&2
  echo "       time the container is recreated or the Pi reboots, taking out both LAN" >&2
  echo "       HTTPS and the tunnel origin." >&2

  if [ "$flavour" = on-disk ]; then
    echo "       NOTE: this copy is already in $PWD/caddy/Caddyfile, so the protection" >&2
    echo "       above lasts only until Caddy is next recreated or the Pi reboots." >&2
    # Only claim the old config is recoverable when it demonstrably is: `pending` is
    # also true when the container is down, and the naive redirect below would then
    # truncate the Caddyfile to nothing before `docker exec` failed.
    if docker exec aspiro-caddy cat /etc/caddy/Caddyfile >/dev/null 2>&1; then
      echo "       Caddy is still serving the previous config from memory. Recover it" >&2
      echo "       (via a temp file, so a failed read cannot truncate the original):" >&2
      echo "         docker exec aspiro-caddy cat /etc/caddy/Caddyfile > caddy/Caddyfile.recovered \\" >&2
      echo "           && [ -s caddy/Caddyfile.recovered ] && mv caddy/Caddyfile.recovered caddy/Caddyfile" >&2
    else
      echo "       Caddy is not running, so there is no good config to read back —" >&2
      echo "       deploy again from a commit with a working Caddyfile." >&2
    fi
  fi
}

# Make the on-disk Caddyfile live, if it is not already. Deliberately unconditional
# on what changed this run — see note 2.
aspiro_caddy_config_apply() {
  aspiro_caddy_config_pending || return 0
  echo "==> restarting Caddy to pick up the Caddyfile on disk"
  docker restart aspiro-caddy
}
