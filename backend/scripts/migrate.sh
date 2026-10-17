#!/usr/bin/env bash
# One-shot schema migration entrypoint, for a container or a host shell.
#
#   docker compose --profile migrate run --rm migrate              (every update)
#   docker compose --profile migrate run --rm migrate bash scripts/migrate.sh --init
#   DATABASE_URL=postgresql+asyncpg://user:pw@host:5432/db backend/scripts/migrate.sh [--init]
#
# Waits for the database, prints the revision before, runs `alembic upgrade heads`,
# prints the revision after, and exits non-zero if the database never came up or the
# migration failed.
#
#   - Empty database WITH --init (a first install): the schema is built from the
#     models, reference data (currencies, starter categories) is seeded and the head
#     is stamped (see alembic/env.py).
#   - Empty database WITHOUT --init: fails. On an existing install an empty database
#     means a lost volume or a wrong DATABASE_URL, and must never come back as a
#     fresh, healthy-looking app with no data.
#   - Database already at head: a no-op.
#   - Database behind head: the chain is applied. Note prod-only SQL conventions in
#     CLAUDE.md still apply to the live Pi database.
#
# Environment:
#   DATABASE_URL            required (asyncpg / postgresql / postgres:// forms all work)
#   MIGRATE_WAIT_SECONDS    how long to wait for the database (default 60)
set -euo pipefail

INIT=0
case "${1:-}" in
  --init) INIT=1 ;;
  "") ;;
  *) echo "usage: migrate.sh [--init]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is not set}"
WAIT="${MIGRATE_WAIT_SECONDS:-60}"

# Reachability check through the same driver Alembic uses, so a wrong password or a
# missing database fails here with a clear message rather than inside a migration.
python - "$WAIT" <<'PY'
import sys, time
from sqlalchemy import create_engine, text
from app.core.config import get_settings

deadline = time.time() + float(sys.argv[1])
engine = create_engine(get_settings().database_url_sync, pool_pre_ping=True)
last = None
while time.time() < deadline:
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        print("migrate: database is reachable", flush=True)
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001 - any failure means "not yet"
        last = exc
        time.sleep(1)
print(f"migrate: database not reachable after {sys.argv[1]}s: {last}", file=sys.stderr)
sys.exit(1)
PY

# The stamped revision(s), read from alembic_version itself. Prints the revision(s);
# nothing when the table is missing or has no row (an empty database); and "?" when
# the query itself failed, whose error goes to stderr. Scraping `alembic current`
# instead read any stray line at column 0 as a revision, and a failed read must not
# pass for an empty database: that would tell someone with data that it may be gone.
current_raw() {  # the query; its tagged line on stdout, any error on stderr
  python - <<'PY' || true
from sqlalchemy import create_engine, inspect, text
from app.core.config import get_settings

engine = create_engine(get_settings().database_url_sync)
with engine.connect() as c:
    if inspect(c).has_table("alembic_version"):
        revs = c.execute(text("SELECT version_num FROM alembic_version ORDER BY 1")).scalars()
        print("ASPIRO_REV:" + ",".join(revs))
    else:
        print("ASPIRO_REV:")
PY
}
current() {
  local out
  # Tagged, and only the tagged line kept: importing the app may print to stdout too.
  out=$(current_raw | sed -n 's/^ASPIRO_REV:/=/p' | head -n1)
  if [ -z "$out" ]; then echo "?"; else printf '%s\n' "${out#=}"; fi
}

before="$(current)"
if [ "$before" = "?" ]; then
  echo "migrate: revision before: <unknown, could not read alembic_version>"
else
  echo "migrate: revision before: ${before:-<none, empty database>}"
fi
# Only --init lets an empty database be built from the models (alembic/env.py).
if [ "$INIT" -eq 1 ]; then
  ALEMBIC_BOOTSTRAP_EMPTY=1 alembic upgrade heads
elif ! alembic upgrade heads; then
  if [ -z "$before" ]; then
    echo "migrate: the database is EMPTY and --init was not given." >&2
    echo "migrate: on a new install run: migrate.sh --init. On an existing one, check the" >&2
    echo "migrate: postgres volume and DATABASE_URL first - data may be missing." >&2
  fi
  exit 1
fi
after="$(current)"
echo "migrate: revision after:  ${after:-<none>}"

# Captured, not piped into `grep -q`: under pipefail an early grep exit can SIGPIPE
# alembic and fail a database that is in fact at head.
status="$(alembic current 2>&1 || true)"
if [ -z "$after" ] || [ "$after" = "?" ] || [[ "$status" != *'(head)'* ]]; then
  echo "migrate: database is not at head after upgrade" >&2
  exit 1
fi
echo "migrate: done"
