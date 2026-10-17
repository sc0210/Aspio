'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isRefreshableQueryKey } from '@/hooks/useDataSynchronization';
import { useAppMode } from '@/hooks/useAppMode';
import toast from 'react-hot-toast';
import { TOP_BAR_BUTTON } from '@/components/layout/topBarStyles';
import { cn } from '@/utils/cn';

interface DataRefreshButtonProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function DataRefreshButton({ 
  className = '', 
  size = 'md',
  showLabel = true 
}: DataRefreshButtonProps) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAppMode();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);

    try {
      // Refresh by INVALIDATING, never by removing. `removeQueries` deletes the
      // cache entry outright, and a query that is no longer in the cache cannot
      // be invalidated — so the old code removed precisely the queries it meant
      // to refresh and then asked the cache to refetch the ones it had just
      // deleted. Mounted components kept rendering their last data forever:
      // the portfolio mini-calendar never re-fired /portfolio/daily-performance,
      // while widgets the predicate did NOT match (wallet-trends,
      // income/spending-by-category) survived in cache and did refresh — which
      // is why only half the dashboard appeared to update.
      //
      // refetchType 'active' (not 'all') keeps the original intent: only
      // queries with a mounted observer refetch, so cached queries belonging to
      // other pages (reports/comprehensive) are not re-fired into 500s.
      await queryClient.invalidateQueries({
        // One registry-derived predicate, shared with useDashboardRefresh and
        // the invalidation groups. The hand-written substring list this
        // replaces matched 'transactions' (plural), so 'transaction-stats',
        // 'transaction-page-stats' and 'transaction-categories' never matched
        // it, and it named no key containing 'wallet-trends' — so pressing
        // Refresh left the dashboard's net-worth chart, the transactions
        // summary tiles and the cash-flow insight card untouched.
        predicate: isAuthenticated
          ? (query) => isRefreshableQueryKey(query.queryKey)
          // Demo mode has no server to go back to; refresh everything mounted.
          : () => true,
        refetchType: 'active',
      });

      // Demo fixtures are deterministic — re-running queries produces identical
      // data, so without explicit feedback the button looks broken. Tell the user.
      if (!isAuthenticated) {
        toast.success('Demo data reloaded (sample data does not change)');
      }

      // Keep loading state for visual feedback
      setTimeout(() => setIsRefreshing(false), 800);

    } catch {
      setIsRefreshing(false);
    }
  };

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      // It only ever sits in the dashboard's top bar, so it wears that bar's
      // button rather than a style of its own.
      className={cn(TOP_BAR_BUTTON, className)}
      title={isAuthenticated ? 'Refresh dashboard data' : 'Refresh demo data'}
    >
      <svg
        className={`${sizeClasses[size]} ${isRefreshing ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      
      {showLabel && (
        <span>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </span>
      )}
    </button>
  );
}