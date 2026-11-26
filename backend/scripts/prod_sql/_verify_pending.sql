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
                   AND column_name = 'day_position')),
    -- 2026_10_22_username_lower_unique.sql
    (16, 'index users.uq_users_username_lower', '2026_10_22_username_lower_unique.sql',
        EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public' AND tablename = 'users'
                   AND indexname = 'uq_users_username_lower')),

    -- 2026_10_28_drop_daily_wallet_snapshots.sql (present = the table is gone)
    (17, 'table daily_wallet_snapshots dropped', '2026_10_28_drop_daily_wallet_snapshots.sql',
        to_regclass('public.daily_wallet_snapshots') IS NULL),

    -- 2026_11_03_security_quotes.sql
    (18, 'table security_quotes', '2026_11_03_security_quotes.sql',
        to_regclass('public.security_quotes') IS NOT NULL),
    (19, 'RLS on security_quotes', '2026_11_03_security_quotes.sql',
        COALESCE((SELECT relrowsecurity FROM pg_class
                   WHERE oid = to_regclass('public.security_quotes')), false)),

    -- 2026_11_06_goal_category_car_purchase.sql
    (20, 'enum value goalcategory.car_purchase', '2026_11_06_goal_category_car_purchase.sql',
        EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'goalcategory' AND e.enumlabel = 'car_purchase')),

    -- 2026_11_06_drop_system_alerts.sql
    (21, 'table system_alerts dropped', '2026_11_06_drop_system_alerts.sql',
        to_regclass('public.system_alerts') IS NULL),

    -- 2026_11_06_saving_records_rls.sql
    -- Retired by 2026_11_16_shared_goal_sides.sql: a dropped table passes too.
    (22, 'RLS on saving_records (or retired)', '2026_11_06_saving_records_rls.sql',
        COALESCE((SELECT relrowsecurity FROM pg_class
                   WHERE oid = to_regclass('public.saving_records')),
                 to_regclass('public.saving_records') IS NULL)),

    -- 2026_11_07_peer_splits.sql
    (23, 'table peer_connection_prefs (RLS on)', '2026_11_07_peer_splits.sql',
        COALESCE((SELECT relrowsecurity FROM pg_class
                   WHERE oid = to_regclass('public.peer_connection_prefs')), false)),
    (24, 'table peer_splits (RLS on)', '2026_11_07_peer_splits.sql',
        COALESCE((SELECT relrowsecurity FROM pg_class
                   WHERE oid = to_regclass('public.peer_splits')), false)),
    (25, 'table peer_split_shares (RLS on)', '2026_11_07_peer_splits.sql',
        COALESCE((SELECT relrowsecurity FROM pg_class
                   WHERE oid = to_regclass('public.peer_split_shares')), false)),
    (26, 'column transactions.peer_split_share_id', '2026_11_07_peer_splits.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'peer_split_share_id')),
    (27, 'index uq_transactions_live_peer_split_share', '2026_11_07_peer_splits.sql',
        to_regclass('public.uq_transactions_live_peer_split_share') IS NOT NULL),
    (28, 'table peer_settlements (RLS on)', '2026_11_07_peer_settlements.sql',
        EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.peer_settlements')
                AND relrowsecurity)),
    (29, 'column peer_splits.source_transaction_id', '2026_11_07_split_source_transaction.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'peer_splits' AND column_name = 'source_transaction_id')),
    (30, 'column peer_connection_prefs.split_notifications', '2026_11_08_peer_prefs_notifications.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'peer_connection_prefs' AND column_name = 'split_notifications')),
    (31, 'table peer_split_amendments (RLS on)', '2026_11_08_peer_split_amendments.sql',
        EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.peer_split_amendments')
                AND relrowsecurity)),
    (32, 'index uq_peer_split_amendments_open', '2026_11_08_peer_split_amendments.sql',
        to_regclass('public.uq_peer_split_amendments_open') IS NOT NULL),
    (33, 'column recurring_transactions.split_connection_id', '2026_11_08_recurring_splits.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'recurring_transactions' AND column_name = 'split_connection_id')),
    (34, 'column peer_split_amendments.kind', '2026_11_09_split_cancel_request.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'peer_split_amendments' AND column_name = 'kind')),
    (35, 'column goal_contributions.kind', '2026_11_14_goal_reservations.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'goal_contributions' AND column_name = 'kind')),
    (36, 'column transactions.goal_id', '2026_11_14_goal_reservations.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'goal_id')),
    (37, 'every goal in TWD', '2026_11_14_goal_reservations.sql',
        NOT EXISTS (SELECT 1 FROM goals WHERE currency <> 'TWD')),
    (38, 'column portfolio_holdings.goal_id', '2026_11_15_goal_holdings.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'portfolio_holdings' AND column_name = 'goal_id')),
    (39, 'column goals.shared_goal_id', '2026_11_15_goal_shared.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'goals' AND column_name = 'shared_goal_id')),
    (40, 'column users.access_tier', '2026_11_15_access_tier.sql',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'users' AND column_name = 'access_tier')),
    (41, 'saving_records retired', '2026_11_16_shared_goal_sides.sql',
        NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'saving_records')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'shared_goals' AND column_name = 'target_amount')),
    (42, 'table tw_market_valuations', '2026_11_21_tw_market_valuations.sql',
        (SELECT count(*) > 0 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'tw_market_valuations')),

    -- 2026_11_23_drop_unused_tables.sql (present = all nine are gone)
    (43, 'unused tables dropped', '2026_11_23_drop_unused_tables.sql',
        (SELECT count(*) = 0 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN (
            'chat_messages', 'chat_sessions', 'transaction_attachments', 'user_data_exports',
            'user_security_logs', 'user_preference_history', 'password_reset_tokens',
            'notification_templates', 'market_data'))),

    -- 2026_11_24_drop_line_bot_activities.sql (present = the table is gone)
    (44, 'line_bot_activities dropped', '2026_11_24_drop_line_bot_activities.sql',
        (SELECT to_regclass('public.line_bot_activities') IS NULL))
)
SELECT
    CASE WHEN present THEN 'OK     ' ELSE 'MISSING' END AS status,
    object,
    CASE WHEN present THEN '' ELSE source_file END AS apply_this
FROM checks
ORDER BY present, sort;

-- 2026_11_13_cash_face_value: expect 0 (cash lots priced other than 1).
SELECT 'cash lots not at face value' AS what, count(*)::text AS value
FROM portfolio_holdings
WHERE lower(type::text) = 'cash' AND (average_cost <> 1 OR current_price <> 1);
-- 2026_11_14_portfolio_currency_twd: expect 0.
SELECT 'portfolios not in TWD' AS what, count(*)::text AS value
FROM portfolios WHERE upper(currency) <> 'TWD';
-- 2026_11_15_access_tier: right after the first apply, expect 0 (every
-- account that existed was made premium). Later, free accounts are normal.
SELECT 'free-tier accounts' AS what, count(*)::text AS value
FROM users WHERE access_tier = 'free';

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
-- 2026_11_16_shared_goal_sides: expect 0 (open shared goals missing a partner's part).
SELECT 'shared goals without two parts' AS what, count(*)::text AS value
FROM shared_goals sg
WHERE sg.status <> 'cancelled'
  AND (SELECT count(*) FROM goals g WHERE g.shared_goal_id = sg.id AND g.status <> 'cancelled') < 2;
-- 2026_11_21_insurance_category: expect 1 (an active Insurance expense category).
SELECT 'insurance expense category' AS what, count(*)::text AS value
FROM transaction_categories WHERE name = 'Insurance' AND type = 'EXPENSE'::categorytype AND is_active;
-- 2026_11_21_tw_market_valuations: months stored for the Taiwan CAPE. 0 right
-- after the apply; ~250 once the first daily sync has backfilled from 2005.
SELECT 'tw_market_valuations months' AS what, count(*)::text AS value
FROM tw_market_valuations;
-- 2026_11_23_drop_unused_tables: expect 'gone' for each after the apply. Before
-- it, a count above 0 on any of the first six stops the drop: look at those rows.
SELECT t AS what,
       CASE WHEN to_regclass(t) IS NULL THEN 'gone'
            ELSE (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', t), false, true, '')))[1]::text
       END AS value
FROM unnest(ARRAY['chat_messages', 'chat_sessions', 'transaction_attachments', 'user_data_exports',
                  'user_security_logs', 'user_preference_history', 'password_reset_tokens',
                  'notification_templates', 'market_data']) AS t;
-- 2026_11_24_pass_through_recurring_detail: expect 2 (both new columns exist).
SELECT 'pass_through + recurring subcategory columns' AS what, count(*)::text AS value
FROM information_schema.columns
WHERE (table_name, column_name) IN (('transactions', 'pass_through'),
                                    ('recurring_transactions', 'subcategory'));
-- 2026_11_25_demo_dividend_per_share: expect 0 (demo rows still carrying a seeded yearly total).
SELECT 'demo annual dividends still yearly totals' AS what, count(*)::text AS value
FROM portfolio_holdings h JOIN users u ON u.id = h.user_id
WHERE u.email = 'demo@aspiro.dev'
  AND (h.symbol, h.annual_dividend) IN (('AAPL', 10.42), ('VOO', 26.78), ('2330', 1656.00));
