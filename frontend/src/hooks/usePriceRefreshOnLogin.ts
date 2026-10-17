'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { portfolioService } from '@/services/portfolioService';
import { log } from '@/utils/logger';

/**
 * Hook to check if user just logged in and trigger price cache update.
 * This ensures latest prices are fetched as soon as possible after login.
 */
export function usePriceRefreshOnLogin() {
    const { data: session, status } = useSession();

    useEffect(() => {
        // Only run when session is authenticated AND has access token
        // This prevents race condition where API call happens before token is set
        if (status !== 'authenticated' || !session?.user?.id || !session?.accessToken) {
            if (status === 'authenticated' && session?.user?.id && !session?.accessToken) {
                log.warn(
                    'Session authenticated but access token not yet available',
                    { userId: session.user.id },
                    'usePriceRefreshOnLogin'
                );
            }
            return;
        }

        // Add a small delay to ensure API client is fully initialized with the token
        const timer = setTimeout(() => {
            // Check if this is a fresh login by looking at session storage
            const lastLoginCheckKey = `last_login_check_${session.user.id}`;
            const lastCheckTime = sessionStorage.getItem(lastLoginCheckKey);
            const now = Date.now();
            const refreshInterval = 60 * 60 * 1000; // Check only once per hour

            // Skip if we've already checked recently
            if (lastCheckTime && now - parseInt(lastCheckTime) < refreshInterval) {
                return;
            }

            // Mark that we've checked
            sessionStorage.setItem(lastLoginCheckKey, now.toString());

            // Trigger price refresh with cache check
            (async () => {
                try {
                    log.info(
                        `Checking price cache on login for user ${session.user.id}`,
                        undefined,
                        'usePriceRefreshOnLogin'
                    );

                    // First, check if we have cached prices
                    const hasCachedPrices = localStorage.getItem('aspiro_portfolio_prices_cache');

                    // If no cache or cache is stale, refresh prices
                    if (!hasCachedPrices) {
                        log.info(
                            'No cached prices found, refreshing prices on login',
                            undefined,
                            'usePriceRefreshOnLogin'
                        );

                        // Refresh with force=false to use backend cache first
                        const result = await portfolioService.refreshPortfolioPrices(false);

                        if (result.success && result.data) {
                            log.info(
                                `Price cache updated on login: ${result.data.updated} updated, ${result.data.cached} cached`,
                                undefined,
                                'usePriceRefreshOnLogin'
                            );
                        } else {
                            log.warn(
                                'Failed to refresh prices on login',
                                result.message,
                                'usePriceRefreshOnLogin'
                            );
                        }
                    } else {
                        log.info(
                            'Cached prices found, updating prices in background',
                            undefined,
                            'usePriceRefreshOnLogin'
                        );

                        // If cache exists but might be stale, refresh in background (non-blocking)
                        // Use a small timeout to allow page to render first
                        setTimeout(() => {
                            portfolioService.refreshPortfolioPrices(false).catch((error) => {
                                log.warn(
                                    'Background price refresh failed',
                                    error,
                                    'usePriceRefreshOnLogin'
                                );
                            });
                        }, 2000);
                    }
                } catch (error) {
                    log.error(
                        'Error refreshing prices on login',
                        error,
                        'usePriceRefreshOnLogin'
                    );
                }
            })();
        }, 500); // 500ms delay to ensure API client is initialized

        return () => clearTimeout(timer);
    }, [session?.user?.id, session?.accessToken, status]);
}
