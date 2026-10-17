import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { portfolioService } from '@/services/portfolioService';
import { useAppMode } from '@/hooks/useAppMode';
import toast from 'react-hot-toast';

/**
 * Price update operations hook
 *
 * Manages portfolio price updates and historical data synchronization.
 * Provides loading states and error handling for price-related operations.
 *
 * Features:
 * - Manual price refresh with cache bypass
 * - Historical data synchronization
 * - Portfolio data refresh
 * - Loading state management
 * - Toast notifications
 *
 * @example
 * ```tsx
 * function PortfolioPage() {
 *   const priceOps = usePortfolioPriceOperations(refetchAll);
 *
 *   return (
 *     <button
 *       onClick={priceOps.handleUpdatePrices}
 *       disabled={priceOps.isUpdatingPrices}
 *     >
 *       {priceOps.isUpdatingPrices ? 'Updating...' : 'Update Prices'}
 *     </button>
 *   );
 * }
 * ```
 */
export function usePortfolioPriceOperations(refetchAll: () => Promise<void>) {
  const { t } = useTranslation(['portfolio']);
  const { isDemo } = useAppMode();
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [isSyncingHistorical, setIsSyncingHistorical] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * Handle manual price update
   *
   * Fetches latest prices from market data sources and updates the portfolio.
   * Shows success/failure toast notifications with update statistics.
   */
  const handleUpdatePrices = async () => {
    // Demo mode has no backend session — the price endpoint 401s. Re-read the
    // local fixtures instead so the UI still reflects any in-session changes.
    if (isDemo) {
      setIsUpdatingPrices(true);
      try {
        await refetchAll();
        toast.success(t('portfolio:toast.demoRefreshed', 'Demo data refreshed'));
      } finally {
        setIsUpdatingPrices(false);
      }
      return;
    }
    try {
      setIsUpdatingPrices(true);
      const result = await portfolioService.refreshPortfolioPrices(true);

      if (result.success && result.data) {
        await refetchAll();
        toast.success(t('portfolio:toast.pricesUpdatedDetail', { updated: result.data.updated, cached: result.data.cached }));
      } else {
        toast.error(t('portfolio:toast.priceUpdateFailed'));
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('portfolio:toast.priceUpdateFailed'));
      console.error('Update prices error:', error);
    } finally {
      setIsUpdatingPrices(false);
    }
  };

  /**
   * Handle sync historical data
   *
   * Synchronizes historical price data for chart rendering.
   * Default lookback period is 90 days.
   */
  const handleSyncHistorical = async () => {
    if (isDemo) {
      setIsSyncingHistorical(true);
      try {
        await refetchAll();
        toast.success(t('portfolio:toast.demoRefreshed', 'Demo data refreshed'));
      } finally {
        setIsSyncingHistorical(false);
      }
      return;
    }
    try {
      setIsSyncingHistorical(true);
      const result = await portfolioService.syncHistoricalPrices(90);

      if (result.success && result.data) {
        await refetchAll();
        toast.success(t('portfolio:toast.historicalSynced', { successful: result.data.successful, totalRecords: result.data.totalRecords }));
      } else {
        toast.error(result.message || t('portfolio:toast.historicalSyncFailed'));
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('portfolio:toast.historicalSyncFailed'));
      console.error('Sync historical error:', error);
    } finally {
      setIsSyncingHistorical(false);
    }
  };

  /**
   * Handle portfolio refresh
   *
   * The primary refresh action: fresh quotes, then the historical series behind
   * every chart on the page, then a reload.
   *
   * Historical used to be a separate item in the overflow menu, which meant the
   * obvious button left the charts stale — a current price beside a sparkline
   * that stopped days ago, with nothing saying so. The menu item stays for
   * syncing charts on its own.
   *
   * The two halves are reported separately on purpose. Historical walks every
   * held symbol against the providers, so it is both the slow half and the half
   * that partially fails; letting it throw would lose a price refresh that had
   * already succeeded.
   */
  const handleRefresh = async () => {
    if (isDemo) {
      setIsRefreshing(true);
      try {
        await refetchAll();
        toast.success(t('portfolio:toast.demoRefreshed', 'Demo data refreshed'));
      } finally {
        setIsRefreshing(false);
      }
      return;
    }
    try {
      // Both flags span the WHOLE call. Raising the historical one only around
      // its own await left a window — the length of a full price refresh — in
      // which "Sync Charts" was still enabled and would start a second,
      // independent sync of every held symbol.
      setIsRefreshing(true);
      setIsSyncingHistorical(true);

      const result = await portfolioService.refreshPortfolioPrices(true);

      let historicalOk = true;
      try {
        const historical = await portfolioService.syncHistoricalPrices(90);
        historicalOk = Boolean(historical.success);
      } catch (historicalError) {
        historicalOk = false;
        console.error('Refresh: historical sync failed', historicalError);
      }

      await refetchAll();

      if (result.success && result.data) {
        toast.success(t('portfolio:toast.refreshSuccess', { updated: result.data.updated, cached: result.data.cached }));
      } else {
        toast.success(t('portfolio:toast.portfolioRefreshed'));
      }
      if (!historicalOk) {
        // Not an error toast: the prices the user asked for are current. Only
        // the chart history is not, and saying so beats a stale sparkline that
        // looks authoritative.
        toast(t('portfolio:toast.refreshedPricesOnly', 'Prices updated, but chart history could not be refreshed.'));
      }
    } catch (error) {
      // Even if price update fails, still refetch to get latest cached data
      try { await refetchAll(); } catch {}
      toast.error(t('portfolio:toast.priceUpdateFailedCached'));
      console.error('Refresh error:', error);
    } finally {
      setIsRefreshing(false);
      setIsSyncingHistorical(false);
    }
  };

  return {
    // State
    isUpdatingPrices,
    isSyncingHistorical,
    isRefreshing,
    /**
     * Either price path is in flight.
     *
     * Refresh and "Sync Charts" overlap — refresh does the historical sync too —
     * so every control that starts either must block on both. Derived once here
     * rather than re-spelled at each call site, because there are three and they
     * only stayed correct by hand.
     */
    isBusy: isRefreshing || isSyncingHistorical,

    // Actions
    handleUpdatePrices,
    handleSyncHistorical,
    handleRefresh,
  };
}
