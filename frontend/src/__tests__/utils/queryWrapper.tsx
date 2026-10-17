/**
 * A real QueryClient for tests.
 *
 * jest.setup.js no longer stubs @tanstack/react-query, so anything that calls
 * useQuery needs a provider. Give it a client per test — never a shared one, or
 * cached data leaks between cases and a passing test starts depending on the
 * one that ran before it.
 */

import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Retries off so a rejected queryFn surfaces immediately instead of after
 * backoff, and gcTime Infinity so nothing is collected mid-assertion.
 */
export const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });

/** Wrapper for renderHook. */
export const createQueryWrapper = (client: QueryClient = createQueryClient()) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    Wrapper.displayName = 'QueryWrapper';
    return Wrapper;
};

/** render() with a provider already in place. Returns the client for assertions. */
export const renderWithQuery = (
    ui: React.ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult & { queryClient: QueryClient } => {
    const queryClient = createQueryClient();
    const result = render(ui, { wrapper: createQueryWrapper(queryClient), ...options });
    return { ...result, queryClient };
};
