'use client';

import { useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { useEffect, useRef, useMemo } from 'react';

/**
 * Enhanced query hook that handles authentication state changes properly
 * Automatically refetches data when user logs in/out and ensures proper cache management
 */
export function useAuthenticatedQuery<TData = unknown, TError = unknown>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<TData>,
  options?: Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn'>
) {
  const { status, isAuthenticated, user, mode } = useAuthContext();
  const queryClient = useQueryClient();
  const lastAuthStateRef = useRef<string>(`${status}-${user?.id || 'none'}`);

  // Key on the full three-state mode (authenticated | demo | unauthenticated),
  // not the binary isAuthenticated. With a binary key, "demo" and
  // "not-yet-resolved" share a cache entry: a request fired before the demo
  // cookie resolves gets cached and then served to demo mode as an empty
  // result. A mode flip must produce a fresh cache entry.
  const modeAwareQueryKey = useMemo(() => [
    ...queryKey,
    mode,
    user?.id || 'anonymous'
  ], [queryKey, mode, user?.id]);

  const query = useQuery({
    queryKey: modeAwareQueryKey,
    queryFn: queryFn,
    // Defaults (callers can override via options)
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    ...options,
    // Enhanced retry logic for auth changes
    retry: (failureCount: number, error: unknown) => {
      // Don't retry auth errors in demo mode
      const err = error as { response?: { status?: number } };
      if (err?.response?.status === 401 && !isAuthenticated) {
        return false;
      }
      // Standard retry logic
      if (options?.retry !== undefined) {
        if (typeof options.retry === 'function') {
          return options.retry(failureCount, error as TError) as boolean;
        }
        if (typeof options.retry === 'number') {
          return failureCount < options.retry;
        }
        return options.retry as boolean;
      }
      return failureCount < 3;
    },
  });

  useEffect(() => {
    const currentAuthState = `${status}-${user?.id || 'none'}`;

    if (lastAuthStateRef.current !== currentAuthState) {
      // If user just logged in (status changed to authenticated)
      if (status === 'authenticated' && lastAuthStateRef.current.includes('loading')) {
        // Small delay to ensure token is available
        setTimeout(() => {
          queryClient.invalidateQueries({
            queryKey: modeAwareQueryKey,
            refetchType: 'all'
          });
        }, 100);
      }

      lastAuthStateRef.current = currentAuthState;
    }
  }, [status, user?.id, queryClient, queryKey, modeAwareQueryKey]);

  return query;
}
/**
 * Hook for queries that work in both demo and authenticated modes
 * Uses different data sources based on authentication state
 */
export function useDualModeQuery<TData = unknown, TError = unknown>(
  queryKey: readonly unknown[],
  authenticatedQueryFn: () => Promise<TData>,
  demoDataFn: () => TData,
  options?: Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn'>
) {
  const { isDemo, status } = useAuthContext();

  return useAuthenticatedQuery(
    queryKey,
    async () => {
      if (isDemo) {
        // Return demo data synchronously wrapped in Promise
        return Promise.resolve(demoDataFn());
      }

      // Call authenticated API
      return authenticatedQueryFn();
    },
    {
      ...options,
      // Don't fire until the session check settles: the data source (API vs
      // demo fixtures) isn't known yet, and a premature API call would just
      // fail and waste a request. Mode-keyed caching handles the rest.
      enabled: status !== 'loading' && options?.enabled !== false,
      // Shorter stale time for demo mode to allow quick updates
      staleTime: isDemo ? 1000 : (options?.staleTime || 5 * 60 * 1000),
    }
  );
}