# Development Guide

Day-to-day workflow and the environment traps that keep costing time. For setup see
[README.md](../README.md), for sending a change [CONTRIBUTING.md](../CONTRIBUTING.md), for deploys
[SELF_HOSTING.md](SELF_HOSTING.md).

## Running the stack

```bash
./scripts/start-local.sh              # everything in Docker (recommended)
docker compose down           # stop, keep data
docker compose down -v        # stop and DELETE the database
```

Frontend :3000 · backend :8000 · Swagger :8000/docs · pgAdmin :5050.

QuickChart renders the charts the LINE bot sends (no host URL — it's reached in-network at
`quickchart:3400`). Its image is **amd64-only**, so on Apple Silicon Docker runs it under
emulation and prints a platform warning; that's expected. It can take ~15s to report healthy.

To run the production shape locally, use the self-host stack in
[SELF_HOSTING.md](SELF_HOSTING.md).

The frontend source is bind-mounted, so **code changes hot-reload; you do not rebuild the image
for an edit.** Rebuild only when dependencies or the Dockerfile change.

```bash
docker compose build --no-cache frontend && docker compose up -d frontend   # dep/Dockerfile change
./scripts/rebuild-fresh.sh                                                  # when cache is stuck
```

## Demo and test accounts

The demo user is seeded by `backend/app/modules/users/init_demo_user.py`, with fixture data from
`init_demo_data.py`. Read the credentials there rather than from a doc that can go stale.

For UI work you usually don't need to log in at all — set the `demo-mode=true` cookie and
authenticated pages render with fixture data.

## The environment traps

These are the recurring ones. Nearly every "it works on my machine" bug in this repo is on this
list.

**Use `localhost:3000`, never `127.0.0.1:3000`.** They are different origins. On `127.0.0.1` the
session cookies aren't sent, the app hangs on a spinner, HMR 403s, and Google OAuth fails with
`redirect_uri_mismatch`. The symptom looks like broken auth; the cause is the hostname.

**Don't run a host `npm run dev` while Docker is up.** Both write the bind-mounted
`frontend/.next`, and they corrupt each other — you get `build-manifest` ENOENT and
`__webpack_exec__` crashes. Kill the host dev server and restart the container.

**After a dependency bump, reinstall inside the container.** A named volume shadows
`node_modules` from the image, so a host `npm install` alone leaves the container on the old
tree:

```bash
docker compose exec frontend npm install
```

The reverse also bites: a stale *host* `node_modules` makes `npm run lint` fail with
`ERR_MODULE_NOT_FOUND` on `core-web-vitals` and conjures phantom `.next/dev/types` errors. That's
the host sitting on an older Next/eslint-config-next than the pin — fix it with `npm install` on
the host, not by editing config.

**Two Postgres servers exist locally**: native on `:5432` and the Docker one on `:5433`. A
host-shell `alembic` command hits the native one unless you point it at 5433, which silently
migrates the wrong database.

**Reproduce prod-shape bugs in Docker, not natively.** Ports, secrets and pinned package
versions all differ. A local image running an older SQLAlchemy than the pin will happily mask a
crash that only appears in production.

**Native uvicorn and Docker read different env files** (`backend/.env` vs the root `.env` /
compose defaults). A `SECRET_KEY` mismatch shows up as a 401 against `localhost:8000`. After
changing env values, *recreate* the backend container — `restart` does not re-read them.

**A stale service worker can fake a broken app.** Two signatures: `/auth/signin` reload-looping
about once a second with healthy containers and no `/api/auth/session` calls, and
`ReactCurrentDispatcher undefined` crashes that a hard reload fixes but that keep returning.
Both are `sw.js` serving cache-first from a pre-upgrade bundle. Unregister the service worker in
DevTools → Application.

## Database changes

Local:

```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

Check the generated migration before applying it — autogenerate has emitted a full-schema
`DROP TABLE` when `target_metadata` came up empty because of a dual-`Base` import.

Migrations are **not** auto-applied on cloud deploys. A schema change ships three artifacts
together, never one:

1. the Alembic migration,
2. an idempotent SQL script in `backend/scripts/prod_sql/`,
3. a note in the deploy backlog that it's pending.

A new table also needs RLS enabled in the same change.

## Before you call it done

Lint and typecheck are necessary, not sufficient:

```bash
cd frontend && npm run lint && npm run type-check && npm test
cd backend && python -m pytest -m "not integration"
```

Several past runtime crashes compiled and tested clean. Drive the actual flow in the running app
before saying it works. See [TESTING.md](TESTING.md).

## Git

- Don't commit or push unless asked. If you're on `main`, branch first.
- Conventional commits, one PR per feature — batch related commits on a branch rather than
  opening a PR per tweak.
- Another session may hold uncommitted edits in this working tree. Never run `git stash -u`,
  `git reset --hard`, `git clean -f`, or `git checkout -f` here; use a separate `git worktree`
  for risky work.
