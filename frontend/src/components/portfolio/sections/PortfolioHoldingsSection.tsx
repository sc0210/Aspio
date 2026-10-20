'use client';

import { lazy, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HoldingsList } from '@/components/portfolio/HoldingsList';
import { usePrivacy } from '@/contexts/PrivacyContext';

// Lazy-load the allocation chart (pulls in recharts ~386KB) only when needed
const PortfolioAllocation = lazy(() =>
  import('@/components/portfolio/PortfolioAllocation').then(m => ({ default: m.PortfolioAllocation }))
);

const AllocationSkeleton = () => (
  <div className="h-96 w-full flex items-center justify-center">
    <div className="animate-pulse flex flex-col items-center gap-4">
      <div className="w-48 h-48 bg-gray-200 dark:bg-gray-700 rounded-full" />
      <div className="w-24 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  </div>
);
import type { Holding } from '@/components/portfolio/HoldingsList';
import type { PortfolioFiltersState } from '@/hooks/portfolio/usePortfolioFilters';
import type { PortfolioEditState } from '@/hooks/portfolio/usePortfolioEdit';
import type { PortfolioModalsState } from '@/hooks/portfolio/usePortfolioModals';

interface AnalyticsData {
  allocation: {
    byType: Array<{ type: string; value: number; percentage: number; color: string }>;
    bySector: Array<{ sector: string; value: number; percentage: number; color: string }>;
    byRegion: Array<{ region: string; value: number; percentage: number; color: string }>;
    baseCurrency?: string;
    exchangeRate?: number;
  };
  performance: {
    oneDay: number; oneWeek: number; oneMonth: number;
    threeMonths: number; sixMonths: number; oneYear: number;
  };
  diversificationScore: number;
  riskScore: number;
  sharpeRatio?: number | null;
  beta?: number | null;
}

interface PortfolioHoldingsSectionProps {
  /** Current view type */
  viewType: 'list' | 'allocation';
  /** Holdings data */
  holdings: Holding[];
  /** All aggregated holdings (before wallet filter) */
  allHoldings: Holding[];
  /** Raw non-aggregated holdings for per-lot detail view inside HoldingsList */
  rawHoldings?: Holding[];
  /** Analytics data for allocation view */
  analyticsData?: AnalyticsData | null;
  /** Filters state from usePortfolioFilters */
  filters: PortfolioFiltersState;
  /** Edit state from usePortfolioEdit */
  editState: PortfolioEditState;
  /** Modals state from usePortfolioModals */
  modals: PortfolioModalsState;
  /** Callback when a holding is clicked for detail view */
  onHoldingClick?: (holding: Holding) => void;
  /** Callback when update prices button is clicked */
  onUpdatePrices?: () => void;
  /** Whether prices are currently updating */
  isUpdatingPrices?: boolean;
  /** Callback when sync historical data button is clicked */
  onSyncHistorical?: () => void;
  /** Whether historical data is syncing */
  isSyncingHistorical?: boolean;
  /** Callback to delete a holding */
  onDeleteHolding?: (holdingId: string) => void;
  /** Callback to update an individual lot's date/quantity/cost */
  onUpdateLot?: (lotId: string, updates: { purchaseDate?: string; quantity?: number; averageCost?: number }) => Promise<void>;
  /** Callback to update symbol-level metadata across all lots */
  onUpdateSymbol?: (symbol: string, updates: { name?: string; sector?: string }) => Promise<void>;
  /** Callback to open buy modal from holdings list */
  onAddInvestment?: () => void;
  /** Callback to open sell modal from wallet quick-action */
  onSellFromWallet?: () => void;
}

/**
 * Portfolio holdings section component
 *
 * Displays holdings in either list view or allocation (pie chart) view.
 * This component manages the holdings display area with filters and actions.
 *
 * Features:
 * - Holdings list view with filtering and sorting
 * - Allocation pie chart view
 * - Bulk selection mode
 * - Quick actions (edit, sell, view details)
 * - Wallet type filtering
 *
 * @example
 * ```tsx
 * <PortfolioHoldingsSection
 *   viewType={viewState.viewType}
 *   holdings={aggregatedHoldings}
 *   filters={filters}
 *   editState={editState}
 *   modals={modals}
 *   onHoldingClick={handleHoldingClick}
 * />
 * ```
 */
const WALLET_TYPE_OPTIONS = [
  { value: 'all',       label: 'All Wallets', description: 'Show all wallets',  icon: '💼' },
  { value: 'life',      label: 'Life',        description: 'Daily spending',    icon: '💳' },
  { value: 'portfolio', label: 'Portfolio',   description: 'Invested assets',   icon: '📈' },
  { value: 'emergency', label: 'Emergency',   description: 'Emergency fund',    icon: '🚨' },
];

export function PortfolioHoldingsSection({
  viewType,
  holdings,
  allHoldings,
  rawHoldings,
  analyticsData,
  filters,
  editState,
  modals,
  onHoldingClick: _onHoldingClick,
  onUpdatePrices: _onUpdatePrices,
  isUpdatingPrices: _isUpdatingPrices = false,
  onSyncHistorical: _onSyncHistorical,
  isSyncingHistorical: _isSyncingHistorical = false,
  onDeleteHolding,
  onUpdateLot,
  onUpdateSymbol,
  onAddInvestment,
  onSellFromWallet,
}: PortfolioHoldingsSectionProps) {
  const { t } = useTranslation(['portfolio']);
  const { isValueVisible } = usePrivacy();

  // These reach every memoised HoldingRow, so their identity has to survive a
  // re-render of this section. As inline arrows they did not: ticking one
  // checkbox re-renders here, rebuilds both arrows, and every row sees new
  // props — which silently undid the memo on the exact interaction it was
  // added for. Both `selectAll` and `openSellModal` are already useCallback'd
  // in their own hooks; only these adapters were unstable.
  const { selectAll } = editState;
  const { openSellModal } = modals;
  const handleSelectionChange = useCallback(
    (selected: string[]) => selectAll(selected),
    [selectAll],
  );
  // `as never` bridges the two Holding shapes, exactly as the inline arrow did;
  // this change is about the callback's identity, not its body.
  const handleSellHolding = useCallback(
    (holding: Holding) => openSellModal(holding as never),
    [openSellModal],
  );

  // Don't render wallet filter or empty state if no holdings at all
  const hasAnyHoldings = allHoldings && allHoldings.length > 0;

  if (!hasAnyHoldings) {
    return (
      <div className="p-12 text-center bg-white rounded-xl shadow-sm dark:bg-gray-800">
        <div className="mx-auto w-24 h-24 mb-4 text-gray-300 dark:text-gray-600">
          <svg
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            className="w-full h-full"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          {t('portfolio:noHoldingsYet')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          {t('portfolio:emptyHoldingsHint')}
        </p>
        <a
          href="/portfolio/add"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-700 rounded-lg hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          {t('portfolio:addFirstHolding')}
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm dark:bg-gray-800">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('portfolio:holdingsHeading')}
          </h2>
          <span className="px-2.5 py-0.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-full dark:text-gray-300 dark:bg-gray-700">
            {t('portfolio:holdingsUnit', { count: holdings.length })}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bulk Edit Toggle (List view only) */}
          {viewType === 'list' && (
            <button
              onClick={editState.toggleBulkEdit}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${editState.bulkEditMode
                  ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }
              `}
            >
              {editState.bulkEditMode ? (
                <>{t('portfolio:exitBulkEdit')} {editState.hasSelection && `(${editState.selectedCount})`}</>
              ) : (
                t('portfolio:bulkEdit')
              )}
            </button>
          )}
        </div>
      </div>

      {/* Wallet Filter Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-smooth px-4 pt-4 pb-0 pr-4">
          {WALLET_TYPE_OPTIONS.map((option) => {
            const isActive = filters.filters.walletType === option.value;
            const count = option.value === 'all'
              ? allHoldings.length
              : allHoldings.filter(h => {
                  const holdingWalletType = h.walletType || 'portfolio';
                  return holdingWalletType === option.value;
                }).length;

            return (
              <button
                key={option.value}
                onClick={() => filters.updateFilter('walletType', option.value)}
                className={`
                  flex-shrink-0 px-4 py-3 mb-2 mr-2 rounded-xl border transition-all snap-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                  ${isActive
                    ? 'bg-primary-50 border-primary-500 dark:bg-primary-900/20 dark:border-primary-400'
                    : 'bg-gray-50 border-gray-200 hover:border-gray-300 dark:bg-gray-800/50 dark:border-gray-700 dark:hover:border-gray-600'
                  }
                `}
              >
                <div className="flex items-center gap-2 min-w-[140px]">
                  <span className="text-2xl" aria-hidden="true">{option.icon}</span>
                  <div className="text-left">
                    <div className={`text-sm font-semibold ${isActive ? 'text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-gray-100'}`}>
                      {t(`portfolio:wallets.${option.value}`, option.label)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('portfolio:holdingsUnit', { count })}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Holdings Content */}
      <div className="p-4">
        {/* List View */}
        {viewType === 'list' && (
          <HoldingsList
            holdings={holdings}
            allHoldings={rawHoldings}
            isValueVisible={isValueVisible}
            filters={filters.filters as never}
            onFiltersChange={(newFilters) => {
              filters.updateFilters(newFilters as Partial<typeof filters.filters>);
            }}
            bulkEditMode={editState.bulkEditMode}
            selectedHoldings={editState.selectedHoldings}
            onSelectionChange={handleSelectionChange}
            onEditHolding={editState.startEdit as never}
            onSellHolding={handleSellHolding}
            onDeleteHolding={onDeleteHolding}
            onUpdateLot={onUpdateLot}
            onUpdateSymbol={onUpdateSymbol}
            onAddInvestment={onAddInvestment}
            onSellFromWallet={onSellFromWallet}
          />
        )}

        {/* Allocation View */}
        {viewType === 'allocation' && analyticsData?.allocation && (
          <Suspense fallback={<AllocationSkeleton />}>
            <PortfolioAllocation
              allocation={analyticsData.allocation}
              isValueVisible={isValueVisible}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
