import { useState, useCallback } from 'react';

/**
 * Date range preset types supported by the portfolio view
 */
export type DateRangePreset = 7 | 30 | 90 | 365 | 'ytd' | 'max' | 'custom';

/**
 * Custom date range with start and end dates
 */
export interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

/**
 * Portfolio view state hook
 *
 * Manages all view-related state for the portfolio page including:
 * - View type (list vs allocation)
 * - Chart type (daily, trend, analytics)
 * - Date range selection
 * - Performance view mode
 * - UI expansion states
 *
 * This hook consolidates 7 useState declarations into a single hook,
 * making the portfolio page component much cleaner.
 *
 * @example
 * ```tsx
 * function PortfolioPage() {
 *   const viewState = usePortfolioViewState();
 *
 *   return (
 *     <div>
 *       <ViewToggle
 *         value={viewState.viewType}
 *         onChange={viewState.setViewType}
 *       />
 *       <ChartSelector
 *         value={viewState.chartType}
 *         onChange={viewState.setChartType}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function usePortfolioViewState() {
  // View type: list or allocation view
  const [viewType, setViewType] = useState<'list' | 'allocation'>('list');

  // Chart type: which chart to display (null = hidden by default)
  const [chartType, setChartType] = useState<'daily' | 'trend' | 'analytics' | null>(null);

  // Date range preset selection
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>(30);

  // Custom date range when preset is 'custom'
  const [customDateRange, setCustomDateRange] = useState<DateRange>({
    startDate: null,
    endDate: null
  });

  // Daily performance chart expansion state
  const [isDailyPerformanceExpanded, setIsDailyPerformanceExpanded] = useState(false);

  /**
   * Toggle daily performance chart expansion
   */
  const toggleDailyPerformance = useCallback(() => {
    setIsDailyPerformanceExpanded(prev => !prev);
  }, []);

  return {
    // View type state
    viewType,
    setViewType,

    // Chart type state
    chartType,
    setChartType,

    // Date range state
    dateRangePreset,
    setDateRangePreset,
    customDateRange,
    setCustomDateRange,

    // Daily performance expansion state
    isDailyPerformanceExpanded,
    setIsDailyPerformanceExpanded,
    toggleDailyPerformance,
  };
}

/**
 * Return type of usePortfolioViewState hook
 * Useful for prop typing in child components
 */
export type PortfolioViewState = ReturnType<typeof usePortfolioViewState>;
