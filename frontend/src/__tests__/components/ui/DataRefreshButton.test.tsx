/**
 * The dashboard's top-bar refresh button.
 *
 * It used to `removeQueries` the very queries it wanted to refresh, then call
 * `invalidateQueries` to refetch them. A removed query is no longer in the
 * cache, so there was nothing left to invalidate: the matched queries never
 * refetched, and mounted components went on rendering their last data.
 *
 * The visible symptom was a dashboard that half-updated. Widgets whose keys the
 * predicate did NOT match (wallet-trends, income/spending-by-category) stayed in
 * the cache, got invalidated and refreshed; the portfolio mini-calendar, matched
 * by `portfolio`, was deleted and never re-fetched /portfolio/daily-performance.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { DataRefreshButton } from '@/components/ui/DataRefreshButton';

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: { success: jest.fn(), error: jest.fn() },
}));

/** A mounted consumer of the query the mini-calendar uses. */
function CalendarConsumer({ queryFn }: { queryFn: () => Promise<string> }) {
    const { data } = useQuery({
        queryKey: ['portfolio-daily-performance', 'user@example.com'],
        queryFn,
        // The dashboard's own settings — neither may excuse the button from
        // refetching, or "Refresh" silently does nothing.
        staleTime: 15 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });
    return <div data-testid="cal">{data ?? 'empty'}</div>;
}

const renderWith = (queryFn: () => Promise<string>) => {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    render(
        <QueryClientProvider client={client}>
            <CalendarConsumer queryFn={queryFn} />
            <DataRefreshButton />
        </QueryClientProvider>
    );
    return client;
};

describe('DataRefreshButton', () => {
    it('refetches the portfolio calendar query it claims to refresh', async () => {
        let call = 0;
        const queryFn = jest.fn(async () => `render-${++call}`);
        renderWith(queryFn);

        await screen.findByText('render-1');
        expect(queryFn).toHaveBeenCalledTimes(1);

        await userEvent.click(screen.getByRole('button'));

        // The regression: this stayed at 1, and the cell text never changed.
        await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
        await screen.findByText('render-2');
    });

    it('leaves the query in the cache instead of deleting it', async () => {
        const queryFn = jest.fn(async () => 'value');
        const client = renderWith(queryFn);

        await screen.findByText('value');
        await userEvent.click(screen.getByRole('button'));

        // removeQueries dropped the entry entirely, which is what left
        // invalidateQueries with nothing to refetch.
        await waitFor(() => {
            const entry = client.getQueryCache().find({
                queryKey: ['portfolio-daily-performance', 'user@example.com'],
            });
            expect(entry).toBeDefined();
        });
        expect(screen.getByTestId('cal')).toHaveTextContent('value');
    });
});
