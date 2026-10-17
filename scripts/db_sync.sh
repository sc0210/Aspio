#!/usr/bin/env bash
# db_sync.sh — Sync data between local Docker PostgreSQL and remote Supabase
#
# NOTE: there are TWO db_sync.sh in this repo and they are not the same tool.
#   scripts/db_sync.sh          (this one) — status / pull / push, with --dry-run.
#                                            Does NOT touch the remote schema.
#   backend/scripts/db_sync.sh             — push only, and runs `alembic upgrade`
#                                            against the remote first.
# Both used to print the same "./scripts/db_sync.sh" usage line, so which one you
# got depended on your shell's cwd — on a command that truncates tables. Paths
# below are relative to the REPO ROOT.
#
# Usage:
#   ./scripts/db_sync.sh status         # compare row counts side-by-side
#   ./scripts/db_sync.sh pull           # Supabase → local  (overwrites local data)
#   ./scripts/db_sync.sh push           # local → Supabase  (overwrites remote data ⚠️)
#   ./scripts/db_sync.sh pull --dry-run # preview without changing anything
#   ./scripts/db_sync.sh push --dry-run
#
# Remote URL (checked in order):
#   1. SUPABASE_DB_URL environment variable
#   2. SUPABASE_DB_URL= in backend/.env
#
# Requirements:
#   - pg_dump and psql on $PATH  (brew install libpq)
#   - aspiro-postgres Docker container running  (for local side)
#   - SUPABASE_DB_URL must be the DIRECT connection (port 5432, not pooler 6543)
#     Supabase dashboard → Settings → Database → Connection string → URI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Local config ──────────────────────────────────────────────────────────────
LOCAL_CONTAINER="aspiro-postgres"
LOCAL_DB="${POSTGRES_DB:-aspiro_db}"
LOCAL_USER="${POSTGRES_USER:-aspiro_user}"

# Tables excluded from sync (schema bookkeeping — each DB manages these itself)
EXCLUDE_TABLES=("alembic_version")

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}▸ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
die()     { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────

resolve_remote_url() {
  local url="${SUPABASE_DB_URL:-}"

  if [ -z "$url" ]; then
    local env_file="$ROOT_DIR/backend/.env"
    [ -f "$env_file" ] || die "SUPABASE_DB_URL not set and $env_file not found."
    url=$(grep -E '^SUPABASE_DB_URL=' "$env_file" 2>/dev/null \
          | head -1 | cut -d= -f2- | tr -d '"' || true)
    [ -n "$url" ] || die "SUPABASE_DB_URL not found in $env_file.\nSee backend/.env.sample for the correct format."
  fi

  # Normalise SQLAlchemy async prefix → plain postgres URL
  url="${url/postgresql+asyncpg:\/\//postgresql://}"
  # Strip async-driver SSL param (not understood by psql)
  url="${url/\?ssl=require/}"
  url="${url/\?sslmode=require/}"

  echo "$url"
}

check_local() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${LOCAL_CONTAINER}$" \
    || die "Docker container '$LOCAL_CONTAINER' is not running.\nRun: docker compose up -d"
}

# Wrapper — always enforces SSL for remote psql/pg_dump calls
remote_psql()    { PGSSLMODE=require PGCONNECT_TIMEOUT=10 psql    "$@"; }
remote_pg_dump() { PGSSLMODE=require PGCONNECT_TIMEOUT=10 pg_dump "$@"; }

check_remote() {
  local url="$1"
  remote_psql "$url" -c "SELECT 1" -q --no-psqlrc >/dev/null 2>&1 \
    || die "Cannot connect to remote Supabase.\nCheck SUPABASE_DB_URL — it must be the direct connection (port 5432, not 6543)."
}

# Return public-schema tables excluding the ones we skip
get_tables() {
  local source="$1"   # "local" or a psql URL
  local exclusion_sql
  exclusion_sql=$(printf ",'%s'" "${EXCLUDE_TABLES[@]}")
  exclusion_sql="(${exclusion_sql:1})"   # strip leading comma → ('alembic_version',...)

  local query="SELECT tablename FROM pg_tables
               WHERE schemaname='public'
               AND tablename NOT IN $exclusion_sql
               ORDER BY tablename;"

  if [ "$source" = "local" ]; then
    docker exec "$LOCAL_CONTAINER" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -Atq -c "$query"
  else
    remote_psql "$source" -Atq -c "$query"
  fi
}

row_count() {
  local source="$1"   # "local" or URL
  local table="$2"
  local query="SELECT COUNT(*) FROM \"$table\";"
  if [ "$source" = "local" ]; then
    docker exec "$LOCAL_CONTAINER" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -Atq -c "$query"
  else
    remote_psql "$source" -Atq -c "$query"
  fi
}

# ── status ────────────────────────────────────────────────────────────────────

cmd_status() {
  local remote_url
  remote_url=$(resolve_remote_url)

  check_local
  info "Connecting to remote…"
  check_remote "$remote_url"

  # Collect all tables from both sides (bash 3 compatible — no mapfile)
  local_tables=()
  while IFS= read -r t; do [[ -n "$t" ]] && local_tables+=("$t"); done \
    < <(get_tables local)
  remote_tables=()
  while IFS= read -r t; do [[ -n "$t" ]] && remote_tables+=("$t"); done \
    < <(get_tables "$remote_url")

  # Union of table names
  all_tables=()
  while IFS= read -r t; do [[ -n "$t" ]] && all_tables+=("$t"); done \
    < <(printf '%s\n' "${local_tables[@]}" "${remote_tables[@]}" | sort -u)

  echo ""
  printf "${BOLD}%-30s %10s %10s %8s${RESET}\n" "Table" "Local" "Remote" "Diff"
  printf '%.0s─' {1..62}; echo ""

  local has_diff=0
  for table in "${all_tables[@]}"; do
    local local_c remote_c diff colour
    local_c=$(row_count local       "$table" 2>/dev/null || echo "—")
    remote_c=$(row_count "$remote_url" "$table" 2>/dev/null || echo "—")

    if [[ "$local_c" =~ ^[0-9]+$ ]] && [[ "$remote_c" =~ ^[0-9]+$ ]]; then
      diff=$((local_c - remote_c))
      if   [ "$diff" -eq 0 ]; then colour="$GREEN"
      elif [ "${diff#-}" -le 5 ]; then colour="$YELLOW"
      else colour="$RED"; fi
      has_diff=1
      printf "${colour}%-30s %10s %10s %+8d${RESET}\n" \
             "$table" "$local_c" "$remote_c" "$diff"
    else
      printf "${YELLOW}%-30s %10s %10s %8s${RESET}\n" \
             "$table" "$local_c" "$remote_c" "?"
    fi
  done

  echo ""
  [ "$has_diff" -eq 0 ] && success "Both databases are in sync." \
                         || warn "Diff = local count minus remote count."
}

# ── core dump / restore ───────────────────────────────────────────────────────

build_exclude_flags() {
  local flags=""
  for t in "${EXCLUDE_TABLES[@]}"; do
    flags="$flags --exclude-table-data=$t"
  done
  echo "$flags"
}

dump_local() {
  local exclude_flags
  exclude_flags=$(build_exclude_flags)
  # shellcheck disable=SC2086
  docker exec "$LOCAL_CONTAINER" pg_dump \
    -U "$LOCAL_USER" -d "$LOCAL_DB" \
    --data-only --no-owner --no-privileges \
    --schema=public \
    $exclude_flags
}

dump_remote() {
  local url="$1"
  local exclude_flags
  exclude_flags=$(build_exclude_flags)
  # shellcheck disable=SC2086
  remote_pg_dump "$url" \
    --data-only --no-owner --no-privileges \
    --schema=public \
    $exclude_flags
}

truncate_local() {
  local tables=("$@")
  local truncate_list
  truncate_list=$(printf '"%s",' "${tables[@]}")
  truncate_list="${truncate_list%,}"
  docker exec "$LOCAL_CONTAINER" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -q \
    -c "SET session_replication_role = 'replica';
        TRUNCATE TABLE $truncate_list RESTART IDENTITY CASCADE;
        SET session_replication_role = 'origin';"
}

truncate_remote() {
  local url="$1"; shift
  local tables=("$@")
  local truncate_list
  truncate_list=$(printf '"%s",' "${tables[@]}")
  truncate_list="${truncate_list%,}"
  remote_psql "$url" -q \
    -c "SET session_replication_role = 'replica';
        TRUNCATE TABLE $truncate_list RESTART IDENTITY CASCADE;
        SET session_replication_role = 'origin';"
}

restore_local() {
  local sql_data="$1"
  docker exec -i "$LOCAL_CONTAINER" psql \
    -U "$LOCAL_USER" -d "$LOCAL_DB" -q \
    --set ON_ERROR_STOP=1 \
    -c "SET session_replication_role = 'replica';" \
    <<< "$sql_data" || true
  docker exec "$LOCAL_CONTAINER" psql \
    -U "$LOCAL_USER" -d "$LOCAL_DB" -q \
    -c "SET session_replication_role = 'origin';"
}

restore_remote() {
  local url="$1"
  local sql_data="$2"
  remote_psql "$url" -q \
    --set ON_ERROR_STOP=1 \
    -c "SET session_replication_role = 'replica';" \
    <<< "$sql_data" || true
  remote_psql "$url" -q \
    -c "SET session_replication_role = 'origin';"
}

# ── pull ──────────────────────────────────────────────────────────────────────

cmd_pull() {
  local dry_run="${1:-}"
  local remote_url
  remote_url=$(resolve_remote_url)

  check_local
  info "Checking remote connection…"
  check_remote "$remote_url"

  echo ""
  echo -e "${BOLD}PULL — Supabase → Local${RESET}"
  echo -e "  ${YELLOW}This will ERASE local data and replace it with remote data.${RESET}"
  echo ""

  if [ "$dry_run" = "--dry-run" ]; then
    warn "Dry-run mode: no changes will be made."
    cmd_status
    return 0
  fi

  read -rp "  Type 'yes' to continue: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 0; }

  # Safety backup of local before overwriting
  info "Backing up local database first…"
  "$SCRIPT_DIR/backup_db.sh" >/dev/null
  success "Local backup saved to backups/db/"

  info "Dumping remote data…"
  local sql_data
  sql_data=$(dump_remote "$remote_url")

  tables=()
  while IFS= read -r t; do [[ -n "$t" ]] && tables+=("$t"); done \
    < <(get_tables local)
  info "Truncating ${#tables[@]} local tables…"
  truncate_local "${tables[@]}"

  info "Restoring remote data to local…"
  { echo "SET session_replication_role = 'replica';"; \
    remote_pg_dump "$remote_url" \
      --data-only --no-owner --no-privileges \
      --schema=public \
      $(build_exclude_flags); \
    echo "SET session_replication_role = 'origin';"; } \
    | docker exec -i "$LOCAL_CONTAINER" psql \
        -U "$LOCAL_USER" -d "$LOCAL_DB" -q \
        --set ON_ERROR_STOP=1

  echo ""
  success "Pull complete. Verifying…"
  cmd_status
}

# ── push ──────────────────────────────────────────────────────────────────────

cmd_push() {
  local dry_run="${1:-}"
  local remote_url
  remote_url=$(resolve_remote_url)

  check_local
  info "Checking remote connection…"
  check_remote "$remote_url"

  echo ""
  echo -e "${BOLD}${RED}PUSH — Local → Supabase  ⚠️  DESTRUCTIVE${RESET}"
  echo -e "  ${RED}This will ERASE all remote (Supabase) data and replace it with local data.${RESET}"
  echo ""

  if [ "$dry_run" = "--dry-run" ]; then
    warn "Dry-run mode: no changes will be made."
    cmd_status
    return 0
  fi

  warn "This will overwrite your PRODUCTION database."
  read -rp "  Are you sure? Type the word 'push' to confirm: " CONFIRM1
  [ "$CONFIRM1" = "push" ] || { echo "Aborted."; exit 0; }
  read -rp "  Final confirmation — type 'yes': " CONFIRM2
  [ "$CONFIRM2" = "yes" ] || { echo "Aborted."; exit 0; }

  # Safety dump of remote before overwriting
  info "Backing up remote database first…"
  local backup_file
  backup_file="$ROOT_DIR/backups/db/supabase_pre_push_$(date +%Y%m%d_%H%M%S).sql.gz"
  mkdir -p "$ROOT_DIR/backups/db"
  remote_pg_dump "$remote_url" \
    --no-owner --no-privileges --schema=public \
    | gzip > "$backup_file"
  success "Remote backup saved: $backup_file"

  tables=()
  while IFS= read -r t; do [[ -n "$t" ]] && tables+=("$t"); done \
    < <(get_tables "$remote_url")
  info "Truncating ${#tables[@]} remote tables…"
  truncate_remote "$remote_url" "${tables[@]}"

  info "Streaming local data to remote…"
  { echo "SET session_replication_role = 'replica';"; dump_local; echo "SET session_replication_role = 'origin';"; } \
    | remote_psql "$remote_url" -q \
        --set ON_ERROR_STOP=1

  echo ""
  success "Push complete. Verifying…"
  cmd_status
}

# ── entry point ───────────────────────────────────────────────────────────────

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  status)             cmd_status ;;
  pull)               cmd_pull  "${1:-}" ;;
  push)               cmd_push  "${1:-}" ;;
  help|--help|-h)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    die "Unknown command: $COMMAND\nUsage: db_sync.sh [status|pull|push] [--dry-run]"
    ;;
esac
