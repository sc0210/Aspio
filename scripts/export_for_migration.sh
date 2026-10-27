#!/usr/bin/env bash
# Exports the dev Docker stack's data for a move to another host, and checks the
# restored copy once it is there.
#
# Usage:
#   ./scripts/export_for_migration.sh [OUT_DIR]       # on this host (default backups/migrate)
#   ./scripts/export_for_migration.sh --check COUNTS  # on the new host, right after the SQL restore
#
# Export writes four files, all mode 600 (they hold real financial data):
#   aspiro_<stamp>.sql.gz          pg_dump --no-owner --no-privileges, gzip-verified
#   aspiro_<stamp>.uploads.tar.gz  receipt attachments; the DB only points at them
#   aspiro_<stamp>.counts          row count per table + alembic version, for --check
#   aspiro_<stamp>.sha256          checksums of the three above
#
# backend and frontend are stopped for the dump so nothing writes mid-export, and
# started again on exit (also on failure). A logical dump rather than a copy of the
# postgres_data volume: the raw data directory is tied to the Postgres major version
# and is not safe to carry across architectures (arm64 Mac -> amd64 host).
#
# Restore on the new host: docs/SELF_HOSTING.md, "Moving the dev stack's data to a
# new host". Run --check BEFORE `scripts/aspiro update`: once the backend is up it
# writes rows and may migrate, and the counts stop being an exact comparison. Never
# pass --init there.
set -euo pipefail

CONTAINER="${PG_CONTAINER:-aspiro-postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Every public table's row count, plus the schema version, one "name count" per line.
# Sorted with collation C so the line order does not depend on the host's locale.
COUNTS_SQL="select name, n from (
select table_name::text as name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as n
from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all select 'alembic_version=' || version_num, null from alembic_version
) s order by name collate \"C\";"

die() { echo "ERROR: $*" >&2; exit 1; }

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die "container '$CONTAINER' is not running."

psql_c() {
  docker exec -i "$CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F" " -v ON_ERROR_STOP=1'
}

if [ "${1:-}" = "--check" ]; then
  EXPECTED="${2:-}"
  [ -f "$EXPECTED" ] || die "usage: $0 --check aspiro_<stamp>.counts"
  ACTUAL="$(mktemp)"
  trap 'rm -f "$ACTUAL"' EXIT
  echo "$COUNTS_SQL" | psql_c > "$ACTUAL"
  if diff "$EXPECTED" "$ACTUAL"; then
    echo "OK: $(grep -vc '^alembic_version=' "$ACTUAL") tables, every row count and the schema version match."
  else
    echo "MISMATCH: lines marked < are the export, > this database." >&2
    echo "A newer alembic_version alone is expected if 'aspiro update' migrated past the export." >&2
    exit 1
  fi
  exit 0
fi

OUT_DIR="${1:-$ROOT/backups/migrate}"
STAMP="$(date +%Y%m%d_%H%M%S)"
BASE="$OUT_DIR/aspiro_$STAMP"
UPLOADS_DIR="$ROOT/backend/uploads"   # bind-mounted into the dev backend as /app/uploads

mkdir -p "$OUT_DIR"
umask 077

compose() { docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml" "$@"; }

# Stop only what is running, and bring back exactly that. A plain word list, not
# mapfile: macOS still ships bash 3.2.
RUNNING="$(compose ps --services --status running | grep -xE 'backend|frontend' | xargs || true)"
restart() {
  [ -z "$RUNNING" ] && return
  echo "==> starting $RUNNING again"
  # shellcheck disable=SC2086
  compose start $RUNNING >/dev/null
}
trap restart EXIT
if [ -n "$RUNNING" ]; then
  echo "==> stopping $RUNNING so nothing writes during the dump"
  # shellcheck disable=SC2086
  compose stop $RUNNING >/dev/null
fi

echo "==> dumping database to $BASE.sql.gz"
docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  | gzip > "$BASE.sql.gz.partial" || { rm -f "$BASE.sql.gz.partial"; die "pg_dump failed"; }
gzip -t "$BASE.sql.gz.partial" || { rm -f "$BASE.sql.gz.partial"; die "dump is not a valid gzip"; }
mv "$BASE.sql.gz.partial" "$BASE.sql.gz"

echo "==> archiving uploads to $BASE.uploads.tar.gz"
mkdir -p "$UPLOADS_DIR"
# No macOS ._* AppleDouble files or xattr headers: GNU tar in the container would extract them as junk.
COPYFILE_DISABLE=1 tar --no-xattrs -C "$UPLOADS_DIR" -czf "$BASE.uploads.tar.gz" .

echo "==> recording row counts to $BASE.counts"
echo "$COUNTS_SQL" | psql_c > "$BASE.counts"

(cd "$OUT_DIR" && shasum -a 256 "$(basename "$BASE").sql.gz" "$(basename "$BASE").uploads.tar.gz" \
  "$(basename "$BASE").counts" > "$(basename "$BASE").sha256")

ls -lh "$BASE".*
cat <<EOF

Done: $(grep -vc '^alembic_version=' "$BASE.counts") tables, $(awk '{s+=$2} END {print s}' "$BASE.counts") rows, $(grep '^alembic_version=' "$BASE.counts" | tr -d ' ').
Next:
  scp $BASE.* user@newhost:~/
  # on the new host (full steps: docs/SELF_HOSTING.md):
  shasum -a 256 -c aspiro_$STAMP.sha256
  # ... start only postgres, restore the .sql.gz, then before 'aspiro update':
  scripts/export_for_migration.sh --check ~/aspiro_$STAMP.counts
These files are plaintext financial data: delete them once the new host checks out.
EOF
