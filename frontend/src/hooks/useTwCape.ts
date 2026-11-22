'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QUERY_KEYS } from './useDataSynchronization';
import { useAppMode } from './useAppMode';

export type CapeBand = 'cheap' | 'fair' | 'expensive';

export interface TwCape {
  available: true;
  asOf: string;
  cape: number;
  percentile: number;
  band: CapeBand;
  since: string;
  low: number;
  high: number;
  /** The band's edges as CAPE values: cheap at or below, expensive above. */
  cheapAtOrBelow: number;
  expensiveAbove: number;
  taiex: number;
  marketPe: number;
  history: Array<{ month: string; cape: number }>;
}

export type TwCapeResponse = TwCape | { available: false };

/**
 * The Taiwan CAPE (Shiller P/E of the TAIEX) and where it sits in its own
 * history, from GET /market/tw-cape. A server job refreshes it once a day, so
 * an hour's staleTime is plenty. Not fetched in demo mode, which runs without
 * a backend; the card is not shown there.
 */
export function useTwCape() {
  const { isDemo } = useAppMode();
  return useQuery({
    enabled: !isDemo,
    queryKey: [QUERY_KEYS.TW_CAPE],
    queryFn: async (): Promise<TwCapeResponse> => {
      const res = await apiClient.get<TwCapeResponse>('/market/tw-cape');
      if (!res.success || !res.data) throw new Error(res.message || 'Taiwan CAPE unavailable');
      return res.data;
    },
    staleTime: 60 * 60 * 1000,
  });
}
