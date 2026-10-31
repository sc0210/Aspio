'use client';

import { useDebounce } from '@/hooks/useDebounce';
import { useDualModeQuery } from '@/hooks/useAuthenticatedQuery';
import { useDemo } from '@/contexts/DemoContext';
import {
  transactionService,
  TransactionPageStats,
  PageStatsCategoryItem,
} from '@/services/transactionService';
import { isDayInRange, toTWD } from '@/utils/formatters';
import type { Transaction } from '@/shared/types';
import type { TransactionFilters } from './useTransactionFilters';
import { isWalletTransfer } from '@/utils/expenseGroups';

/**
 * Compute the page-stats payload client-side. Used for demo mode only —
 * authenticated mode gets the same shape from GET /transactions/stats.
 */
export function computeClientPageStats(
  rawTransactions: Transaction[],
  filteredTransactions: Transaction[],
  /** Leave both legs of a wallet transfer out of the totals, as the aggregate
   *  query does for an authenticated account. */
  { excludeTransfers = false }: { excludeTransfers?: boolean } = {},
): TransactionPageStats {
  if (excludeTransfers) {
    filteredTransactions = filteredTransactions.filter(t => !isWalletTransfer(t));
  }
  const totalIncome = filteredTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + toTWD(Number(t.amount), t.currency), 0);
  const totalExpenses = filteredTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + toTWD(Number(t.amount), t.currency), 0);

  const avgTransactionAmount =
    filteredTransactions.length > 0
      ? filteredTransactions.reduce((sum, t) => sum + toTWD(Number(t.amount), t.currency), 0) /
        filteredTransactions.length
      : 0;

  // Category breakdown from the RAW set (keeps every category visible in the
  // dropdown even while a category filter is active).
  const categoryMap: Record<string, PageStatsCategoryItem> = {};
  rawTransactions.forEach(t => {
    const key = `${t.category}_${t.type}`;
    if (!categoryMap[key]) {
      categoryMap[key] = {
        category: t.category,
        amount: 0,
        type: t.type,
        color: t.type === 'income' ? '#22c55e' : '#ef4444',
      };
    }
    categoryMap[key].amount += toTWD(Number(t.amount), t.currency);
  });

  // Expense-only breakdown from the FILTERED set — matches the stat cards.
  const expenseCategoryMap: Record<string, PageStatsCategoryItem> = {};
  filteredTransactions
    .filter(t => t.type === 'expense')
    .forEach(t => {
      if (!expenseCategoryMap[t.category]) {
        expenseCategoryMap[t.category] = {
          category: t.category,
          amount: 0,
          type: 'expense',
          color: '#ef4444',
        };
      }
      expenseCategoryMap[t.category].amount += toTWD(Number(t.amount), t.currency);
    });

  const byTwdDesc = (a: Transaction, b: Transaction) =>
    toTWD(Number(b.amount), b.currency) - toTWD(Number(a.amount), a.currency);

  return {
    stats: {
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
      transactionCount: filteredTransactions.length,
      avgTransactionAmount,
    },
    categoryBreakdown: Object.values(categoryMap),
    expenseCategoryBreakdown: Object.values(expenseCategoryMap),
    topExpenses: filteredTransactions.filter(t => t.type === 'expense').sort(byTwdDesc).slice(0, 5),
    topIncome: filteredTransactions.filter(t => t.type === 'income').sort(byTwdDesc).slice(0, 5),
  };
}

function matchesSearch(t: Transaction, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  if (t.description?.toLowerCase().includes(q)) return true;
  if (t.category?.toLowerCase().includes(q)) return true;
  if (t.subcategory?.toLowerCase().includes(q)) return true;
  if (t.tags && Array.isArray(t.tags)) {
    if (t.tags.some(tag => tag.toLowerCase().includes(q) || `#${tag.toLowerCase()}`.includes(q))) {
      return true;
    }
  }
  if (t.paymentMethod?.toLowerCase().includes(q)) return true;
  if (t.location?.toLowerCase().includes(q)) return true;
  if (!isNaN(Number(q)) && String(t.amount).includes(q)) return true;
  return false;
}

function filterDemoTransactions(
  transactions: Transaction[],
  filters: TransactionFilters,
  searchQuery: string,
  dateRange?: { start: Date; end: Date },
): { raw: Transaction[]; filtered: Transaction[] } {
  const raw = transactions.filter(t => {
    // Transfer legs are stored as expense/income rows, never type 'transfer'.
    if (filters.type === 'transfer') {
      if (!isWalletTransfer(t)) return false;
    } else if (filters.type !== 'all' && t.type !== filters.type) return false;
    if (dateRange && !isDayInRange(t.date, dateRange)) return false;
    if (searchQuery && !matchesSearch(t, searchQuery)) return false;
    return true;
  });

  const filtered = raw.filter(t => {
    if (filters.category && filters.category !== 'all') {
      const selected = filters.category.split(',').filter(Boolean);
      if (!selected.includes(t.category)) return false;
    }
    if (filters.walletType && filters.walletType !== 'all') {
      if (t.walletType !== filters.walletType) return false;
    }
    return true;
  });

  return { raw, filtered };
}

/**
 * Stats, category breakdowns, and top transactions for the transactions page.
 * Authenticated mode asks the backend (aggregate queries, TWD-normalized);
 * demo mode computes the same shape from the fixture set.
 */
export function useTransactionPageStats(
  filters: TransactionFilters,
  searchQuery: string,
  dateRange: { start: Date; end: Date } | undefined,
  /** Leave both legs of a wallet transfer out of the totals. The rows below the
   *  cards are untouched, so the cards stop equalling them — which is the point
   *  of asking, and what the toggle's own caption says. */
  excludeTransfers = false,
) {
  const { demoTransactions, demoRevision } = useDemo();
  const debouncedSearch = useDebounce(searchQuery, 500);

  const query = useDualModeQuery<TransactionPageStats>(
    [
      'transaction-page-stats',
      filters.type,
      filters.category,
      filters.walletType,
      debouncedSearch,
      dateRange?.start?.toISOString(),
      dateRange?.end?.toISOString(),
      excludeTransfers,
      demoRevision ?? 0,
    ],
    async () => {
      const res = await transactionService.getPageStats({
        type: filters.type !== 'all' ? (filters.type as 'income' | 'expense' | 'transfer') : undefined,
        category: filters.category !== 'all' ? filters.category : undefined,
        walletType: filters.walletType !== 'all' ? filters.walletType : undefined,
        search: debouncedSearch || undefined,
        dateRange,
        excludeTransfers,
      });
      if (!res.success || !res.data) {
        throw new Error(res.message || 'Failed to load transaction stats');
      }
      return res.data;
    },
    () => {
      const { raw, filtered } = filterDemoTransactions(
        demoTransactions,
        filters,
        searchQuery,
        dateRange,
      );
      // Demo mode computes the same shape client-side, so it honours the toggle
      // the same way rather than quietly ignoring it.
      return computeClientPageStats(raw, filtered, { excludeTransfers });
    },
    {
      staleTime: 1000 * 60 * 2,
      refetchOnWindowFocus: false,
      // Flipping the transfer switch (or any filter) changes the key, and with no
      // cache entry for the new one the page falls back to its zeros — three cards
      // reading a confident NT$0 with error=false, which TransactionStats exists to
      // avoid. Hold the last figures until the new ones land.
      placeholderData: (previous: TransactionPageStats | undefined) => previous,
    },
  );

  return {
    pageStats: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
