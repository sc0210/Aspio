'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { dashboardService } from '@/services/dashboardService';
import { useAppMode } from './useAppMode';
import { useEffect } from 'react';
import { QUERY_KEYS } from './useDataSynchronization';

export interface WalletTrendDataPoint {
    date: string;
    lifeWallet: number;
    portfolioWallet: number;
    emergencyWallet: number;
    totalAsset: number;
    investmentTotal: number;
    debtBalance?: number;
    /**
     * Outstanding balance per loan id on this date, from the payments recorded
     * against each loan. Optional because a payload predating the field has no
     * key at all — which is not the same as reporting no debt.
     */
    debtByLoan?: Record<string, number>;
}

interface WalletTrendPayload {
    dataPoints?: WalletTrendDataPoint[];
    /** Balances at the close of the day before the window — see below. */
    baseline?: WalletTrendDataPoint | null;
}

/**
 * Hook to fetch wallet trends with realtime updates
 * Similar to monthly summary page - always fetches fresh data
 */
export function useWalletTrends(period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = '30d') {
    const { data: session } = useSession();
    const { isDemo, user } = useAppMode();
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: [QUERY_KEYS.WALLET_TRENDS, period, isDemo ? 'demo' : user?.id],
        queryFn: async () => {
            const response = await dashboardService.getWalletTrends(period);
            return (response.data ?? {}) as WalletTrendPayload;
        },
        // Callers still receive WalletTrendDataPoint[]; the baseline rides along
        // on the same query and is read through useWalletTrendBaseline below.
        select: (payload: WalletTrendPayload) => payload.dataPoints ?? [],
        enabled: !!session || isDemo,
        // Freshness is driven by explicit invalidation on data-change events below
        // (which ignores staleTime), so we don't need staleTime:0 — that forced a
        // refetch on every mount/remount. A 60s window avoids redundant refetches
        // (e.g. the card mounting twice) while mutations still refresh immediately.
        staleTime: 60_000,
        retry: 1,
    });

    // Auto-refresh when transactions or portfolio changes, or dashboard data updates
    useEffect(() => {
        const handleDataChange = () => {
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.WALLET_TRENDS] });
        };

        // Listen for custom events from transaction/portfolio updates
        window.addEventListener('transaction-updated', handleDataChange);
        window.addEventListener('portfolio-updated', handleDataChange);
        window.addEventListener('dashboard-data-updated', handleDataChange);

        return () => {
            window.removeEventListener('transaction-updated', handleDataChange);
            window.removeEventListener('portfolio-updated', handleDataChange);
            window.removeEventListener('dashboard-data-updated', handleDataChange);
        };
    }, [queryClient]);

    return query;
}


/**
 * Where the period opened: balances at the close of the day before the window.
 *
 * A series of N daily points spans N-1 days, so `last - first` over it measures
 * one day less than the period the caller asked for — whatever moved on the 1st
 * was dropped from "this month" entirely. That is what made the dashboard's
 * portfolio delta disagree with the P&L calendar beside it, which does count
 * the 1st.
 *
 * It shares `useWalletTrends`' query key, so this is a second read of one
 * fetch, not a second fetch. Undefined against a backend that predates the
 * field; callers fall back to the first point, which is the old behaviour.
 */
export function useWalletTrendBaseline(
    period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = '30d',
) {
    const { data: session } = useSession();
    const { isDemo, user } = useAppMode();

    return useQuery({
        queryKey: [QUERY_KEYS.WALLET_TRENDS, period, isDemo ? 'demo' : user?.id],
        queryFn: async () => {
            const response = await dashboardService.getWalletTrends(period);
            return (response.data ?? {}) as WalletTrendPayload;
        },
        enabled: !!session || isDemo,
        select: (payload: WalletTrendPayload) => payload.baseline ?? undefined,
        staleTime: 60_000,
        retry: 1,
    });
}
