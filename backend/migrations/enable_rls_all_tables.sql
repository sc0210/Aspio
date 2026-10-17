-- Enable Row Level Security on all public tables
-- -----------------------------------------------
-- The FastAPI backend connects as the postgres superuser via the Supabase
-- transaction pooler. Superusers bypass RLS, so NO backend queries are affected.
-- RLS only blocks direct PostgREST / Supabase client access, which is the intent:
-- all data access must go through the API layer.
--
-- Policy summary:
--   • User/auth/admin tables  → RLS on, no policies → deny all PostgREST access
--   • Reference/lookup tables → RLS on, SELECT allowed for authenticated role


-- ── User data ────────────────────────────────────────────────────────────────
ALTER TABLE public.users                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_holdings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_analytics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_wallet_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_import_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_milestones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_contributions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividends                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_gamification_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_data_exports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_security_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preference_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_accounts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saving_records              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_connections            ENABLE ROW LEVEL SECURITY;

-- ── LINE Bot / group expense splitting ────────────────────────────────────────
-- Per-user and group-chat data (incl. link tokens). RLS on, no policies.
ALTER TABLE public.line_groups                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_group_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_user_links             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_link_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_bot_activities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_expenses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_goals                ENABLE ROW LEVEL SECURITY;

-- ── Auth / token tables ───────────────────────────────────────────────────────
ALTER TABLE public.refresh_tokens              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_providers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions               ENABLE ROW LEVEL SECURITY;

-- ── Admin / system tables ─────────────────────────────────────────────────────
ALTER TABLE public.admin_users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings             ENABLE ROW LEVEL SECURITY;

-- ── Reference / lookup tables ─────────────────────────────────────────────────
-- Enable RLS, then allow authenticated users to read so the frontend can query
-- these static datasets directly if needed.
ALTER TABLE public.currencies                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_data                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_prices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_rates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON public.currencies
    FOR SELECT USING (true);

CREATE POLICY "anon_read" ON public.transaction_categories
    FOR SELECT USING (true);

CREATE POLICY "anon_read" ON public.market_data
    FOR SELECT USING (true);

CREATE POLICY "anon_read" ON public.historical_prices
    FOR SELECT USING (true);

CREATE POLICY "anon_read" ON public.currency_rates
    FOR SELECT USING (true);

CREATE POLICY "anon_read" ON public.notification_templates
    FOR SELECT USING (true);


-- ── Drop legacy permissive "backend_access" policies ──────────────────────────
-- Alembic migrations 2026_05_14 / 2026_05_27 added a `backend_access` policy
-- `FOR ALL USING (true) WITH CHECK (true)` to satisfy the "RLS enabled, no policy"
-- hint. The 2026_05_27 batch omitted `TO postgres`, so it defaulted to PUBLIC and
-- actually GRANTED anon/authenticated full access via PostgREST — the opposite of
-- the intent, now flagged by Supabase lint 0024 (rls_policy_always_true). The
-- backend connects as the postgres superuser and bypasses RLS, so no policy is
-- needed at all: drop every backend_access policy, leaving RLS-on / no-policy
-- (deny all direct access). Idempotent.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'backend_access'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "backend_access" ON public.%I', r.tablename);
    END LOOP;
END $$;


-- ── Catch-all: enable RLS on any remaining public table ───────────────────────
-- Self-healing guard so a newly added table can't silently ship to prod without
-- RLS (which is what triggered the Supabase advisor finding). Enables RLS on every
-- public base table that still lacks it; tables already covered above (incl. the
-- reference tables with anon_read policies) are skipped. Safe to re-run.
DO $$
DECLARE t regclass;
BEGIN
    FOR t IN
        SELECT c.oid::regclass
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity = false
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;
