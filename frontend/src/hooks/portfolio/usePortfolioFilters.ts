import { useState, useCallback, useMemo, useEffect } from 'react';

/**
 * Portfolio filter options
 */
export interface PortfolioFilters {
  /** Asset type filter (e.g., 'all', 'stock', 'crypto', 'etf') */
  type: string;
  /** Wallet type filter (e.g., 'all', 'portfolio', 'emergency') */
  walletType: string;
  /** Sort field */
  sortBy: 'symbol' | 'name' | 'value' | 'gainLoss' | 'gainLossPercentage';
  /** Sort direction */
  sortOrder: 'asc' | 'desc';
}

/**
 * Default filter values
 */
const DEFAULT_FILTERS: PortfolioFilters = {
  type: 'all',
  walletType: 'all',
  sortBy: 'value',
  sortOrder: 'desc',
};

const SESSION_KEY = 'portfolio-filters';

function readSessionFilters(): Partial<PortfolioFilters> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Portfolio filters hook
 *
 * Manages filtering and sorting state for the portfolio holdings view.
 * Provides memoized filters to prevent unnecessary re-renders and API calls.
 *
 * Features:
 * - Type filtering (stocks, crypto, ETFs, etc.)
 * - Wallet type filtering (portfolio, emergency)
 * - Sorting by various fields
 * - Sort order (ascending/descending)
 * - Memoized filter object for React Query
 *
 * @example
 * ```tsx
 * function PortfolioPage() {
 *   const filters = usePortfolioFilters();
 *
 *   // Use memoized filters in React Query
 *   const { data } = useQuery({
 *     queryKey: ['portfolio', filters.memoizedFilters],
 *     queryFn: () => fetchPortfolio(filters.memoizedFilters),
 *   });
 *
 *   return (
 *     <div>
 *       <select
 *         value={filters.filters.type}
 *         onChange={(e) => filters.updateFilter('type', e.target.value)}
 *       >
 *         <option value="all">All</option>
 *         <option value="stock">Stocks</option>
 *       </select>
 *       <button onClick={filters.resetFilters}>Reset</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function usePortfolioFilters(initialFilters: Partial<PortfolioFilters> = {}) {
  const [filters, setFilters] = useState<PortfolioFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...readSessionFilters(), // restore from previous navigation
    ...initialFilters,      // explicit initial values take highest priority
  }));

  // Persist filter changes to sessionStorage so they survive navigation
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(filters));
    } catch {
      // sessionStorage unavailable (private mode, quota exceeded, etc.)
    }
  }, [filters]);

  /**
   * Update a single filter field
   */
  const updateFilter = useCallback((key: keyof PortfolioFilters, value: PortfolioFilters[keyof PortfolioFilters]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  /**
   * Update multiple filter fields at once
   */
  const updateFilters = useCallback((updates: Partial<PortfolioFilters>) => {
    setFilters(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Reset all filters to default values and clear persisted state
   */
  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, []);

  /**
   * Set filter type
   */
  const setType = useCallback((type: string) => {
    updateFilter('type', type);
  }, [updateFilter]);

  /**
   * Set wallet type filter
   */
  const setWalletType = useCallback((walletType: string) => {
    updateFilter('walletType', walletType);
  }, [updateFilter]);

  /**
   * Set sort field
   */
  const setSortBy = useCallback((sortBy: PortfolioFilters['sortBy']) => {
    updateFilter('sortBy', sortBy);
  }, [updateFilter]);

  /**
   * Set sort order
   */
  const setSortOrder = useCallback((sortOrder: 'asc' | 'desc') => {
    updateFilter('sortOrder', sortOrder);
  }, [updateFilter]);

  /**
   * Toggle sort order between asc and desc
   */
  const toggleSortOrder = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  /**
   * Set sort field and order in one call
   */
  const setSort = useCallback((sortBy: PortfolioFilters['sortBy'], sortOrder: 'asc' | 'desc' = 'desc') => {
    updateFilters({ sortBy, sortOrder });
  }, [updateFilters]);

  /**
   * Memoized filters object
   *
   * ⚡ PERFORMANCE FIX: This prevents infinite refetches in React Query
   * by only creating a new object reference when the actual filter values change
   */
  const memoizedFilters = useMemo(
    () => filters,
    [filters]
  );

  /**
   * Check if any filters are active (not default)
   */
  const hasActiveFilters = useMemo(() => {
    return filters.type !== DEFAULT_FILTERS.type ||
           filters.walletType !== DEFAULT_FILTERS.walletType;
  }, [filters.type, filters.walletType]);

  /**
   * Check if sorting is different from default
   */
  const hasCustomSort = useMemo(() => {
    return filters.sortBy !== DEFAULT_FILTERS.sortBy ||
           filters.sortOrder !== DEFAULT_FILTERS.sortOrder;
  }, [filters.sortBy, filters.sortOrder]);

  return {
    // Current filters
    filters,

    // Memoized filters for React Query
    memoizedFilters,

    // Update methods
    updateFilter,
    updateFilters,
    resetFilters,

    // Convenience setters
    setType,
    setWalletType,
    setSortBy,
    setSortOrder,
    toggleSortOrder,
    setSort,

    // State flags
    hasActiveFilters,
    hasCustomSort,
  };
}

/**
 * Return type of usePortfolioFilters hook
 * Useful for prop typing in child components
 */
export type PortfolioFiltersState = ReturnType<typeof usePortfolioFilters>;
