#!/usr/bin/env bash
# Restores a compressed SQL backup into the local aspiro-postgres Docker container.
# Usage:
#   ./scripts/restore_db.sh                   # interactive — pick from list
#   ./scripts/restore_db.sh <file.sql.gz>     # restore a specific file

set -euo pipefail

CONTAINER="aspiro-postgres"
DB_NAME="${POSTGRES_DB:-aspiro_db}"
DB_USER="${POSTGRES_USER:-aspiro_user}"
BACKUP_DIR="$(dirname "$0")/../backups/db"

# Check the container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Container '$CONTAINER' is not running." >&2
  exit 1
fi

# Resolve backup file
if [ -n "${1:-}" ]; then
  BACKUP_FILE="$1"
else
  mapfile -t FILES < <(find "$BACKUP_DIR" -name "aspiro_*.sql.gz" | sort -r)
  if [ ${#FILES[@]} -eq 0 ]; then
    echo "No backups found in $BACKUP_DIR. Run ./scripts/backup_db.sh first." >&2
    exit 1
  fi
  echo "Available backups:"
  for i in "${!FILES[@]}"; do
    SIZE=$(du -sh "${FILES[$i]}" | cut -f1)
    echo "  [$i] $(basename "${FILES[$i]}") ($SIZE)"
  done
  read -rp "Select backup number [0]: " CHOICE
  CHOICE="${CHOICE:-0}"
  BACKUP_FILE="${FILES[$CHOICE]}"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: File not found: $BACKUP_FILE" >&2
  exit 1
fi

echo ""
echo "WARNING: This will ERASE all data in '$DB_NAME' and replace it with:"
echo "  $(basename "$BACKUP_FILE")"
read -rp "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "Clearing existing data..."
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q \
  -c "SET session_replication_role = 'replica'; TRUNCATE TABLE users CASCADE; SET session_replication_role = 'origin';"

echo "Restoring from $(basename "$BACKUP_FILE")..."
TMPFILE="/tmp/aspiro_restore_$$.sql"
gunzip -c "$BACKUP_FILE" > "$TMPFILE"
docker cp "$TMPFILE" "$CONTAINER:/tmp/aspiro_restore.sql"
docker exec "$CONTAINER" bash -c \
  "psql -U $DB_USER -d $DB_NAME -q -c \"SET session_replication_role = 'replica';\" -f /tmp/aspiro_restore.sql > /dev/null 2>&1; rm /tmp/aspiro_restore.sql"
rm "$TMPFILE"

echo "Verifying..."
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT 'users' as table_name, COUNT(*) FROM users
   UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
   UNION ALL SELECT 'portfolios', COUNT(*) FROM portfolios
   ORDER BY table_name;"

echo "Restore complete."
