-- Performance Indexes Migration
-- Date: 2025-11-07
-- Purpose: Add indexes to fix sequential scans and improve query performance
-- Impact: Zero frontend changes, pure backend optimization

BEGIN;

-- ========================================
-- 1. Portfolio Holdings Performance Indexes
-- ========================================

-- Index for holdings aggregation by portfolio (active holdings only)
-- Fixes: Sequential scans when loading portfolio with holdings
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_active
ON portfolio_holdings (portfolio_id, is_active)
WHERE is_active = true;

-- Index for multi-lot holdings queries (supports purchase_date tracking)
-- Fixes: Queries that need to show holdings grouped by symbol with dates
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_symbol_active_date
ON portfolio_holdings (portfolio_id, symbol, is_active, purchase_date DESC)
WHERE is_active = true;

-- Index for user-wide portfolio queries
-- Fixes: Dashboard queries that need all holdings for a user across portfolios
CREATE INDEX IF NOT EXISTS idx_holdings_user_active_updated
ON portfolio_holdings (user_id, is_active, updated_at DESC);

-- ========================================
-- 2. Partial Indexes for Soft-Deleted Records
-- ========================================

-- Transactions: Index for active (non-deleted, completed) transactions
-- Fixes: Most queries filter by is_deleted = false AND status = 'COMPLETED'
CREATE INDEX IF NOT EXISTS idx_transactions_active_user_date
ON transactions (user_id, transaction_date DESC)
WHERE is_deleted = false AND status = 'COMPLETED';

-- Transactions: Index for active transactions by category
-- Usage: Category spending analysis, budget tracking
CREATE INDEX IF NOT EXISTS idx_transactions_active_category_date
ON transactions (category_id, transaction_date DESC)
WHERE is_deleted = false;

-- Portfolio Holdings: Index for active holdings by user and portfolio
-- Usage: Any query that lists or aggregates holdings
CREATE INDEX IF NOT EXISTS idx_holdings_active_only
ON portfolio_holdings (user_id, portfolio_id, updated_at DESC)
WHERE is_active = true;

-- Goals: Index for active goals by user
-- Fixes: Dashboard goal widgets, goal list page
CREATE INDEX IF NOT EXISTS idx_goals_active_user_priority
ON goals (user_id, priority, target_date ASC)
WHERE status = 'ACTIVE';

COMMIT;

-- Verify indexes were created
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname IN (
    'idx_holdings_portfolio_active',
    'idx_holdings_portfolio_symbol_active_date',
    'idx_holdings_user_active_updated',
    'idx_transactions_active_user_date',
    'idx_transactions_active_category_date',
    'idx_holdings_active_only',
    'idx_goals_active_user_priority'
)
ORDER BY tablename, indexname;
