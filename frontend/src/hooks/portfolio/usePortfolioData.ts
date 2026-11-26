import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useMemo, useCallback } from 'react';
import { portfolioService } from '@/services/portfolioService';
import { log } from '@/utils/logger';
import { aggregateHoldingsBySymbol } from '@/utils/portfolio-aggregation';
import { useRetirementProjection } from '@/hooks/useRetirementProjection';
import type { PortfolioFilters } from './usePortfolioFilters';
import { dailyPerformanceKey, DAILY_PERFORMANCE_DAYS_DEFAULT } from '@/lib/queryKeys';
import { fetchDailyPerformance } from './fetchDailyPerformance';

/**
 * Portfolio data hook
 *
 * Consolidates all data fetching for the portfolio page including:
 * - Portfolio holdings
 * - Analytics data
 * - Daily performance data
 * - Retirement projection
 * - Aggregated holdings
 *
 * This hook replaces 6+ individual useQuery hooks with a single
 * comprehensive data fetching solution.
 *
 * @param filters - Portfolio filters from usePortfolioFilters
 *
 * @example
 * ```tsx
 * function PortfolioPage() {
 *   const filters = usePortfolioFilters();
 *   const {
 *     portfolioData,
 *     analyticsData,
 *     aggregatedHoldings,
 *     isLoading,
 *     refetchAll,
 *   } = usePortfolioData(filters.memoizedFilters);
 *
 *   if (isLoading) return <LoadingSpinner />;
 *
 *   return (
 *     <div>
 *       <PortfolioStats data={portfolioData} />
 *       <HoldingsList holdings={aggregatedHoldings} />
 *     </div>
 *   );
 * }
 * ```
 */
/**
 * The Portfolio page is the Portfolio wallet: what is invested and moves with
 * the market. Emergency-wallet holdings are legacy cash at a fixed price (cash
 * has lived in the Emergency wallet as transactions since #137); they never
 * move, the page's totals already leave them out, and the dashboard counts
 * them under Emergency. Listing them here put a cash row among the funds.
 *
 * Applied through `select`, so the cached response stays whole.
 */
function onlyPortfolioWallet<T extends { holdings?: Array<{ walletType?: string }> } | null | undefined>(data: T): T {
  if (!data?.holdings) return data;
  return { ...data, holdings: data.holdings.filter((h) => (h.walletType ?? 'portfolio') === 'portfolio') };
}

export function usePortfolioData(filters: PortfolioFilters) {
  const { data: session } = useSession();

  // ============================================================
  // 1. Portfolio Holdings
  // ============================================================

  const {
    data: portfolioData,
    isLoading: isLoadingPortfolio,
    refetch: refetchPortfolio,
    error: portfolioError,
    failureCount: portfolioFailureCount,
  } = useQuery({
    queryKey: ['portfolio', filters, session?.user?.email || 'demo'],
    queryFn: async () => {
      log.debug('Fetching portfolio data with filters', filters, 'Portfolio');

      const response = await portfolioService.getPortfolio(filters);

      if (!response.success) {
        throw new Error(response.message || 'Failed to fetch portfolio data');
      }

      log.debug('Portfolio data fetched', {
        holdingsCount: response.data?.holdings?.length,
      }, 'Portfolio');

      return response.data;
    },
    select: onlyPortfolioWallet,
    enabled: true,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: true,  // re-fetch prices when user returns to the tab
    refetchOnMount: true,  // refetch when navigating back so new holdings are visible
    gcTime: 15 * 60 * 1000,
  });

  // ============================================================
  // 3. Analytics Data
  // ============================================================

  const {
    data: analyticsData,
    isLoading: isLoadingAnalytics,
    error: analyticsError,
    refetch: refetchAnalytics,
  } = useQuery({
    // A stable key: a failed refetch keeps the last good allocation. A key that
    // changed with prices or lot count started an empty query, so a failure there
    // showed the error card instead. Trades, edits and refreshes invalidate it.
    queryKey: ['portfolio-analytics', session?.user?.email || 'demo'],
    // Rejects on failure: TanStack then keeps the last good allocation and sets
    // `error`, where resolving to null wiped it and looked like "nothing to show".
    queryFn: async () => (await portfolioService.getPortfolioAnalytics()).data ?? null,
    enabled: !!portfolioData && portfolioData.holdings?.length > 0,
    staleTime: 2 * 60 * 1000,
    retry: false,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  // ============================================================
  // 4. Risk Metrics (CAGR, Max Drawdown, Volatility, Sharpe, HHI)
  // ============================================================

  const {
    data: riskMetrics,
    isLoading: isLoadingRiskMetrics,
    refetch: refetchRiskMetrics,
  } = useQuery({
    queryKey: ['portfolio-risk-metrics', session?.user?.email || 'demo'],
    queryFn: async () => {
      try {
        return await portfolioService.getRiskMetrics();
      } catch {
        return null;
      }
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
    retry: false,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ============================================================
  // 5. Dividend Income (projected annual, yield on cost)
  // ============================================================

  const {
    data: dividendIncome,
    isLoading: isLoadingDividends,
    refetch: refetchDividends,
  } = useQuery({
    queryKey: ['portfolio-dividend-income', session?.user?.email || 'demo'],
    queryFn: async () => {
      try {
        return await portfolioService.getDividendIncome('1y');
      } catch {
        return null;
      }
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
    retry: false,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ============================================================
  // 5b. Realized P&L (from completed sells)
  // ============================================================

  const { data: realizedPnl } = useQuery({
    queryKey: ['portfolio-realized-pnl', session?.user?.email || 'demo'],
    queryFn: async () => {
      try {
        return await portfolioService.getRealizedPnl();
      } catch {
        return null;
      }
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
    retry: false,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ============================================================
  // 6. Daily Performance Data
  // ============================================================

  const {
    data: dailyPerformanceData,
    isLoading: isLoadingDailyPerformance,
    error: dailyPerformanceError,
    refetch: refetchDailyPerformance,
  } = useQuery({
    queryKey: dailyPerformanceKey(session?.user?.email, DAILY_PERFORMANCE_DAYS_DEFAULT),
    // Fetch a year upfront, filter client-side. Shared with the dashboard.
    queryFn: fetchDailyPerformance,
    enabled: !!portfolioData && portfolioData.holdings?.length > 0,
    staleTime: 15 * 60 * 1000, // 15 minutes (historical data)
    retry: false,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  // ============================================================
  // 7. Aggregated Holdings
  // ============================================================

  const aggregatedHoldings = useMemo(
    () => (portfolioData?.holdings ? aggregateHoldingsBySymbol(portfolioData.holdings) : []),
    [portfolioData],
  );

  // ============================================================
  // 8. Retirement Projection (computed)
  // ============================================================

  const retirementProjection = useRetirementProjection(portfolioData || null);

  // ============================================================
  // 9. Computed States
  // ============================================================

  /**
   * Overall loading state - true if any critical data is loading
   */
  const isLoading = isLoadingPortfolio;

  /**
   * True if any data fetch is in progress
   */
  const isFetching = isLoadingPortfolio || isLoadingAnalytics || isLoadingDailyPerformance || isLoadingRiskMetrics || isLoadingDividends;

  /**
   * True if portfolio has no holdings
   */
  const isEmpty = !portfolioData || portfolioData.holdings?.length === 0;

  /**
   * True if portfolio has errors
   */
  const hasError = !!portfolioError;

  /**
   * Combined error message
   */
  const errorMessage = portfolioError
    ? portfolioError.message || 'Failed to load portfolio'
    : null;

  // ============================================================
  // 10. Refetch Methods
  // ============================================================

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchPortfolio(),
      refetchAnalytics(),
      refetchDailyPerformance(),
      refetchRiskMetrics(),
      refetchDividends(),
    ]);
  }, [refetchPortfolio, refetchAnalytics, refetchDailyPerformance, refetchRiskMetrics, refetchDividends]);

  return {
    // Raw data
    portfolioData,
    analyticsData,
    dailyPerformanceData,
    riskMetrics,
    dividendIncome,
    realizedPnl,
    retirementProjection,

    // Computed data
    aggregatedHoldings,

    // Loading states
    isLoading,
    isFetching,
    isLoadingPortfolio,
    isLoadingAnalytics,
    isLoadingDailyPerformance,

    // Error states
    hasError,
    errorMessage,
    portfolioError,
    analyticsError,
    dailyPerformanceError,
    portfolioFailureCount,

    // Utility flags
    isEmpty,

    // Refetch methods
    refetchAll,
    refetchPortfolio,
    refetchAnalytics,
    refetchDailyPerformance,
  };
}
