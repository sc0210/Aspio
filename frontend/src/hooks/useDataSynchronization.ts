'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useAppMode } from './useAppMode';

/**
 * Centralized query key constants for consistent cache management
 * All data hooks should use these keys for proper cross-page synchronization
 */
export const QUERY_KEYS = {
  // Dashboard related
  DASHBOARD: 'dashboard',
  OPTIMIZED_DASHBOARD: 'optimized-dashboard',
  WALLET_TRENDS: 'wallet-trends',

  // Transactions
  TRANSACTIONS: 'transactions',
  TRANSACTION_STATS: 'transaction-stats',
  TRANSACTION_CATEGORIES: 'transaction-categories',

  // Portfolio
  PORTFOLIO: 'portfolio',
  HOLDINGS: 'holdings',

  // Goals
  GOALS: 'goals',
  LOANS: 'loans',
  GOALS_SUMMARY: 'goals-summary',


  // Derived from transactions — these read the same ledger the wallets do, so
  // anything that writes a transaction makes them stale too.
  TRANSACTION_PAGE_STATS: 'transaction-page-stats',
  HEATMAP_MONTH_TRANSACTIONS: 'heatmap-month-transactions',
  INCOME_BY_CATEGORY: 'income-by-category',
  CASHFLOW_SPENDING_BY_CATEGORY: 'cashflow-spending-by-category',
  CASH_WALLET: 'cash-wallet',
  LOANS_LIST: 'loans-list',

  // Month in Review reads a month of the same ledger.
  REVIEW_SPENDING: 'review-spending',
  REVIEW_GOALS: 'review-goals',
  REVIEW_CONTEXT: 'review-context',
  REVIEW_TOP_EXPENSES: 'review-top-expenses',

  // Portfolio analytics — derived from holdings and their prices.
  PORTFOLIO_ANALYTICS: 'portfolio-analytics',
  PORTFOLIO_DAILY_PERFORMANCE: 'portfolio-daily-performance',
  PORTFOLIO_RISK_METRICS: 'portfolio-risk-metrics',
  PORTFOLIO_REALIZED_PNL: 'portfolio-realized-pnl',
  PORTFOLIO_DIVIDEND_INCOME: 'portfolio-dividend-income',
  PORTFOLIO_TWR: 'portfolio-twr',

  // Gamification — a goal contribution can unlock an achievement.
  ACHIEVEMENTS: 'achievements',
  GAMIFICATION: 'gamification',

  // Read off the ledger from their own pages.
  MONTHLY_SUMMARY: 'monthly-summary',
  ASSET_HISTORY: 'asset-history',
  BENCHMARK: 'benchmark',

  // Not derived from the ledger: refreshed on their own schedule, and
  // deliberately excluded from ledger invalidation (see UNGROUPED_KEYS).
  // Notifications are written by scheduled producers, not by the transaction
  // write path, so a save
  // cannot have produced one yet — invalidating here would only re-fetch the
  // same rows.
  NOTIFICATIONS: 'notifications',
  EXCHANGE_RATES: 'exchange-rates',
  ADMIN: 'admin',

  // User
  USER_PROFILE: 'user-profile',
} as const;

type QueryKeyName = keyof typeof QUERY_KEYS;
type QueryKeyValue = (typeof QUERY_KEYS)[QueryKeyName];

/**
 * Keys that deliberately sit outside every ledger group.
 *
 * `exchange-rates` has its own hour-long staleTime and does not move when a
 * transaction is written; `admin` is its own polled surface; `user-profile`
 * changes only through profile mutations, which invalidate it directly. The
 * registry test requires every other key to belong to a group, so anything new
 * must either be grouped or be added here on purpose.
 */
export const UNGROUPED_KEYS: readonly QueryKeyValue[] = [
  QUERY_KEYS.EXCHANGE_RATES,
  QUERY_KEYS.ADMIN,
  QUERY_KEYS.USER_PROFILE,
  QUERY_KEYS.NOTIFICATIONS,
] as const;

/**
 * Query groups for batch invalidation
 */
/**
 * Everything downstream of the ledger. A transaction or a holding write makes
 * every one of these stale, because each is computed from the same rows.
 *
 * This list used to be maintained by hand and drifted: /review, the transactions
 * summary tiles and the cash-flow insight card were never invalidated by
 * anything, so they showed pre-edit numbers until their staleTime expired. The
 * registry test now fails if a key exists without a group.
 */
const LEDGER_DERIVED: readonly QueryKeyValue[] = [
  QUERY_KEYS.TRANSACTION_STATS,
  QUERY_KEYS.TRANSACTION_PAGE_STATS,
  QUERY_KEYS.TRANSACTION_CATEGORIES,
  QUERY_KEYS.HEATMAP_MONTH_TRANSACTIONS,
  QUERY_KEYS.INCOME_BY_CATEGORY,
  QUERY_KEYS.CASHFLOW_SPENDING_BY_CATEGORY,
  QUERY_KEYS.CASH_WALLET,
  QUERY_KEYS.LOANS_LIST,
  QUERY_KEYS.REVIEW_SPENDING,
  QUERY_KEYS.REVIEW_GOALS,
  QUERY_KEYS.REVIEW_CONTEXT,
  QUERY_KEYS.REVIEW_TOP_EXPENSES,
  QUERY_KEYS.PORTFOLIO_ANALYTICS,
  QUERY_KEYS.PORTFOLIO_DAILY_PERFORMANCE,
  QUERY_KEYS.PORTFOLIO_RISK_METRICS,
  QUERY_KEYS.PORTFOLIO_REALIZED_PNL,
  QUERY_KEYS.PORTFOLIO_DIVIDEND_INCOME,
  QUERY_KEYS.PORTFOLIO_TWR,
  QUERY_KEYS.MONTHLY_SUMMARY,
  QUERY_KEYS.ASSET_HISTORY,
  QUERY_KEYS.BENCHMARK,
  QUERY_KEYS.HOLDINGS,
];

/**
 * A user's own data that a ledger write does NOT touch.
 *
 * Goals have no link to transactions on the backend: a contribution goes
 * through its own endpoint, which invalidates its own queries, and achievements
 * follow contributions the same way. Sweeping them into a transaction write
 * would be a refetch nobody asked for on every edit — so they are refreshed by
 * the manual Refresh button and on an auth change, but not by a save.
 */
const USER_DATA: readonly QueryKeyValue[] = [
  QUERY_KEYS.GOALS,
  QUERY_KEYS.GOALS_SUMMARY,
  QUERY_KEYS.ACHIEVEMENTS,
  QUERY_KEYS.GAMIFICATION,
];

const QUERY_GROUPS = {
  // The headline balances, refetched immediately after a write.
  dashboardRelated: [
    QUERY_KEYS.DASHBOARD,
    QUERY_KEYS.OPTIMIZED_DASHBOARD,
    QUERY_KEYS.WALLET_TRENDS,
    QUERY_KEYS.PORTFOLIO, // life wallet balance is derived from transactions — must sync
    // An expense carrying a loan_id reduces that loan's balance server-side
    // (transactions/services.py::_apply_loan_payment), so /loans is derived
    // from transactions in exactly the way the wallets are. Without this,
    // recording a repayment left the loan page showing the old balance until
    // its 5-minute staleTime expired — and `refetchOnMount: true` does not
    // help, because it only refetches data already considered stale.
    //
    // The reverse direction was already wired: every loan mutation calls
    // invalidateDashboardData.
    QUERY_KEYS.LOANS,
    QUERY_KEYS.TRANSACTIONS,
  ],

  // Everything else the write invalidates. Marked stale rather than refetched
  // outright — see invalidateDashboardData.
  ledgerDerived: LEDGER_DERIVED,

  // All financial data (invalidate on auth change)
  allFinancialData: [
    QUERY_KEYS.DASHBOARD,
    QUERY_KEYS.OPTIMIZED_DASHBOARD,
    QUERY_KEYS.WALLET_TRENDS,
    QUERY_KEYS.TRANSACTIONS,
    QUERY_KEYS.PORTFOLIO,
    // Unlike GOALS, the loans key carries no user id, and credentials sign-in
    // does not reload the page. Two accounts in one tab would otherwise leave
    // the second looking at the first's balances until a mutation fired.
    QUERY_KEYS.LOANS,
    ...LEDGER_DERIVED,
    ...USER_DATA,
  ],
};

/**
 * The one answer to "does this query show ledger data?", shared by every
 * refresh path. Previously three places each carried their own substring list
 * and they diverged: the Refresh button matched `transactions` (plural), so
 * `transaction-page-stats` and `transaction-categories` never matched it, and
 * it omitted `wallet-trends` entirely — pressing Refresh did not refresh the
 * dashboard's net-worth chart.
 */
const REFRESHABLE = new Set<string>([
  ...QUERY_GROUPS.dashboardRelated,
  ...LEDGER_DERIVED,
  ...USER_DATA,
]);

export function isRefreshableQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey.some((part) => typeof part === 'string' && REFRESHABLE.has(part));
}

/**
 * Utility function to invalidate a group of queries
 * Can be used outside of React components
 */
function invalidateQueryGroup(
  queryClient: QueryClient,
  group: keyof typeof QUERY_GROUPS,
  options?: { refetchType?: 'active' | 'inactive' | 'all' | 'none' }
) {
  const keys = QUERY_GROUPS[group];

  keys.forEach(key => {
    queryClient.invalidateQueries({
      queryKey: [key],
      exact: false,
      refetchType: options?.refetchType ?? 'active',
    });
  });
}

/**
 * Utility function to invalidate dashboard-related queries after data mutations
 * Should be called after creating/updating/deleting transactions or portfolio items
 */
export function invalidateDashboardData(queryClient: QueryClient) {
  invalidateQueryGroup(queryClient, 'dashboardRelated', { refetchType: 'all' });

  // Everything else the ledger feeds. 'active' rather than 'all' on purpose:
  // each of these is marked stale, but only the ones with a mounted observer
  // refetch now. The rest re-fetch on their next mount (refetchOnMount is the
  // default), so a single transaction save does not fire twenty requests for
  // pages the user is not looking at.
  invalidateQueryGroup(queryClient, 'ledgerDerived', { refetchType: 'active' });

  // Dispatch custom event for components listening to data changes
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dashboard-data-updated'));
  }
}

/**
 * Utility function to invalidate all financial data (used on auth changes)
 */
export function invalidateAllFinancialData(queryClient: QueryClient) {
  invalidateQueryGroup(queryClient, 'allFinancialData', { refetchType: 'all' });
}

/**
 * Hook to handle data synchronization when switching between demo and authenticated modes
 * Ensures data is properly refreshed when authentication state changes
 */
export function useDataSynchronization() {
  const { data: session, status } = useSession();
  const { mode, user } = useAppMode();
  const queryClient = useQueryClient();

  // Track initial auth state — skip invalidation on component re-mounts where
  // nothing actually changed. Only fire when auth/mode truly transitions.
  const prevStatusRef = useRef<string>('');

  useEffect(() => {
    if (prevStatusRef.current === '') {
      // First run after mount: record current state, don't invalidate
      prevStatusRef.current = `${status}-${mode}-${user?.id || ''}`;
      return;
    }
    const currentState = `${status}-${mode}-${user?.id || ''}`;
    if (prevStatusRef.current !== currentState) {
      prevStatusRef.current = currentState;
      if (status === 'authenticated' || status === 'unauthenticated') {
        invalidateAllFinancialData(queryClient);
      }
    }
  }, [status, mode, queryClient, user?.id]);

  // Invalidate only when a different user logs in (account switch)
  const prevUserIdRef = useRef<string>('__initial__');

  useEffect(() => {
    const userId = session?.user?.id || '';
    if (prevUserIdRef.current === '__initial__') {
      prevUserIdRef.current = userId;
      return;
    }
    if (userId && prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes('authenticated'),
        refetchType: 'all',
      });
    }
  }, [session?.user?.id, queryClient]);
}

/**
 * Hook to provide dashboard refresh functionality
 */
export function useDashboardRefresh() {
  const queryClient = useQueryClient();

  const refreshDashboard = useCallback(async () => {
    await queryClient.invalidateQueries({
      // One shared predicate — this used to carry its own substring list
      // alongside DataRefreshButton's, and the two had already diverged.
      predicate: (query) => isRefreshableQueryKey(query.queryKey),
      refetchType: 'all'
    });
  }, [queryClient]);

  const refreshAllData = useCallback(async () => {
    // Invalidate all queries
    await queryClient.invalidateQueries({
      refetchType: 'all'
    });
  }, [queryClient]);

  return {
    refreshDashboard,
    refreshAllData,
  };
}