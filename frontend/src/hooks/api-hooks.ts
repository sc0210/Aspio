/**
 * React Query hooks for Aspiro API
 * Provides caching, synchronization, and error handling for API calls
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from './useDataSynchronization';
import { apiClient, type GamificationStats, type AchievementItem, type AchievementProgress, type StreakUpdateResult } from '@/lib/api-client';
import { invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { Transaction } from '@/shared/types';
import { transactionService } from '@/services/transactionService';
import { useAppMode } from '@/hooks/useAppMode';
import { useDemo } from '@/contexts/DemoContext';

// Query keys come from the one registry in useDataSynchronization. This file
// used to keep a second, lowercase `queryKeys` object: ten entries of which
// only three were ever used, `chat` outliving the page it belonged to. Worse,
// it was invisible to the registry ratchet — its keys are referenced as
// `queryKeys.gamification`, not as a literal inside a queryKey array — so
// `gamification` was live, unregistered and in no invalidation group at all.

// User Hooks

/**
 * Save one day's rows in a dragged order (#478). Resolves only after the
 * transactions queries have refetched, so the caller can drop its on-screen order
 * without the old one flashing back.
 */
export function useSetDayOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ date, ids }: { date: string; ids: string[] }) =>
      transactionService.setDayOrder(date, ids),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS], exact: false }),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Transaction> }) =>
      apiClient.updateTransaction(id, data),
    // Optimistic update - immediately apply changes to UI
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['transactions'] });

      // Snapshot the previous value
      const previousTransactions = queryClient.getQueryData(['transactions']);

      // Optimistically update the transaction
      queryClient.setQueryData(['transactions'], (old: unknown) => {
        if (Array.isArray(old)) {
          return old.map((t: Transaction) =>
            t.id === id
              ? { ...t, ...data, updatedAt: new Date() }
              : t
          );
        }
        return old;
      });

      return { previousTransactions, id, data };
    },
    onSuccess: (updatedTransaction, { id }) => {
      // Replace optimistic update with real data
      queryClient.setQueryData(['transactions'], (old: unknown) => {
        if (Array.isArray(old)) {
          return old.map((t: Transaction) => t.id === id ? updatedTransaction : t);
        }
        return old;
      });

      // Centralized dashboard invalidation — covers dashboard, optimized/comprehensive
      // dashboard, dashboard-stats, wallet-trends and portfolio (kept in sync with
      // useTransactions.ts so both transaction hooks refresh identical widgets).
      invalidateDashboardData(queryClient);
    },
    onError: (error, _variables, context) => {
      // If the mutation fails, restore the previous data
      queryClient.setQueryData(['transactions'], context?.previousTransactions);
      console.error('Transaction update error:', error);
    },
    // Ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  const { isDemo } = useAppMode();
  const { removeDemoTransaction } = useDemo();

  return useMutation({
    // Demo rows live in DemoContext, not on the backend (a DELETE there 404s).
    mutationFn: async (id: string): Promise<unknown> => {
      if (isDemo) {
        removeDemoTransaction?.(id);
        return { success: true, demo: true };
      }
      return apiClient.deleteTransaction(id);
    },
    // Optimistic delete - immediately remove from UI before backend responds
    onMutate: async (deletedId) => {
      // Cancel any outgoing refetches for all transaction queries
      await queryClient.cancelQueries({ queryKey: ['transactions'] });

      // Snapshot all transaction query data
      const allTransactionQueries = queryClient.getQueriesData({ queryKey: ['transactions'] });

      // Optimistically remove the transaction from all relevant queries
      allTransactionQueries.forEach(([queryKey, data]) => {
        if (data) {
          queryClient.setQueryData(queryKey, (old: unknown) => {
            if (Array.isArray(old)) {
              return old.filter((t: Transaction) => t.id !== deletedId);
            }
            const oldObj = old as Record<string, unknown>;
            // Handle paginated responses
            if (oldObj?.transactions && Array.isArray(oldObj.transactions)) {
              return {
                ...oldObj,
                transactions: (oldObj.transactions as Transaction[]).filter((t: Transaction) => t.id !== deletedId)
              };
            }
            return old;
          });
        }
      });

      // Return a context with all previous data
      return { allTransactionQueries, deletedId };
    },
    onSuccess: async () => {
      // Centralized dashboard invalidation — covers dashboard, optimized/comprehensive
      // dashboard, dashboard-stats, wallet-trends and portfolio (kept in sync with
      // useTransactions.ts so both transaction hooks refresh identical widgets).
      invalidateDashboardData(queryClient);

      // Force refetch active transaction queries to update stats immediately
      await queryClient.refetchQueries({ queryKey: ['transactions'], type: 'active' });
    },
    onError: (error, deletedId, context) => {
      // If the mutation fails, restore all previous data
      if (context?.allTransactionQueries) {
        context.allTransactionQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('Transaction deletion error:', error);
    },
    // Ensure consistency by refetching on completion
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

// Goals Hooks

export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.markNotificationAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
    },
  });
}

// Gamification Hooks
export function useGamificationStats(options?: { enabled?: boolean }) {
  return useQuery<GamificationStats | null>({
    queryKey: [QUERY_KEYS.GAMIFICATION],
    queryFn: async () => {
      try {
        return await apiClient.getGamificationStats();
      } catch {
        return null;
      }
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

export function useAchievementProgress(options?: { enabled?: boolean }) {
  return useQuery<AchievementProgress[]>({
    queryKey: [QUERY_KEYS.ACHIEVEMENTS, 'progress'],
    queryFn: async () => {
      try {
        return await apiClient.getAchievementProgress();
      } catch {
        return [];
      }
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Pings the backend to refresh the user's login streak. The backend is
 * idempotent per calendar day, so calling this on every page visit is safe —
 * it only advances the streak once per day and returns any streak achievements
 * earned as a side effect.
 */
export function useUpdateStreak() {
  const queryClient = useQueryClient();
  return useMutation<StreakUpdateResult, Error, void>({
    mutationFn: () => apiClient.updateLoginStreak(),
    onSuccess: (result) => {
      if (result?.streak_updated) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GAMIFICATION] });
        if (result.new_achievements?.length) {
          queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ACHIEVEMENTS] });
        }
      }
    },
  });
}

/**
 * Sweeps every achievement category server-side and awards anything newly
 * completed. Returns the list of freshly-unlocked achievements so the UI can
 * celebrate them. Invalidates gamification + achievement caches on success.
 */
export function useCheckAchievements() {
  const queryClient = useQueryClient();
  return useMutation<AchievementItem[], Error, void>({
    mutationFn: () => apiClient.checkAllAchievements(),
    onSuccess: (newAchievements) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GAMIFICATION] });
      if (newAchievements?.length) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ACHIEVEMENTS] });
      }
    },
  });
}

// Chat Hooks

