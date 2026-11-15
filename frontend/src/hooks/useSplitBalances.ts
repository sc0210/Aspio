'use client';

import { apiClient } from '@/lib/api-client';
import { demoSplitBalances } from '@/data/demoData';
import { useAccessTier } from './useAccessTier';
import { useDualModeQuery } from './useAuthenticatedQuery';
import { QUERY_KEYS } from './useDataSynchronization';
import type { PeerBalanceOut } from '@/shared/types';

/**
 * What each partner owes you (net > 0) or you owe them (net < 0), per currency.
 * Splits are a premium feature: a free account never asks (the API would 403),
 * so its data stays undefined and callers render nothing.
 */
export function useSplitBalances() {
  const { isPremium } = useAccessTier();
  return useDualModeQuery<PeerBalanceOut[]>(
    [QUERY_KEYS.SPLIT_BALANCES],
    async () => (await apiClient.getSplitBalances()).data ?? [],
    () => demoSplitBalances,
    { enabled: isPremium },
  );
}
