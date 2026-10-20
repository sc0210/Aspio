'use client';

import Link from 'next/link';
import {
  PlusIcon,
  CameraIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ChartBarIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobileTransactions } from '@/components/transactions/MobileTransactions';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_BUTTON, TOP_BAR_PRIMARY } from '@/components/layout/topBarStyles';
import { PageHeader } from '@/components/layout/PageHeader';
import { TransactionStats } from '@/components/transactions/TransactionStats';
import dynamic from 'next/dynamic';

const TransactionList = dynamic(
  () => import('@/components/transactions/TransactionList').then(m => ({ default: m.TransactionList })),
  { ssr: false, loading: () => <div className="animate-pulse space-y-4">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />)}</div> }
);
const ExpenseGroupSummary = dynamic(
  () => import('@/components/transactions/ExpenseGroupSummary').then(m => ({ default: m.ExpenseGroupSummary })),
  { ssr: false }
);

// TransactionImportExportModal is 740 lines and includes heavy CSV / XLSX parsing
// logic — lazy-load it so it only appears in the bundle when the user clicks
// the Export/Import button.
const TransactionImportExportModal = dynamic(
  () => import('@/components/transactions/TransactionImportExportModal').then(
    m => ({ default: m.TransactionImportExportModal })
  ),
  { ssr: false }
);
import { useCallback, useMemo, useState } from 'react';
import { Transaction } from '@/shared/types';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { transactionService } from '@/services/transactionService';
import TransactionsLoading from './loading';
import {
  useTransactionFilters,
  useTransactionData,
  useTransactionImport,
  useTransactionPageStats,
} from '@/hooks/transactions';

/** Remembers the totals' transfer preference across visits. */
const HIDE_TRANSFERS_KEY = 'aspiro-txn-hide-transfers';

/**
 * Prev / next pager for the transaction list. Rendered both above and below
 * the list so the user can switch pages without scrolling. Only the bottom
 * instance is an aria-live region, so a page change is announced once.
 */
function TransactionPager({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
  isFetching,
  announce = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isFetching: boolean;
  announce?: boolean;
}) {
  const { t } = useTranslation(['transactions']);
  return (
    <div className={cn('flex items-center justify-center gap-4 py-2 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40', isFetching && 'opacity-60')}>
      <Button variant="outline" size="sm" onClick={onPrev} disabled={page <= 1}>
        {t('transactions:pagination.previous')}
      </Button>
      <span
        className="text-sm text-gray-600 dark:text-gray-400"
        {...(announce ? { 'aria-live': 'polite' as const } : {})}
      >
        {t('transactions:pagination.pageOf', { page, totalPages })}
        <span className="hidden sm:inline">
          {' · '}
          {t('transactions:pagination.totalCount', { count: total })}
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={onNext} disabled={page >= totalPages}>
        {t('transactions:pagination.next')}
      </Button>
    </div>
  );
}

function DesktopTransactionsPage() {
  const { t } = useTranslation(['common', 'transactions']);
  const { getModeMessage, isDemo } = useModeAwareUI();

  const {
    filters,
    setFilters,
    searchQuery,
    setSearchQuery,
    showFilters,
    setShowFilters,
    dateRange,
    activeFilters,
    removeFilter,
    clearAllFilters,
  } = useTransactionFilters();

  const {
    transactions,
    demoRows,
    dayTotals,
    page,
    setPage,
    pageSize,
    total,
    totalPages,
    isLoading,
    isFetching,
  } = useTransactionData(filters, searchQuery, dateRange, isDemo);

  // Stats, category breakdowns, and top transactions come from aggregate
  // queries (or fixture math in demo mode) — not from fetching every row.
  // Leaving transfers out of the totals is a reading preference, so it survives a
  // reload the way the heatmap's own transfer toggle does. Read in the initializer,
  // not an effect: starting false and correcting afterwards fired the whole
  // five-query aggregate twice on every visit and painted the wrong totals first.
  const [excludeTransfers, setExcludeTransfers] = useState(() => {
    try {
      return localStorage.getItem(HIDE_TRANSFERS_KEY) === 'true';
    } catch {
      return false; // private window or blocked storage: the default stands
    }
  });
  const toggleTransfers = useCallback((next: boolean) => {
    setExcludeTransfers(next);
    try {
      localStorage.setItem(HIDE_TRANSFERS_KEY, String(next));
    } catch {
      /* not worth failing the click over */
    }
  }, []);

  const {
    pageStats,
    error: pageStatsError,
    refetch: refetchPageStats,
  } = useTransactionPageStats(filters, searchQuery, dateRange, excludeTransfers);
  const statsFailed = !!pageStatsError;
  // Wrapped so the click event isn't forwarded into refetch's options argument.
  const retryPageStats = useCallback(() => {
    void refetchPageStats();
  }, [refetchPageStats]);

  const exportFilterOptions = useMemo(
    () => ({
      sortBy: filters.sortBy || 'date',
      sortOrder: (filters.sortOrder || 'desc') as 'asc' | 'desc',
      type: filters.type !== 'all' ? (filters.type as 'income' | 'expense' | 'transfer') : undefined,
      category: filters.category !== 'all' ? filters.category : undefined,
      walletType: filters.walletType !== 'all' ? filters.walletType : undefined,
      dateRange,
      search: searchQuery || undefined,
    }),
    [filters, dateRange, searchQuery],
  );

  // Full filtered row set, fetched only when actually needed (CSV export or
  // replace-mode import). Demo mode already has the whole fixture set locally.
  const getAllFilteredRows = useCallback(async (): Promise<Transaction[]> => {
    if (isDemo) return demoRows;
    return transactionService.getAllTransactions(exportFilterOptions);
  }, [isDemo, demoRows, exportFilterOptions]);

  const [exportRows, setExportRows] = useState<Transaction[] | null>(null);

  // Import runs from the already-open modal, so the row set fetched on open
  // is reused instead of re-fetching the whole table for replace mode.
  const getRowsForImport = useCallback(
    async (): Promise<Transaction[]> => exportRows ?? getAllFilteredRows(),
    [exportRows, getAllFilteredRows],
  );

  const { showImportExport, setShowImportExport, handleBulkImport } =
    useTransactionImport(getRowsForImport);
  const openImportExport = useCallback(() => {
    setShowImportExport(true);
    setExportRows(null);
    getAllFilteredRows()
      .then(setExportRows)
      .catch(() => setExportRows([]));
  }, [getAllFilteredRows, setShowImportExport]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingSpinner size="lg" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout topBarActions={
      <div className="flex items-center gap-2">
        {/* Search + Export/Import — shown on xl+. In the lg–xl band the right
            panel hosts them; below lg they live in the collapsible Filters panel. */}
        <div className="hidden xl:flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('transactions:filters.searchPlaceholder')}
              aria-label={t('transactions:filters.searchPlaceholder')}
              className="w-48 xl:w-64 pl-8 pr-8 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 transition-shadow"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-error-500 dark:hover:text-error-400 transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={openImportExport}
            className={TOP_BAR_BUTTON}
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {t('transactions:importExport.button')}
          </button>
        </div>
        <Link
          href="/transactions/monthly-summary"
          className={TOP_BAR_BUTTON}
        >
          <ChartBarIcon className="w-4 h-4" />
          {t('transactions:monthlySummary')}
        </Link>
        {/* Receipt scan — the page existed with no link to it from anywhere. */}
        <Link
          href="/transactions/scan"
          className={TOP_BAR_BUTTON}
        >
          <CameraIcon className="w-4 h-4" />
          {t('transactions:scan.title')}
        </Link>
        <Link
          href="/transactions/add"
          className={TOP_BAR_PRIMARY}
        >
          <PlusIcon className="w-4 h-4" />
          {t('common:transactions.addTransaction')}
        </Link>
      </div>
    }>
      <div className="space-y-4">
        {/* Header — mobile only */}
        <PageHeader
            title={t('common:transactions.title')}
            subtitle={getModeMessage('transactions')}
            accent="prosperity"
            actions={
                <>
                    <Button size="sm" variant="outline" className="gap-1.5 flex-1 sm:flex-none justify-center" asChild>
                        <Link href="/transactions/monthly-summary">
                            <ChartBarIcon className="w-4 h-4 flex-shrink-0" />
                            <span>{t('transactions:monthlySummaryShort', 'Summary')}</span>
                        </Link>
                    </Button>
                    <Button size="sm" variant="primary" className="gap-1.5 flex-1 sm:flex-none justify-center" asChild>
                        <Link href="/transactions/add">
                            <PlusIcon className="w-4 h-4 flex-shrink-0" />
                            <span>{t('common:transactions.addTransaction')}</span>
                        </Link>
                    </Button>
                </>
            }
        />

        {/* Stats Cards */}
        <div
          key={`stats-${filters.type}-${filters.category}-${filters.dateRange}`}
          className="animate-fade-in"
        >
          <TransactionStats
            stats={pageStats?.stats || {
              totalIncome: 0,
              totalExpenses: 0,
              netIncome: 0,
              transactionCount: 0,
            }}
            error={statsFailed}
            onRetry={retryPageStats}
            excludeTransfers={excludeTransfers}
            onToggleTransfers={toggleTransfers}
          />
        </div>

        {/* Two Column Layout: Left (Content) and Right (Filter Panel) */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Left Column: Transaction List */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            {/* Mobile Filters Toggle (Mobile only) */}
            <div className="lg:hidden flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FunnelIcon className="w-4 h-4" />}
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "flex-1 min-h-[44px] relative",
                  activeFilters.length > 0 ? 'ring-2 ring-primary-200 dark:ring-primary-800' : ''
                )}
                aria-label={activeFilters.length > 0 ? `${activeFilters.length} filters active` : t('transactions:filters.showFilters')}
              >
                <span className="hidden sm:inline">{t('transactions:filters.showFilters')}</span>
                <span className="sm:hidden">Filters</span>
                {activeFilters.length > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-white bg-primary-700 rounded-full shadow-md">
                    {activeFilters.length}
                  </span>
                )}
              </Button>
            </div>

            {/* Mobile Filters Panel */}
            {showFilters && (
              <div className="lg:hidden">
                <ExpenseGroupSummary
                  categoryBreakdown={pageStats?.categoryBreakdown || []}
                  expenseCategoryBreakdown={pageStats?.expenseCategoryBreakdown || []}
                  transactions={[...(pageStats?.topExpenses || []), ...(pageStats?.topIncome || [])]}
                  filters={filters}
                  onFiltersChange={setFilters}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onExport={openImportExport}
                  totalTransactions={total}
                  error={statsFailed}
                  onRetry={retryPageStats}
                />
              </div>
            )}

            {/* Active Filters with enhanced styling */}
            {(activeFilters.length > 0 || searchQuery) && (
              <div className="flex flex-wrap items-center gap-1.5 p-3 bg-blue-50/50 dark:bg-gray-800/50 border-l-4 border-primary-500 animate-slide-up rounded-lg">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  {t('transactions:list.activeFilters')}
                </span>

                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-100 to-cyan-100 dark:from-blue-900/80 dark:to-cyan-900/80 text-blue-800 dark:text-blue-200 rounded-full hover:from-blue-200 hover:to-cyan-200 dark:hover:from-blue-800 dark:hover:to-cyan-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 will-change-transform"
                  >
                    <MagnifyingGlassIcon className="w-3.5 h-3.5" />
                    <span>&quot;{searchQuery}&quot;</span>
                    <XMarkIcon className="w-3.5 h-3.5 ml-0.5 opacity-70 hover:opacity-100" />
                  </button>
                )}

                {activeFilters.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => removeFilter(filter.key)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/80 dark:to-pink-900/80 text-purple-800 dark:text-purple-200 rounded-full hover:from-purple-200 hover:to-pink-200 dark:hover:from-purple-800 dark:hover:to-pink-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 will-change-transform"
                  >
                    <span>{filter.label}</span>
                    <XMarkIcon className="w-3.5 h-3.5 ml-0.5 opacity-70 hover:opacity-100" />
                  </button>
                ))}

                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 underline underline-offset-2 decoration-2 hover:decoration-wavy transition-all duration-200"
                >
                  {t('transactions:list.clearAll')}
                </button>
              </div>
            )}

            {/* Transaction List */}
            {transactions.length === 0 && !isLoading ? (
              <EmptyState
                className="animate-fade-in"
                icon="🔍"
                title={t('common:transactions.noTransactionsFound')}
                description={
                  searchQuery || activeFilters.length > 0
                    ? t('common:transactions.noMatchingTransactions')
                    : t('common:transactions.noTransactionsYet')
                }
                action={
                  <>
                    {(searchQuery || activeFilters.length > 0) && (
                      <Button variant="secondary" onClick={clearAllFilters} type="button">
                        {t('common:transactions.clearAllFilters')}
                      </Button>
                    )}
                    <Link href="/transactions/add">
                      <Button type="button">{t('common:transactions.addTransaction')}</Button>
                    </Link>
                  </>
                }
              />
            ) : (
              <>
                {/* Top pager only on a full page — a short page fits one
                    screen, so the bottom pager alone suffices (avoids two
                    pagers stacked close together). */}
                {totalPages > 1 && transactions.length >= pageSize && (
                  <TransactionPager
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    onPrev={() => setPage(page - 1)}
                    onNext={() => setPage(page + 1)}
                    isFetching={isFetching}
                  />
                )}
                <TransactionList
                  transactions={transactions as Transaction[]}
                  isLoading={isLoading}
                  isFetching={isFetching && !isLoading}
                  isSearching={!!searchQuery || activeFilters.length > 0}
                  searchQuery={searchQuery}
                  // Only when the screen shows each day's own order: a search or
                  // filter hides rows, and another sort column isn't that order.
                  canReorder={!searchQuery && activeFilters.length === 0 && (filters.sortBy || 'date') === 'date'}
                  isDemo={isDemo}
                  dayTotals={dayTotals}
                />
                {totalPages > 1 && (
                  <TransactionPager
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    onPrev={() => setPage(page - 1)}
                    onNext={() => setPage(page + 1)}
                    isFetching={isFetching}
                    announce
                  />
                )}
              </>
            )}
          </div>

          {/* Right Column: Filter & Analysis (Desktop only) - Sticky.
              Search + Export/Import move to the top bar only at xl+; in the
              lg–xl band this panel hosts them (searchExportClassName hides
              them at xl to avoid a duplicate). */}
          <div className="hidden lg:block lg:w-72 xl:w-80 2xl:w-96 flex-shrink-0">
            <div className="sticky top-0 max-h-[calc(100vh-120px)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
              <ExpenseGroupSummary
                categoryBreakdown={pageStats?.categoryBreakdown || []}
                expenseCategoryBreakdown={pageStats?.expenseCategoryBreakdown || []}
                transactions={[...(pageStats?.topExpenses || []), ...(pageStats?.topIncome || [])]}
                filters={filters}
                onFiltersChange={setFilters}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onExport={openImportExport}
                totalTransactions={total}
                searchExportClassName="xl:hidden"
                error={statsFailed}
                onRetry={retryPageStats}
              />
            </div>
          </div>
        </div>

        {/* Import/Export Modal — export rows are fetched lazily on open */}
        {showImportExport && (
          exportRows === null ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <TransactionImportExportModal
              transactions={exportRows}
              onClose={() => setShowImportExport(false)}
              onImport={handleBulkImport}
            />
          )
        )}
      </div>
    </DashboardLayout>
  );
}

/**
 * Breakpoint switch: phones (< md) get the focused MobileTransactions (spent-vs-
 * income hero + a day-grouped list); tablet/desktop get the full page. The switch
 * lives in this thin wrapper so the desktop page's heavy data/filter hooks never
 * run on mobile. `isMobile` is null until resolved; show the route skeleton then,
 * so the page keeps its dimensions instead of blanking for a frame.
 */
export default function TransactionsPage() {
  const isMobile = useIsMobile();
  if (isMobile === null) return <TransactionsLoading />;
  return isMobile ? <MobileTransactions /> : <DesktopTransactionsPage />;
}
