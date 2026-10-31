'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import {
  FunnelIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { formatTWD, formatDate } from '@/utils/formatters';
import type { Transaction } from '@/shared/types';
import type { TransactionFilters } from '@/hooks/transactions/useTransactionFilters';
import { topTransactionsByAmount } from './transactionRanking';
import { PRIORITY_CATEGORIES } from '@/utils/expenseGroups';
import { categoryColorGroups, getCategoryColorGroup } from './categoryColorGroups';
import { Card } from '@/components/ui/Card';
import { chartTooltipStyle } from '@/lib/charts/tooltipStyle';
import { useIsDark } from '@/contexts/ThemeContext';

interface CategoryBreakdownItem {
  category: string;
  amount: number;
  type: string;
  color: string;
}

interface ExpenseGroupSummaryProps {
  categoryBreakdown: CategoryBreakdownItem[];
  expenseCategoryBreakdown?: CategoryBreakdownItem[];
  /** Filtered transactions (respect period + category) — used for the top-expenses ranking. */
  transactions?: Transaction[];
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onExport: () => void;
  totalTransactions: number;
  /** Show the search box + Export/Import button. False on desktop, where the
   *  page's top bar hosts them instead (avoids a duplicate search box). */
  showSearchExport?: boolean;
  /** Extra classes on the search/export block — e.g. "xl:hidden" so the lg–xl
   *  panel hosts them but they yield to the top bar at xl+. */
  searchExportClassName?: string;
  /** The page-stats request failed, so every breakdown below arrived empty.
   *  Without this the panels would read "no expenses in range" — which blames
   *  the filter for what is actually a failed request. */
  error?: boolean;
  onRetry?: () => void;
}

// Filter options. Each holds the i18n key for its label — the option `value`
// is what the filter runs on, and must not move with the display language.
const typeOptions = [
  { value: 'all', labelKey: 'transactions:filters.type.all' },
  { value: 'income', labelKey: 'transactions:filters.type.income' },
  { value: 'expense', labelKey: 'transactions:filters.type.expense' },
  { value: 'transfer', labelKey: 'transactions:filters.type.transfer' },
];

const walletTypeOptions = [
  { value: 'all', icon: '', labelKey: 'transactions:filters.wallet.all' },
  { value: 'life', icon: '🏠', labelKey: 'transactions:filters.wallet.life' },
  { value: 'emergency', icon: '🚨', labelKey: 'transactions:filters.wallet.emergency' },
];

const dateRangeOptions = [
  { value: 'all', labelKey: 'transactions:filters.range.all' },
  { value: '7d', labelKey: 'transactions:filters.range.last7d' },
  { value: 'month', labelKey: 'transactions:filters.range.thisMonth' },
  { value: '30d', labelKey: 'transactions:filters.range.last30d' },
  { value: '90d', labelKey: 'transactions:filters.range.last90d' },
  { value: '1y', labelKey: 'transactions:filters.range.lastYear' },
  { value: 'custom', labelKey: 'transactions:filters.range.custom' },
];

const sortOptions = [
  { value: 'date', labelKey: 'transactions:fields.date' },
  { value: 'amount', labelKey: 'transactions:fields.amount' },
  { value: 'category', labelKey: 'transactions:fields.category' },
  { value: 'description', labelKey: 'transactions:fields.description' },
];

const sortOrderOptions = [
  { value: 'desc', labelKey: 'transactions:filters.order.desc' },
  { value: 'asc', labelKey: 'transactions:filters.order.asc' },
];


/**
 * The message a breakdown panel shows when it has nothing to draw. A failed
 * request and an empty result set look identical from the data alone, so the
 * panel must be told which one it is — otherwise a 500 reads as "no expenses".
 */
function PanelPlaceholder({
  error,
  emptyMessage,
  onRetry,
}: {
  error: boolean;
  emptyMessage: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation(['common', 'transactions']);

  if (!error) {
    return (
      <div className="text-center py-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col items-center gap-1.5 py-3">
      <p className="flex items-center gap-1.5 text-sm text-warning-700 dark:text-warning-300">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
        {t('transactions:filters.loadFailed')}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-primary-700 dark:text-primary-400 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          {t('common:errorState.tryAgain')}
        </button>
      )}
    </div>
  );
}

export function ExpenseGroupSummary({
  categoryBreakdown,
  expenseCategoryBreakdown,
  transactions = [],
  filters,
  onFiltersChange,
  searchQuery,
  onSearchChange,
  onExport,
  totalTransactions,
  showSearchExport = true,
  searchExportClassName,
  error = false,
  onRetry,
}: ExpenseGroupSummaryProps) {
  // This component is mounted twice on /transactions (a desktop copy and a
  // mobile one), so fixed ids would collide and each label would bind to
  // whichever copy comes first in the document.
  const uid = useId();
  const [showCustomDate, setShowCustomDate] = useState(filters.dateRange === 'custom');
  const { isValueVisible } = usePrivacy();
  const isDark = useIsDark();

  // Top 5 biggest items within the current view, ranked by TWD amount. `transactions`
  // is already filtered by the selected period + category, so these track both.
  const topExpenses = useMemo(() => topTransactionsByAmount(transactions, 'expense'), [transactions]);
  const topIncome = useMemo(() => topTransactionsByAmount(transactions, 'income'), [transactions]);

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'dateRange' && value === 'custom') {
      setShowCustomDate(true);
    } else if (key === 'dateRange') {
      setShowCustomDate(false);
    }

    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  // Handle multi-category toggle
  const toggleCategory = (category: string) => {
    const currentCategory = filters.category;

    if (category === 'all') {
      handleFilterChange('category', 'all');
      return;
    }

    if (currentCategory === 'all') {
      handleFilterChange('category', category);
      return;
    }

    const currentCategories = Array.isArray(currentCategory)
      ? currentCategory
      : currentCategory.split(',').filter(Boolean);

    let newCategories: string[];
    if (currentCategories.includes(category)) {
      newCategories = currentCategories.filter(c => c !== category);
      if (newCategories.length === 0) {
        handleFilterChange('category', 'all');
        return;
      }
    } else {
      newCategories = [...currentCategories, category];
    }

    handleFilterChange('category', newCategories.join(','));
  };

  // Check if a category is currently selected
  const isCategorySelected = (category: string): boolean => {
    if (category === 'all') {
      return filters.category === 'all';
    }

    const currentCategory = filters.category;
    if (currentCategory === 'all') return false;

    const currentCategories = Array.isArray(currentCategory)
      ? currentCategory
      : currentCategory.split(',').filter(Boolean);

    return currentCategories.includes(category);
  };

  // Get unique categories from breakdown
  const dataCategories = Array.from(
    new Set(categoryBreakdown.map(item => item.category))
  );

  // Merge priority categories with data categories
  const categories = [
    ...PRIORITY_CATEGORIES.filter(cat => dataCategories.includes(cat)),
    ...dataCategories.filter(cat => !PRIORITY_CATEGORIES.includes(cat))
  ];
  // Calculate group totals (only for expenses)
  // Use expenseCategoryBreakdown (from filtered transactions) when provided,
  // only fall back to categoryBreakdown when expenseCategoryBreakdown is undefined (not passed)
  const expenseBreakdown = expenseCategoryBreakdown !== undefined
    ? expenseCategoryBreakdown
    : categoryBreakdown.filter(item => item.type === 'expense');
  const totalExpenses = expenseBreakdown.reduce((sum, item) => sum + item.amount, 0);

  const groupTotals = {
    food: { total: 0, percentage: 0, ...categoryColorGroups.food },
    transportation: { total: 0, percentage: 0, ...categoryColorGroups.transportation },
    housing: { total: 0, percentage: 0, ...categoryColorGroups.housing },
    investment: { total: 0, percentage: 0, ...categoryColorGroups.investment },
    transfer: { total: 0, percentage: 0, ...categoryColorGroups.transfer },
    others: { total: 0, percentage: 0, ...categoryColorGroups.others },
  };

  // Calculate totals for each group
  expenseBreakdown.forEach(item => {
    const colorGroup = getCategoryColorGroup(item.category);
    const key = Object.keys(categoryColorGroups).find(
      k => categoryColorGroups[k as keyof typeof categoryColorGroups] === colorGroup
    ) as keyof typeof groupTotals;
    if (key) groupTotals[key].total += item.amount;
  });

  // Calculate percentages
  if (totalExpenses > 0) {
    (Object.keys(groupTotals) as Array<keyof typeof groupTotals>).forEach(key => {
      groupTotals[key].percentage = (groupTotals[key].total / totalExpenses) * 100;
    });
  }

  const { t } = useTranslation(['transactions']);

  return (
    <Card padding="none" radius="xl" shadow="lg" clip className="h-full">
      {/* Header - Simplified */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-500 dark:from-primary-700 dark:to-primary-600 px-4 py-3.5 border-b border-primary-700 dark:border-primary-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-4 h-4 text-white" />
            <h2 className="text-sm font-bold text-white">
              {t('transactions:filters.filterAndAnalysis')}
            </h2>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full">
            <span className="text-xs font-bold text-white">{totalTransactions}</span>
            <span className="text-xs font-medium text-white/90">{t('transactions:filters.countUnit')}</span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Search Bar and Export Button - Enhanced.
            Hidden on desktop (showSearchExport=false) where the page top bar
            hosts these controls instead. */}
        {showSearchExport && (
          <div className={cn("flex gap-2", searchExportClassName)}>
            <div className="relative group flex-1">
              <Input
                type="text"
                placeholder={t('transactions:filters.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                leftIcon={<MagnifyingGlassIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 group-focus-within:text-primary-500 transition-colors" />}
                rightIcon={
                  searchQuery && (
                    <button
                      onClick={() => onSearchChange('')}
                      className="text-gray-500 dark:text-gray-400 hover:text-error-500 dark:hover:text-error-400 transition-colors transform hover:scale-110"
                      aria-label="Clear search"
                      type="button"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  )
                }
                className="h-10 text-sm shadow-sm hover:shadow-md focus-within:shadow-lg transition-all duration-200"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowDownTrayIcon className="w-4 h-4" />}
              onClick={onExport}
              className="h-10 font-semibold shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 flex-shrink-0"
            >
              {t('transactions:importExport.button')}
            </Button>
          </div>
        )}

        {/* Divider - Enhanced (only when the search/export block above shows) */}
        {showSearchExport && (
          <div className={cn("relative", searchExportClassName)}>
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-2 bg-white dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">●</span>
            </div>
          </div>
        )}

        {/* Quick Category Filters - Enhanced */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-5 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full shadow-sm"></span>
            {t('transactions:filters.quickFilter')}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleCategory('all')}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-full transition-all duration-200 transform hover:scale-105 active:scale-95',
                isCategorySelected('all')
                  ? 'bg-gradient-to-r from-primary-100 to-primary-50 dark:from-primary-900/40 dark:to-primary-800/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-400 dark:ring-primary-600 shadow-lg'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 shadow-sm hover:shadow-md'
              )}
              aria-label={t('transactions:filters.selectAllCategories')}
              aria-pressed={isCategorySelected('all')}
            >
              {t('common:common.all')}
            </button>
            {categories.map((category) => {
              const isSelected = isCategorySelected(category);
              const colorGroup = getCategoryColorGroup(category);

              return (
                <button
                  key={category}
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-full transition-all duration-200 flex items-center gap-1.5 transform hover:scale-105 active:scale-95',
                    isSelected
                      ? `${colorGroup.lightBg} ${colorGroup.lightText} ring-2 ${colorGroup.lightRing} shadow-lg`
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 shadow-sm hover:shadow-md'
                  )}
                  aria-label={`Filter by ${category} category`}
                  aria-pressed={isSelected}
                >
                  <div
                    className="w-2 h-2 rounded-full shadow-sm"
                    style={{ backgroundColor: colorGroup.color }}
                  />
                  <span>{category}</span>
                </button>
              );
            })}
          </div>
          {/* Only "All" renders when the breakdown is empty. Say why, so a failed
              request doesn't look like an account with no categories. */}
          {error && categories.length === 0 && (
            <PanelPlaceholder
              error
              emptyMessage={t('transactions:filters.loadFailed')}
              onRetry={onRetry}
            />
          )}
        </div>

        {/* Divider - Enhanced */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="px-2 bg-white dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">●</span>
          </div>
        </div>

        {/* Expense Breakdown Section - Always visible so filters update it */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-5 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full shadow-sm"></span>
            {t('transactions:filters.expenseAnalysis')}
          </h3>

          {totalExpenses > 0 ? (() => {
            const pieData = (Object.keys(groupTotals) as Array<keyof typeof groupTotals>)
              .map(key => ({ key, ...groupTotals[key] }))
              .filter(g => g.total > 0)
              .sort((a, b) => b.total - a.total);

            return (
              <>
                {/* Donut pie chart */}
                <div
                  role="img"
                  aria-label={`${t('transactions:filters.expenseAnalysis')}: ${pieData.map(g => `${t(g.labelKey)} ${g.percentage.toFixed(0)}%`).join(', ')}`}
                  className="relative"
                >
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={84}
                        paddingAngle={2}
                        dataKey="total"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {pieData.map(entry => (
                          <Cell key={entry.key} fill={entry.color} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string | number, props: { payload?: { labelKey?: string } }) => [
                          isValueVisible ? formatTWD(value) : '•••••',
                          props.payload?.labelKey ? t(props.payload.labelKey) : '',
                        ]}
                        {...chartTooltipStyle(isDark)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('transactions:stats.totalExpenses')}</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums mt-0.5">
                      {isValueVisible ? formatTWD(totalExpenses) : '•••••'}
                    </span>
                  </div>
                </div>

                {/* Legend rows */}
                <div className="space-y-1.5">
                  {pieData.map(g => (
                    <div key={g.key} className="flex items-center gap-2 px-1">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                      <span className="text-xs text-gray-600 dark:text-gray-400 flex-1 truncate">
                        {g.icon} {t(g.labelKey)}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-gray-700 dark:[color:var(--legend)]" style={{ '--legend': g.color } as CSSProperties}>
                        {g.percentage.toFixed(1)}%
                      </span>
                      <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums w-20 2xl:w-24 text-right">
                        {isValueVisible ? formatTWD(g.total) : '•••••'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })() : (
            <PanelPlaceholder
              error={error}
              emptyMessage={t('transactions:filters.noExpensesInRange')}
              onRetry={onRetry}
            />
          )}
        </div>

        {/* Divider - Enhanced */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="px-2 bg-white dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">●</span>
          </div>
        </div>

        {/* Filter Controls Section - Enhanced */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-5 bg-gradient-to-b from-indigo-500 to-blue-500 rounded-full shadow-sm"></span>
            {t('transactions:filters.advancedFilters')}
          </h3>

          {/* Transaction Type + Wallet Type — side by side at lg */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-type`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('transactions:filters.transactionType')}
              </label>
              <select
                id={`${uid}-type`}
                value={filters.type}
                onChange={(e) => handleFilterChange('type', e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
              >
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${uid}-wallet`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('transactions:filters.walletType')}
              </label>
              <select
                id={`${uid}-wallet`}
                value={filters.walletType}
                onChange={(e) => handleFilterChange('walletType', e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
              >
                {walletTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.icon ? `${option.icon} ` : ''}{t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Range */}
          <div>
            <label htmlFor={`${uid}-daterange`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('transactions:filters.dateRange')}
            </label>
            <select
              id={`${uid}-daterange`}
              value={filters.dateRange}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
            >
              {dateRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Date Range */}
          {showCustomDate && (
            <div className="space-y-1.5 animate-fade-in">
              <div>
                <label htmlFor={`${uid}-start-date`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('transactions:filters.startDate')}
                </label>
                <input
                  id={`${uid}-start-date`}
                  type="date"
                  className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
                  value={filters.startDate || ''}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-end-date`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('transactions:filters.endDate')}
                </label>
                <input
                  id={`${uid}-end-date`}
                  type="date"
                  className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
                  value={filters.endDate || ''}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Sort Options */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label htmlFor={`${uid}-member`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('transactions:filters.sortBy')}
              </label>
              <select
                id={`${uid}-member`}
                value={filters.sortBy}
                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-sort`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('transactions:filters.sortOrder')}
              </label>
              <select
                id={`${uid}-sort`}
                value={filters.sortOrder}
                onChange={(e) => handleFilterChange('sortOrder', e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent transition-all"
              >
                {sortOrderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Divider - Enhanced */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="px-2 bg-white dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">●</span>
          </div>
        </div>

        {/* Top Expenses Ranking — biggest single expenses in the selected period + category */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-5 bg-gradient-to-b from-rose-500 to-red-500 rounded-full shadow-sm"></span>
            {t('transactions:filters.topExpenses')}
          </h3>

          {topExpenses.length > 0 ? (
            <ol className="space-y-1.5">
              {topExpenses.map(({ tx, twd }, index) => (
                <li key={tx.id} className="flex items-center gap-2.5 px-1">
                  <span
                    className={cn(
                      'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold tabular-nums',
                      index === 0
                        ? 'bg-rose-700 dark:bg-rose-500 text-white shadow-sm'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                      {tx.description || tx.category}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {tx.category} · {formatDate(tx.date, 'MM/dd')}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-xs font-bold text-gray-900 dark:text-white tabular-nums">
                    {isValueVisible ? formatTWD(twd) : '•••••'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <PanelPlaceholder
              error={error}
              emptyMessage={t('transactions:filters.noExpensesInRange')}
              onRetry={onRetry}
            />
          )}
        </div>

        {/* Divider - Enhanced */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="px-2 bg-white dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">●</span>
          </div>
        </div>

        {/* Top Income Ranking — biggest single income items in the selected period + category */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-5 bg-gradient-to-b from-prosperity-500 to-emerald-500 rounded-full shadow-sm"></span>
            {t('transactions:filters.topIncome')}
          </h3>

          {topIncome.length > 0 ? (
            <ol className="space-y-1.5">
              {topIncome.map(({ tx, twd }, index) => (
                <li key={tx.id} className="flex items-center gap-2.5 px-1">
                  <span
                    className={cn(
                      'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold tabular-nums',
                      index === 0
                        ? 'bg-prosperity-700 dark:bg-prosperity-500 text-white shadow-sm'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                      {tx.description || tx.category}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {tx.category} · {formatDate(tx.date, 'MM/dd')}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-xs font-bold text-prosperity-700 dark:text-prosperity-400 tabular-nums">
                    {isValueVisible ? formatTWD(twd) : '•••••'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <PanelPlaceholder
              error={error}
              emptyMessage={t('transactions:filters.noIncomeInRange')}
              onRetry={onRetry}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

