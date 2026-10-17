'use client';

import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { DemoProvider } from '@/contexts/DemoContext';
import { I18nProvider } from '@/components/providers/I18nProvider';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthContextProvider } from '@/contexts/AuthContext';
import { ApiClientProvider } from '@/components/providers/ApiClientProvider';
import { SessionInitProvider } from '@/components/providers/SessionInitProvider';
import { AuthSyncProvider } from '@/components/providers/AuthSyncProvider';
import { DataSyncErrorBoundary } from '@/components/errors/DataSyncErrorBoundary';
import { PrivacyProvider } from '@/contexts/PrivacyContext';
import { ExchangeRatesLoader } from '@/components/providers/ExchangeRatesLoader';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes — data is fresh for 5 min after last fetch
            // gcTime must be strictly greater than staleTime so cached (but stale) data
            // is still available while a background refetch is in-flight.
            gcTime: 1000 * 60 * 30, // 30 minutes — keep unused cache entries for 30 min
            refetchOnWindowFocus: false, // Disable refetch on window focus to reduce API calls
            // Keep refetchOnMount: true (the default) so navigating back to a page
            // re-fetches data that has become stale, rather than showing stale data forever.
            refetchOnMount: true,
            // On by default. With refetchOnWindowFocus off, a tab that loses
            // the network had no way back to fresh data short of a reload:
            // the Refresh button is manual, and staleTime alone only marks
            // data stale, it does not refetch what is already on screen.
            // Reconnect is the one passive signal that something was missed.
            refetchOnReconnect: true,
            retry: (failureCount: number, error: unknown) => {
              // Don't retry on 4xx errors (client errors)
              const e = error as { response?: { status?: number } };
              if (e?.response?.status !== undefined && e.response.status >= 400 && e.response.status < 500) {
                return false;
              }
              // Only retry once for 5xx errors (server errors)
              return failureCount < 1;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  // Pause refetching when tab is hidden to save resources
  useEffect(() => {
    const handleVisibilityChange = () => {
      focusManager.setFocused(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider refetchInterval={0} refetchOnWindowFocus={false} refetchWhenOffline={false}>
        <ThemeProvider>
          <I18nProvider>
            <DemoProvider>
              <AuthContextProvider>
                <ApiClientProvider>
                  <PrivacyProvider>
                    <DataSyncErrorBoundary queryClient={queryClient}>
                      <SessionInitProvider>
                        <AuthSyncProvider>
                          {/* Fills toTWD's rate table once. Renders nothing;
                              inside QueryClientProvider because it fetches. */}
                          <ExchangeRatesLoader />
                          {children}
                        </AuthSyncProvider>
                      </SessionInitProvider>
                    </DataSyncErrorBoundary>
                  </PrivacyProvider>
                </ApiClientProvider>
              </AuthContextProvider>
            </DemoProvider>
          </I18nProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}