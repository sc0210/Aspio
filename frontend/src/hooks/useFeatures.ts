'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ALL_FEATURES, type Features } from '@/lib/features';
import { useAppMode } from './useAppMode';
import { QUERY_KEYS } from './useDataSynchronization';

const ALL_OFF: Features = { lineBot: false };

/**
 * Optional add-ons this instance has configured.
 *
 * The LINE bot needs a channel created on LINE's developer console, which a
 * self-hoster may never set up. Without one the backend does not mount the
 * /line-bot routes at all, so every LINE surface (the /groups nav entry, the
 * Settings section, /link-line, /liff, the landing copy) hides off this.
 *
 * Off until the answer arrives, and off when the request fails, so the nav and
 * Settings never offer what may not exist. `isError` lets LineBotGate decide
 * differently for a page someone already opened (see there). Demo mode has
 * fixtures for all of it, so it reports everything on without asking.
 */
export function useFeatures(): Features & { isLoading: boolean; isError: boolean } {
  const { isDemo } = useAppMode();

  const query = useQuery({
    queryKey: [QUERY_KEYS.FEATURES],
    queryFn: async (): Promise<Features> => {
      const res = await apiClient.get<{ line_bot: boolean }>('/features');
      return { lineBot: res.data?.line_bot === true };
    },
    enabled: !isDemo,
    // Configuration, not data: it changes only when the instance restarts.
    staleTime: Infinity,
  });

  if (isDemo) return { ...ALL_FEATURES, isLoading: false, isError: false };
  return { ...(query.data ?? ALL_OFF), isLoading: query.isLoading, isError: query.isError };
}
