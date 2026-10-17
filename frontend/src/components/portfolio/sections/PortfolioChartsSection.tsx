'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { DateRangePreset, DateRange } from '@/hooks/portfolio/usePortfolioViewState';
import type { Portfolio } from '@/shared/types';

// Chart skeleton shared by all three lazy chart wrappers below
const ChartSkeleton = ({ height = 400 }: { height?: number }) => (
  <div
    className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center"
    style={{ height }}
    role="status"
    aria-label="Loading chart"
  >
    <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15l4-4 4 4 4-8 4 4" />
    </svg>
  </div>
);

// Lazy-loaded chart components — Recharts (~386 KB) is deferred until the user
// actually opens the charts section, keeping the portfolio page initial bundle slim.
const DailyPerformanceChart = dynamic(
  () => import('@/components/portfolio/DailyPerformanceChart').then(m => ({ default: m.DailyPerformanceChart })),
  { loading: () => <ChartSkeleton height={400} />, ssr: false }
);

const AssetTrendChart = dynamic(
  () => import('@/components/portfolio/AssetTrendChart').then(m => ({ default: m.AssetTrendChart })),
  { loading: () => <ChartSkeleton height={520} />, ssr: false }
);

const PortfolioChart = dynamic(
  () => import('@/components/portfolio/PortfolioChart').then(m => ({ default: m.PortfolioChart })),
  { loading: () => <ChartSkeleton height={400} />, ssr: false }
);

interface PortfolioChartsSectionProps {
  /** Current chart type */
  chartType: 'daily' | 'trend' | 'analytics';
  /** Callback when chart type changes (null closes the section) */
  onChartTypeChange: (type: 'daily' | 'trend' | 'analytics' | null) => void;
  /** Portfolio data */
  portfolioData: Portfolio | null | undefined;
  /** Date range preset */
  dateRangePreset: DateRangePreset;
  /** Custom date range */
  customDateRange: DateRange;
  /** Callback when date range preset changes */
  onDateRangeChange: (preset: DateRangePreset) => void;
  /** Callback when custom date range changes */
  onCustomDateRangeChange: (range: DateRange) => void;
  /** Whether daily performance chart is expanded */
  isDailyPerformanceExpanded: boolean;
  /** Callback to toggle daily performance expansion */
  onToggleDailyPerformance: () => void;
  /** Daily performance data */
  dailyPerformanceData?: Array<{ date: string; value: number; change: number; changePercent: number }>;
}

/**
 * Portfolio charts section component
 *
 * Displays various portfolio performance charts based on selected chart type.
 * This component consolidates all chart-related UI into a single section.
 *
 * Features:
 * - Chart type selector (Daily, Trend, Analytics)
 * - Daily performance chart with expansion toggle
 * - Asset trend chart with date range controls
 * - Portfolio analytics chart
 *
 * @example
 * ```tsx
 * <PortfolioChartsSection
 *   chartType={viewState.chartType}
 *   onChartTypeChange={viewState.setChartType}
 *   portfolioData={portfolioData}
 *   dateRangePreset={viewState.dateRangePreset}
 *   customDateRange={viewState.customDateRange}
 *   onDateRangeChange={viewState.setDateRangePreset}
 *   onCustomDateRangeChange={viewState.setCustomDateRange}
 *   isDailyPerformanceExpanded={viewState.isDailyPerformanceExpanded}
 *   onToggleDailyPerformance={viewState.toggleDailyPerformance}
 *   dailyPerformanceData={dailyPerformanceData}
 * />
 * ```
 */
export function PortfolioChartsSection({
  chartType,
  onChartTypeChange,
  portfolioData,
  dateRangePreset,
  customDateRange,
  onDateRangeChange,
  onCustomDateRangeChange: _onCustomDateRangeChange,
  isDailyPerformanceExpanded: _isDailyPerformanceExpanded,
  onToggleDailyPerformance: _onToggleDailyPerformance,
  dailyPerformanceData,
}: PortfolioChartsSectionProps) {
  const { t } = useTranslation(['portfolio']);
  const { isValueVisible } = usePrivacy();

  // Filter data based on date range
  const filteredData = useMemo(() => {
    if (!dailyPerformanceData || dailyPerformanceData.length === 0) return [];

    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    switch (dateRangePreset) {
      case 7:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 30:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 90:
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 365:
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'ytd':
        startDate = new Date(now.getFullYear(), 0, 1); // January 1st of current year
        break;
      case 'max':
        return dailyPerformanceData; // Return all data
      case 'custom':
        if (customDateRange.startDate) {
          startDate = customDateRange.startDate;
          if (customDateRange.endDate) {
            endDate = customDateRange.endDate;
          }
        } else {
          return dailyPerformanceData;
        }
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to 30 days
    }

    return dailyPerformanceData.filter(item => {
      // Append time to force local-time parsing; bare "YYYY-MM-DD" parses as UTC midnight
      const itemDate = new Date(item.date.includes('T') ? item.date : item.date + 'T00:00:00');
      return itemDate >= startDate && itemDate <= endDate;
    });
  }, [dailyPerformanceData, dateRangePreset, customDateRange]);

  // Don't render if no portfolio data
  if (!portfolioData) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm dark:bg-gray-800">
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('portfolio:performanceCharts')}
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          {/* Chart Type Selector */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg dark:bg-gray-700">
            <button
              onClick={() => onChartTypeChange('daily')}
              aria-pressed={chartType === 'daily'}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${chartType === 'daily'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              {t('portfolio:charts.daily')}
            </button>
            <button
              onClick={() => onChartTypeChange('trend')}
              aria-pressed={chartType === 'trend'}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${chartType === 'trend'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              {t('portfolio:charts.trend')}
            </button>
            <button
              onClick={() => onChartTypeChange('analytics')}
              aria-pressed={chartType === 'analytics'}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${chartType === 'analytics'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              {t('portfolio:charts.analytics')}
            </button>
          </div>

          {/* Date Range Selector — hidden for analytics tab (uses its own timeframe control) */}
          {chartType !== 'analytics' && <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg dark:bg-gray-700">
            <button
              onClick={() => onDateRangeChange(7)}
              aria-pressed={dateRangePreset === 7}
              className={`
                px-2 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${dateRangePreset === 7
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              7D
            </button>
            <button
              onClick={() => onDateRangeChange(30)}
              aria-pressed={dateRangePreset === 30}
              className={`
                px-2 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${dateRangePreset === 30
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              30D
            </button>
            <button
              onClick={() => onDateRangeChange(90)}
              aria-pressed={dateRangePreset === 90}
              className={`
                px-2 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${dateRangePreset === 90
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              90D
            </button>
            <button
              onClick={() => onDateRangeChange(365)}
              aria-pressed={dateRangePreset === 365}
              className={`
                px-2 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${dateRangePreset === 365
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              1Y
            </button>
            <button
              onClick={() => onDateRangeChange('ytd')}
              aria-pressed={dateRangePreset === 'ytd'}
              className={`
                px-2 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${dateRangePreset === 'ytd'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              YTD
            </button>
            <button
              onClick={() => onDateRangeChange('max')}
              aria-pressed={dateRangePreset === 'max'}
              className={`
                px-2 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
                ${dateRangePreset === 'max'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              MAX
            </button>
          </div>}

          {/* Full Page link — visible only on Trend tab */}
          {chartType === 'trend' && (
            <Link
              href="/portfolio/trend"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700/50 hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:shadow-sm flex-shrink-0"
              title={t('portfolio:charts.openFullTrend')}
            >
              <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
              {t('portfolio:charts.fullPage')}
            </Link>
          )}

          {/* Close chart section */}
          <button
            onClick={() => onChartTypeChange(null)}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={t('portfolio:charts.closeChart')}
            aria-label={t('portfolio:charts.closeChart')}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart Content */}
      <div className="p-4">
        {/* Daily Performance Chart */}
        {chartType === 'daily' && (
          <div className="h-[300px] sm:h-[400px] w-full">
            <DailyPerformanceChart
              data={filteredData}
              currency={portfolioData?.currency || 'TWD'}
              isValueVisible={isValueVisible}
              viewMode="percentage"
            />
          </div>
        )}

        {/* Asset Trend Chart */}
        {chartType === 'trend' && (
          <div className="h-[460px] sm:h-[520px] w-full flex flex-col">
            <AssetTrendChart
              data={filteredData}
              currency={portfolioData?.currency || 'TWD'}
              isValueVisible={isValueVisible}
              className="flex-1 min-h-0"
            />
          </div>
        )}

        {/* Portfolio Analytics Chart */}
        {chartType === 'analytics' && (
          <div className="h-[300px] sm:h-[400px] w-full">
            <PortfolioChart
              holdings={portfolioData?.holdings || []}
              baseCurrency={portfolioData?.currency || 'TWD'}
              externalTimeframe={
                dateRangePreset === 7 ? '7D' :
                dateRangePreset === 30 ? '30D' :
                dateRangePreset === 90 ? '90D' :
                dateRangePreset === 365 ? '1Y' :
                dateRangePreset === 'ytd' ? 'YTD' :
                dateRangePreset === 'max' ? 'MAX' : '30D'
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
