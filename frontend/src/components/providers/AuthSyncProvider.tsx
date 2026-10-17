'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { logger } from '@/utils/logger';

// Simple debounce utility
function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Provider that handles authentication synchronization with React Query
 * Ensures all queries are properly invalidated and refetched when auth state changes
 */
export function AuthSyncProvider({ children }: { children: React.ReactNode }) {
  const { status, isAuthenticated, user } = useAuthContext();
  const queryClient = useQueryClient();

  const lastAuthStateRef = useRef<{
    status: string;
    userId: string | null;
    isAuthenticated: boolean;
  }>({
    status: 'loading',
    userId: null,
    isAuthenticated: false,
  });

  // Debounced invalidation to prevent rapid refetches during auth transitions.
  // Stored in a ref so the stable reference is always available inside effects
  // without triggering re-renders or violating exhaustive-deps.
  const debouncedInvalidateRef = useRef(
    debounce((queryKeys: string[]) => {
      queryKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: [key], refetchType: 'active' });
      });
      logger.debug(`Selective queries invalidated: ${queryKeys.join(', ')}`, undefined, 'Sync');
    }, 500)
  );

  // Recreate the debounced function whenever queryClient changes (rare in practice).
  useEffect(() => {
    debouncedInvalidateRef.current = debounce((queryKeys: string[]) => {
      queryKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: [key], refetchType: 'active' });
      });
      logger.debug(`Selective queries invalidated: ${queryKeys.join(', ')}`, undefined, 'Sync');
    }, 500);
  }, [queryClient]);

  useEffect(() => {
    const currentAuthState = {
      status,
      userId: user?.id || null,
      isAuthenticated,
    };

    const lastAuthState = lastAuthStateRef.current;

    // Detect significant auth state changes
    const statusChanged = lastAuthState.status !== currentAuthState.status;
    const userChanged = lastAuthState.userId !== currentAuthState.userId;
    const authStateChanged = lastAuthState.isAuthenticated !== currentAuthState.isAuthenticated;

    // Check for login event (transition to authenticated)
    const justLoggedIn = !lastAuthState.isAuthenticated && currentAuthState.isAuthenticated;

    // Check for logout event (transition from authenticated)
    const justLoggedOut = lastAuthState.isAuthenticated && !currentAuthState.isAuthenticated;

    if (statusChanged || userChanged || authStateChanged) {
      logger.debug('Auth state change detected', {
        lastState: lastAuthState,
        currentState: currentAuthState,
        justLoggedIn,
        justLoggedOut,
      }, 'Sync');

      if (justLoggedIn) {
        logger.info('User logged in - clearing cache', undefined, 'Sync');

        // Clear all cached data to prevent stale demo data
        queryClient.clear();

        // Selectively refetch only critical queries to avoid rate limits
        debouncedInvalidateRef.current([
          'portfolio',
          'portfolio-stats',
          'portfolio-holdings',
          'wallet-balances',
        ]);

      } else if (justLoggedOut) {
        logger.info('User logged out - clearing data', undefined, 'Sync');

        // Clear all authenticated data
        queryClient.clear();

        // Selectively refetch queries that work in demo mode
        debouncedInvalidateRef.current(['portfolio', 'portfolio-stats']);
        logger.debug('Demo queries refreshed after logout', undefined, 'Sync');

      } else if (userChanged && currentAuthState.isAuthenticated) {
        logger.debug('Different user logged in - refreshing user data', undefined, 'Sync');

        // Different authenticated user - clear and refetch
        queryClient.clear();
        debouncedInvalidateRef.current([
          'portfolio',
          'portfolio-stats',
          'portfolio-holdings',
          'wallet-balances',
        ]);
      }
    }

    // Update reference for next comparison
    lastAuthStateRef.current = currentAuthState;
  }, [status, user?.id, isAuthenticated, queryClient, debouncedInvalidateRef]);

  return <>{children}</>;
}