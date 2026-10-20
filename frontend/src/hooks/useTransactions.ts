'use client';

import { useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { Transaction, ApiResponse, PaginationParams } from '@/shared/types';
import { transactionService } from '@/services/transactionService';
import { useDemo } from '@/contexts/DemoContext';
import { useAppMode } from '@/hooks/useAppMode';
import { useDualModeQuery } from './useAuthenticatedQuery';
import { QUERY_KEYS, invalidateDashboardData } from './useDataSynchronization';
import toast from 'react-hot-toast';
import { log } from '@/utils/logger';

interface UseTransactionsOptions extends PaginationParams {
  category?: string;
  type?: 'income' | 'expense' | 'transfer';
  walletType?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  search?: string;
  /**
   * Fetch every page in range instead of a single capped page. Only for
   * callers that genuinely need the full row set (e.g. CSV export or
   * replace-mode import); the list/stat views use server pagination + the
   * /transactions/stats endpoint instead.
   */
  fetchAll?: boolean;
  /** Set false to defer fetching (e.g. export data only when the modal opens). */
  enabled?: boolean;
}

// One shared empty list, so a consumer memoising on `transactions` is not
// invalidated on every render while the query has no data.
const NO_TRANSACTIONS: Transaction[] = [];

export function useTransactions(options: UseTransactionsOptions = {}) {
  const { data: session } = useSession();
  const { isDemo } = useAppMode();
  const { demoTransactions, addDemoTransaction, demoRevision } = useDemo();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['transactions']);

  // Use dual-mode query for proper authentication handling
  const {
    data: transactions,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useDualModeQuery(
    // Demo keys carry the fixture revision: a demo add/delete must refetch
    // through a queryFn that sees the new rows, not one closed over the old.
    isDemo ? ['transactions', options, 'demo', demoRevision ?? 0] : ['transactions', options],
    async () => {
      if (!options.fetchAll) {
        return transactionService.getTransactions(options);
      }
      // Aggregate every page in the selected range so client-side stats are
      // accurate. Backend caps a page at 200; loop until a short/empty page,
      // with a hard cap to avoid runaway fetches.
      const PAGE_LIMIT = 200;
      const MAX_PAGES = 50; // 10k transactions ceiling
      const all: Transaction[] = [];
      // The backend's (sort_col, id) ORDER BY tiebreaker is the primary fix for
      // pagination determinism. This dedup is defense-in-depth for the one case
      // SQL can't cover: a row shifting pages BETWEEN these sequential per-page
      // fetches (e.g. a concurrent edit/insert). Keep first occurrence.
      const seen = new Set<string>();
      let meta: ApiResponse<Transaction[]>['meta'];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await transactionService.getTransactions({ ...options, page, limit: PAGE_LIMIT });
        if (!res.success) {
          // Surface the failure on the first page; otherwise keep what we have.
          if (page === 1) return res;
          break;
        }
        const batch = res.data || [];
        for (const t of batch) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            all.push(t);
          }
        }
        meta = res.meta;
        if (batch.length < PAGE_LIMIT) break;
      }
      return { data: all, success: true, message: 'Transactions retrieved successfully', meta } as ApiResponse<Transaction[]>;
    },
    () => {
      // Filter demo transactions based on options
      let filteredTransactions = demoTransactions;

      if (options.type) {
        filteredTransactions = filteredTransactions.filter(t => t.type === options.type);
      }

      if (options.category) {
        // Server accepts comma-separated category names; mirror that here
        const selected = options.category.split(',').filter(Boolean);
        filteredTransactions = filteredTransactions.filter(t => selected.includes(t.category));
      }

      if (options.walletType) {
        filteredTransactions = filteredTransactions.filter(t => t.walletType === options.walletType);
      }

      if (options.dateRange) {
        filteredTransactions = filteredTransactions.filter(t => {
          const dateValue = typeof t.date === 'string' ? new Date(t.date) : t.date;
          return dateValue >= options.dateRange!.start && dateValue <= options.dateRange!.end;
        });
      }

      // Demo fallback: support server-side search param as well
      if (options.search) {
        const query = String(options.search).toLowerCase().trim();
        filteredTransactions = filteredTransactions.filter(t => {
          if (!query) return true;
          if (t.description && t.description.toLowerCase().includes(query)) return true;
          if (t.category && t.category.toLowerCase().includes(query)) return true;
          if (t.subcategory && t.subcategory.toLowerCase().includes(query)) return true;
          if (t.paymentMethod && t.paymentMethod.toLowerCase().includes(query)) return true;
          if (t.location && t.location.toLowerCase().includes(query)) return true;
          if (t.tags && Array.isArray(t.tags)) {
            const hasMatchingTag = t.tags.some(tag => tag.toLowerCase().includes(query) || (`#${tag.toLowerCase()}`).includes(query));
            if (hasMatchingTag) return true;
          }
          if (!isNaN(Number(query)) && String(t.amount).includes(query)) return true;
          return false;
        });
      }

      return {
        data: filteredTransactions,
        success: true,
        message: 'Demo transactions loaded'
      } as ApiResponse<Transaction[]>;
    },
    {
      // ⚡ PERFORMANCE: Optimized cache settings for faster page loads
      staleTime: 1000 * 60 * 2, // 2 minutes - allow filters to work with reasonable cache
      gcTime: 1000 * 60 * 15, // 15 minutes cache
      refetchOnWindowFocus: false,
      refetchOnMount: true, // Refetch when filters change (different cache key)
      retry: 1,
      enabled: options.enabled !== false,
      // Keep showing the previous page's rows while the next page loads so
      // pagination doesn't flash an empty list.
      placeholderData: keepPreviousData,
    }
  );

  const createMutation = useMutation({
    mutationFn: async (transactionData: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => {
      log.debug('Creating transaction', { isDemo, transactionData }, 'useTransactions');

      const newTransaction = {
        id: `demo-${crypto.randomUUID()}`,
        userId: 'demo-user',
        ...transactionData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (isDemo) {
        log.debug('Demo mode: Adding transaction to demo context', undefined, 'useTransactions');
        // Add to demo context first
        addDemoTransaction(transactionData);

        log.debug('Demo transaction created', newTransaction, 'useTransactions');

        return {
          data: newTransaction,
          success: true,
          message: 'Demo transaction created'
        } as ApiResponse<Transaction>;
      }

      return transactionService.createTransaction(transactionData);
    },
    onMutate: async (newTransaction) => {
      log.debug('Starting optimistic update for transaction creation', undefined, 'useTransactions');

      // Cancel ALL transaction-related queries
      await queryClient.cancelQueries({ queryKey: ['transactions'] });

      const optimisticTransaction = {
        id: `temp-${crypto.randomUUID()}`,
        userId: session?.user?.id || 'demo-user',
        ...newTransaction,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Transaction;

      // Get all transaction queries and update them
      const allTransactionQueries = queryClient.getQueriesData({ queryKey: ['transactions'] });
      const snapshots: Array<[readonly unknown[], unknown]> = [];

      allTransactionQueries.forEach(([queryKey, data]) => {
        // Store snapshot - copy readonly array to mutable array
        snapshots.push([queryKey, data]);

        // Update the query data
        queryClient.setQueryData(queryKey, (old: unknown) => {
          type CachedData = { transactions?: Transaction[]; data?: Transaction[] };
          const cached = old as CachedData | Transaction[] | null | undefined;
          if (cached && !Array.isArray(cached) && cached.transactions) {
            // Handle paginated format from transaction page
            return { ...cached, transactions: [optimisticTransaction, ...cached.transactions] };
          } else if (cached && !Array.isArray(cached) && cached.data) {
            // Handle hook format
            return { ...cached, data: [optimisticTransaction, ...cached.data] };
          } else if (Array.isArray(cached)) {
            // Handle direct array format
            return [optimisticTransaction, ...cached];
          }

          // Default: create new array
          return [optimisticTransaction];
        });
      });

      return { snapshots, optimisticTransaction };
    },
    onSuccess: (result, variables, context) => {
      log.info('Transaction created successfully', {
        isDemo,
        transactionType: variables.type,
        amount: variables.amount,
        transactionId: result.data?.id
      }, 'useTransactions');

      // Replace optimistic transaction with real data in ALL queries
      if (context?.snapshots) {
        context.snapshots.forEach(([queryKey, _snapshot]) => {
          queryClient.setQueryData(queryKey, (old: unknown) => {
            type CachedData = { transactions?: Transaction[]; data?: Transaction[] };
            const cached = old as CachedData | Transaction[] | null | undefined;
            if (cached && !Array.isArray(cached) && cached.transactions) {
              // Handle paginated format from transaction page
              return {
                ...cached,
                transactions: cached.transactions.map((t: Transaction) =>
                  t.id === context.optimisticTransaction.id ? result.data : t
                )
              };
            } else if (cached && !Array.isArray(cached) && cached.data) {
              // Handle hook format
              return {
                ...cached,
                data: cached.data.map((t: Transaction) =>
                  t.id === context.optimisticTransaction.id ? result.data : t
                )
              };
            } else if (Array.isArray(cached)) {
              // Handle direct array format
              return cached.map((t: Transaction) =>
                t.id === context.optimisticTransaction.id ? result.data : t
              );
            }
            return cached;
          });
        });
      }

      // Invalidate all related queries to ensure fresh data everywhere
      log.debug('Invalidating related queries after transaction creation', undefined, 'useTransactions');

      // Use centralized invalidation for dashboard data (includes wallet-trends)
      invalidateDashboardData(queryClient);

      // For comprehensive cache refresh, invalidate all transaction queries
      // This will match ['transactions'], ['transactions', options], etc.
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.TRANSACTIONS],
        exact: false,
        refetchType: 'all'
      });

      // Dispatch custom event for cross-component sync
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-updated'));
      }

      // For demo mode, additional forced refresh
      if (isDemo) {
        log.debug('Demo mode: Forcing comprehensive cache refresh', undefined, 'useTransactions');
        setTimeout(() => {
          queryClient.removeQueries({ queryKey: [QUERY_KEYS.OPTIMIZED_DASHBOARD], exact: false });
          queryClient.invalidateQueries({
            queryKey: [QUERY_KEYS.TRANSACTIONS],
            exact: false,
            refetchType: 'all'
          });
        }, 50);
      }

      toast.success(t('transactions:toast.created'));
    },
    onError: (error: unknown, _variables, context) => {
      log.error('Transaction creation failed, rolling back optimistic updates', error, 'useTransactions');

      // Rollback ALL transaction queries
      if (context?.snapshots) {
        context.snapshots.forEach(([queryKey, originalData]) => {
          queryClient.setQueryData(queryKey, originalData);
        });
      }

      const message = error instanceof Error ? error.message : t('transactions:toast.createFailed');
      toast.error(message);
    },
    onSettled: () => {
      log.debug('Transaction mutation settled, ensuring cache consistency', undefined, 'useTransactions');
      // Force refetch of all transaction queries to ensure consistency
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.TRANSACTIONS],
        exact: false,
        refetchType: 'all'
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Transaction> }) =>
      transactionService.updateTransaction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS], exact: false });
      // Use centralized invalidation for dashboard data (includes wallet-trends)
      invalidateDashboardData(queryClient);

      // Dispatch custom event for cross-component sync
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-updated'));
      }

      toast.success(t('transactions:toast.updated'));
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : t('transactions:toast.updateFailed');
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => transactionService.deleteTransaction(id),
    onMutate: async (deletedId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });

      // Match by prefix, as create does: useDualModeQuery appends the mode and
      // user id to the key, so the exact [TRANSACTIONS, options] key this used
      // to write was never the one any query read — the row stayed on screen
      // until the server answered, and the rollback restored nothing.
      const snapshots = queryClient.getQueriesData({ queryKey: [QUERY_KEYS.TRANSACTIONS] });

      queryClient.setQueriesData({ queryKey: [QUERY_KEYS.TRANSACTIONS] }, (old: unknown) => {
        type CachedData = { data?: Transaction[] };
        const cached = old as CachedData | Transaction[] | null | undefined;
        if (!cached) return cached;
        const oldData: Transaction[] = Array.isArray(cached) ? cached : (cached.data ?? []);
        const newData = oldData.filter((t: Transaction) => t.id !== deletedId);
        return Array.isArray(cached) ? newData : { ...cached, data: newData };
      });

      return { snapshots, deletedId };
    },
    onSuccess: () => {
      // Use centralized invalidation for dashboard data (includes wallet-trends)
      invalidateDashboardData(queryClient);

      // Dispatch custom event for cross-component sync
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-updated'));
      }
      toast.success(t('transactions:toast.deleted'));
    },
    onError: (error: unknown, _deletedId, context) => {
      // Rollback
      context?.snapshots.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      const message = error instanceof Error ? error.message : t('transactions:toast.deleteFailed');
      toast.error(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS], exact: false });
    },
  });

  return {
    transactions: transactions?.data || NO_TRANSACTIONS,
    meta: transactions?.meta,
    // Don't show loading for mutations since we use optimistic updates
    isLoading: isLoading,
    isFetching: isFetching,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    error,
    refetch,
    createTransaction: createMutation.mutateAsync,
    updateTransaction: updateMutation.mutateAsync,
    deleteTransaction: deleteMutation.mutateAsync,
  };
}