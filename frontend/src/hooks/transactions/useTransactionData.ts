'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { useTransactions } from '@/hooks/useTransactions';
import { transactionService } from '@/services/transactionService';
import { daysNeedingFullTotal, sumDayNet, transactionDayKey } from '@/components/transactions/dayTotals';
import type { Transaction } from '@/shared/types';
import type { TransactionFilters } from './useTransactionFilters';

// Each page holds ~1.25 screenfuls of rows so the pager sits just below the
// fold — a short scroll away instead of the long scroll a fixed 50-row page
// required. The count is viewport-relative (adapts to laptop vs. tall monitor
// vs. phone) and clamped to a sane range.
const DEFAULT_PAGE_SIZE = 15; // SSR / pre-measurement fallback
const APPROX_ROW_PX = 84; // effective avg row height, incl. date-group headers
const VIEWPORT_FILL = 1.25; // pages ≈ 1.25 × viewport height (per request)
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;
function computeViewportPageSize(): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  const rows = Math.round((window.innerHeight * VIEWPORT_FILL) / APPROX_ROW_PX);
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, rows));
}

/**
 * Server-paginated transaction list data for the transactions page.
 *
 * The list fetches one page at a time and pushes all filters (type, category,
 * wallet, date range, search) to the API. Stats and category breakdowns come
 * from useTransactionPageStats — nothing here needs the full row set anymore.
 */
// Stable on purpose: useQueries re-runs `combine` (and hands back a new array)
// only when this reference or a result changes, so dayTotals can memoise on it.
const dataOnly = (results: { data?: number }[]) => results.map((r) => r.data);

export function useTransactionData(
  filters: TransactionFilters,
  searchQuery: string,
  dateRange: { start: Date; end: Date } | undefined,
  isDemo: boolean,
) {
  const debouncedSearch = useDebounce(searchQuery, 500);
  const [page, setPage] = useState(1);

  // Page size adapts to the viewport (~1.25 screens per page). Recomputing on
  // resize only changes state when the row count actually crosses a threshold,
  // so React bails out of no-op updates — no explicit debounce needed.
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => {
    const update = () => setPageSize(computeViewportPageSize());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Snap back to page 1 whenever any filter changes, or when the page size
  // changes (a smaller/larger page shifts which rows fall on page 1).
  useEffect(() => {
    setPage(1);
  }, [
    filters.type,
    filters.category,
    filters.walletType,
    filters.sortBy,
    filters.sortOrder,
    dateRange,
    debouncedSearch,
    pageSize,
  ]);

  const transactionOptions = useMemo(
    () => ({
      page,
      limit: pageSize,
      sortBy: filters.sortBy || 'date',
      sortOrder: (filters.sortOrder || 'desc') as 'asc' | 'desc',
      type: filters.type !== 'all' ? (filters.type as 'income' | 'expense' | 'transfer') : undefined,
      category: filters.category !== 'all' ? filters.category : undefined,
      walletType: filters.walletType !== 'all' ? filters.walletType : undefined,
      dateRange,
      search: debouncedSearch || undefined,
    }),
    [
      page,
      pageSize,
      filters.sortBy,
      filters.sortOrder,
      filters.type,
      filters.category,
      filters.walletType,
      dateRange,
      debouncedSearch,
    ],
  );

  const { transactions, meta, isLoading, isFetching, error, refetch } =
    useTransactions(transactionOptions);

  const allRows = transactions as Transaction[];

  // Demo mode returns the whole filtered fixture set in one response —
  // paginate it client-side so both modes present the same interface.
  const pageRows = useMemo(
    () => (isDemo ? allRows.slice((page - 1) * pageSize, page * pageSize) : allRows),
    [isDemo, allRows, page, pageSize],
  );
  const total = isDemo ? allRows.length : meta?.total ?? allRows.length;
  const totalPages = isDemo
    ? Math.max(1, Math.ceil(allRows.length / pageSize))
    : Math.max(1, meta?.total_pages ?? 1);

  // A day header must total the whole day in the filtered set, not just the
  // rows that landed on this page — otherwise a day split by a page break reads
  // one figure on page 1 and another on page 2 (a transfer's two legs, split,
  // showed as −NT$50,120 and +NT$50,000).
  const sortedByDate = (filters.sortBy || 'date') === 'date';
  const splitDays = useMemo(
    () => (isDemo ? [] : daysNeedingFullTotal(pageRows, totalPages, sortedByDate)),
    [isDemo, pageRows, totalPages, sortedByDate],
  );

  const dayNets = useQueries({
    queries: splitDays.map((date) => {
      const day = new Date(date);
      return {
        queryKey: [
          'transaction-page-stats',
          'day-net',
          transactionDayKey(date),
          filters.type,
          filters.category,
          filters.walletType,
          debouncedSearch,
        ],
        queryFn: async () => {
          const res = await transactionService.getPageStats({
            type: filters.type !== 'all' ? (filters.type as 'income' | 'expense' | 'transfer') : undefined,
            category: filters.category !== 'all' ? filters.category : undefined,
            walletType: filters.walletType !== 'all' ? filters.walletType : undefined,
            search: debouncedSearch || undefined,
            // Every row on the page is already inside the filter's date range,
            // so the day alone is the intersection.
            dateRange: { start: day, end: day },
          });
          if (!res.success || !res.data) {
            throw new Error(res.message || 'Failed to load day total');
          }
          return res.data.stats.netIncome;
        },
        staleTime: 1000 * 60 * 2,
      };
    }),
    combine: dataOnly,
  });

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    if (isDemo) {
      // Demo holds the whole filtered set; total each visible day across it.
      const visible = new Set(pageRows.map((r) => transactionDayKey(r.date)));
      const byDay: Record<string, Transaction[]> = {};
      for (const row of allRows) {
        const key = transactionDayKey(row.date);
        if (!visible.has(key)) continue;
        (byDay[key] ??= []).push(row);
      }
      for (const [key, rows] of Object.entries(byDay)) totals[key] = sumDayNet(rows);
      return totals;
    }
    splitDays.forEach((date, i) => {
      const value = dayNets[i];
      // Until the day's figure arrives the list falls back to the page's rows.
      if (typeof value === 'number') totals[transactionDayKey(date)] = value;
    });
    return totals;
  }, [isDemo, pageRows, allRows, splitDays, dayNets]);

  return {
    transactions: pageRows,
    /**
     * Demo mode ONLY: the full filtered fixture set. In auth mode this is
     * just the current page — use transactionService.getAllTransactions when
     * the complete authenticated row set is needed.
     */
    demoRows: allRows,
    /** Per day key (`Date#toDateString`), that day's net across every page. */
    dayTotals,
    page,
    setPage,
    pageSize,
    total,
    totalPages,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}
