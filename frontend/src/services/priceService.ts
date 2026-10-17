import { apiClient } from '@/lib/api-client';
import { StockQuote } from '@/shared/types';

/**
 * Lightweight wrapper to call backend bulk prices endpoint.
 * Returns a mapping of symbol -> StockQuote | null
 */
export const priceService = {
    async getLatestPricesBulk(symbols: string[]): Promise<Record<string, StockQuote | null>> {
        if (!symbols || symbols.length === 0) return {};

        // Backend expects a comma-separated symbols param
        const params = new URLSearchParams();
        params.append('symbols', symbols.join(','));

        const response = await apiClient.get<{ prices: Record<string, StockQuote | null>; cached: boolean }>(`/prices/bulk?${params.toString()}`);
        return (response.data as { prices?: Record<string, StockQuote | null> })?.prices || {};
    }
};
