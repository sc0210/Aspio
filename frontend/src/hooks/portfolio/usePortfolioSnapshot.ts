'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioService } from '@/services/portfolioService';
import { useAppMode } from '@/hooks/useAppMode';
import { useDemo } from '@/contexts/DemoContext';
import { QUERY_KEYS } from '@/hooks/useDataSynchronization';

/**
 * The unfiltered portfolio as a bare object, shared by the pages that only read it
 * (the trend page and a holding's page), so moving between them reads one cache
 * entry instead of fetching /portfolio again under a second key.
 *
 * Its own `'snapshot'` segment: usePortfolio caches ['portfolio', owner] as a
 * {data, success} envelope and usePortfolioData keys by its filters, so neither
 * shape can land here. Invalidation by the 'portfolio' prefix still reaches it.
 *
 * Demo mode reads the client fixture, which the backend's demo payload is pinned
 * to (tests/test_demo_payloads_twd.py), so no request is made for it.
 */
export function usePortfolioSnapshot() {
    const { isDemo, user } = useAppMode();
    const { demoPortfolio } = useDemo();

    return useQuery({
        queryKey: [QUERY_KEYS.PORTFOLIO, 'snapshot', isDemo ? 'demo' : (user?.email ?? 'anon')],
        queryFn: async () => {
            if (isDemo) return demoPortfolio;
            const res = await portfolioService.getPortfolio();
            return res.success ? res.data : null;
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
}
