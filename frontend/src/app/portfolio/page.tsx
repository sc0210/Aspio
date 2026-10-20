'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobilePortfolio } from '@/components/portfolio/MobilePortfolio';
import {
  PlusIcon,
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
  Bars4Icon,
  ChartPieIcon,
  EllipsisVerticalIcon,
  ChartBarIcon,
  ArrowDownTrayIcon,
  ScaleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_BUTTON, TOP_BAR_PRIMARY, TOP_BAR_SEGMENTED, topBarSegment } from '@/components/layout/topBarStyles';
import { PortfolioPageSkeleton } from '@/components/portfolio/PortfolioSkeleton';
import { RetirementProgressTracker } from '@/components/portfolio/RetirementProgressTracker';
import { ConfirmDeleteDialog } from '@/components/portfolio/ConfirmDeleteDialog';
import {
  PortfolioHeader,
  PortfolioStatsSection,
  PortfolioChartsSection,
  PortfolioHoldingsSection,
  PortfolioModalsContainer,
} from '@/components/portfolio/sections';
import {
  usePortfolioViewState,
  usePortfolioFilters,
  usePortfolioModals,
  usePortfolioEdit,
  usePortfolioData,
  usePortfolioPriceOperations,
  usePortfolioActions,
  usePortfolioHoldingOperations,
} from '@/hooks/portfolio';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { usePrivacy } from '@/contexts/PrivacyContext';
import PortfolioLoading from './loading';

/**
 * Portfolio Page
 *
 * Main portfolio management page for tracking and managing investment holdings.
 *
 * This page has been refactored from 3,175 lines into a clean, modular structure:
 * - 8 custom hooks manage all state (Phase 1 + Phase 4)
 *   - usePortfolioViewState: View type, chart type, date ranges
 *   - usePortfolioFilters: Filtering and sorting
 *   - usePortfolioModals: Modal state management
 *   - usePortfolioEdit: Single and bulk editing
 *   - usePortfolioData: Data fetching with React Query
 *   - usePortfolioPriceOperations: Price updates and refresh (NEW)
 *   - usePortfolioActions: User action handlers (NEW)
 *   - useModeAwareUI: Demo mode awareness
 * - 5 section components organize the UI (Phase 2)
 * - This page orchestrates everything together (Phase 3)
 *
 * Features:
 * - View holdings in list or allocation view
 * - Filter and sort holdings
 * - Display performance charts (daily, trend, analytics)
 * - Portfolio statistics and metrics
 * - Retirement progress tracking
 * - Buy/sell holdings
 * - Import/export portfolio data
 * - Wallet management
 * - Price updates and historical data sync
 *
 * @refactored April 4, 2026 (Phase 4: Additional hook extraction)
 * @see docs/PORTFOLIO_PAGE_REFACTORING.md
 */
function DesktopPortfolioPage() {
  const router = useRouter();

  // ============================================================
  // Mode awareness and Privacy
  // ============================================================
  const { getModeIndicator, getModeMessage, isDemo } = useModeAwareUI();
  const { isValueVisible, toggleValueVisibility } = usePrivacy();
  const { t } = useTranslation(['portfolio']);

  // ============================================================
  // State Management (Phase 1: Custom Hooks)
  // ============================================================

  // View state (view type, chart type, date ranges)
  const viewState = usePortfolioViewState();

  // Filters and sorting
  const filters = usePortfolioFilters();

  // Modal management
  const modals = usePortfolioModals();

  // Edit state (single and bulk editing)
  const editState = usePortfolioEdit();

  // Data fetching (portfolio, analytics, daily performance, exchange rates)
  const dataState = usePortfolioData(filters.memoizedFilters);

  // ============================================================
  // Extract data from dataState
  // ============================================================

  const {
    portfolioData,
    analyticsData,
    riskMetrics,
    dividendIncome,
    realizedPnl,
    dailyPerformanceData,
    aggregatedHoldings,
    allAggregatedHoldings,
    retirementProjection,
    isLoading,
    hasError,
    errorMessage,
    refetchAll,
  } = dataState;

  // ============================================================
  // Price Operations (refresh, update prices, sync historical)
  // ============================================================
  const priceOps = usePortfolioPriceOperations(refetchAll);

  // ============================================================
  // Holding CRUD Operations (delete, update lot, update symbol)
  // ============================================================
  const holdingOps = usePortfolioHoldingOperations(
    filters.memoizedFilters,
    modals,
    allAggregatedHoldings,
  );

  // ============================================================
  // User Actions (holding clicks, goal actions, chart interactions)
  // ============================================================
  const actions = usePortfolioActions(modals, viewState);

  // ============================================================
  // Loading State
  // ============================================================

  if (isLoading) {
    return (
      <DashboardLayout>
        <PortfolioPageSkeleton />
      </DashboardLayout>
    );
  }

  // ============================================================
  // Error State
  // ============================================================

  if (hasError) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="mb-4 text-6xl" role="img" aria-label="Error">⚠️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
              Failed to Load Portfolio
            </h2>
            <p className="mb-4 text-gray-600 dark:text-gray-400">
              {errorMessage || 'An unexpected error occurred'}
            </p>
            <button
              type="button"
              onClick={priceOps.handleRefresh}
              disabled={priceOps.isRefreshing}
              aria-disabled={priceOps.isRefreshing}
              aria-label={priceOps.isRefreshing ? 'Retrying...' : 'Try again'}
              className="px-4 py-2.5 min-h-[44px] text-white bg-primary-700 rounded-lg hover:bg-primary-800 disabled:opacity-50 touch-manipulation"
            >
              {priceOps.isRefreshing ? 'Retrying...' : 'Try Again'}
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ============================================================
  // Main Render (Phase 2: Section Components)
  // ============================================================

  return (
    <DashboardLayout topBarActions={
      <div className="flex items-center gap-2">
        {/* Privacy toggle */}
        <button
          type="button"
          onClick={toggleValueVisibility}
          aria-label={isValueVisible ? t('portfolio:hideValues') : t('portfolio:showValues')}
          className={TOP_BAR_BUTTON}
        >
          {isValueVisible ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
          <span className="hidden lg:inline">{isValueVisible ? t('portfolio:header.hide') : t('portfolio:header.show')}</span>
        </button>

        {/* View type toggle */}
        <div className={TOP_BAR_SEGMENTED}>
          <button
            onClick={() => viewState.setViewType('list')}
            aria-label={t('portfolio:header.listView')}
            aria-pressed={viewState.viewType === 'list'}
            className={topBarSegment(viewState.viewType === 'list')}
          >
            <Bars4Icon className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => viewState.setViewType('allocation')}
            aria-label={t('portfolio:header.allocationView')}
            aria-pressed={viewState.viewType === 'allocation'}
            className={topBarSegment(viewState.viewType === 'allocation')}
          >
            <ChartPieIcon className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Refresh */}
        <button
          type="button"
          onClick={priceOps.handleRefresh}
          disabled={priceOps.isBusy}
          aria-label={t('portfolio:header.refreshTitle')}
          className={TOP_BAR_BUTTON}
        >
          <ArrowPathIcon className={cn('w-4 h-4', priceOps.isRefreshing && 'animate-spin')} />
          <span className="hidden lg:inline">{priceOps.isRefreshing ? t('portfolio:header.refreshing') : t('portfolio:refresh')}</span>
        </button>

        {/* Overflow menu — Sync Charts + Import/Export (Headless UI: aria + Escape + focus) */}
        <Menu as="div" className="relative">
          <MenuButton
            aria-label={t('portfolio:header.moreActions')}
            className={TOP_BAR_BUTTON}
          >
            <EllipsisVerticalIcon className="w-4 h-4" />
          </MenuButton>
          <MenuItems className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1 focus:outline-none">
            <MenuItem>
              {/* /rebalancing's entry point, desktop only: the phone view
                  (MobilePortfolio) sends rebalancing to tablet/desktop by design. */}
              <Link
                href="/rebalancing"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 data-[focus]:bg-gray-50 dark:data-[focus]:bg-gray-700 transition-colors"
              >
                <ScaleIcon className="w-4 h-4 flex-shrink-0" />
                {t('portfolio:header.rebalancing')}
              </Link>
            </MenuItem>
            <MenuItem>
              <button
                onClick={() => priceOps.handleSyncHistorical()}
                disabled={priceOps.isBusy}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 data-[focus]:bg-gray-50 dark:data-[focus]:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                <ChartBarIcon className={cn('w-4 h-4 flex-shrink-0', priceOps.isSyncingHistorical && 'animate-spin')} />
                {priceOps.isSyncingHistorical ? t('portfolio:header.syncingCharts') : t('portfolio:header.syncCharts')}
              </button>
            </MenuItem>
            <MenuItem>
              <button
                onClick={() => modals.openImportExportModal()}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 data-[focus]:bg-gray-50 dark:data-[focus]:bg-gray-700 transition-colors"
              >
                <ArrowDownTrayIcon className="w-4 h-4 flex-shrink-0" />
                {t('portfolio:header.importExport')}
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>

        {/* Add Holding */}
        <Link
          href="/portfolio/add"
          className={TOP_BAR_PRIMARY}
        >
          <PlusIcon className="w-4 h-4" />
          <span className="hidden lg:inline">{t('portfolio:header.addHolding')}</span>
        </Link>
      </div>
    }>
      {/* Demo Mode Indicator */}
      {isDemo && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-900/20 dark:border-amber-800">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {getModeIndicator().text} {getModeMessage('general')}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Header Section — mobile only */}
        <PortfolioHeader
          viewState={viewState}
          modals={modals}
          onRefresh={priceOps.handleRefresh}
          isRefreshing={priceOps.isRefreshing}
          onSyncHistorical={priceOps.handleSyncHistorical}
          isSyncingHistorical={priceOps.isSyncingHistorical}
          lastPriceUpdate={portfolioData?.lastPriceUpdateAt}
          className="md:hidden"
        />

        {/* Portfolio Stats Section - Moved to top */}
        <PortfolioStatsSection
          portfolioData={portfolioData}
          analyticsData={analyticsData}
          riskMetrics={riskMetrics}
          dividendIncome={dividendIncome}
          realizedPnl={realizedPnl}
          viewState={viewState}
          onTodayChangeClick={actions.handleTodayChangeClick}
          onViewTrendClick={actions.handleViewTrendClick}
        />

        {/* Retirement Progress Tracker - Always visible; shows "Set Goal" prompt when no goal exists */}
        {retirementProjection && (
          <RetirementProgressTracker
            projection={retirementProjection}
            isValueVisible={isValueVisible}
            currency={portfolioData?.currency || 'TWD'}
            onSetGoal={() => {
              if (retirementProjection.retirementGoal) {
                actions.handleEditGoal(retirementProjection.retirementGoal as never);
              } else {
                // No goal yet — navigate to the goals page to create one
                router.push('/goals');
              }
            }}
          />
        )}

        {/* Charts Section - Only show when a chart type is selected */}
        {viewState.chartType && (
          <PortfolioChartsSection
            chartType={viewState.chartType}
            onChartTypeChange={viewState.setChartType}
            portfolioData={portfolioData}
            dateRangePreset={viewState.dateRangePreset}
            customDateRange={viewState.customDateRange}
            onDateRangeChange={viewState.setDateRangePreset}
            onCustomDateRangeChange={viewState.setCustomDateRange}
            isDailyPerformanceExpanded={viewState.isDailyPerformanceExpanded}
            onToggleDailyPerformance={viewState.toggleDailyPerformance}
            dailyPerformanceData={dailyPerformanceData}
          />
        )}

        {/* Holdings Section */}
        <PortfolioHoldingsSection
          viewType={viewState.viewType}
          holdings={aggregatedHoldings}
          allHoldings={allAggregatedHoldings}
          rawHoldings={portfolioData?.holdings || []}
          analyticsData={analyticsData}
          filters={filters}
          editState={editState}
          modals={modals}
          onHoldingClick={actions.handleHoldingClick as never}
          onDeleteHolding={holdingOps.handleDeleteHolding}
          onUpdateLot={holdingOps.handleUpdateLot}
          onUpdateSymbol={holdingOps.handleUpdateSymbol}
          onAddInvestment={holdingOps.handleAddInvestment}
          onSellFromWallet={holdingOps.handleSellFromWallet}
        />

        {/* Modals Container */}
        <PortfolioModalsContainer
          modals={modals}
          onRefreshPortfolio={refetchAll}
          rawHoldings={portfolioData?.holdings || []}
          sellableHoldings={aggregatedHoldings}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDeleteDialog
          isOpen={!!holdingOps.pendingDeleteId}
          onConfirm={holdingOps.handleConfirmDelete}
          onCancel={holdingOps.handleCancelDelete}
        />
      </div>
    </DashboardLayout>
  );
}

/**
 * Breakpoint switch: on phones (< md) render the focused MobilePortfolio (hero
 * value + allocation donut + top holdings); tablet/desktop get the full
 * DesktopPortfolioPage. Switching at this wrapper means the heavy portfolio data
 * hooks in DesktopPortfolioPage never run on mobile. `isMobile` is null until the
 * breakpoint resolves; show the route skeleton then, so the page keeps its
 * dimensions instead of blanking for a frame.
 */
export default function PortfolioPage() {
  const isMobile = useIsMobile();
  if (isMobile === null) return <PortfolioLoading />;
  return isMobile ? <MobilePortfolio /> : <DesktopPortfolioPage />;
}
