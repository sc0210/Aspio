# Architecture

How Aspiro is put together. For the domain vocabulary (wallets, Total Asset, Net Worth) see
[FINANCIAL_TERMINOLOGY.md](FINANCIAL_TERMINOLOGY.md); for deploying see
[SELF_HOSTING.md](SELF_HOSTING.md).

## Stack

| Layer | What we run |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript 5 · TailwindCSS 3 · TanStack Query v5 · NextAuth v4 · Recharts 2 |
| Backend | FastAPI 0.141 · Python 3.11 · SQLAlchemy 2.0 (async) · Pydantic v2 · Alembic |
| Database | PostgreSQL 15 — 48 tables |
| Auth | NextAuth (frontend session) + JWT / Google OAuth (backend) |

Versions are pinned in `frontend/package.json` and `backend/requirements.txt`; treat those as
the source of truth if this table drifts.

## Shape

```
Browser ──► Next.js (App Router)
              │  server components / route handlers → INTERNAL_API_URL
              │  client components → NEXT_PUBLIC_API_URL
              ▼
           FastAPI  /api/v1/*
              │  router → service → repository
              ▼
           PostgreSQL
```

LINE users reach the same backend through `POST /line-bot/webhook`, which is unauthenticated and
verified by the `X-Line-Signature` header instead of a JWT.

## Backend

### Module layout

Every feature is a package under `backend/app/modules/`, and each follows the same layering:

| File | Holds |
|---|---|
| `models.py` | SQLAlchemy models |
| `schemas.py` | Pydantic request/response contracts |
| `repositories.py` | All data access — extends `BaseRepository` (`app/common/base_repository.py`) |
| `services.py` | Business logic; calls repositories, never raw queries |
| `router.py` | HTTP endpoints; returns `ApiResponse[T]` |
| `dependencies.py` | FastAPI `Depends` wiring |

Naming varies (`service.py` vs `services.py`), and bigger modules add helpers — `transactions/`
has `attachment_service · cache_service · demo_service · spending_alerts`, and `portfolio/`
splits its router into a `routers/` sub-package next to its IRR, metrics, market-data and
rebalancing calculators.

| Module | Responsibility |
|---|---|
| `auth` | Token endpoints, Google OAuth callback |
| `users` | Profile, preferences, security, gamification achievements |
| `transactions` | Income/expense CRUD, wallet balance updates |
| `portfolio` | Holdings, historical prices, performance, IRR, rebalancing |
| `dashboard` | Aggregated stats across all wallets |
| `goals` | Savings goals, milestones, streaks |
| `line_bot` | LINE webhook, account linking, group expense splitting. Optional: mounted only when `settings.line_bot_enabled`; the frontend reads `GET /features` and hides LINE surfaces |
| `loans` | Peer loan tracking |
| `peers` | Social comparison / peer connections |
| `reports` | Spending, monthly-trend and goals reads behind `/review` |
| `admin` | Admin panel: user management and approvals, DB stats and cleanup, audit log, system health |
| `notifications` | Alerts and reminders |

Shared infrastructure lives outside `modules/`:

- `app/common/` — `BaseRepository`, `ApiResponse` schemas, constants
- `app/core/` — `config.py` (pydantic-settings, `get_settings()` cached via `@lru_cache`),
  `database.py` (engine, `get_db`), `exceptions.py` (`setup_exception_handlers`)
- `app/middleware/` — `cors · logging · rate_limit · pure_asgi`
- `app/utils/` — currency, datetime, exchange-rate, validation helpers

Schema migrations live in `backend/alembic/` only.

### Response envelope

Every route returns the generic envelope from `app/common/schemas.py`:

```python
class ApiResponse(BaseModel, Generic[DataT]):
    success: bool
    data: Optional[DataT] = None
    message: Optional[str] = None
    errors: Optional[List[str]] = None
    meta: Optional[PaginationMeta] = None   # page · limit · total · total_pages · has_next · has_previous
```

Build it with `ApiResponse.success_response(data=...)`. Errors are raised as the exception types
in `app/core/exceptions.py` and converted by `setup_exception_handlers(app)` — do not hand-roll
error dicts in routers.

### Conventions

- Async SQLAlchemy throughout; sessions injected with `Depends(get_db)`. `get_async_session` is
  a back-compat alias for the same thing.
- `CurrentUser` (`users/dependencies.py`) validates the JWT and returns the user model.
- Eager-load with `selectinload` to avoid N+1; paginate with `PaginationParams`.
- `SKIP_DB_SCHEMA_INIT=True` in production — the app never creates tables.
- asyncpg's statement cache is on for a direct Postgres connection and off behind a
  transaction-mode pooler (`settings.database_via_pooler`), where a named statement can land on
  another backend. Supabase pooler hosts and port 6543 are detected; a self-hosted PgBouncer on
  another port must set `DATABASE_VIA_POOLER=true`. `pool_pre_ping` stays on everywhere.

Health: `GET /health`, `/health/detailed`, `/health/scheduler`. Interactive API docs at
`/docs` — that is the API reference, which is why none is duplicated here.

## Frontend

### Layout

```
frontend/src/
├── app/            # App Router pages; authed pages wrap in DashboardLayout
├── components/     # ui/ · layout/ · dashboard/ · transactions/ · portfolio/ · goals/ · housing/
├── hooks/          # TanStack Query hooks (useTransactions, usePortfolio, useGoals …)
├── services/       # per-domain wrappers over apiClient
├── contexts/       # AuthContext, DemoContext
├── lib/            # api-client.ts, i18n, housing calculators
└── shared/types/   # cross-cutting TypeScript types (@/shared/*)
```

### Auth flow

1. NextAuth (`src/lib/auth.ts`) handles Google OAuth and credentials login.
2. On sign-in it calls `/api/v1/auth/...` and stores `accessToken` + `refreshToken` in the
   NextAuth JWT.
3. `AuthContext` exposes `mode: 'authenticated' | 'demo' | 'unauthenticated'` app-wide. Read it
   with `useAppMode()` — never call `useSession()` directly in a component.
4. Refresh failures redirect to `/api/auth/destroy`, a custom route that clears NextAuth cookies
   server-side. Calling `signOut()` instead races the HttpOnly cookies.

### Data fetching

`src/lib/api-client.ts` is the single Axios instance. It picks `INTERNAL_API_URL` for
server-side calls (container-to-container) and `NEXT_PUBLIC_API_URL` for browser calls. Domain
services in `src/services/` wrap it; TanStack Query hooks in `src/hooks/` wrap those. Components
talk to hooks, not to Axios.

Query defaults (`src/app/providers.tsx`): `staleTime` 5 min, `gcTime` 30 min,
`refetchOnWindowFocus` off but `refetchOnReconnect` on (focus is too chatty; reconnect is the one passive signal that data was missed), 4xx never retried, 5xx retried once.

Mutations must invalidate the query keys they affect — stale caches after a write are the most
common CRUD bug in this codebase.

### Demo mode

A full client-side demo backed by fixture data, no backend required. Check `isDemo` from
`useAppMode()` before making an API call, and guard writes with `canPersistData`. To preview an
authenticated page in a browser, set the `demo-mode=true` cookie.

## Data model

48 tables. The ones worth knowing before touching financial logic:

| Table | Note |
|---|---|
| `transactions` | Life/Emergency cash movements. `transfer_group_id` links the two legs of a transfer; `holding_id` links the expense that bought a holding; `loan_id` links a repayment |
| `portfolio_holdings` · `portfolio_transactions` | Holdings live in the Portfolio or Emergency wallet, never as cash |
| `transaction_categories` | Global rows (`user_id IS NULL`) plus per-user rows |
| `historical_prices` · `market_data` | Two independent pipelines — a live quote and a previous close can go stale separately |
| `line_*` | `line_group_members.line_user_id` is a plain string, not an FK — clean it up explicitly on unlink |

New tables need RLS enabled in the same change: the backend connects as superuser and bypasses
it, so a missing policy is invisible until something else reads the table.

## Cross-cutting

**Currency.** Amounts are `NUMERIC(15,2)`; quantities are `NUMERIC(18,8)`. Normalise to a base
currency with the helpers in `app/utils/` (backend) or `toTWD` (frontend) before summing across
holdings.

**Scheduled work.** Price refresh, historical sync, payment reminders and spending alerts each
have a one-shot runner in `backend/scripts/` (`run_price_update_job.py`,
`run_historical_sync_job.py`, `run_payment_reminders.py`, `run_spending_alerts.py`). In-process
scheduling is gated by `ENABLE_SCHEDULER`; leave it off anywhere memory is tight, since the
price refresh is the heaviest job in the app. It defaults on, and the self-host stack runs every
job inside the backend (`docker logs aspiro-backend | grep 'Scheduled:'`), so do not also add
crons for them there: they would run twice.
