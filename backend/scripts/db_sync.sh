#!/usr/bin/env bash
# db_sync.sh — push local Docker DB data to Supabase (schema + data)
#
# NOTE: there are TWO db_sync.sh in this repo and they are not the same tool.
#   backend/scripts/db_sync.sh  (this one) — push only, and runs `alembic upgrade`
#                                            against the remote FIRST, so it can
#                                            change the remote schema.
#   scripts/db_sync.sh                     — status / pull / push, with --dry-run,
#                                            and never touches the remote schema.
# Both used to print the same "./scripts/db_sync.sh" usage line, so which one you
# got depended on your shell's cwd — on a command that truncates tables. Paths
# below are relative to the REPO ROOT.
#
# Usage:
#   ./backend/scripts/db_sync.sh <supabase-direct-url>
#   # OR set SUPABASE_DB_URL in your shell and run with no args
#
# The SUPABASE_DB_URL must be the DIRECT connection (not a pooler), e.g.:
#   postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
#
# What this does:
#   1. Runs Alembic migrations on the remote DB (schema sync)
#   2. Dumps user-data tables from the local Docker DB
#   3. Truncates those tables on remote (clean slate)
#   4. Restores the dump to remote

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
LOCAL_HOST=localhost
LOCAL_PORT=5433
LOCAL_USER=aspiro_user
LOCAL_DB=aspiro_db
PGPASSWORD_LOCAL=aspiro_password   # default Docker password

# Remote URL: arg > env var
REMOTE="${1:-${SUPABASE_DB_URL:-}}"
if [[ -z "$REMOTE" ]]; then
  echo "ERROR: Provide the Supabase direct URL as an argument or set SUPABASE_DB_URL"
  echo "  postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres"
  exit 1
fi

# ── Safety guard ──────────────────────────────────────────────────────────────
# This script TRUNCATEs every table on the remote and replaces it with a copy of
# LOCAL. Against a database with real users that is UNRECOVERABLE without a backup
# (it is exactly what emptied prod). Require an explicit, conscious opt-in.
CONFIRM_TOKEN="WIPE_REMOTE_AND_REPLACE_WITH_LOCAL"
REMOTE_HOST="$(printf '%s' "$REMOTE" | sed -E 's#^[^@]*@##; s#[/?].*$##')"   # host only (no password)
if [[ "${CONFIRM:-}" != "$CONFIRM_TOKEN" ]]; then
  echo "╔══════════════════════════════════════════════════════════════════════╗"
  echo "║  REFUSING TO RUN                                                      ║"
  echo "║  This DELETES all data on the remote and replaces it with your LOCAL  ║"
  echo "║  data. Unrecoverable without a backup. Use only on a throwaway/empty  ║"
  echo "║  target — never a production DB with real users.                     ║"
  echo "╚══════════════════════════════════════════════════════════════════════╝"
  echo "  Target : ${REMOTE_HOST}"
  echo "  To proceed:  CONFIRM=${CONFIRM_TOKEN} $0 $*"
  exit 1
fi

# Tables to sync, in FK dependency order (parents before children)
TABLES=(
  users
  oauth_providers
  transaction_categories
  portfolios
  portfolio_holdings
  portfolio_transactions
  debt_accounts
  transactions
  recurring_transactions
  goals
  goal_contributions
  goal_milestones
  notification_preferences
  dividends
)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/.."
DUMP_FILE=$(mktemp /tmp/aspiro_sync_XXXXXX.sql)
trap 'rm -f "$DUMP_FILE"' EXIT

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Aspiro DB Sync: local → Supabase"
echo "═══════════════════════════════════════════════════════"

# ── Step 1: Schema — run Alembic on remote ───────────────────────────────────
echo ""
echo "▶  Step 1: Running Alembic migrations on remote..."
cd "$BACKEND_DIR"

# Alembic uses psycopg2 (sync driver); strip asyncpg prefix if present
ALEMBIC_URL=$(echo "$REMOTE" | sed 's|postgresql+asyncpg://|postgresql://|')
# Add sslmode if missing and connecting to Supabase
if [[ "$ALEMBIC_URL" == *"supabase.co"* ]] && [[ "$ALEMBIC_URL" != *"sslmode="* ]]; then
  if [[ "$ALEMBIC_URL" == *"?"* ]]; then
    ALEMBIC_URL="${ALEMBIC_URL}&sslmode=require"
  else
    ALEMBIC_URL="${ALEMBIC_URL}?sslmode=require"
  fi
fi

ENVIRONMENT=production DATABASE_URL="$ALEMBIC_URL" \
  python -m alembic upgrade head
echo "   Schema up to date."

# ── Step 2: Dump local data ───────────────────────────────────────────────────
echo ""
echo "▶  Step 2: Dumping local data from ${LOCAL_DB}@${LOCAL_HOST}:${LOCAL_PORT}..."

TABLE_FLAGS=()
for t in "${TABLES[@]}"; do
  TABLE_FLAGS+=(-t "$t")
done

# Run pg_dump inside the Docker container to match the server version (pg15)
docker exec aspiro-postgres bash -c \
  "PGPASSWORD=$PGPASSWORD_LOCAL pg_dump \
    -h localhost -U $LOCAL_USER $LOCAL_DB \
    --data-only --no-owner --no-privileges \
    $(printf -- '-t %s ' "${TABLES[@]}")" \
  > "$DUMP_FILE"

DUMP_SIZE=$(wc -c < "$DUMP_FILE" | tr -d ' ')
# pg15 wraps dumps with \restrict / \unrestrict <token> lines that psql 14 rejects — strip both
sed -i '' '/^\\restrict /d; /^\\unrestrict /d' "$DUMP_FILE"
echo "   Dump written: $DUMP_FILE (${DUMP_SIZE} bytes)"

# ── Step 3: Truncate + restore in ONE transaction (atomic) ────────────────────
# Truncate and restore must NOT be separate psql calls: if the restore fails
# after the truncate has committed, the remote is left empty (data loss). Piping
# BEGIN … TRUNCATE … <dump> … COMMIT through a single psql session with
# ON_ERROR_STOP=1 makes it all-or-nothing — any error rolls the truncate back.
echo ""
echo "▶  Step 3: Replacing remote data (atomic truncate + restore)..."

TRUNCATE_STMTS=""
for t in $(printf '%s\n' "${TABLES[@]}" | tac); do
  TRUNCATE_STMTS+="TRUNCATE TABLE public.$t CASCADE;"$'\n'
done

{
  echo "BEGIN;"
  echo "SET LOCAL session_replication_role = 'replica';"   # transaction-scoped; auto-reverts
  printf '%s' "$TRUNCATE_STMTS"
  cat "$DUMP_FILE"
  echo "COMMIT;"
} | psql "$REMOTE" --set ON_ERROR_STOP=1 -q
echo "   Remote data replaced (committed)."

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Sync complete!"
echo "═══════════════════════════════════════════════════════"
echo ""

# Quick row-count verification
echo "Remote row counts:"
for t in users portfolios transactions portfolio_transactions goals; do
  COUNT=$(psql "$REMOTE" -t -c "SELECT COUNT(*) FROM $t" 2>/dev/null | tr -d ' ')
  echo "  $t: $COUNT"
done
