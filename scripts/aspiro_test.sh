#!/usr/bin/env bash
# Exercises scripts/aspiro with docker stubbed on PATH (git is real).
#
# Run by hand from the repo root:  bash scripts/aspiro_test.sh
#
# Covers the parts that can go wrong without a daemon: argument parsing, .env
# generation (secret format, never clobbering, --force keeping every existing value),
# and the order `update` does things in — refuse a dirty checkout, an unknown ref or a
# compose file without a migrate service before touching anything; fast-forward or
# check out the ref, build here, migrate (with --init only when asked) before `up`;
# and put the previous images and checkout back when the build, the migration or the
# health check fails. Backups never silently leave or upload a plaintext dump.
#
# Lint exceptions, all deliberate: the single-quoted assertions are eval'd later
# (SC2016, and the variables they read look unused: SC2034); per-case env changes are
# meant to stay in their subshell (SC2030/SC2031); the ls calls list our own files.
# shellcheck disable=SC2016,SC2030,SC2031,SC2034,SC2012
set -u
repo_root=$(cd "$(dirname "$0")/.." && pwd)
cli="$repo_root/scripts/aspiro"
work=$(mktemp -d)
cleanup() { [ -n "${work:-}" ] && [ -d "$work" ] && /bin/rm -rf -- "$work"; }
trap cleanup EXIT

fail=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
expect() {  # expect <description> <command…>   — passes when the command succeeds
  local desc=$1; shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}
has()     { grep -qF -- "$2" "$1"; }
has_not() { ! grep -qF -- "$2" "$1"; }
count_glob() { local n=0 f; for f in "$@"; do [ -e "$f" ] && n=$((n + 1)); done; echo "$n"; }  # count_glob <glob…>
line_of() { grep -nF -- "$2" "$1" | head -1 | cut -d: -f1; }
# Octal file mode. GNU first: GNU `stat -f` is filesystem status and succeeds with
# junk, while BSD `stat` rejects `-c` and falls through to its own `-f %Lp`.
file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
before()  {  # before <file> <first> <second>  — both present, first earlier
  local a b
  a=$(line_of "$1" "$2"); b=$(line_of "$1" "$3")
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]
}

# --- stubs ---------------------------------------------------------------------------
mkdir -p "$work/bin" "$work/bin-plain"
# docker: image tags live as files under $STUB_STATE (name = ref with / and : mangled,
# content = image id). Health answers only when aspiro-backend:latest holds
# $FAKE_HEALTHY_ID (unset = any image is healthy).
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
key() { printf '%s' "$1" | tr '/:@' '___'; }
get() { cat "$STUB_STATE/$(key "$1")" 2>/dev/null; }
put() { printf '%s' "$2" > "$STUB_STATE/$(key "$1")"; }
case "$1" in
  tag)
    id=$(get "$2") || exit 1; put "$3" "$id"; exit 0 ;;
  builder)
    # FAKE_OLD_BUILDX=1: a buildx from before --max-used-space replaced --keep-storage.
    if [ "$3" = --help ]; then
      [ "${FAKE_OLD_BUILDX:-0}" = 1 ] && echo '      --keep-storage bytes' || echo '      --max-used-space bytes'
      exit 0
    fi
    exit "${FAKE_PRUNE_RC:-0}" ;;
  image)
    [ "$2" = prune ] && exit "${FAKE_PRUNE_RC:-0}"
    # image inspect [--format FMT] REF
    if [ "$3" = --format ]; then fmt=$4; ref=$5; else fmt=''; ref=$3; fi
    id=$(get "$ref") || exit 1
    case "$fmt" in
      *com.docker.compose.project*) echo "${FAKE_PROJECT_LABEL-aspiro}" ;;
      *) echo "$id" ;;
    esac
    exit 0 ;;
  compose)
    shift
    while [ $# -gt 0 ]; do
      case "$1" in --project-directory|--env-file|-f|--profile) shift 2 ;; *) break ;; esac
    done
    case "$1" in
      config) echo postgres; echo backend; echo frontend; [ "${FAKE_MIGRATE:-1}" = 1 ] && echo migrate; exit 0 ;;
      run) echo "compose-run $*" >> "$STUB_LOG"; exit "${FAKE_MIGRATE_RC:-0}" ;;
      build)
        echo "compose-build $*" >> "$STUB_LOG"
        [ "${FAKE_BUILD_FAIL:-0}" = 1 ] && exit 1
        shift; for svc in "$@"; do put "aspiro-$svc:latest" "built-$svc"; done
        exit 0 ;;
      up)
        # Starting postgres alone (the pre-update dump) brings the database up,
        # unless FAKE_PG_NEVER_UP=1 (it never becomes healthy).
        case " $* " in
          *" postgres "*)
            [ "${FAKE_PG_NEVER_UP:-0}" = 1 ] && exit 1
            : > "$STUB_STATE/pg-up"; exit 0 ;;
        esac
        # FAKE_UP_FAIL=1: only the first `up` fails, so the rollback's own `up` works.
        if [ "${FAKE_UP_FAIL:-0}" = 1 ] && [ ! -e "$STUB_STATE/up-failed" ]; then
          : > "$STUB_STATE/up-failed"; exit 1
        fi
        exit 0 ;;
      logs|ps) exit 0 ;;
      exec)
        case "$*" in
          *backend*alembic*current*)
            # FAKE_DB_AT_HEAD=0: reachable but behind (no "(head)" marker).
            if [ "${FAKE_DB_AT_HEAD:-1}" = 1 ]; then echo '2026_10_07_x (head)'; else echo '2026_10_06_w'; fi
            exit 0 ;;
          *backend*health*)
            cur=$(get aspiro-backend:latest)
            if [ -z "${FAKE_HEALTHY_ID:-}" ] || [ "$cur" = "$FAKE_HEALTHY_ID" ]; then
              body='{"status":"healthy","service":"aspiro-backend","commit":"abc"}'
              echo "${FAKE_HEALTH_BODY:-$body}"; exit 0
            fi
            exit 7 ;;
          *backend*tar*)
            [ "${FAKE_TAR_FAIL:-0}" = 1 ] || [ "${FAKE_STACK_DOWN:-0}" = 1 ] && exit 1
            printf 'receipt.jpg' | gzip
            exit 0 ;;
          *frontend*node*)
            # Healthy only when aspiro-frontend:latest holds $FAKE_FRONTEND_HEALTHY_ID (unset = any).
            cur=$(get aspiro-frontend:latest)
            if [ -z "${FAKE_FRONTEND_HEALTHY_ID:-}" ] || [ "$cur" = "$FAKE_FRONTEND_HEALTHY_ID" ]; then exit 0; fi
            exit 1 ;;
          *backend*create_admin.py*)
            # FAKE_ADMIN_RC=1: the script found no account with that email.
            exit "${FAKE_ADMIN_RC:-0}" ;;
          *pg_dump*)
            # FAKE_STACK_DOWN=1: postgres is stopped until something starts it.
            [ "${FAKE_STACK_DOWN:-0}" = 1 ] && [ ! -e "$STUB_STATE/pg-up" ] && exit 1
            echo '-- PostgreSQL database dump'
            i=0; while [ $i -lt 50 ]; do echo "INSERT INTO t VALUES ($i);"; i=$((i+1)); done
            exit 0 ;;
        esac ;;
    esac
    exit 0 ;;
esac
exit 0
STUB
chmod +x "$work/bin/"*
cp "$work/bin/docker" "$work/bin-plain/"
# age that writes a partial ciphertext and then fails.
mkdir -p "$work/bin-agefail"
cp "$work/bin/docker" "$work/bin-agefail/"
cat > "$work/bin-agefail/age" <<'STUB'
#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do [ "$1" = -o ] && { printf 'partial' > "$2"; }; shift; done
exit 1
STUB
chmod +x "$work/bin-agefail/age"
# aws and age that only record being called.
mkdir -p "$work/bin-offsite"
cp "$work/bin/docker" "$work/bin-offsite/"
for tool in aws age; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$STUB_LOG"\n' "$tool" > "$work/bin-offsite/$tool"
done
chmod +x "$work/bin-offsite/"*

base_path="/usr/bin:/bin"
export STUB_LOG="$work/log" STUB_STATE="$work/state"
export ASPIRO_HEALTH_TIMEOUT=1 ASPIRO_HEALTH_INTERVAL=0

run_cli() {  # run_cli <install dir> <bin dir> <args…>  → exit code in $rc, output in $work/out
  local d=$1 bin=$2; shift 2
  (export ASPIRO_DIR="$d" PATH="$bin:$base_path"; "$cli" "$@") \
    > "$work/out" 2>&1 < /dev/null
  rc=$?
}

# --- pure functions ------------------------------------------------------------------
echo "pure functions"
# shellcheck source=scripts/aspiro
. "$cli"
set +e +u   # the CLI turns these on when sourced; the harness wants to keep going
set -u
s=$(aspiro_gen_secret 32)
expect "secret is 64 lowercase hex chars" eval '[[ "$s" =~ ^[0-9a-f]{64}$ ]]'
expect "secrets differ per call" [ "$s" != "$(aspiro_gen_secret 32)" ]
f="$work/kv"; printf 'A=1\nB=x=y\n# C=commented\nAB=2\n' > "$f"
aspiro_env_set "$f" A 'new/v+a=l\ue$x'
aspiro_env_set "$f" C 3
expect "env_set replaces in place, literally" [ "$(sed -n 1p "$f")" = 'A=new/v+a=l\ue$x' ]
expect "env_set leaves a similar key alone" has "$f" 'AB=2'
expect "env_set appends a missing key" [ "$(tail -1 "$f")" = 'C=3' ]
expect "env_get keeps '=' in values" [ "$(aspiro_env_get "$f" B)" = 'x=y' ]
expect "env_get ignores comments" [ "$(aspiro_env_get "$f" C)" = 3 ]

# --- setup ---------------------------------------------------------------------------
echo "setup"
d="$work/setup"; mkdir -p "$d"
printf '# template\nAPP_DOMAIN=example.com\nSECRET_KEY=change-me\nNEXTAUTH_SECRET=change-me\nPOSTGRES_PASSWORD=change-me\nLOG_LEVEL=INFO\n' > "$d/production.env.sample"
run_cli "$d" "$work/bin" setup
expect "non-interactive setup without a domain fails" [ "$rc" -ne 0 ]
expect "...and writes no .env" [ ! -e "$d/.env" ]

run_cli "$d" "$work/bin" setup --non-interactive --domain https://aspiro.example.com/ \
  --google-client-id gid --google-client-secret gsec --tunnel-token tok
expect "setup succeeds" [ "$rc" -eq 0 ]
expect "domain is normalised" has "$d/.env" 'APP_DOMAIN=aspiro.example.com'
expect "template lines kept" has "$d/.env" 'LOG_LEVEL=INFO'
expect "no placeholder left" has_not "$d/.env" 'change-me'
for k in SECRET_KEY NEXTAUTH_SECRET; do
  v=$(aspiro_env_get "$d/.env" "$k")
  expect "$k is 64 hex chars" eval '[[ "$v" =~ ^[0-9a-f]{64}$ ]]'
done
pg=$(aspiro_env_get "$d/.env" POSTGRES_PASSWORD)
expect "POSTGRES_PASSWORD is 48 hex chars" eval '[[ "$pg" =~ ^[0-9a-f]{48}$ ]]'
expect "tunnel token enables the tunnel profile" has "$d/.env" 'COMPOSE_PROFILES=tunnel'
expect "Google redirect URI is printed" has "$work/out" 'https://aspiro.example.com/api/auth/callback/google'
expect "...and how to make yourself admin" has "$work/out" 'aspiro admin grant <your email>'
mode=$(file_mode "$d/.env")
expect ".env is mode 600" [ "$mode" = 600 ]
expect "no temp file left behind" eval '[ -z "$(ls "$d" | grep "\.env\.new")" ]'

sk=$(aspiro_env_get "$d/.env" SECRET_KEY)
cp "$d/.env" "$work/env-before"
run_cli "$d" "$work/bin" setup --non-interactive --domain other.example.com
expect "existing .env is refused" [ "$rc" -ne 0 ]
expect "...and left byte-for-byte unchanged" cmp -s "$d/.env" "$work/env-before"

printf 'LINE_CHANNEL_SECRET=line-secret\nSMTP_HOST=smtp.example.com\n' >> "$d/.env"
nas=$(aspiro_env_get "$d/.env" NEXTAUTH_SECRET)
run_cli "$d" "$work/bin" setup --non-interactive --domain other.example.com --force
expect "--force updates in place" [ "$rc" -eq 0 ]
expect "--force applies the new domain" has "$d/.env" 'APP_DOMAIN=other.example.com'
expect "--force on an existing install never suggests --init" has_not "$work/out" "update --init"
expect "--force keeps SECRET_KEY (no logout)" [ "$(aspiro_env_get "$d/.env" SECRET_KEY)" = "$sk" ]
expect "--force keeps NEXTAUTH_SECRET" [ "$(aspiro_env_get "$d/.env" NEXTAUTH_SECRET)" = "$nas" ]
expect "--force keeps POSTGRES_PASSWORD (the DB volume still has it)" \
  [ "$(aspiro_env_get "$d/.env" POSTGRES_PASSWORD)" = "$pg" ]
expect "--force keeps GOOGLE_CLIENT_ID" [ "$(aspiro_env_get "$d/.env" GOOGLE_CLIENT_ID)" = gid ]
expect "--force keeps GOOGLE_CLIENT_SECRET" [ "$(aspiro_env_get "$d/.env" GOOGLE_CLIENT_SECRET)" = gsec ]
expect "--force keeps CF_TUNNEL_TOKEN" [ "$(aspiro_env_get "$d/.env" CF_TUNNEL_TOKEN)" = tok ]
expect "--force keeps COMPOSE_PROFILES" [ "$(aspiro_env_get "$d/.env" COMPOSE_PROFILES)" = tunnel ]
expect "--force keeps a custom key (LINE_CHANNEL_SECRET)" \
  [ "$(aspiro_env_get "$d/.env" LINE_CHANNEL_SECRET)" = line-secret ]
expect "--force keeps a custom key (SMTP_HOST)" [ "$(aspiro_env_get "$d/.env" SMTP_HOST)" = smtp.example.com ]
expect "--force keeps template lines" has "$d/.env" 'LOG_LEVEL=INFO'
expect "--force backs the old .env up" eval 'ls "$d"/.env.bak.* >/dev/null 2>&1'
mode=$(file_mode "$d/.env")
expect "--force leaves .env mode 600" [ "$mode" = 600 ]

run_cli "$d" "$work/bin" setup --non-interactive --force --google-client-id gid2
expect "--force with only a new flag succeeds (domain kept)" [ "$rc" -eq 0 ]
expect "...the given value replaces the old one" [ "$(aspiro_env_get "$d/.env" GOOGLE_CLIENT_ID)" = gid2 ]
expect "...the domain is kept" has "$d/.env" 'APP_DOMAIN=other.example.com'

run_cli "$d" "$work/bin" setup --non-interactive --force --rotate-secrets
expect "--rotate-secrets succeeds" [ "$rc" -eq 0 ]
expect "--rotate-secrets changes SECRET_KEY" [ "$(aspiro_env_get "$d/.env" SECRET_KEY)" != "$sk" ]
expect "--rotate-secrets changes NEXTAUTH_SECRET" [ "$(aspiro_env_get "$d/.env" NEXTAUTH_SECRET)" != "$nas" ]
v=$(aspiro_env_get "$d/.env" SECRET_KEY)
expect "...to a fresh 64-hex secret" eval '[[ "$v" =~ ^[0-9a-f]{64}$ ]]'
expect "--rotate-secrets keeps POSTGRES_PASSWORD" [ "$(aspiro_env_get "$d/.env" POSTGRES_PASSWORD)" = "$pg" ]
expect "--rotate-secrets keeps LINE_CHANNEL_SECRET" [ "$(aspiro_env_get "$d/.env" LINE_CHANNEL_SECRET)" = line-secret ]

d2="$work/setup-notunnel"; mkdir -p "$d2"
cp "$d/production.env.sample" "$d2/"
run_cli "$d2" "$work/bin" setup --non-interactive --domain a.example.com
expect "no tunnel token, no tunnel profile" has_not "$d2/.env" 'COMPOSE_PROFILES'
expect "no ingress at all is warned about" has "$work/out" 'no tunnel token or Tailscale key'

d3="$work/setup-tailscale"; mkdir -p "$d3"
cp "$d/production.env.sample" "$d3/"
run_cli "$d3" "$work/bin" setup --non-interactive --domain aspiro.tail1234.ts.net --tailscale-authkey tskey-abc
expect "Tailscale setup succeeds" [ "$rc" -eq 0 ]
expect "a Tailscale key enables the tailscale profile" [ "$(aspiro_env_get "$d3/.env" COMPOSE_PROFILES)" = tailscale ]
expect "...stores the key" [ "$(aspiro_env_get "$d3/.env" TS_AUTHKEY)" = tskey-abc ]
expect "...serves to the tailnet only by default" [ "$(aspiro_env_get "$d3/.env" TS_SERVE_FILE)" = serve.json ]
expect "...names the node after the ts.net hostname" [ "$(aspiro_env_get "$d3/.env" TS_HOSTNAME)" = aspiro ]
expect "...says the address is tailnet-only" has "$work/out" 'reachable from your tailnet only'
expect "...no ingress warning" has_not "$work/out" 'no tunnel token or Tailscale key'
expect "...no hostname warning for a ts.net name" has_not "$work/out" 'should be <name>.<tailnet>.ts.net'

run_cli "$d3" "$work/bin" setup --non-interactive --force --funnel
expect "--force --funnel switches to Funnel" [ "$(aspiro_env_get "$d3/.env" TS_SERVE_FILE)" = funnel.json ]
expect "...keeps the key" [ "$(aspiro_env_get "$d3/.env" TS_AUTHKEY)" = tskey-abc ]
expect "...says the address is public" has "$work/out" 'Tailscale Funnel'
run_cli "$d3" "$work/bin" setup --non-interactive --force
expect "--force without a funnel flag keeps Funnel" [ "$(aspiro_env_get "$d3/.env" TS_SERVE_FILE)" = funnel.json ]
run_cli "$d3" "$work/bin" setup --non-interactive --force --no-funnel --tunnel-token tok
expect "--no-funnel goes back to tailnet-only" [ "$(aspiro_env_get "$d3/.env" TS_SERVE_FILE)" = serve.json ]
expect "both ingresses keep both profiles" [ "$(aspiro_env_get "$d3/.env" COMPOSE_PROFILES)" = tailscale,tunnel ]

d4="$work/setup-tailscale-domain"; mkdir -p "$d4"
cp "$d/production.env.sample" "$d4/"
run_cli "$d4" "$work/bin" setup --non-interactive --domain aspiro.example.com --tailscale-authkey tskey-abc
expect "Tailscale with a non-ts.net hostname still succeeds" [ "$rc" -eq 0 ]
expect "...but warns about the hostname" has "$work/out" 'should be <name>.<tailnet>.ts.net'
expect "...and leaves the node name at its default" has_not "$d4/.env" 'TS_HOSTNAME'

run_cli "$d" "$work/bin" setup --bogus
expect "unknown setup option fails" [ "$rc" -ne 0 ]

# --- update --------------------------------------------------------------------------
echo "update"
# Every case gets its own origin (a bare repo with commits A and B) and an install
# cloned at A, so `update` has a real fetch, fast-forward and checkout to do.
git_quiet() { git -c user.email=t@example.com -c user.name=t -c init.defaultBranch=main "$@" >/dev/null 2>&1; }
new_install() {  # new_install <name>  → install dir; $origin is its remote
  local d="$work/install-$1" seed="$work/seed-$1"
  origin="$work/origin-$1.git"
  rm -rf "$d" "$seed" "$origin" "$STUB_STATE"; mkdir -p "$seed" "$STUB_STATE"
  : > "$STUB_LOG"
  git_quiet init -q "$seed"
  printf 'services: {}\n' > "$seed/docker-compose.pi.yml"
  printf '.env\n.aspiro-state/\n' > "$seed/.gitignore"
  git_quiet -C "$seed" add -A; git_quiet -C "$seed" commit -qm A; git_quiet -C "$seed" tag v1.0.0
  git_quiet clone -q --bare "$seed" "$origin"
  git_quiet clone -q "$origin" "$d"
  printf 'x\n' > "$seed/CHANGELOG"; git_quiet -C "$seed" add -A; git_quiet -C "$seed" commit -qm B
  git_quiet -C "$seed" push -q "$origin" main
  printf 'APP_DOMAIN=x.example.com\n' > "$d/.env"
  printf 'old-backend' > "$STUB_STATE/aspiro-backend_latest"
  printf 'old-frontend' > "$STUB_STATE/aspiro-frontend_latest"
  echo "$d"
}
head_is() { [ "$(git -C "$1" log -1 --format=%s)" = "$2" ]; }   # head_is <dir> <subject>

d=$(new_install noinit)
run_cli "$d" "$work/bin" update
expect "a first update without --init does not infer it" \
  eval 'has "$STUB_LOG" "compose-run run --rm migrate" && has_not "$STUB_LOG" "--init"'

d=$(new_install ok)
run_cli "$d" "$work/bin" update --init
expect "update succeeds" [ "$rc" -eq 0 ]
expect "...fast-forwards the checkout to origin" head_is "$d" B
expect "builds both app images here, by name" has "$STUB_LOG" 'compose-build build backend frontend'
expect "...and never pulls" has_not "$STUB_LOG" 'docker pull'
expect "records the previous image" has "$STUB_LOG" 'docker tag aspiro-backend:latest aspiro-backend:previous'
expect "tags previous before building" before "$STUB_LOG" 'docker tag aspiro-backend:latest aspiro-backend:previous' 'compose-build'
expect "builds before migrating" before "$STUB_LOG" 'compose-build' 'run --rm migrate'
expect "migrates before up" before "$STUB_LOG" 'run --rm migrate' ' up -d --remove-orphans'
expect "backend now runs the new image" [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = built-backend ]
expect "previous is the old image" [ "$(cat "$STUB_STATE/aspiro-backend_previous")" = old-backend ]
expect "state records the commit" has "$d/.aspiro-state/current" "commit=$(git -C "$d" rev-parse HEAD)"
expect "state records the old image ids" has "$d/.aspiro-state/previous.ids" 'backend=old-backend'
expect "update --init migrates with --init" has "$STUB_LOG" 'compose-run run --rm migrate bash scripts/migrate.sh --init'
expect "checks the schema is at head" has "$STUB_LOG" 'exec -T backend alembic current'
expect "update --init backs nothing up (the database is empty)" has_not "$STUB_LOG" 'pg_dump'
expect "a healthy update prunes this project's dangling images only" \
  has "$STUB_LOG" 'docker image prune -f --filter label=com.docker.compose.project=aspiro'
expect "...and the build cache down to 3GB" has "$STUB_LOG" 'docker builder prune -f --max-used-space 3GB'
expect "...only after the new build is up" before "$STUB_LOG" ' up -d --remove-orphans' 'docker image prune -f'
: > "$STUB_LOG"
run_cli "$d" "$work/bin" update
expect "a second update (nothing new) succeeds" [ "$rc" -eq 0 ]
expect "...and migrates WITHOUT --init" eval 'has "$STUB_LOG" "compose-run run --rm migrate" && has_not "$STUB_LOG" "--init"'
expect "...backs the database up first" before "$STUB_LOG" 'exec -T postgres sh -c pg_dump' 'run --rm migrate'
recorded=$(cat "$d/.aspiro-state/backup" 2>/dev/null)
expect "...records that dump in the state dir" eval '[ -n "$recorded" ] && [ -f "$recorded" ] && gzip -dc "$recorded" | grep -q "INSERT INTO t"'
expect "...in its own directory" [ "$(dirname "$recorded")" = "$d/backups/pre-update" ]
expect "...at mode 600" [ "$(file_mode "$recorded")" = 600 ]
expect "...in a mode 700 directory" [ "$(file_mode "$d/backups/pre-update")" = 700 ]
expect "...database only (no uploads archive)" has_not "$STUB_LOG" 'tar -C /app/uploads'
first=$recorded
sleep 1
run_cli "$d" "$work/bin" update
expect "a second update keeps the first dump as backup.prev" \
  eval '[ "$(cat "$d/.aspiro-state/backup.prev")" = "$first" ] && [ "$(cat "$d/.aspiro-state/backup")" != "$first" ]'

d=$(new_install bind)
printf 'COMPOSE_PROFILES=tunnel\n' >> "$d/.env"
run_cli "$d" "$work/bin" update
expect "a tunnel host without CADDY_BIND is warned once" \
  eval '[ "$rc" -eq 0 ] && [ "$(grep -c "CADDY_BIND is not set" "$work/out")" -eq 1 ]'
printf 'CADDY_BIND=127.0.0.1\n' >> "$d/.env"
run_cli "$d" "$work/bin" update
expect "...and not once it is set" has_not "$work/out" 'CADDY_BIND is not set'
d=$(new_install bind-lan)
run_cli "$d" "$work/bin" update
expect "a LAN-HTTPS host (no tunnel or tailscale profile) is not warned" has_not "$work/out" 'CADDY_BIND is not set'
d=$(new_install bind-token)
printf 'CF_TUNNEL_TOKEN=tok\n' >> "$d/.env"
run_cli "$d" "$work/bin" update
expect "a tunnel host started with --profile (token set, no COMPOSE_PROFILES) is warned" has "$work/out" 'CADDY_BIND is not set'

d=$(new_install oldbuildx)
(export FAKE_OLD_BUILDX=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "an older buildx trims the cache with --keep-storage" \
  eval '[ $? -eq 0 ] && has "$STUB_LOG" "docker builder prune -f --keep-storage 3GB"'

d=$(new_install nolabel)
(export FAKE_PROJECT_LABEL=''; run_cli "$d" "$work/bin" update; exit "$rc")
expect "images without a compose project label are never pruned" \
  eval '[ $? -eq 0 ] && has_not "$STUB_LOG" "docker image prune" && has "$work/out" "skipped pruning old images"'

d=$(new_install stackdown)
(export FAKE_STACK_DOWN=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "an update with the stack down still succeeds" [ $? -eq 0 ]
expect "...starting postgres alone, without recreating it, before the dump" \
  before "$STUB_LOG" 'up -d --no-recreate --wait --wait-timeout 1 postgres' 'exec -T postgres sh -c pg_dump'
recorded=$(cat "$d/.aspiro-state/backup" 2>/dev/null)
expect "...and backs the database up" eval '[ -n "$recorded" ] && gzip -dc "$recorded" | grep -q "INSERT INTO t"'

d=$(new_install offsite)
mkdir -p "$d/backups/db" "$d/backups/pre-update"
for i in 1 2 3; do
  printf 'scheduled' | gzip > "$d/backups/db/aspiro_2020010${i}_000000.sql.gz"
  touch -t "20200${i}010000" "$d/backups/db/aspiro_2020010${i}_000000.sql.gz"
done
for i in 1 2 3 4; do
  printf 'pre' | gzip > "$d/backups/pre-update/aspiro_2020020${i}_000000.sql.gz"
  touch -t "20200${i}020000" "$d/backups/pre-update/aspiro_2020020${i}_000000.sql.gz"
done
ls -l "$d/backups/db" > "$work/scheduled-before"
(export ASPIRO_BACKUP_AGE_RECIPIENT=age1test ASPIRO_BACKUP_S3_URI=s3://bucket/x ASPIRO_BACKUP_KEEP=1
 run_cli "$d" "$work/bin-offsite" update; exit "$rc")
expect "an update with offsite backups configured succeeds" [ $? -eq 0 ]
expect "...and neither encrypts nor uploads anything" eval '! grep -qE "^(aws|age) " "$STUB_LOG"'
ls -l "$d/backups/db" > "$work/scheduled-after"
expect "...leaves every scheduled dump as it was" cmp -s "$work/scheduled-before" "$work/scheduled-after"
expect "...keeps the newest 3 pre-update dumps" [ "$(count_glob "$d"/backups/pre-update/*.sql.gz)" -eq 3 ]
expect "...dropping the oldest" [ ! -e "$d/backups/pre-update/aspiro_20200201_000000.sql.gz" ]
expect "...and keeping the new one" [ -e "$(cat "$d/.aspiro-state/backup")" ]

d=$(new_install prunefail)
(export FAKE_PRUNE_RC=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a failed prune does not fail the update" [ $? -eq 0 ]
expect "...but says so" has "$work/out" 'prune failed'

d=$(new_install backupfail)
(export FAKE_STACK_DOWN=1 FAKE_PG_NEVER_UP=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a failed pre-migration backup aborts the update" [ $? -ne 0 ]
expect "...without migrating or recreating" eval 'has_not "$STUB_LOG" "run --rm migrate" && has_not "$STUB_LOG" " up -d --remove-orphans"'
expect "...restores the old image" [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]
expect "...and the old checkout" head_is "$d" A

d=$(new_install ref)
run_cli "$d" "$work/bin" update --ref v1.0.0
expect "update --ref <tag> succeeds" [ "$rc" -eq 0 ]
expect "...and runs that tag" head_is "$d" A
run_cli "$d" "$work/bin" update --ref main
expect "update --ref <branch> takes the remote branch" eval '[ "$rc" -eq 0 ] && head_is "$d" B'

d=$(new_install badref)
run_cli "$d" "$work/bin" update --ref v9.9.9
expect "an unknown --ref refuses" [ "$rc" -ne 0 ]
expect "...before building or retagging" eval 'has_not "$STUB_LOG" "compose-build" && has_not "$STUB_LOG" "docker tag"'
expect "...and leaves the checkout where it was" head_is "$d" A

d=$(new_install dirty)
printf 'local edit\n' >> "$d/docker-compose.pi.yml"
run_cli "$d" "$work/bin" update
expect "a checkout with local changes refuses" [ "$rc" -ne 0 ]
expect "...saying so" has "$work/out" 'local changes'
expect "...before building" has_not "$STUB_LOG" 'compose-build'
expect "...and keeps the edit" has "$d/docker-compose.pi.yml" 'local edit'

d="$work/notgit"; rm -rf "$d"; mkdir -p "$d"
printf 'services: {}\n' > "$d/docker-compose.pi.yml"; printf 'APP_DOMAIN=x\n' > "$d/.env"
run_cli "$d" "$work/bin" update
expect "an install that is not a git checkout refuses" [ "$rc" -ne 0 ]
expect "...pointing at the docs" has "$work/out" 'not a git checkout'

d=$(new_install buildfail)
(export FAKE_BUILD_FAIL=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a failed build aborts" [ $? -ne 0 ]
expect "...without migrating or recreating" eval 'has_not "$STUB_LOG" "run --rm migrate" && has_not "$STUB_LOG" " up -d --remove-orphans"'
expect "...restores the old image" [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]
expect "...and the old checkout" head_is "$d" A

d=$(new_install migfail)
(export FAKE_MIGRATE_RC=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "failed migration aborts" [ $? -ne 0 ]
expect "...without recreating containers" has_not "$STUB_LOG" ' up -d --remove-orphans'
expect "...restores the old tag" [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]
expect "...and the old checkout" head_is "$d" A
expect "...and prints how to restore the pre-update dump" has "$work/out" 'DROP SCHEMA public CASCADE'

d=$(new_install nomig)
(export FAKE_MIGRATE=0; run_cli "$d" "$work/bin" update; exit "$rc")
expect "compose without a migrate service refuses" [ $? -ne 0 ]
expect "...saying so" has "$work/out" "no 'migrate' service"
expect "...before fetching or building" eval 'has_not "$STUB_LOG" "compose-build" && head_is "$d" A'

expect "the real docker-compose.pi.yml has a migrate service in profile migrate" \
  awk '/^  migrate:/ { m = 1; next }
       m && /^  [^ #]/ { m = 0 }
       m && /profiles:.*"migrate"/ { p = 1 }
       m && /scripts\/migrate\.sh/ { c = 1 }
       END { exit !(p && c) }' "$repo_root/docker-compose.pi.yml"

d=$(new_install unhealthy-body)
(export FAKE_HEALTH_BODY='{"status":"unhealthy","service":"aspiro-backend"}'; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a body saying unhealthy fails the update" [ $? -ne 0 ]
expect "...and rolls back" eval 'has "$work/out" "rolling back" && [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]'
expect "...including the checkout" head_is "$d" A
expect "...without recording the update" [ ! -e "$d/.aspiro-state/current" ]

d=$(new_install behind)
(export FAKE_DB_AT_HEAD=0; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a database not at head fails the update" [ $? -ne 0 ]
expect "...and rolls back to the old image" [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]
expect "...without recording the update" [ ! -e "$d/.aspiro-state/current" ]

d=$(new_install unhealthy)
(export FAKE_HEALTHY_ID=old-backend; run_cli "$d" "$work/bin" update; exit "$rc")
expect "unhealthy update exits non-zero" [ $? -ne 0 ]
expect "...rolls back to the old image" [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]
expect "...and the old frontend" [ "$(cat "$STUB_STATE/aspiro-frontend_latest")" = old-frontend ]
expect "...recreating twice (new, then old)" [ "$(grep -c ' up -d --remove-orphans' "$STUB_LOG")" -eq 2 ]
expect "...and reports the rollback" has "$work/out" 'rolled back to the previous images'
expect "...and prints how to restore the pre-update dump" \
  eval 'has "$work/out" "DROP SCHEMA public CASCADE" && has "$work/out" "$(cat "$d/.aspiro-state/backup")" && has "$work/out" "--single-transaction -v ON_ERROR_STOP=1"'
expect "...without pruning anything" has_not "$STUB_LOG" 'prune'

d=$(new_install up-fails)
(export FAKE_UP_FAIL=1; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a failed compose up fails the update" [ $? -ne 0 ]
expect "...and still rolls back (set -e used to exit first)" eval 'has "$work/out" "rolling back" && [ "$(cat "$STUB_STATE/aspiro-backend_latest")" = old-backend ]'
expect "...without recording the update" [ ! -e "$d/.aspiro-state/current" ]

d=$(new_install frontend-down)
(export FAKE_FRONTEND_HEALTHY_ID=old-frontend; run_cli "$d" "$work/bin" update; exit "$rc")
expect "a frontend that never answers fails the update" [ $? -ne 0 ]
expect "...rolls back the frontend" [ "$(cat "$STUB_STATE/aspiro-frontend_latest")" = old-frontend ]
expect "...and reports the rollback" has "$work/out" 'rolled back to the previous images'
expect "...without recording the update" [ ! -e "$d/.aspiro-state/current" ]

d=$(new_install args)
run_cli "$d" "$work/bin" update --channel stable
expect "the old --channel flag is refused" [ "$rc" -ne 0 ]
run_cli "$d" "$work/bin" update --wat
expect "unknown update option refuses" [ "$rc" -ne 0 ]
rm "$d/.env"
run_cli "$d" "$work/bin" update
expect "update without .env refuses" [ "$rc" -ne 0 ]
expect "...pointing at setup" has "$work/out" "aspiro setup"

# --- backup / status -----------------------------------------------------------------
echo "backup / status"
d=$(new_install backup)
for i in 1 2 3; do printf 'old' | gzip > "$d/old$i"; done
mkdir -p "$d/backups/db"
for i in 1 2 3; do
  mv "$d/old$i" "$d/backups/db/aspiro_2020010${i}_000000.sql.gz"
  touch -t "20200${i}010000" "$d/backups/db/aspiro_2020010${i}_000000.sql.gz"
done
run_cli "$d" "$work/bin" backup --keep 2
expect "backup succeeds" [ "$rc" -eq 0 ]
expect "dumps with pg_dump through compose" has "$STUB_LOG" 'exec -T postgres sh -c pg_dump'
newest=$(ls -1t "$d/backups/db"/aspiro_*.sql.gz | head -1)
expect "the dump is valid gzip with the data" eval 'gzip -dc "$newest" | grep -q "INSERT INTO t"'
expect "keeps only 2 local dumps" [ "$(count_glob "$d"/backups/db/*.sql.gz)" -eq 2 ]
expect "...the newest ones" [ -e "$d/backups/db/aspiro_20200103_000000.sql.gz" ]
expect "archives /app/uploads from the backend" has "$STUB_LOG" 'exec -T backend tar -C /app/uploads'
uploads=$(ls -1t "$d/backups/db"/aspiro_*.uploads.tar.gz | head -1)
expect "...as a valid gzip beside the dump" eval 'gzip -dc "$uploads" | grep -q receipt.jpg'
expect "...at mode 600" [ "$(file_mode "$uploads")" = 600 ]
expect "the dump is mode 600 too" [ "$(file_mode "$newest")" = 600 ]
run_cli "$d" "$work/bin" backup --keep 0
expect "backup --keep 0 refuses" [ "$rc" -ne 0 ]

d=$(new_install plain-offsite)
(export ASPIRO_BACKUP_S3_URI=s3://bucket/x; run_cli "$d" "$work/bin" backup; exit "$rc")
expect "an offsite bucket without an encryption recipient refuses" [ $? -ne 0 ]
expect "...saying why" has "$work/out" 'refusing to upload unencrypted'
expect "...before dumping anything" eval 'has_not "$STUB_LOG" pg_dump && [ -z "$(ls "$d/backups/db" 2>/dev/null)" ]'

d=$(new_install tarfail)
(export FAKE_TAR_FAIL=1 ASPIRO_BACKUP_AGE_RECIPIENT=age1test ASPIRO_BACKUP_S3_URI=s3://bucket/x
 run_cli "$d" "$work/bin" backup; exit "$rc")
expect "a failed uploads archive fails the backup" [ $? -ne 0 ]
expect "...saying nothing went offsite" has "$work/out" 'nothing was encrypted or uploaded'
expect "...encrypting nothing (no age run)" has_not "$STUB_LOG" 'age '
expect "...leaving no archive or partial behind" eval '[ -z "$(ls "$d/backups/db" | grep uploads)" ]'
expect "...and keeping the local dump" eval '[ -n "$(ls "$d/backups/db" | grep "\.sql\.gz$")" ]'

d=$(new_install agefail)
(export ASPIRO_BACKUP_AGE_RECIPIENT=age1test ASPIRO_BACKUP_S3_URI=s3://bucket/x
 run_cli "$d" "$work/bin-agefail" backup; exit "$rc")
expect "a failed age encryption exits non-zero" [ $? -ne 0 ]
expect "...saying the plaintext was kept" eval 'has "$work/out" "encryption failed; unencrypted copy kept at" && has "$work/out" "not uploaded"'
plain=$(ls -1 "$d/backups/db"/aspiro_*.sql.gz 2>/dev/null | head -1)
expect "...and the plaintext dump is still there" [ -n "$plain" ]
mode=$(file_mode "$plain")
expect "...at mode 600" [ "$mode" = 600 ]
expect "...with no partial ciphertext left" eval '[ -z "$(ls "$d/backups/db" | grep "\.age$")" ]'
(export ASPIRO_BACKUP_GPG_RECIPIENT=someone; run_cli "$d" "$work/bin-plain" backup; exit "$rc")
expect "a missing gpg fails the backup too" [ $? -ne 0 ]

run_cli "$d" "$work/bin" status
expect "status succeeds" [ "$rc" -eq 0 ]
expect "status shows health" has "$work/out" '"status":"healthy"'

echo "admin"
: > "$STUB_LOG"
run_cli "$d" "$work/bin" admin grant owner@example.com
expect "admin grant succeeds" [ "$rc" -eq 0 ]
expect "...runs the grant in the backend, super_admin by default" \
  has "$STUB_LOG" 'exec -T backend python scripts/create_admin.py grant owner@example.com --role super_admin'
run_cli "$d" "$work/bin" admin grant ops@example.com support
expect "...passes an explicit role" has "$STUB_LOG" 'create_admin.py grant ops@example.com --role support'
(export FAKE_ADMIN_RC=1; run_cli "$d" "$work/bin" admin grant nobody@example.com; exit "$rc")
expect "a grant for an unregistered email fails" [ $? -ne 0 ]
run_cli "$d" "$work/bin" admin list
expect "admin list succeeds" [ "$rc" -eq 0 ]
expect "...and runs the list in the backend" has "$STUB_LOG" 'exec -T backend python scripts/create_admin.py list'
run_cli "$d" "$work/bin" admin grant
expect "admin grant without an email fails" [ "$rc" -ne 0 ]
run_cli "$d" "$work/bin" admin
expect "admin without a subcommand fails" [ "$rc" -ne 0 ]

run_cli "$d" "$work/bin" frobnicate
expect "unknown command fails" [ "$rc" -ne 0 ]

if [ "$fail" -eq 0 ]; then
  echo 'all aspiro CLI cases behave'
else
  echo 'the aspiro CLI is wrong for at least one case' >&2
  exit 1
fi
