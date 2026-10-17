'use client';

import { apiClient } from '@/lib/api-client';
import { useAppMode } from './useAppMode';
import { useAuthenticatedQuery } from './useAuthenticatedQuery';
import { QUERY_KEYS } from './useDataSynchronization';

/**
 * The signed-in user's full profile (GET /users/me), including
 * preferred_currency. Not fetched in demo mode — callers should fall back
 * to a sensible default (e.g. 'TWD') when the query isn't enabled/loaded.
 */
export function useCurrentUser() {
  const { isAuthenticated } = useAppMode();

  return useAuthenticatedQuery(
    [QUERY_KEYS.USER_PROFILE],
    () => apiClient.getCurrentUser(),
    {
      enabled: isAuthenticated,
      staleTime: 1000 * 60 * 30, // profile rarely changes within a session
    }
  );
}
