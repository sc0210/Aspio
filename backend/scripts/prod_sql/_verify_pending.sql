-- ============================================================================
-- Aspiro — verify which pending prod schema changes a target database is missing
--
-- Read-only. Safe to run against anything, any number of times. Prints one row
-- per expected object with OK / MISSING, so you can tell at a glance what still
-- needs applying rather than re-running the DDL blind and reading NOTICEs.
--
-- Usage on the Pi (production):
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/_verify_pending.sql
--
-- Usage locally (reference DB — should be all OK):
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/_verify_pending.sql
--
-- Anything MISSING → apply the named file from this directory, then re-run this
-- to confirm. Once everything is OK, run `alembic stamp head` on the backend so
-- alembic_version matches the schema it is actually looking at.
-- ============================================================================

WITH checks(sort, object, source_file, present) AS (
    VALUES
    -- 2026_07_04_daily_wallet_snapshots.sql
    (1, 'table daily_wallet_snapshots', '2026_07_04_daily_wallet_snapshots.sql',
        (SELECT count(*) > 0 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'daily_wallet_snapshots')),

    -- 2026_07_07_add_transfer_group_id.sql
    (2, 'column transactions.transfer_group_id', '2026_07_07_add_transfer_group_id.sql',
        (SELECT count(*) > 0 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transactions'
            AND column_name = 'transfer_group_id')),
    (3, 'index idx_transactions_transfer_group', '2026_07_07_add_transfer_group_id.sql',
        (SELECT count(*) > 0 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_transactions_transfer_group')),

    -- 2026_07_12_line_processed_events.sql
    (4, 'table line_processed_events', '2026_07_12_line_processed_events.sql',
        (SELECT count(*) > 0 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'line_processed_events')),

    -- 2026_07_13_portfolio_single_default.sql
    (5, 'index uq_portfolios_one_active_default_per_user', '2026_07_13_portfolio_single_default.sql',
        (SELECT count(*) > 0 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'uq_portfolios_one_active_default_per_user')),

    -- 2026_07_17_dedupe_duplicate_categories.sql
    -- Data fix, not DDL: "present" means no active (name,type) pair is duplicated.
    -- Must be clean BEFORE the unique index below can be created.
    (6, 'no duplicate active categories', '2026_07_17_dedupe_duplicate_categories.sql',
        (SELECT count(*) = 0 FROM (
            SELECT 1 FROM transaction_categories
             WHERE is_active
             GROUP BY name, type
            HAVING count(*) > 1
         ) d)),

    -- 2026_07_17_uq_active_category_name_type.sql
    (7, 'index uq_active_category_name_type', '2026_07_17_uq_active_category_name_type.sql',
        (SELECT count(*) > 0 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'uq_active_category_name_type')),

    -- 2026_08_02_add_holding_id_to_transactions.sql
    (8, 'column transactions.holding_id', '2026_08_02_add_holding_id_to_transactions.sql',
        (SELECT count(*) > 0 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transactions'
            AND column_name = 'holding_id')),
    (9, 'index idx_transactions_holding', '2026_08_02_add_holding_id_to_transactions.sql',
        (SELECT count(*) > 0 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_transactions_holding')),

    -- 2026_08_14_holding_previous_close.sql
    (10, 'column portfolio_holdings.previous_close', '2026_08_14_holding_previous_close.sql',
        (SELECT count(*) > 0 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'portfolio_holdings'
            AND column_name = 'previous_close')),

    -- 2026_08_26_canonical_symbols.sql
    -- Unlike every check above this one is about DATA, not schema: the repair
    -- adds no object, so "is it applied?" can only be answered by asking whether
    -- any of the merged spellings survive. Absent this entry the report reads
    -- all-OK while each security still carries two half-depth price series.
    (11, 'symbols merged onto one spelling', '2026_08_26_canonical_symbols.sql',
        (SELECT count(*) = 0 FROM portfolio_holdings
          WHERE symbol ~ '^[0-9]+\.TWO?$'
             OR symbol IN ('50', '6208', '713'))),
    (12, 'no orphaned bare-crypto price rows', '2026_08_26_canonical_symbols.sql',
        (SELECT count(*) = 0 FROM historical_prices hp
          WHERE hp.symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC')
            AND NOT EXISTS (SELECT 1 FROM portfolio_holdings h WHERE h.symbol = hp.symbol))),
    -- Check 12 cannot see this one: a bare crypto holding keeps its own price
    -- rows from being orphaned, so the check above reads OK while the holding
    -- itself is still stored ambiguously against an equity ticker.
    (13, 'no crypto holdings on a bare base', '2026_08_26_canonical_symbols.sql',
        (SELECT count(*) = 0 FROM portfolio_holdings
          WHERE symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC')
            AND type IN ('crypto', 'cryptocurrency'))),

    -- 2026_09_17_holding_price_precision.sql
    (14, 'portfolio_holdings cost and price at 10 decimal places', '2026_09_17_holding_price_precision.sql',
        (SELECT count(*) = 2 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'portfolio_holdings'
            AND column_name IN ('average_cost', 'current_price')
            AND numeric_scale = 10)),
    -- 2026_10_07_transaction_day_position.sql
    (15, 'column transactions.day_position', '2026_10_07_transaction_day_position.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'transactions'
                   AND column_name = 'day_position'))
)
SELECT
    CASE WHEN present THEN 'OK     ' ELSE 'MISSING' END AS status,
    object,
    CASE WHEN present THEN '' ELSE source_file END AS apply_this
FROM checks
ORDER BY present, sort;

-- ── alembic bookkeeping ────────────────────────────────────────────────────
-- Should equal the single head in backend/alembic/versions (check with
-- `alembic heads`). If the schema above is fully OK but this lags, the fix is
-- `alembic stamp head` — NOT `alembic upgrade head`, which errors on objects
-- that already exist.
SELECT 'alembic_version' AS what, string_agg(version_num, ', ') AS value
FROM alembic_version;

-- ── row-level security ─────────────────────────────────────────────────────
-- Only meaningful where something other than the backend superuser can reach
-- the database directly (Supabase's PostgREST + anon key). On the self-hosted
-- Pi there is no such surface and the backend bypasses RLS anyway, so a high
-- count here is informational, not a finding — the control that matters there
-- is keeping the Postgres port off the LAN (see docker-compose.pi.yml).
SELECT 'public tables without RLS' AS what, count(*)::text AS value
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
