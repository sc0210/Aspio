#!/usr/bin/env bash
# Two checks that bracket the moment deploy-local.sh swaps the app containers.
#
#   aspiro_schema_gate   BEFORE `up`: refuse to start new backend code against a
#                        database that is behind it.
#   aspiro_verify_apps   AFTER `up`: prove each app container is running the image
#                        this deploy left at aspiro-<svc>:latest, and is healthy.
#
# Source it, then call the functions. deploy_local_plan_test.sh drives both through
# the real deploy-local.sh with docker stubbed.

# --- schema gate --------------------------------------------------------------------
#
# Migrations are never applied by a deploy: prod schema changes ship as SQL in
# backend/scripts/prod_sql/ plus `alembic stamp head`, run by hand. Nothing checked
# that the hand step had happened, so a merge carrying a migration deployed code that
# queried columns the Pi's database did not have yet.
#
# The verdict comes from the NEW backend image, which carries the migration scripts
# the code was written against, compared with what alembic_version says the database
# is at:
#   current  the database is at the image's head(s)            -> deploy
#   behind   the database revision is an ancestor of the head  -> refuse; old containers keep serving
#   unknown  the image does not know that revision             -> warn and deploy
# "unknown" is a rollback to code older than the schema (the newer revision is not in
# the older image), or drift. Blocking a rollback is worse than the warning.
#
# Anything that stops the check from reaching a verdict — no backend image yet, the
# database container not running, no alembic_version table — warns and deploys: a
# fresh Pi must still come up, and that is how every deploy behaved before this.
#
# ASPIRO_SKIP_SCHEMA_GATE=1 overrides a refusal, for a deliberate deploy ahead of the
# SQL (a migration whose code tolerates both shapes).
aspiro_schema_gate() {
  if [ "${ASPIRO_SKIP_SCHEMA_GATE:-0}" = 1 ]; then
    echo "==> schema gate skipped (ASPIRO_SKIP_SCHEMA_GATE=1)"
    return 0
  fi

  local db_revs verdict
  db_revs=$(docker exec aspiro-postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select version_num from alembic_version"' \
    2>/dev/null | tr -d ' ' | grep -v '^$' | tr '\n' ' ') || true
  if [ -z "${db_revs// /}" ]; then
    echo "WARNING: schema gate could not read alembic_version from aspiro-postgres — not checked" >&2
    return 0
  fi

  # Reads the versions directory only (no env.py, no database connection), so it
  # needs no settings and works on an image that is not running yet.
  # --pull never: with no local image, docker would otherwise go looking for
  # aspiro-backend on Docker Hub.
  verdict=$(docker run --rm --pull never --entrypoint python -e DB_REVS="$db_revs" aspiro-backend:latest -c '
import os
from alembic.config import Config
from alembic.script import ScriptDirectory
s = ScriptDirectory.from_config(Config("alembic.ini"))
heads, db = set(s.get_heads()), set(os.environ["DB_REVS"].split())
if db == heads:
    print("current")
elif all(s.get_revision(r) is not None for r in db):
    print("behind " + " ".join(sorted(heads)))
else:
    print("unknown " + " ".join(sorted(heads)))
' 2>/dev/null) || true

  case "$verdict" in
    current)
      echo "==> schema gate: database is at the code's migration head ($db_revs)" ;;
    behind*)
      echo "ERROR: the Pi's database is behind the code being deployed." >&2
      echo "         database at:  $db_revs" >&2
      echo "         code expects: ${verdict#behind }" >&2
      echo "       The running containers were left untouched. Apply the pending SQL from" >&2
      echo "       backend/scripts/prod_sql/ on the Pi, then \`alembic stamp head\`, and re-run" >&2
      echo "       the deploy. To deploy anyway: ASPIRO_SKIP_SCHEMA_GATE=1." >&2
      return 1 ;;
    unknown*)
      echo "WARNING: the database is at $db_revs, which the code being deployed does not know" >&2
      echo "         (its head: ${verdict#unknown }). Expected on a rollback past a migration;" >&2
      echo "         otherwise the schema has drifted. Deploying anyway." >&2 ;;
    *)
      echo "WARNING: schema gate could not read the migration head from aspiro-backend:latest — not checked" >&2 ;;
  esac
  return 0
}

# --- post-deploy verification ---------------------------------------------------------
#
# The deploy used to end at `up -d` and the workflow then checked that / returned 200.
# That passes when nothing changed at all: a backend that failed to recreate leaves
# the OLD container answering, and the frontend serves / without the backend. So:
# every app container must be running exactly the image at aspiro-<svc>:latest (which
# is what this deploy pulled or built), and report healthy — the backend's compose
# healthcheck, or plain `running` for the frontend, which has none.
#
# ASPIRO_VERIFY_TIMEOUT (seconds, default 180) covers the backend's start_period and
# its first 30s healthcheck interval.
aspiro_verify_apps() {
  local timeout="${ASPIRO_VERIFY_TIMEOUT:-180}" svc want have state ok
  local deadline=$((SECONDS + timeout))
  while :; do
    ok=1
    for svc in backend frontend; do
      want=$(docker image inspect -f '{{.Id}}' "aspiro-$svc:latest" 2>/dev/null || true)
      have=$(docker inspect -f '{{.Image}}' "aspiro-$svc" 2>/dev/null || true)
      state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "aspiro-$svc" 2>/dev/null || true)
      if [ -z "$want" ] || [ "$want" != "$have" ] || { [ "$state" != healthy ] && [ "$state" != running ]; }; then
        ok=0
        [ "$SECONDS" -ge "$deadline" ] && {
          echo "ERROR: aspiro-$svc is not serving this deploy: state=${state:-missing}," >&2
          echo "       running image ${have:-none}, expected ${want:-none}" >&2
          echo "       docker logs --tail 100 aspiro-$svc" >&2
          return 1
        }
      fi
    done
    [ "$ok" = 1 ] && { echo "==> verified: backend and frontend are running this deploy's images and healthy"; return 0; }
    sleep 5
  done
}
