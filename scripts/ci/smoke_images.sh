#!/usr/bin/env bash
# Start the production images against a real Postgres and drive them end to end.
#
# CI proves the code compiles and its unit tests pass; nothing started the actual
# images. Several production crashes compiled clean (an unspecced mock hid a missing
# repository method, a driver default changed under a dependency bump), and the
# first place they showed was the Pi. This runs the images the way production does
# — production settings, real Postgres, Next's standalone server — and fails on the
# first thing that does not answer as it should.
#
# Usage:  scripts/ci/smoke_images.sh <backend image> <frontend image>
# Local:  docker build -t smoke-backend backend
#         docker build -t smoke-frontend --build-arg NEXT_PUBLIC_API_URL=http://localhost:18000/api/v1 frontend
#         scripts/ci/smoke_images.sh smoke-backend smoke-frontend
#
# Everything it creates is named "$SMOKE_PREFIX-*" (default "smoke") on its own
# network, and removed on exit; nothing touches the dev stack's containers or ports.
set -euo pipefail

BACKEND_IMAGE=${1:?backend image}
FRONTEND_IMAGE=${2:?frontend image}
P=${SMOKE_PREFIX:-smoke}
BPORT=${SMOKE_BACKEND_PORT:-18000}
FPORT=${SMOKE_FRONTEND_PORT:-13000}
API="http://localhost:$BPORT/api/v1"
NET="$P-net"
DB_URL="postgresql+asyncpg://smoke:smoke@$P-postgres:5432/smoke"
SECRET="smoke-secret-key-0123456789abcdef0123456789"

passed=0
ok()   { passed=$((passed + 1)); echo "  ok    $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    for c in backend frontend; do
      echo "---- $P-$c logs (last 40) ----" >&2
      docker logs --tail 40 "$P-$c" >&2 2>&1 || true
    done
  fi
  docker rm -f "$P-frontend" "$P-backend" "$P-postgres" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT

wait_for() {  # wait_for <desc> <seconds> <command...>
  local desc=$1 secs=$2; shift 2
  local deadline=$((SECONDS + secs))
  until "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -ge "$deadline" ] && fail "$desc did not come up within ${secs}s"
    sleep 2
  done
}

# code <method> <url> [curl args...] -> prints the HTTP status, body to $BODY
BODY=$(mktemp)
code() {
  local method=$1 url=$2; shift 2
  curl -s -o "$BODY" -w '%{http_code}' -X "$method" --max-time 30 "$@" "$url" || echo 000
}
json() { python3 -c "import sys,json; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$BODY" "$1"; }

echo "==> starting Postgres, then $BACKEND_IMAGE"
docker network create "$NET" >/dev/null
# Retried: a Docker Hub blip should not turn CI red and hold a deploy.
for _ in 1 2 3; do docker pull -q postgres:15-alpine >/dev/null && break; sleep 10; done
docker run -d --name "$P-postgres" --network "$NET" \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke postgres:15-alpine >/dev/null
wait_for "Postgres" 60 docker exec "$P-postgres" pg_isready -U smoke -d smoke

# Production settings, except that the schema is created at startup: a fresh
# database has none, and the migration chain cannot build one from empty (prod's
# schema predates Alembic). So this schema comes from the models, not from prod's
# history: a column prod lacks would not show up here. `alembic stamp` below proves
# Alembic loads, connects and writes in the image; no migration is executed.
docker run -d --name "$P-backend" --network "$NET" -p "127.0.0.1:$BPORT:8000" \
  -e ENVIRONMENT=production -e DEBUG=false \
  -e DATABASE_URL="$DB_URL" -e SKIP_DB_SCHEMA_INIT=false \
  -e SECRET_KEY="$SECRET" -e RATE_LIMIT_ENABLED=false -e ENABLE_SCHEDULER=false \
  -e CORS_ORIGINS="[\"http://localhost:$FPORT\"]" \
  -e FRONTEND_URL="http://localhost:$FPORT" \
  "$BACKEND_IMAGE" >/dev/null
wait_for "backend /health" 120 curl -sf "http://localhost:$BPORT/health"

# Reference data the schema alone does not provide (see the seed file for why).
REPO=$(cd "$(dirname "$0")/../.." && pwd)
docker exec -i "$P-postgres" psql -q -U smoke -d smoke -v ON_ERROR_STOP=1 \
  < "$REPO/backend/scripts/seed/currencies.sql" >/dev/null || fail "currency seed"

echo "==> backend"
[ "$(code GET "http://localhost:$BPORT/health")" = 200 ] || fail "/health"
ok "/health 200 (commit $(json 'd.get("commit")'))"

# The production image must be able to run Alembic: the deploy's schema gate and
# every prod schema change depend on it. It could not, until SQLAlchemy 2.1's new
# default driver was pinned away in database_url_sync.
docker exec "$P-backend" alembic stamp head >/dev/null 2>&1 \
  || { docker exec "$P-backend" alembic stamp head; fail "alembic stamp head in the image"; }
current=$(docker exec "$P-backend" alembic current 2>/dev/null)
case "$current" in *"(head)"*) ok "alembic connects and stamps head in the image: ${current%% *}" ;;
                   *) fail "alembic current: $current" ;; esac

[ "$(code GET "$API/users/me")" = 401 ] || fail "unauthenticated /users/me should be 401"
ok "unauthenticated /users/me 401"

email="smoke-$RANDOM@example.com"
pw="Smoke-password-1"
s=$(code POST "$API/users/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"name\":\"Smoke Test\",\"password\":\"$pw\",\"confirm_password\":\"$pw\",\"terms_accepted\":true}")
case "$s" in 200|201) ok "register $s" ;; *) cat "$BODY" >&2; fail "register -> $s" ;; esac

# New accounts wait for an admin; approve this one the way the admin panel does —
# status active, is_active true — matching whatever spelling the enum stores, so this does
# not break if the enum is ever stored by value instead of by name.
psql_smoke() { docker exec "$P-postgres" psql -U smoke -d smoke -v ON_ERROR_STOP=1 -tAc "$1"; }
pending=$(psql_smoke "select status::text from users where email = '$email'")
case "$pending" in
  PENDING_APPROVAL) active=ACTIVE ;;
  pending_approval) active=active ;;
  *) fail "new user's status is '$pending', expected pending approval" ;;
esac
psql_smoke "update users set status = '$active', is_active = true where email = '$email'" >/dev/null
ok "registration pending approval ($pending), approved"

s=$(code POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$pw\"}")
[ "$s" = 200 ] || { cat "$BODY" >&2; fail "login -> $s"; }
token=$(json 'd["access_token"]')
AUTH=(-H "Authorization: Bearer $token")
ok "login 200"

s=$(code GET "$API/users/me" "${AUTH[@]}")
[ "$s" = 200 ] || { cat "$BODY" >&2; fail "/users/me with a token -> $s"; }
ok "/users/me 200"

s=$(code POST "$API/transactions/" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"type\":\"expense\",\"amount\":123.45,\"description\":\"smoke lunch\",\"transaction_date\":\"$(date -u +%F)\",\"category_name\":\"Dining\"}")
case "$s" in 200|201) ok "create transaction $s" ;; *) cat "$BODY" >&2; fail "create transaction -> $s" ;; esac

s=$(code GET "$API/transactions/" "${AUTH[@]}")
[ "$s" = 200 ] || { cat "$BODY" >&2; fail "list transactions -> $s"; }
grep -q 'smoke lunch' "$BODY" || { cat "$BODY" >&2; fail "the new transaction is not in the list"; }
ok "list transactions 200, includes the new one"

s=$(code GET "$API/dashboard/stats" "${AUTH[@]}")
[ "$s" = 200 ] || { cat "$BODY" >&2; fail "dashboard stats -> $s"; }
ok "dashboard stats 200"

echo "==> starting $FRONTEND_IMAGE"
docker run -d --name "$P-frontend" --network "$NET" -p "127.0.0.1:$FPORT:3000" \
  -e INTERNAL_API_URL="http://$P-backend:8000/api/v1" \
  -e NEXTAUTH_URL="http://localhost:$FPORT" -e NEXTAUTH_SECRET="$SECRET" \
  "$FRONTEND_IMAGE" >/dev/null
wait_for "frontend" 60 curl -sf "http://localhost:$FPORT/auth/signin"

echo "==> frontend"
[ "$(code GET "http://localhost:$FPORT/auth/signin")" = 200 ] || fail "/auth/signin"
ok "/auth/signin 200"
[ "$(code GET "http://localhost:$FPORT/api/auth/providers")" = 200 ] || fail "NextAuth /api/auth/providers"
ok "NextAuth providers 200"
# Authenticated pages render in demo mode without a session (the demo-mode cookie).
for page in /dashboard /transactions /portfolio; do
  s=$(code GET "http://localhost:$FPORT$page" -H 'Cookie: demo-mode=true')
  [ "$s" = 200 ] || fail "$page (demo mode) -> $s"
  ok "$page 200 (demo mode)"
done

echo "==> smoke test passed ($passed checks)"
