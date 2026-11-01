#!/usr/bin/env bash
# Backs up the aspiro-postgres Docker container to a compressed SQL file,
# verifies the dump is readable, prunes old copies, and (optionally) ships a
# copy offsite. Safe to run unattended from cron / a systemd timer.
#
# Usage:  ./scripts/backup_db.sh [backup_dir]
#
# Config via env (all optional — defaults keep the original local-only behavior):
#   POSTGRES_DB / POSTGRES_USER   DB name / user           (aspiro_db / aspiro_user)
#   KEEP_DAYS                      local retention in days  (7)
#   RCLONE_REMOTE                  offsite target, e.g. "r2:aspiro-backups"
#                                  (requires rclone; skipped if unset/absent)
#   BACKUP_SCP_DEST                offsite scp target, e.g. "sam@192.168.0.10:~/aspiro-offsite"
#   BACKUP_AGE_RECIPIENT           age public key; REQUIRED for any offsite copy, which
#                                  is uploaded as <dump>.age (the local dump stays plain)
#   PING_URL                       healthcheck URL curl'd on success (e.g. healthchecks.io)
#   OFFSITE_RETRIES                attempts to reach the remote before giving up (6)
#   OFFSITE_RETRY_DELAY            seconds before the first retry, doubling (5)
#
# Usage:
#   backup_db.sh [BACKUP_DIR]
#   backup_db.sh --if-stale [HOURS]   run only if no dump is newer than HOURS (20)
#
# The offsite step waits for the remote before uploading — a scheduled run can
# start before the network is up — and after a successful upload reconciles any
# earlier dump the remote is missing, so one failed night heals on the next good
# one instead of stranding that backup for good.
set -euo pipefail
# Dumps hold every user's finances: owner-only from the moment they are created.
umask 077

# --if-stale [HOURS]: do nothing if a recent enough dump already exists.
#
# For an @reboot companion to the nightly cron. A plain cron entry only fires if
# the machine happens to be on at the scheduled minute, and this one is not:
# across five weeks the 03:30 job ran nine times, because the Pi spends nights
# powered down and cron has no catch-up. Every missed night was silent.
IF_STALE_HOURS=""
if [ "${1:-}" = "--if-stale" ]; then
  IF_STALE_HOURS="${2:-20}"
  shift 2 2>/dev/null || shift
fi

CONTAINER="${PG_CONTAINER:-aspiro-postgres}"
DB_NAME="${POSTGRES_DB:-aspiro_db}"
DB_USER="${POSTGRES_USER:-aspiro_user}"
BACKUP_DIR="${1:-${BACKUP_DIR:-$(dirname "$0")/../backups/db}}"
KEEP_DAYS="${KEEP_DAYS:-7}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
BACKUP_SCP_DEST="${BACKUP_SCP_DEST:-}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
PING_URL="${PING_URL:-}"
# How long to keep waiting for the network before giving up on the offsite copy.
# Doubling from 5s over 6 attempts is ~2.5 minutes, which covers a scheduled run
# that fired while the machine was still bringing its interface up.
OFFSITE_RETRIES="${OFFSITE_RETRIES:-6}"
OFFSITE_RETRY_DELAY="${OFFSITE_RETRY_DELAY:-5}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/aspiro_${TIMESTAMP}.sql.gz"
log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$BACKUP_DIR"

if [ -n "$IF_STALE_HOURS" ]; then
  # `find -mmin` rather than parsing filenames: it answers "is there a dump
  # newer than N hours" without assuming the naming scheme.
  if find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' \
       -mmin "-$(( IF_STALE_HOURS * 60 ))" -print -quit | grep -q .; then
    log "A backup from the last ${IF_STALE_HOURS}h already exists; nothing to do."
    exit 0
  fi
  log "No backup in the last ${IF_STALE_HOURS}h — running one now."
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Container '$CONTAINER' is not running." >&2
  exit 1
fi

log "Backing up '$DB_NAME' from $CONTAINER..."
# Dump to a temp file first, then move into place — a crash mid-dump never
# leaves a truncated file that looks like a valid backup.
TMP_FILE="$BACKUP_FILE.partial"
docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --schema=public \
  | gzip > "$TMP_FILE"

# Integrity gate: gzip must decompress cleanly and the file must be non-trivial.
if ! gzip -t "$TMP_FILE" 2>/dev/null; then
  rm -f "$TMP_FILE"
  echo "ERROR: dump failed gzip integrity check — not saving." >&2
  exit 1
fi
BYTES=$(wc -c < "$TMP_FILE")
if [ "$BYTES" -lt 1000 ]; then
  rm -f "$TMP_FILE"
  echo "ERROR: dump is suspiciously small (${BYTES} bytes) — not saving." >&2
  exit 1
fi
mv "$TMP_FILE" "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup saved: $BACKUP_FILE ($SIZE)"

# --- Offsite copies (best-effort; a failure here must not delete local copies) ---
offsite_failed=0
# Nothing leaves this machine unencrypted: each offsite copy is <dump>.age, made in
# a private temp file and deleted after the upload.
with_encrypted() {  # with_encrypted <dump> <command…>  → runs command with "$enc" set
  local dump=$1 rc; shift
  enc=$(mktemp "${TMPDIR:-/tmp}/aspiro_offsite.XXXXXX")
  if age -r "$BACKUP_AGE_RECIPIENT" -o "$enc" "$dump" && [ -s "$enc" ]; then
    "$@"; rc=$?
  else
    echo "WARN: age encryption of $(basename "$dump") failed." >&2; rc=1
  fi
  rm -f "$enc"
  return "$rc"
}
# copyto with an explicit key (not copy into a prefix) avoids the S3 "is a file
# not a directory" conflict when a bare directory-marker object exists at the
# prefix path.
rclone_put() { rclone copyto "$enc" "$RCLONE_REMOTE/$1" 2>&1; }
upload_one() { with_encrypted "$1" rclone_put "$(basename "$1").age"; }
scp_put() { scp -q -o ConnectTimeout=10 "$enc" "$BACKUP_SCP_DEST/$1" 2>&1; }

# Scheduled runs start before the network is up.
#
# On macOS launchd fires the job the moment the clock matches — including
# straight out of sleep, with the interface not yet configured — and rclone dies
# on "dial tcp: lookup <account>.r2.cloudflarestorage.com: no such host". The
# same run succeeds by hand seconds later. Every offsite upload from this Mac
# failed that way for weeks while the local backup was written normally, so the
# job looked like it was working.
wait_for_remote() {
  local attempt delay="$OFFSITE_RETRY_DELAY"
  for attempt in $(seq 1 "$OFFSITE_RETRIES"); do
    if rclone lsf --max-depth 1 "$RCLONE_REMOTE" >/dev/null 2>&1; then
      [ "$attempt" -gt 1 ] && log "Remote reachable after ${attempt} attempts."
      return 0
    fi
    log "Remote not reachable yet (attempt ${attempt}); retrying in ${delay}s."
    sleep "$delay"
    delay=$(( delay * 2 ))
  done
  return 1
}

# One failed night used to strand that dump offsite for good: the next run only
# ever uploaded its own file, so a transient failure compounded silently. 29
# dumps had accumulated locally before anyone noticed. Reconciling what the
# remote is missing makes a bad night self-healing.
catch_up_missing() {
  local remote_list f uploaded=0
  # A listing failure is not "nothing to do" — swallowing it here would report a
  # clean run while the reconcile never happened.
  if ! remote_list=$(rclone lsf "$RCLONE_REMOTE" 2>/dev/null); then
    echo "WARN: could not list $RCLONE_REMOTE; skipped offsite catch-up." >&2
    offsite_failed=1
    return 0
  fi
  for f in "$BACKUP_DIR"/*.sql.gz; do
    [ -e "$f" ] || continue
    case "$remote_list" in
      *"$(basename "$f").age"*) continue ;;
    esac
    if upload_one "$f" >/dev/null; then
      uploaded=$(( uploaded + 1 ))
    else
      # Reporting this matters as much as doing it: a silent failure here fires
      # the success ping and exits 0, which is precisely the "29 dumps stranded,
      # nobody noticed" state this function exists to prevent — one level down.
      echo "WARN: catch-up upload failed for $(basename "$f")." >&2
      offsite_failed=1
    fi
  done
  [ "$uploaded" -gt 0 ] && log "Offsite catch-up: uploaded $uploaded earlier backup(s)."
  return 0
}

if [ -n "$RCLONE_REMOTE$BACKUP_SCP_DEST" ]; then
  if [ -z "$BACKUP_AGE_RECIPIENT" ]; then
    echo "WARN: an offsite target is set but BACKUP_AGE_RECIPIENT is not: refusing to send an unencrypted dump offsite." >&2
    offsite_failed=1
    RCLONE_REMOTE="" BACKUP_SCP_DEST=""
  elif ! command -v age >/dev/null 2>&1; then
    echo "WARN: BACKUP_AGE_RECIPIENT is set but age is not installed; skipping offsite." >&2
    offsite_failed=1
    RCLONE_REMOTE="" BACKUP_SCP_DEST=""
  fi
fi
if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    log "Uploading to rclone remote: $RCLONE_REMOTE"
    if ! wait_for_remote; then
      echo "WARN: rclone remote unreachable after retries." >&2
      offsite_failed=1
    elif upload_one "$BACKUP_FILE"; then
      log "Offsite (rclone) OK."
      catch_up_missing
    else
      echo "WARN: rclone upload failed." >&2
      offsite_failed=1
    fi
  else
    echo "WARN: RCLONE_REMOTE set but rclone is not installed — skipping offsite." >&2
    offsite_failed=1
  fi
fi
if [ -n "$BACKUP_SCP_DEST" ]; then
  log "Copying offsite via scp: $BACKUP_SCP_DEST"
  if with_encrypted "$BACKUP_FILE" scp_put "$(basename "$BACKUP_FILE").age"; then
    log "Offsite (scp) OK."
  else
    echo "WARN: scp offsite copy failed." >&2
    offsite_failed=1
  fi
fi

# --- Prune local copies older than KEEP_DAYS ---
PRUNED=$(find "$BACKUP_DIR" -name "aspiro_*.sql.gz" -mtime +"${KEEP_DAYS}" -print -delete | wc -l | tr -d ' ')
if [ "$PRUNED" -gt 0 ]; then
  log "Pruned $PRUNED backup(s) older than ${KEEP_DAYS} days."
fi

# --- Monitoring ping (healthchecks.io-style dead-man's switch) ---
# The success ping fires ONLY when the offsite upload succeeded, so a silent
# offsite failure stops the pings and the monitor alerts after its grace period.
# On failure we also hit the /fail endpoint for an immediate alert. Set PING_URL
# to a healthchecks.io check URL to enable.
if [ -n "$PING_URL" ]; then
  if [ "$offsite_failed" = 1 ]; then
    curl -fsS -m 10 "${PING_URL}/fail" >/dev/null 2>&1 || true
  else
    curl -fsS -m 10 "$PING_URL" >/dev/null 2>&1 || echo "WARN: ping failed." >&2
  fi
fi

# A failed offsite is loud: non-zero exit so cron/launchd + logs flag it. The
# local backup is already safely saved above, so no data is lost — this just
# makes an offsite problem impossible to miss.
if [ "$offsite_failed" = 1 ]; then
  echo "ERROR: offsite upload did NOT succeed (local backup is saved). See WARN above." >&2
  exit 2
fi

log "Done."
