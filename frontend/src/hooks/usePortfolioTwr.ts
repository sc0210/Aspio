'use client';

import { useQuery } from '@tanstack/react-query';
import { useAppMode } from './useAppMode';
import { QUERY_KEYS } from './useDataSynchronization';
import { portfolioService, type TimeWeightedReturn } from '@/services/portfolioService';

/**
 * The portfolio's time-weighted return since inception. Not called in demo
 * mode (no backend); callers fall back to the per-lot IRR average there.
 */
export function usePortfolioTwr() {
    const { isDemo, isAuthenticated, user } = useAppMode();
    return useQuery<TimeWeightedReturn | null>({
        queryKey: [QUERY_KEYS.PORTFOLIO_TWR, user?.id ?? 'anonymous'],
        queryFn: () => portfolioService.getTimeWeightedReturn(),
        enabled: isAuthenticated && !isDemo,
        staleTime: 30 * 60 * 1000,
        retry: false,
    });
}
