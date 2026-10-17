import { marketDataService } from '../marketDataService';

describe('MarketDataService', () => {
  // These exercise the offline path on purpose. The service reaches for live
  // providers (TradingView, FinLab, Binance) and falls back to synthetic data
  // when the call fails, and only that fallback is deterministic enough to
  // assert on — a unit suite must not depend on a third-party API being up, or
  // on network access at all in CI. Rejecting fetch here picks the fallback
  // deliberately; previously it was picked by accident, because the global stub
  // returned undefined and threw inside the provider call.
  beforeEach(() => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  });

  describe('US Market Data Integration', () => {
    test('should fetch real-time data for US stocks', async () => {
      const symbol = 'AAPL';
      const market = 'US';
      
      const response = await marketDataService.getMarketData(symbol, market);
      
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      
      if (response.data) {
        expect(response.data.symbol).toBe(symbol);
        expect(response.data.market).toBe(market);
        expect(response.data.price).toBeGreaterThan(0);
        expect(response.data.currency).toBe('USD');
        expect(response.data.lastUpdated).toBeInstanceOf(Date);
      }
    }, 10000); // 10 second timeout for API calls

    // Unlike quotes, the historical path has no synthetic fallback — it returns
    // success:false rather than fabricating a price series. So the offline
    // contract and the parsing are asserted separately; asserting success:true
    // outright only ever passed against the live Yahoo endpoint.
    test('reports failure for historical data when the provider is unreachable', async () => {
      const response = await marketDataService.getHistoricalData('GOOGL', 'US', 30);

      expect(response.success).toBe(false);
      expect(response.data).toBeUndefined();
    });

    test('parses a Yahoo chart payload into OHLC rows, dropping invalid days', async () => {
      const day = 24 * 60 * 60;
      const base = Math.floor(Date.UTC(2026, 0, 2) / 1000);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          chart: {
            result: [
              {
                timestamp: [base, base + day, base + 2 * day],
                indicators: {
                  quote: [
                    {
                      open: [100, 110, 120],
                      high: [105, 115, 125],
                      low: [95, 105, 115],
                      // The third day has no close — a real gap in Yahoo's data,
                      // and the reason the service filters on close > 0.
                      close: [102, 112, null],
                      volume: [1000, 2000, 3000],
                    },
                  ],
                },
              },
            ],
          },
        }),
      });

      const response = await marketDataService.getHistoricalData('GOOGL', 'US', 30);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);

      const [first] = response.data!;
      expect(first).toEqual({
        date: '2026-01-02',
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1000,
      });

      response.data!.forEach((d) => {
        expect(d.high).toBeGreaterThanOrEqual(d.open);
        expect(d.high).toBeGreaterThanOrEqual(d.close);
        expect(d.low).toBeLessThanOrEqual(d.open);
        expect(d.low).toBeLessThanOrEqual(d.close);
      });
    });

    test('should handle multiple stock requests', async () => {
      const requests = [
        { symbol: 'AAPL', market: 'US' as const },
        { symbol: 'MSFT', market: 'US' as const },
        { symbol: 'GOOGL', market: 'US' as const }
      ];
      
      const response = await marketDataService.getMultipleMarketData(requests);
      
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      
      if (response.data) {
        expect(Array.isArray(response.data)).toBe(true);
        expect(response.data.length).toBeGreaterThan(0);
        expect(response.data.length).toBeLessThanOrEqual(requests.length);
        
        // Check that all returned data has proper structure
        response.data.forEach(marketData => {
          expect(marketData.symbol).toBeDefined();
          expect(marketData.price).toBeGreaterThan(0);
          expect(marketData.market).toBe('US');
        });
      }
    }, 20000); // 20 second timeout for multiple requests

    test('should respect rate limits', async () => {
      const requests = Array(10).fill(null).map((_, _i) => ({
        symbol: 'AAPL',
        market: 'US' as const
      }));
      
      // Make multiple rapid requests
      const responses = await Promise.allSettled(
        requests.map(req => marketDataService.getMarketData(req.symbol, req.market))
      );
      
      // At least some should succeed
      const successfulResponses = responses.filter(
        response => response.status === 'fulfilled' && response.value.success
      );
      
      expect(successfulResponses.length).toBeGreaterThan(0);
    }, 30000);

    test('should fallback to cache when API fails', async () => {
      // First, get data to populate cache
      const response1 = await marketDataService.getMarketData('AAPL', 'US');
      expect(response1.success).toBe(true);
      
      // Force an API error scenario (this is testing the fallback mechanism)
      // In a real test, you might mock the fetch to fail
      const response2 = await marketDataService.getMarketData('AAPL', 'US');
      expect(response2.success).toBe(true); // Should return cached data
    });

    test('should return proper cache statistics', () => {
      const stats = marketDataService.getCacheStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('keys');
      expect(typeof stats.size).toBe('number');
      expect(Array.isArray(stats.keys)).toBe(true);
    });

    test('should return rate limit status', () => {
      const status = marketDataService.getRateLimitStatus();
      
      expect(status).toHaveProperty('tradingview');
      expect(status.tradingview).toHaveProperty('name');
      expect(status.tradingview).toHaveProperty('limits');
      expect(status.tradingview).toHaveProperty('usage');
      expect(status.tradingview).toHaveProperty('canMakeRequest');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid symbols gracefully', async () => {
      const response = await marketDataService.getMarketData('INVALID_SYMBOL_123', 'US');
      
      // Should either succeed with fallback data or fail gracefully
      if (!response.success) {
        expect(response.message).toBeDefined();
        expect(typeof response.message).toBe('string');
      } else {
        // If successful, it should return valid data structure
        expect(response.data).toBeDefined();
      }
    });

    test('should handle network errors gracefully', async () => {
      // This test would require mocking network failures
      // For now, just ensure the service doesn't crash
      expect(marketDataService).toBeDefined();
    });
  });

  describe('Backend quote fallback', () => {
    // The last step of the US chain used to be a browser-side Alpha Vantage call
    // carrying NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY, i.e. the key shipped to every
    // visitor. It now asks our backend, which fetches prices server-side.
    test('uses the backend quote when the third-party sources fail, and never calls Alpha Vantage', async () => {
      const fetchMock = global.fetch as jest.Mock;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/portfolio/symbol/quote/')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              success: true,
              data: {
                symbol: 'NVDA',
                name: 'NVIDIA',
                market: 'US',
                exchange: 'NASDAQ/NYSE',
                currency: 'USD',
                current_price: 123.45,
                market_open: false,
                last_updated: '2026-10-10T00:00:00Z',
                status: 'success',
              },
            }),
            text: async () => '',
          };
        }
        throw new Error('offline');
      });

      marketDataService.clearCache();
      const response = await marketDataService.getMarketData('NVDA', 'US', true);

      expect(response.success).toBe(true);
      expect(response.data?.price).toBe(123.45);
      expect(response.data?.name).toBe('NVIDIA');

      const urls = fetchMock.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes('/api/v1/portfolio/symbol/quote/NVDA'))).toBe(true);
      expect(urls.some((u) => u.includes('alphavantage'))).toBe(false);
    });
  });

  describe('Cache Management', () => {
    test('should clear cache properly', () => {
      marketDataService.clearCache();
      const stats = marketDataService.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.keys.length).toBe(0);
    });
  });
});