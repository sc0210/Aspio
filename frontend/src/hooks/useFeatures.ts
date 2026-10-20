'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Features } from '@/lib/features';
import { useAppMode } from './useAppMode';
import { QUERY_KEYS } from './useDataSynchronization';

const ALL_OFF: Features = { lineBot: false };
const ALL_ON: Features = { lineBot: true };

/**
 * Optional add-ons this instance has configured.
 *
 * The LINE bot needs a channel created on LINE's developer console, which a
 * self-hoster may never set up. Without one the backend does not mount the
 * /line-bot routes at all, so every LINE surface (the /groups nav entry, the
 * Settings section, /link-line, /liff, the landing copy) hides off this.
 *
 * Off until the answer arrives. A failed request is not an answer, so it
 * counts as on: telling a linked user mid-flow that the instance has no LINE
 * bot would be a lie, while a LINE page on an unreachable backend shows its
 * own error. Demo mode has fixtures for all of it, so it reports everything
 * on without asking the backend.
 */
export function useFeatures(): Features & { isLoading: boolean } {
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

  if (isDemo || query.isError) return { ...ALL_ON, isLoading: false };
  return { ...(query.data ?? ALL_OFF), isLoading: query.isLoading };
}
