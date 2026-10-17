'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioService } from '@/services/portfolioService';

/**
 * Live rates into the account's base currency.
 *
 * The app has been converting with a hardcoded table in `utils/formatters.ts`
 * (`USD: 31.5`), which drifts: against the live rates it is 8% out on EUR and
 * 6% on SGD. This is the source that endpoint has always had and nothing called.
 *
 * A code missing from `rates` is priced by nothing — do NOT fall back to 1, and
 * do not quietly substitute the static table either. The point of showing a
 * converted figure is that it is right; a wrong one is worse than the native
 * currency alone, which the reader can at least interpret.
 *
 * Cached for an hour. The rates themselves are cached server-side (memory for an
 * hour, database for a day), so this mostly avoids re-asking across navigations
 * — a cold request costs a few seconds, because the handler prices each currency
 * in its own round trip.
 */
export function useExchangeRates(
    baseCurrency = 'TWD',
    options: { enabled?: boolean } = {},
) {
    const query = useQuery({
        queryKey: ['exchange-rates', baseCurrency],
        queryFn: () => portfolioService.getExchangeRates(baseCurrency),
        enabled: options.enabled ?? true,
        staleTime: 60 * 60 * 1000,
        gcTime: 2 * 60 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    /**
     * How much one unit of `currency` is worth in the base, or undefined when
     * that cannot be answered. Undefined is a real answer here and callers are
     * expected to render nothing rather than guess.
     */
    const rateFor = (currency?: string): number | undefined => {
        if (!currency) return undefined;
        const code = currency.toUpperCase();
        if (code === baseCurrency.toUpperCase()) return 1;
        return query.data?.rates?.[code];
    };

    return { ...query, rateFor };
}
