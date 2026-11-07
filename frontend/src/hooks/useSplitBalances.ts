'use client';

import { apiClient } from '@/lib/api-client';
import { demoSplitBalances } from '@/data/demoData';
import { useDualModeQuery } from './useAuthenticatedQuery';
import { QUERY_KEYS } from './useDataSynchronization';
import type { PeerBalanceOut } from '@/shared/types';

/** What each partner owes you (net > 0) or you owe them (net < 0), per currency. */
export function useSplitBalances() {
  return useDualModeQuery<PeerBalanceOut[]>(
    [QUERY_KEYS.SPLIT_BALANCES],
    async () => (await apiClient.getSplitBalances()).data ?? [],
    () => demoSplitBalances,
  );
}
