/**
 * The daily-performance cache key.
 *
 * Three callers asked for this data under `['portfolio-daily-performance',
 * email]` while requesting two different spans — 365 days on the dashboard and
 * the portfolio page, 1,825 on /portfolio/trend. The span was not in the key,
 * so they shared one cache entry and whichever mounted first decided what the
 * others rendered. The dashboard is the landing page, so the trend page's
 * 5-year presets were routinely drawn from one year of data.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
    dailyPerformanceKey,
    DAILY_PERFORMANCE_DAYS_DEFAULT,
    DAILY_PERFORMANCE_DAYS_MAX,
} from '@/lib/queryKeys';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

describe('dailyPerformanceKey', () => {
    it('separates the spans that used to collide', () => {
        const short = dailyPerformanceKey('a@b.com', DAILY_PERFORMANCE_DAYS_DEFAULT);
        const long = dailyPerformanceKey('a@b.com', DAILY_PERFORMANCE_DAYS_MAX);
        expect(short).not.toEqual(long);
    });

    it('still shares one entry between callers wanting the same span', () => {
        expect(dailyPerformanceKey('a@b.com', 365)).toEqual(dailyPerformanceKey('a@b.com', 365));
    });

    it('keeps the prefix that mutations invalidate by', () => {
        // Several mutations call invalidateQueries({ queryKey:
        // ['portfolio-daily-performance'] }), which matches by prefix.
        expect(dailyPerformanceKey('a@b.com', 365)[0]).toBe('portfolio-daily-performance');
    });

    it('spells the signed-out identity one way', () => {
        // Previously 'anonymous' | 'demo' | 'anon' depending on the caller,
        // which split the demo-mode cache three ways.
        expect(dailyPerformanceKey(undefined, 365)).toEqual(dailyPerformanceKey(null, 365));
    });

    it('gives each span its own cached data', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const Consumer = ({ days, id }: { days: number; id: string }) => {
            const { data } = useQuery({
                queryKey: dailyPerformanceKey('a@b.com', days),
                queryFn: async () => `${days}-days-of-data`,
            });
            return <div data-testid={id}>{data ?? 'loading'}</div>;
        };

        render(
            <QueryClientProvider client={client}>
                <Consumer days={DAILY_PERFORMANCE_DAYS_DEFAULT} id="dashboard" />
                <Consumer days={DAILY_PERFORMANCE_DAYS_MAX} id="trend" />
            </QueryClientProvider>
        );

        // Under the old shared key the second consumer rendered the first's
        // payload; the trend page showed a year where it asked for five.
        await waitFor(() => {
            expect(screen.getByTestId('dashboard')).toHaveTextContent('365-days-of-data');
            expect(screen.getByTestId('trend')).toHaveTextContent('1825-days-of-data');
        });
    });
});
