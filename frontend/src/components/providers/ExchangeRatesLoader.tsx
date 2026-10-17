'use client';

import { useEffect } from 'react';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useAppMode } from '@/hooks/useAppMode';
import { setExchangeRates } from '@/utils/formatters';

/**
 * Fills `toTWD`'s rate table from the server, once, near the root.
 *
 * Every summed total in the app runs through `toTWD` — the heatmaps, day
 * totals, expense breakdown, annual cash flow. Those were all converting with a
 * fixed table that had drifted 8% on EUR and 6% on SGD, which is a wrong number
 * on the dashboard rather than a cosmetic issue.
 *
 * It renders nothing. The alternative was threading rates through 21 call sites
 * across ten files, all of them inside `useMemo` bodies and reduce loops doing
 * arithmetic — which would have turned a rates problem into a refactor of the
 * money code.
 *
 * Totals painted before this resolves use the bootstrap table and then change,
 * by up to 8%. That is the honest trade for keeping `toTWD` synchronous: the
 * first paint is as wrong as it has always been, and every one after it is
 * right. `areRatesLive()` reports which state a figure came from.
 */
export function ExchangeRatesLoader({ baseCurrency = 'TWD' }: { baseCurrency?: string }) {
    // Mounted at the root, so it would otherwise fire on the marketing page, the
    // sign-in screen and in demo mode — a call to the backend (and on a cache
    // miss, to the FX provider) for visitors who will never see a converted
    // total. Demo mode is not supposed to reach the backend at all.
    const { isDemo, isAuthenticated } = useAppMode();
    const { data } = useExchangeRates(baseCurrency, { enabled: isAuthenticated && !isDemo });

    useEffect(() => {
        if (data?.rates) setExchangeRates(data.rates);
    }, [data]);

    return null;
}
