# Backend Scripts

Run from `backend/` with the app's env (needs `DATABASE_URL`). Each script's
docstring is the authoritative usage; this is only an index.

## Schema

| Script | What it does |
|---|---|
| `migrate.sh` | Alembic entrypoint for a container or host shell (`--init` for a fresh DB) |
| `prod_sql/` | Idempotent SQL for each schema change, applied by hand on prod, then `alembic stamp head`. `_verify_pending.sql` reports what a DB is missing |
| `seed/` | Reference data (`categories.sql`, `currencies.sql`) |
| `add_performance_indexes.py` | Adds dashboard query indexes not covered by Alembic |

## One-shot jobs

The Pi runs these in-process via the scheduler; the scripts exist for running
one by hand or on a host with `ENABLE_SCHEDULER=false`.

| Script | Job |
|---|---|
| `run_price_update_job.py [TW\|US\|CRYPTO\|ALL]` | Live price refresh |
| `run_historical_sync_job.py` | Recent `historical_prices` sync |
| `run_payment_reminders.py` | Payment-due notifications |
| `run_spending_alerts.py` | Spending-alert notifications |

## Backfills and repairs

| Script | What it does |
|---|---|
| `backfill_price_gaps.py` | Fills holes in `historical_prices` |
| `backfill_fx_history.py` | Daily USD/TWD rate series used by TWR |
| `calculate_irr.py` | Recomputes every open lot's stored IRR (`--dry-run` first) |

## Admin and data movement

| Script | What it does |
|---|---|
| `create_admin.py` | Grants admin role to an existing user |
| `db_sync.sh` | Pushes the local Docker DB to Supabase (cold standby) |
