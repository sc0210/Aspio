# Docs

| Doc | Read it when |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | You need the module layout, the response envelope, or how the frontend talks to the backend |
| [FINANCIAL_TERMINOLOGY.md](FINANCIAL_TERMINOLOGY.md) | You're touching money — wallets, Total Asset, Net Worth, the invariants |
| [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md) | You want the feature surface and what each route does |
| [UI_CONVENTIONS.md](UI_CONVENTIONS.md) | You're writing UI — palette, breakpoints, a11y, responsive rules |
| [TESTING.md](TESTING.md) | You're running or writing tests, or CI went red |
| [SECURITY.md](SECURITY.md) | You're touching auth, middleware, a raw query, or adding a table |
| [RASPBERRY_PI_DEPLOYMENT.md](RASPBERRY_PI_DEPLOYMENT.md) | You're deploying to or debugging the Pi |
| [MINIPC_MIGRATION.md](MINIPC_MIGRATION.md) | You're moving production off the Pi to the Ubuntu mini PC (delete once done) |
| [SELF_HOSTING.md](SELF_HOSTING.md) | You're running your own Aspiro, built from a clone of this repo: setup, updates, backups, rollback |
| [../cloudflare/maintenance/README.md](../cloudflare/maintenance/README.md) | You want a "back soon" page instead of Cloudflare's 530 while the origin is down |
| [PI_BACKUPS.md](PI_BACKUPS.md) | You need to back up or restore the production database |

At the repo root: [README.md](../README.md) for setup,
[DEVELOPMENT_GUIDE.md](../DEVELOPMENT_GUIDE.md) for day-to-day workflow, and
[CLAUDE.md](../CLAUDE.md) for agent conventions.

The API reference is generated at `/docs` on a running backend, so it is never written down.

If a doc is wrong, fix or delete it in the same change. Prefer a paragraph in an existing doc to
a new file, and leave implementation history to git.
