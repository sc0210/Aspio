# Docs

| Doc | Read it when |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | You need the module layout, the response envelope, or how the frontend talks to the backend |
| [FINANCIAL_TERMINOLOGY.md](FINANCIAL_TERMINOLOGY.md) | You're touching money — wallets, Total Asset, Net Worth, the invariants |
| [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md) | You want the feature surface and what each route does |
| [UI_CONVENTIONS.md](UI_CONVENTIONS.md) | You're writing UI — palette, breakpoints, a11y, responsive rules |
| [TESTING.md](TESTING.md) | You're running or writing tests, or CI went red |
| [SECURITY.md](SECURITY.md) | You're touching auth, middleware, a raw query, or adding a table |
| [SELF_HOSTING.md](SELF_HOSTING.md) | You're running your own Aspiro, built from a clone of this repo: setup, updates, backups, rollback |
| [DEVELOPMENT.md](DEVELOPMENT.md) | You're working on the code day to day: running the stack, the environment traps, schema changes |

At the repo root: [README.md](../README.md) for the overview, self-host quick start and local setup,
[CONTRIBUTING.md](../CONTRIBUTING.md) for sending a change, and
[CLAUDE.md](../CLAUDE.md) for agent conventions.

## Scripts

Scripts live in three places, by what they run against:

- `scripts/` — the repo and the Docker stacks: `aspiro` (self-host CLI, tested by `aspiro_test.sh`),
  `start-local.sh` and `rebuild-fresh.sh` (dev stack), `backup_db.sh` (cron-able dumps
  of a dev or Pi database, restored as `docs/SELF_HOSTING.md` shows; a self-hosted instance
  uses `aspiro backup`),
  `export_for_migration.sh` (moving a stack to a new host), `install-git-hooks.sh` with
  `commit_review.py` (the advisory commit review), and `ci/` (CI-only checks).
- `backend/scripts/` — the database, run with the backend's env. Indexed in its own
  [README](../backend/scripts/README.md).
- `frontend/scripts/` — the Next.js app: npm-script helpers, the README screenshot and GIF
  capture, and the font CSS build.

Each script's header comment is its usage.

The API reference is generated at `/docs` on a running backend, so it is never written down.

If a doc is wrong, fix or delete it in the same change. Prefer a paragraph in an existing doc to
a new file, and leave implementation history to git.
