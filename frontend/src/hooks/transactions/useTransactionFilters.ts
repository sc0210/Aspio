'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useDebounce } from '@/hooks/useDebounce';

export interface TransactionFilters {
  type: string;
  category: string;
  walletType: string;
  dateRange: string;
  sortBy: string;
  sortOrder: string;
  startDate: string;
  endDate: string;
}

interface ActiveFilter {
  key: string;
  label: string;
  value: string;
}

const DEFAULT_FILTERS: TransactionFilters = {
  type: 'all',
  category: 'all',
  walletType: 'all',
  dateRange: 'month',
  sortBy: 'date',
  sortOrder: 'desc',
  startDate: '',
  endDate: '',
};

/**
 * The filters live in the URL.
 *
 * They used to be plain component state, so editing a transaction — a separate page —
 * unmounted the list and reset every filter to its default: you would narrow to one
 * category, correct a row, and come back to an unfiltered list. In the URL they
 * survive that round trip, a refresh and the back button, and a filtered view can be
 * linked to or bookmarked. Nothing is hidden: what the list is showing is written in
 * the address bar rather than kept in storage to surprise you weeks later.
 *
 * Short parameter names, because this ends up in front of the user.
 */
const PARAM: Record<keyof TransactionFilters, string> = {
  type: 'type',
  category: 'category',
  walletType: 'wallet',
  dateRange: 'range',
  sortBy: 'sort',
  sortOrder: 'order',
  startDate: 'from',
  endDate: 'to',
};

const SEARCH_PARAM = 'q';

/**
 * Values that may appear in the URL, where anyone can type anything.
 *
 * An unrecognised value falls back to the default rather than being passed to the API:
 * `?type=banana` would otherwise reach the backend and come back as a confusingly
 * empty list. `category` is free text (a comma-separated list of names) and
 * `from`/`to` are validated by shape, so neither is enumerated here.
 */
const ALLOWED: Partial<Record<keyof TransactionFilters, readonly string[]>> = {
  type: ['all', 'income', 'expense', 'transfer'],
  walletType: ['all', 'life', 'emergency'],
  dateRange: ['all', '7d', 'month', '30d', '90d', '1y', 'custom'],
  sortBy: ['date', 'amount', 'category', 'description'],
  sortOrder: ['asc', 'desc'],
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function readFilter(
  params: URLSearchParams,
  key: keyof TransactionFilters,
): string {
  const raw = params.get(PARAM[key]);
  if (raw === null || raw === '') return DEFAULT_FILTERS[key];

  const allowed = ALLOWED[key];
  if (allowed) return allowed.includes(raw) ? raw : DEFAULT_FILTERS[key];

  if (key === 'startDate' || key === 'endDate') {
    return ISO_DAY.test(raw) ? raw : DEFAULT_FILTERS[key];
  }

  return raw;
}

function filtersFromParams(params: URLSearchParams): TransactionFilters {
  return {
    type: readFilter(params, 'type'),
    category: readFilter(params, 'category'),
    walletType: readFilter(params, 'walletType'),
    dateRange: readFilter(params, 'dateRange'),
    sortBy: readFilter(params, 'sortBy'),
    sortOrder: readFilter(params, 'sortOrder'),
    startDate: readFilter(params, 'startDate'),
    endDate: readFilter(params, 'endDate'),
  };
}

/**
 * Manages all transaction filter state, derived date range, active filter
 * display list, and filter reset handlers.
 */
export function useTransactionFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read once, on mount. The URL is where this state is kept, but it is not re-read on
  // every render: filter changes use `replace`, so there are no intermediate history
  // entries to come back to, and re-deriving would make the search box lag a keystroke
  // behind the navigation that carries it.
  const [filters, setFilters] = useState<TransactionFilters>(() =>
    filtersFromParams(new URLSearchParams(searchParams.toString())),
  );
  const [searchQuery, setSearchQuery] = useState(
    () => searchParams.get(SEARCH_PARAM) ?? '',
  );
  // Stays shut even when the URL arrives filtered. Tempting to open it so a shared
  // link shows why the list is narrow, but every return from an edit now carries
  // filters, so the panel would spring open on each round trip. The active-filter
  // chips above the list already say what is applied.
  const [showFilters, setShowFilters] = useState(false);

  // The search box writes a character at a time; the URL only needs the result. The
  // same 500ms the query itself is debounced by, so the address bar and the rows it
  // describes settle together.
  const debouncedSearch = useDebounce(searchQuery, 500);

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());

    (Object.keys(PARAM) as Array<keyof TransactionFilters>).forEach((key) => {
      const value = filters[key];
      // Defaults are left out: an untouched list keeps a bare /transactions URL.
      if (value === DEFAULT_FILTERS[key] || value === '') next.delete(PARAM[key]);
      else next.set(PARAM[key], value);
    });

    if (debouncedSearch) next.set(SEARCH_PARAM, debouncedSearch);
    else next.delete(SEARCH_PARAM);

    const query = next.toString();
    if (query === searchParams.toString()) return; // nothing moved

    // replace, not push: narrowing a filter is not a place to come back to with the
    // back button, and pushing would bury the page the user arrived from under one
    // entry per adjustment. scroll: false keeps the list where they were reading.
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [filters, debouncedSearch, pathname, router, searchParams]);

  // ⚡ PERFORMANCE FIX: Memoize date range to prevent new Date objects on every render
  const dateRange = useMemo(() => {
    if (!filters.dateRange || filters.dateRange === 'all') return undefined; // 'all' means no date filtering

    const now = new Date();
    const start = new Date();

    // Handle custom date range
    if (filters.dateRange === 'custom') {
      if (filters.startDate && filters.endDate) {
        return {
          start: new Date(filters.startDate + 'T00:00:00'),
          end: new Date(filters.endDate + 'T23:59:59'),
        };
      }
      // If custom selected but dates not set, return undefined
      return undefined;
    }

    // Handle preset date ranges
    switch (filters.dateRange) {
      case '7d':
        start.setDate(now.getDate() - 7);
        break;
      case 'month': {
        // Start from first day of current month (local time)
        // Use local date to avoid timezone conversion issues
        const year = now.getFullYear();
        const month = now.getMonth();
        start.setFullYear(year, month, 1);
        start.setHours(0, 0, 0, 0);
        start.setMilliseconds(0);
        break;
      }
      case '30d':
        start.setDate(now.getDate() - 30);
        break;
      case '90d':
        start.setDate(now.getDate() - 90);
        break;
      case '1y':
        start.setFullYear(now.getFullYear() - 1);
        break;
      default:
        start.setDate(now.getDate() - 30);
    }

    return { start, end: now };
  }, [filters.dateRange, filters.startDate, filters.endDate]);

  // Get active filter count and labels
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const activeFilterList: ActiveFilter[] = [];

    if (filters.type !== 'all') {
      const typeLabels: Record<string, string> = {
        income: '💰 Income',
        expense: '💸 Expense',
        transfer: '🔄 Transfer',
      };
      activeFilterList.push({
        key: 'type',
        label: typeLabels[filters.type] || filters.type,
        value: filters.type,
      });
    }

    if (filters.category !== 'all') {
      const categories = filters.category.split(',').filter(Boolean);
      const MAX_SHOWN = 2;
      const shown = categories.slice(0, MAX_SHOWN).join(', ');
      const overflow = categories.length > MAX_SHOWN ? ` +${categories.length - MAX_SHOWN}` : '';
      activeFilterList.push({
        key: 'category',
        label: `🏷️ ${shown}${overflow}`,
        value: filters.category,
      });
    }

    // Only show dateRange as active filter if it's not the default 'month'
    if (filters.dateRange && filters.dateRange !== 'month') {
      const dateLabels: Record<string, string> = {
        '7d': '📅 Last 7 days',
        '30d': '📅 Last 30 days',
        '90d': '📅 Last 90 days',
        '1y': '📅 Last year',
      };

      let dateLabel = dateLabels[filters.dateRange];
      if (filters.dateRange === 'custom' && filters.startDate && filters.endDate) {
        dateLabel = `📅 ${filters.startDate} to ${filters.endDate}`;
      } else if (filters.dateRange === 'custom') {
        dateLabel = '📅 Custom range';
      }

      activeFilterList.push({
        key: 'dateRange',
        label: dateLabel || `📅 ${filters.dateRange}`,
        value: filters.dateRange,
      });
    }

    if (filters.walletType && filters.walletType !== 'all') {
      const walletLabels: Record<string, string> = {
        life: '💳 Life Wallet',
        emergency: '🚨 Emergency Wallet',
      };
      activeFilterList.push({
        key: 'walletType',
        label: walletLabels[filters.walletType] || `💳 ${filters.walletType}`,
        value: filters.walletType,
      });
    }

    return activeFilterList;
  }, [filters.type, filters.category, filters.dateRange, filters.startDate, filters.endDate, filters.walletType]);

  const removeFilter = useCallback((key: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: key === 'dateRange' ? 'month' : 'all',
      // Dropping a custom range has to drop its endpoints too, or they linger in the
      // URL and come back the next time 'custom' is picked.
      ...(key === 'dateRange' ? { startDate: '', endDate: '' } : {}),
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery('');
    // The mirror effect takes the parameters back out of the URL from here.
  }, []);

  return {
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
  };
}

