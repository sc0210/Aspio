# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aspiro is a full-stack personal finance app targeting Asian markets. Users track daily expenses, manage investment portfolios, set savings goals, and get AI-assisted financial analysis. A LINE Bot integration lets users record transactions and split group expenses via chat.

**Tech stack:**
- Frontend: Next.js 16 (App Router), React 19, TypeScript, TailwindCSS 3, TanStack Query v5, NextAuth.js v4, Recharts 2
- Backend: FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Alembic
- Database: PostgreSQL 15 — Docker locally and in the production stack (loopback-bound)
- Auth: NextAuth.js (frontend) + JWT / Google OAuth (backend)
- Deployment: self-hosted. Nothing deploys automatically and nothing is published: CI only validates, and each instance clones the repo and builds its own images with `scripts/aspiro setup` / `scripts/aspiro update` (`docs/SELF_HOSTING.md`). Outside access is a Cloudflare Tunnel (`--profile tunnel`) or Tailscale (`--profile tailscale`: tailnet-only, or public with Funnel), so no router port is open. Keep Cloudflare **Bot Fight Mode off**: it blocks the LINE webhook; tailnet-only Tailscale cannot receive it at all.

**Docs:** `docs/README.md` is the index. The ones worth loading before editing: `docs/ARCHITECTURE.md`, `docs/FINANCIAL_TERMINOLOGY.md` (money invariants), `docs/UI_CONVENTIONS.md`, `docs/TESTING.md`, `docs/SECURITY.md`. The API reference is generated at `/docs` on a running backend — never write it down. Docs that go stale get deleted, not archived; if you find one wrong, fix or delete it in the same change.

## Commands

### Full stack (Docker — recommended for local dev)
```bash
./start-local.sh          # starts all services
```
Services: frontend :3000 · backend :8000 · Swagger :8000/docs · pgAdmin :5050

**Production stack:** `docker-compose.pi.yml` (the name is historical; it runs on any amd64/arm64 host) runs Postgres, backend, the production frontend build and Caddy, with `cloudflared` behind the `tunnel` profile and `tailscale` behind the `tailscale` profile. See `docs/SELF_HOSTING.md`.

### Backend only
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

pytest                                              # all tests
pytest tests/test_foo.py::TestClass::test_method   # single test
pytest -m unit                                      # by marker (unit / api / database / integration)
pytest -m "not slow"

alembic upgrade head
alembic revision --autogenerate -m "description"
```

### Frontend only
```bash
cd frontend
npm run dev
npm run lint && npm run type-check
npm run type-check:tests    # tests are excluded from tsconfig.json; this checks them
npm test                    # Jest unit tests
npm run test:playwright     # Playwright e2e
npm run test:crud           # CRUD-specific playwright tests
npm run build               # production build
```

## Architecture

### Three-Wallet System (core domain concept)
Every user has three wallets. **This drives almost all financial logic.**

| Wallet | What it holds | Enum |
|---|---|---|
| **Life** | Day-to-day cash — income, expenses | `TransactionWalletType.LIFE` |
| **Emergency** | Emergency fund (cash, and holdings parked there) | `TransactionWalletType.EMERGENCY` · `HoldingWalletType.EMERGENCY` |
| **Portfolio** | Invested assets (stocks, ETFs, crypto) — **never cash** | `HoldingWalletType.PORTFOLIO` |

Note the two enums are deliberately different sets: cash lives only in the *transaction* wallets (`life`/`emergency`, `transactions/models.py`), while holdings live in the *holding* wallets (`portfolio`/`emergency`, `portfolio/models.py`).

**Total Asset** = `life + portfolio + emergency` (`dashboard/services.py`). **Net worth** = Total Asset − debt balance. **Investment Total** = the Portfolio wallet only.

Invariants that must be maintained in all transaction logic:
- Cash transfers move **only between Life and Emergency**. `portfolio` is rejected as a transfer target — `create_transfer` validates against `TransactionWalletType`.
- Money enters investments by **buying a holding**, which debits the Life Wallet; selling credits proceeds back to it (`portfolio/services.py::credit_sale_proceeds_to_life`). That bridge is what prevents double-counting.

> **Was four wallets until 2026-05-02.** The `Investment` wallet (cash staged for trading) was removed and its transactions re-classified to Life; `Portfolio Performance`→`Portfolio` and `Urgent`→`Emergency` were renamed. See `alembic/versions/2026_05_02_remove_investment_wallet.py`. Older docs, comments and fixtures may still use the old four-wallet names.

### Backend module layout (`backend/app/modules/`)
Typical module structure: `models.py · schemas.py · repositories.py · services.py · router.py · dependencies.py`. Data access lives in `repositories.py` (extends `BaseRepository` in `backend/app/common/base_repository.py`); services hold business logic and call repositories. File naming varies (`service.py` vs `services.py`), and larger modules add helpers — e.g. `transactions/` has `attachment_service.py · cache_service.py · demo_service.py · spending_alerts.py`, and `portfolio/` splits its router into a `routers/` sub-package alongside many calculator/service files (IRR, metrics, market data, rebalancing).

| Module | Responsibility |
|---|---|
| `auth` | Token endpoints, Google OAuth callback |
| `users` | Profile, preferences, security (GoogleOAuthManager, password hashing) |
| `transactions` | Income/expense CRUD, wallet balance updates |
| `portfolio` | Holdings, historical prices, performance metrics |
| `dashboard` | Aggregated stats across all wallets |
| `goals` | Savings goals, milestones, gamification (streaks, achievements) |
| `line_bot` | LINE Messaging API webhook + account linking + group expense splitting |
| `loans` | Peer loan tracking |
| `peers` | Social comparison / peer connections |
| `reports` | Spending, monthly-trend and goals reads behind `/review` |
| `admin` | Admin panel, user management, DB sync |
| `notifications` | Alerts and reminders |

All API responses use `ApiResponse[T]` from `backend/app/common/schemas.py` — a generic envelope with `success`, `data`, `message` fields.

Backend settings are loaded via `backend/app/core/config.py` using pydantic-settings. Access with `get_settings()` (cached via `@lru_cache`). Env file priority: `.env.production` → `.env` in production; `.env.local` → `.env` in dev.

Shared app-level infrastructure lives outside `modules/`: `app/common/` (base repository, `ApiResponse` schemas, error handlers, constants), `app/core/` (config + database engine/session — `get_db`), `app/middleware/` (CORS, logging, rate limiting, pure-ASGI helpers), and `app/utils/` (currency, datetime, exchange-rate, validation helpers).

### Frontend architecture

**Routing**: Next.js 16 App Router under `frontend/src/app/`. Pages are in `app/<route>/page.tsx`. All authenticated pages wrap with `DashboardLayout` from `components/layout/`.

**Auth flow**:
1. NextAuth.js (`src/lib/auth.ts`) handles Google OAuth and credentials login on the frontend.
2. On sign-in, NextAuth calls the FastAPI backend (`/api/v1/auth/...`) to get JWT tokens and stores `accessToken` + `refreshToken` in the NextAuth JWT.
3. The `AuthContext` (`src/contexts/AuthContext.tsx`) provides `mode: 'authenticated' | 'demo' | 'unauthenticated'` app-wide. Use `useAppMode()` to read it — never call `useSession()` directly in components.
4. Token refresh errors redirect to `/api/auth/destroy` (a custom route that clears all NextAuth cookies server-side) instead of calling `signOut()`, to avoid a race condition with HttpOnly cookies.

**API calls**:
- `src/lib/api-client.ts` — base Axios instance. Uses `INTERNAL_API_URL` (Docker-to-backend) for server-side calls and `NEXT_PUBLIC_API_URL` for client-side calls.
- `src/services/` — per-domain service modules that wrap `apiClient`.
- `src/hooks/` — TanStack Query hooks (`useTransactions`, `usePortfolio`, `useGoals`, etc.) that consume the service layer.

**TanStack Query config** (in `src/app/providers.tsx`):
- `staleTime: 5 min`, `gcTime: 30 min`
- `refetchOnWindowFocus: false`, `refetchOnReconnect: true`
- Query keys live in one registry (`QUERY_KEYS` in `hooks/useDataSynchronization.ts`) and `isRefreshableQueryKey` is the single predicate every refresh path uses. A key that is not registered and grouped fails `__tests__/hooks/queryKeyRegistry.test.ts`.
- 4xx errors are never retried; 5xx errors retry once.

**Demo mode**: A full client-side demo with fixture data, no backend required. Check `isDemo` from `useAppMode()` before making API calls. Demo-aware components guard with `canPersistData`.

### LINE Bot
`backend/app/modules/line_bot/` is the largest module (~3800+ lines in `service.py`).
- `POST /line-bot/webhook` — unauthenticated; LINE signs requests with `X-Line-Signature` (verified in the handler).
- Authenticated endpoints require JWT and are called by the frontend settings page.
- Account linking flow: user runs `/link` in LINE → backend generates a token → user clicks link in Aspiro frontend → `POST /line-bot/link-confirm` completes the link.
- `LineGroupMember.line_user_id` is a plain string (not a FK) — must be cleaned up explicitly on unlink.
- `_fetch_line_profile` results are cached in-process for 5 minutes (`_profile_cache` dict).

## Key Conventions

### Backend
- Async SQLAlchemy throughout. DB sessions injected via `Depends(get_db)` (canonical) — `get_async_session` is a thin alias kept for back-compat.
- Data access goes through repositories (`repositories.py`, extending `BaseRepository`); keep raw queries out of routers/services where a repository method fits.
- All routers return `ApiResponse[T]` using `ApiResponse.success_response(data=...)`.
- `CurrentUser` dependency (`users/dependencies.py`) validates JWT and returns the user model.
- `SKIP_DB_SCHEMA_INIT=True` in production — the app never creates tables. Alembic migrations are NOT auto-applied on deploy: schema changes ship as an Alembic migration (local/dev) plus an idempotent SQL script in `backend/scripts/prod_sql/`, applied manually against the target DB followed by `alembic stamp head`. `aspiro update` runs the migration itself and rolls back if the schema doesn't reach head.
- PgBouncer transaction mode in production: `statement_cache_size=0` is required in asyncpg connect args.

### Frontend
- `focus-visible:` not `focus:` for keyboard-only UI elements (avoids flash on page load).
- LINE brand green: `#06C755` / `#05b34d` hover.
- Tailwind `prosperity-*` color scale = the app's primary brand palette.
- All images from external CDNs (LINE, etc.) use plain `<img>` not `next/image` — add `// eslint-disable-next-line @next/next/no-img-element` when needed.

## Sub-agent Ownership

This project uses Claude Code's multi-agent harness. Agents in `.claude/agents/` are auto-triggered by directory. Page/module-specific agents take priority over the generalist (`be-developer` / `fe-developer`) for the areas they own.

**Backend**

| Agent | Owns |
|---|---|
| `be-users` | `backend/app/modules/users/` · `backend/app/modules/auth/` (JWT, Google/LINE login, profiles, user-related Alembic migrations) |
| `be-transactions` | `backend/app/modules/transactions/` + wallet balance logic (three-wallet system) |
| `be-goal` | `backend/app/modules/goals/` · gamification (streaks, milestones, achievements) |
| `be-portfolio` | `backend/app/modules/portfolio/` (holdings, prices, performance, IRR, rebalancing) |
| `be-line-bot` | `backend/app/modules/line_bot/` (webhook, account linking, group expense splitting) |
| `be-developer` | All other backend work |

**Frontend**

| Agent | Owns |
|---|---|
| `fe-dashboard` | `app/(root)` · `app/dashboard/` · `components/dashboard/` |
| `fe-portfolio` | `app/portfolio/` · `app/rebalancing/` · `components/portfolio/` |
| `fe-transactions` | `app/transactions/` · `components/transactions/` |
| `fe-goals` | `app/goals/` · `app/savings/` · `app/achievements/` · `components/goals/` |
| `fe-settings` | `app/settings/` · `app/link-line/` |
| `fe-developer` | Other FE pages (review, loans, admin, auth) · shared components, hooks, providers, API client |
| `fe-ui-ux` | Styling, TailwindCSS, RWD, accessibility |
| `fe-analytics` | Analytics integration, event tracking, KPI dashboards |
| `fe-performance` | Bundle size, Core Web Vitals, lazy loading |
| `fe-qa` | Playwright e2e tests, Jest unit tests |

**Cross-cutting**

| Agent | Owns |
|---|---|
| `git-workflow` | Commits, PRs, branch management |
| `coordination-guide` | Frontend↔backend coordination for parallel development |
| `crud-fix-specialist` | CRUD data issues (race conditions, cache invalidation, persistence) |
| `meta-agent` | Generating new sub-agent definitions |
| `session-manager` | Session time tracking, graceful work preservation |

## Agentic Workflow Rules

How agents (and parallel / concurrent sessions) operate in this repo. These exist to prevent the failure modes recorded in this project's memory: env drift, stranded prod changes, stale caches, and shared-worktree collisions. Two of them are enforced by hooks (`.claude/hooks/`); the rest are conventions agents must follow.

### 1. Agent selection & scope
- One change → one owning agent. Pick the directory-owned agent from the Sub-agent Ownership map above; fall back to `be-developer` / `fe-developer` only when nothing more specific fits.
- `cook` / `fe_cook` (all agents in parallel) is for **independent, read-heavy** fan-out (audits, reviews) — never for edits that touch shared files (`shared/*`, `src/lib/api-client.ts`, providers, contexts). Parallel writers on one worktree corrupt each other.
- A change spanning a shared contract (backend schema ↔ frontend type) goes through `coordination-guide` first; don't have two agents edit both sides in parallel.

### 2. Concurrent-session safety (shared worktree)
- Another session may hold live, uncommitted edits in this tree. Never run ops that override git's own safety here: `git stash -u/-a`, `git reset --hard`, `git clean -f`, `git checkout -f` / `git switch -f`, `git checkout .`. **(Blocked by `pre_tool_use.py`.)** For risky work, use a dedicated `git worktree`.
- Prefer additive commits on the current branch. State which files you'll edit before editing so parallel agents don't collide.

### 3. "Done" means verified, not written
- A green typecheck / lint is necessary, not sufficient. Before claiming a change works, drive the actual flow (`/verify` or `/run`) — several past runtime crashes compiled clean.
- Preview frontend / UI changes via the `demo-mode=true` cookie before saying they work.

### 4. Prod follow-through (schema changes)
- A schema change ships **three artifacts together**, never one: (a) the Alembic migration, (b) idempotent SQL in `backend/scripts/prod_sql/`, (c) a "PROD PENDING" note (memory + a running deploy backlog). Prod migrations are NOT auto-applied. **(A reminder fires from `post_tool_use.py` when a new migration is written.)**
- New table ⇒ enable RLS in the same change (the backend connects as superuser and bypasses it, so a missing policy is invisible from the app).

### 5. Git hygiene
- Never commit or push unless asked. If on `main`, branch first.
- Conventional commits (via `git-workflow`). No `Co-Authored-By` or other AI attribution in commits or PRs. Run `/code-review` on the diff before opening a PR.

### 6. Environment discipline (drift is the #1 recurring bug class)
- Reproduce prod-shape issues in Docker, not native: ports differ (native :5432 vs Docker :5433), as do secrets and pinned package versions.
- After a dependency bump, reinstall **inside the container**, not just on the host.
- Don't run a host `npm run dev` while Docker is up — they fight over `frontend/.next`.

### 7. Memory hygiene
- Record a fact when it was non-obvious and will recur; one fact per file; absolute dates. Delete memories proven wrong. Don't record what the repo or git history already shows.
