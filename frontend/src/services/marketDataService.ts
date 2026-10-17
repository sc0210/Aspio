import { MarketData, MarketDataCache, MarketDataProvider, StockQuote, MarketType, ApiResponse } from '@/shared/types';
import symbolService from './symbolService';

/**
 * Whether a provider actually returned a quote we can use.
 *
 * The provider helpers resolve to {} instead of throwing when a request fails,
 * so presence alone says nothing — a price is what makes a quote real. A zero
 * or non-finite price is treated as a miss so the caller falls through to the
 * next provider rather than publishing a 0 into portfolio valuations.
 */
function hasUsablePrice(quote: Partial<StockQuote> | null | undefined): boolean {
  return typeof quote?.price === 'number' && Number.isFinite(quote.price) && quote.price > 0;
}

class MarketDataService {
  private cache = new Map<string, MarketDataCache>();
  private providers: Map<string, MarketDataProvider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    // TradingView API for US stocks
    this.providers.set('tradingview', {
      name: 'TradingView',
      type: 'tradingview',
      markets: ['US'],
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 3000,
        requestsPerDay: 50000
      },
      requestCount: {
        minute: 0,
        hour: 0,
        day: 0
      }
    });

    // FinLab API for Taiwan stocks
    this.providers.set('finlab', {
      name: 'FinLab',
      type: 'finlab',
      markets: ['TW'],
      rateLimit: {
        requestsPerMinute: 30,
        requestsPerHour: 1000,
        requestsPerDay: 10000
      },
      requestCount: {
        minute: 0,
        hour: 0,
        day: 0
      }
    });

    // Binance API for crypto
    this.providers.set('binance', {
      name: 'Binance',
      type: 'binance',
      markets: ['CRYPTO'],
      rateLimit: {
        requestsPerMinute: 1200,
        requestsPerHour: 50000,
        requestsPerDay: 1000000
      },
      requestCount: {
        minute: 0,
        hour: 0,
        day: 0
      }
    });
  }

  private getCacheKey(symbol: string, market: MarketType): string {
    return `${market}:${symbol.toUpperCase()}`;
  }

  private isDataFresh(cachedData: MarketDataCache): boolean {
    return new Date() < cachedData.expiresAt;
  }

  private getCachedData(symbol: string, market: MarketType): MarketData | null {
    const cacheKey = this.getCacheKey(symbol, market);
    const cached = this.cache.get(cacheKey);

    if (cached && this.isDataFresh(cached)) {
      return cached.data;
    }

    // Remove expired cache
    if (cached) {
      this.cache.delete(cacheKey);
    }

    return null;
  }

  private setCachedData(symbol: string, market: MarketType, data: MarketData, ttlMinutes: number = 60): void {
    const cacheKey = this.getCacheKey(symbol, market);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlMinutes * 60 * 1000));

    this.cache.set(cacheKey, {
      symbol,
      market,
      data,
      cachedAt: now,
      expiresAt
    });
  }

  private canMakeRequest(providerKey: string): boolean {
    const provider = this.providers.get(providerKey);
    if (!provider) return false;

    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Reset counters if time windows have passed
    if (provider.lastRequestAt && provider.lastRequestAt < oneMinuteAgo) {
      provider.requestCount.minute = 0;
    }
    if (provider.lastRequestAt && provider.lastRequestAt < oneHourAgo) {
      provider.requestCount.hour = 0;
    }
    if (provider.lastRequestAt && provider.lastRequestAt < oneDayAgo) {
      provider.requestCount.day = 0;
    }

    // Check rate limits
    return (
      provider.requestCount.minute < provider.rateLimit.requestsPerMinute &&
      provider.requestCount.hour < provider.rateLimit.requestsPerHour &&
      provider.requestCount.day < provider.rateLimit.requestsPerDay
    );
  }

  private incrementRequestCount(providerKey: string): void {
    const provider = this.providers.get(providerKey);
    if (!provider) return;

    provider.requestCount.minute++;
    provider.requestCount.hour++;
    provider.requestCount.day++;
    provider.lastRequestAt = new Date();
  }

  private async fetchFromTradingView(symbol: string): Promise<MarketData> {
    const providerKey = 'tradingview';

    if (!this.canMakeRequest(providerKey)) {
      throw new Error('TradingView API rate limit exceeded');
    }

    try {
      // Use TradingView's public API via proxy or direct API calls
      const response = await this.callTradingViewAPI(symbol);
      this.incrementRequestCount(providerKey);

      return {
        symbol,
        name: response.name || '',
        price: response.price || 0,
        change: response.change || 0,
        changePercent: response.changePercent || 0,
        volume: response.volume || 0,
        marketCap: response.marketCap,
        market: 'US',
        currency: 'USD',
        exchange: response.exchange || 'NASDAQ',
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('TradingView API error:', error);
      // Fallback to mock data if real API fails
      const response = await this.mockTradingViewAPI(symbol);
      return {
        symbol,
        name: response.name || '',
        price: response.price || 0,
        change: response.change || 0,
        changePercent: response.changePercent || 0,
        volume: response.volume || 0,
        marketCap: response.marketCap,
        market: 'US',
        currency: 'USD',
        exchange: response.exchange || 'NASDAQ',
        lastUpdated: new Date()
      };
    }
  }

  private async fetchFromFinLab(symbol: string): Promise<MarketData> {
    const providerKey = 'finlab';

    if (!this.canMakeRequest(providerKey)) {
      throw new Error('FinLab API rate limit exceeded');
    }

    try {
      // FinLab API call - in real implementation, use their REST API
      // For now, we'll use a mock implementation with demo data
      const response = await this.mockFinLabAPI(symbol);
      this.incrementRequestCount(providerKey);

      return {
        symbol,
        name: response.name || '',
        price: response.price || 0,
        change: response.change || 0,
        changePercent: response.changePercent || 0,
        volume: response.volume || 0,
        market: 'TW',
        currency: 'TWD',
        exchange: 'TWSE',
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('FinLab API error:', error);
      throw new Error('Failed to fetch Taiwan market data');
    }
  }

  private async fetchFromBinance(symbol: string): Promise<MarketData> {
    const providerKey = 'binance';

    if (!this.canMakeRequest(providerKey)) {
      throw new Error('Binance API rate limit exceeded');
    }

    try {
      // Binance public API call
      const binanceSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
      const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`);

      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }

      const data = await response.json();
      this.incrementRequestCount(providerKey);

      return {
        symbol: data.symbol,
        name: data.symbol.replace('USDT', ''),
        price: parseFloat(data.lastPrice),
        change: parseFloat(data.priceChange),
        changePercent: parseFloat(data.priceChangePercent),
        volume: parseFloat(data.volume),
        market: 'CRYPTO',
        currency: 'USDT',
        exchange: 'Binance',
        lastUpdated: new Date(data.closeTime)
      };
    } catch (error) {
      console.error('Binance API error:', error);
      // Fallback to mock data if API fails
      return this.mockCryptoAPI(symbol);
    }
  }

  // Real TradingView API implementation
  private async callTradingViewAPI(symbol: string): Promise<Partial<StockQuote>> {
    try {
      // Each helper below returns {} when its request fails. {} is truthy, so a
      // plain `if (response)` accepted that empty object as a successful quote:
      // the first failing provider short-circuited the chain, Yahoo and Alpha
      // Vantage were never tried, 'All API sources failed' never threw, and the
      // caller's mock-data fallback never ran. The result was a quote reported
      // as successful with price 0 — which then flows into portfolio valuations.
      // Only accept a quote that actually carries a usable price.

      // Method 1: Use TradingView's quote API (public endpoint)
      const quoteResponse = await this.fetchTradingViewQuote(symbol);
      if (hasUsablePrice(quoteResponse)) return quoteResponse;

      // Method 2: Use Yahoo Finance as TradingView alternative (more reliable)
      const yahooResponse = await this.fetchYahooFinanceData(symbol);
      if (hasUsablePrice(yahooResponse)) return yahooResponse;

      // Method 3: our backend's server-side quote (replaced a browser-side Alpha
      // Vantage call that exposed its API key)
      const backendResponse = await this.fetchBackendQuote(symbol);
      if (hasUsablePrice(backendResponse)) return backendResponse;

      throw new Error('All API sources failed');
    } catch (error) {
      console.error('TradingView API call failed:', error);
      throw error;
    }
  }

  private async fetchTradingViewQuote(symbol: string): Promise<Partial<StockQuote>> {
    try {
      // TradingView doesn't have a public REST API, but we can use their WebSocket or scraping
      // For now, we'll use a CORS proxy to access their chart data
      const proxyUrl = 'https://api.allorigins.win/raw?url=';
      const tradingViewUrl = `https://scanner.tradingview.com/symbol?symbol=NASDAQ:${symbol.toUpperCase()}`;

      const response = await fetch(proxyUrl + encodeURIComponent(tradingViewUrl));

      if (!response.ok) {
        throw new Error(`TradingView API error: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.market_cap) {
        return {
          name: data.description || `${symbol.toUpperCase()} Corp.`,
          price: data.close || data.lp,
          change: data.change,
          changePercent: data.change_pct,
          volume: data.volume,
          marketCap: data.market_cap,
          exchange: data.exchange || 'NASDAQ'
        };
      }

      throw new Error('Invalid TradingView response');
    } catch (error) {
      console.warn('TradingView direct API failed:', error);
      return {};
    }
  }

  private async fetchYahooFinanceData(symbol: string): Promise<Partial<StockQuote>> {
    try {
      // Yahoo Finance API (free tier available)
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}`;

      const response = await fetch(yahooUrl);

      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status}`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (result && result.meta) {
        const meta = result.meta;
        const currentPrice = meta.regularMarketPrice || meta.previousClose;
        const previousClose = meta.previousClose;
        const change = currentPrice - previousClose;
        const changePercent = (change / previousClose) * 100;

        return {
          name: meta.longName || meta.shortName || `${symbol.toUpperCase()} Corp.`,
          price: currentPrice,
          change: change,
          changePercent: changePercent,
          volume: meta.regularMarketVolume,
          marketCap: meta.marketCap,
          exchange: meta.exchangeName || 'NASDAQ'
        };
      }

      throw new Error('Invalid Yahoo Finance response');
    } catch (error) {
      console.warn('Yahoo Finance API failed:', error);
      return {};
    }
  }

  /**
   * Our own backend's quote (`GET /portfolio/symbol/quote/{symbol}`).
   *
   * This step used to call Alpha Vantage straight from the browser with
   * NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY — which shipped the key to every visitor.
   * The backend already fetches live prices server-side, so ask it instead.
   * It returns price only; change/volume stay unset, and the one caller that
   * consumes this chain (portfolioService.updateHoldingsPrices) reads only price.
   */
  private async fetchBackendQuote(symbol: string): Promise<Partial<StockQuote>> {
    try {
      const quote = await symbolService.getQuote(symbol.toUpperCase(), 'US');
      if (quote?.status === 'success' && quote.current_price) {
        return {
          name: quote.name || `${symbol.toUpperCase()} Corp.`,
          price: quote.current_price,
          exchange: quote.exchange || 'NASDAQ',
        };
      }
      throw new Error('Backend quote returned no price');
    } catch (error) {
      console.warn('Backend quote failed:', error);
      return {};
    }
  }

  // Historical data fetching for US stocks
  async getHistoricalData(symbol: string, market: MarketType, days: number = 365): Promise<ApiResponse<Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>> {
    try {
      if (market === 'US') {
        return await this.fetchUSHistoricalData(symbol, days);
      } else {
        return {
          success: false,
          message: `Historical market data is not available for ${market} in this endpoint`
        };
      }
    } catch (error) {
      console.error('Historical data fetch error:', error);
      return {
        success: false,
        message: 'Failed to fetch historical data'
      };
    }
  }

  private async fetchUSHistoricalData(symbol: string, days: number): Promise<ApiResponse<Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>> {
    try {
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const period1 = Math.floor(startDate.getTime() / 1000);
      const period2 = Math.floor(endDate.getTime() / 1000);

      // Yahoo Finance historical data API
      const yahooHistUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?period1=${period1}&period2=${period2}&interval=1d`;

      const response = await fetch(yahooHistUrl);

      if (!response.ok) {
        throw new Error(`Yahoo Finance historical API error: ${response.status}`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (result && result.timestamp && result.indicators?.quote?.[0]) {
        const timestamps = result.timestamp;
        const quote = result.indicators.quote[0];

        const historicalData = timestamps.map((timestamp: number, index: number) => ({
          date: new Date(timestamp * 1000).toISOString().split('T')[0],
          open: quote.open[index] || 0,
          high: quote.high[index] || 0,
          low: quote.low[index] || 0,
          close: quote.close[index] || 0,
          volume: quote.volume[index] || 0
        })).filter((day: { close: number }) => day.close > 0); // Filter out invalid data points

        return {
          success: true,
          data: historicalData,
          message: `Retrieved ${historicalData.length} days of historical data for ${symbol}`
        };
      }

      throw new Error('Invalid Yahoo Finance historical response');
    } catch (error) {
      console.error('US historical data fetch error:', error);
      return {
        success: false,
        message: `Failed to fetch US historical data for ${symbol}`
      };
    }
  }

  // Mock API implementations for development/demo
  private async mockTradingViewAPI(symbol: string): Promise<Partial<StockQuote>> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

    const stocks: Record<string, { name: string; basePrice: number; exchange?: string }> = {
      'AAPL': { name: 'Apple Inc.', basePrice: 175.50, exchange: 'NASDAQ' },
      'GOOGL': { name: 'Alphabet Inc.', basePrice: 142.80, exchange: 'NASDAQ' },
      'MSFT': { name: 'Microsoft Corporation', basePrice: 378.85, exchange: 'NASDAQ' },
      'TSLA': { name: 'Tesla, Inc.', basePrice: 248.42, exchange: 'NASDAQ' },
      'NVDA': { name: 'NVIDIA Corporation', basePrice: 875.28, exchange: 'NASDAQ' },
      'AMZN': { name: 'Amazon.com, Inc.', basePrice: 145.86, exchange: 'NASDAQ' },
    };

    const stock = stocks[symbol.toUpperCase()] || {
      name: `${symbol.toUpperCase()} Corp.`,
      basePrice: Math.random() * 200 + 50,
      exchange: 'NYSE'
    };

    const changePercent = (Math.random() - 0.5) * 10; // -5% to +5%
    const price = stock.basePrice * (1 + changePercent / 100);
    const change = price - stock.basePrice;

    return {
      name: stock.name,
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      volume: Math.floor(Math.random() * 10000000) + 1000000,
      marketCap: Math.floor(Math.random() * 1000000000000) + 100000000000,
      exchange: stock.exchange
    };
  }

  private async mockFinLabAPI(symbol: string): Promise<Partial<StockQuote>> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 300));

    const stocks: Record<string, { name: string; basePrice: number }> = {
      '2330': { name: '台積電', basePrice: 580.00 },
      '2317': { name: '鴻海', basePrice: 108.50 },
      '2454': { name: '聯發科', basePrice: 1015.00 },
      '2881': { name: '富邦金', basePrice: 75.20 },
      '0050': { name: '元大台灣50', basePrice: 138.45 },
      '2382': { name: '廣達', basePrice: 185.50 },
    };

    const stock = stocks[symbol] || {
      name: `${symbol}股份有限公司`,
      basePrice: Math.random() * 500 + 50
    };

    const changePercent = (Math.random() - 0.5) * 8; // -4% to +4%
    const price = stock.basePrice * (1 + changePercent / 100);
    const change = price - stock.basePrice;

    return {
      name: stock.name,
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      volume: Math.floor(Math.random() * 50000000) + 5000000
    };
  }

  private async mockCryptoAPI(symbol: string): Promise<MarketData> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 200));

    const cryptos: Record<string, { name: string; basePrice: number }> = {
      'BTC': { name: 'Bitcoin', basePrice: 43500.00 },
      'ETH': { name: 'Ethereum', basePrice: 2650.00 },
      'BNB': { name: 'Binance Coin', basePrice: 315.80 },
      'ADA': { name: 'Cardano', basePrice: 0.485 },
      'SOL': { name: 'Solana', basePrice: 98.75 },
      'DOGE': { name: 'Dogecoin', basePrice: 0.085 },
    };

    const crypto = cryptos[symbol.toUpperCase()] || {
      name: symbol.toUpperCase(),
      basePrice: Math.random() * 1000 + 0.1
    };

    const changePercent = (Math.random() - 0.5) * 15; // -7.5% to +7.5%
    const price = crypto.basePrice * (1 + changePercent / 100);
    const change = price - crypto.basePrice;

    return {
      symbol: symbol.toUpperCase(),
      name: crypto.name,
      price: price < 1 ? Math.round(price * 10000) / 10000 : Math.round(price * 100) / 100,
      change: change < 1 ? Math.round(change * 10000) / 10000 : Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      volume: Math.floor(Math.random() * 1000000000) + 100000000,
      market: 'CRYPTO',
      currency: 'USDT',
      exchange: 'Binance',
      lastUpdated: new Date()
    };
  }

  async getMarketData(symbol: string, market: MarketType, forceRefresh: boolean = false): Promise<ApiResponse<MarketData>> {
    try {
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = this.getCachedData(symbol, market);
        if (cached) {
          return {
            success: true,
            data: cached,
            message: 'Market data retrieved from cache'
          };
        }
      }

      let marketData: MarketData;

      switch (market) {
        case 'US':
          marketData = await this.fetchFromTradingView(symbol);
          break;
        case 'TW':
          marketData = await this.fetchFromFinLab(symbol);
          break;
        case 'CRYPTO':
          marketData = await this.fetchFromBinance(symbol);
          break;
        default:
          throw new Error(`Unsupported market: ${market}`);
      }

      // Cache the data (24 hours for daily updates, but allow 1-hour TTL for better UX)
      this.setCachedData(symbol, market, marketData, 60);

      return {
        success: true,
        data: marketData,
        message: 'Market data retrieved successfully'
      };
    } catch (error) {
      console.error(`Market data service error for ${symbol} (${market}):`, error);

      // Return cached data if available, even if expired
      const cacheKey = this.getCacheKey(symbol, market);
      const expired = this.cache.get(cacheKey);

      if (expired) {
        return {
          success: true,
          data: expired.data,
          message: 'Using cached data due to API error'
        };
      }

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch market data'
      };
    }
  }

  async getMultipleMarketData(requests: { symbol: string; market: MarketType }[]): Promise<ApiResponse<MarketData[]>> {
    try {
      const results = await Promise.allSettled(
        requests.map(req => this.getMarketData(req.symbol, req.market))
      );

      const marketDataList: MarketData[] = [];
      const errors: string[] = [];

      results.forEach((result, index) => {
        const { symbol, market } = requests[index];

        if (result.status === 'fulfilled' && result.value.success && result.value.data) {
          marketDataList.push(result.value.data);
        } else {
          const error = result.status === 'rejected'
            ? result.reason
            : result.value.message || 'Unknown error';
          errors.push(`${symbol} (${market}): ${error}`);
        }
      });

      return {
        success: marketDataList.length > 0,
        data: marketDataList,
        message: marketDataList.length === requests.length
          ? 'All market data retrieved successfully'
          : `Retrieved ${marketDataList.length}/${requests.length} market data`,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch {
      return {
        success: false,
        message: 'Failed to fetch multiple market data'
      };
    }
  }

  async searchStocks(query: string, market: MarketType): Promise<ApiResponse<StockQuote[]>> {
    // Mock search implementation - in production, use respective APIs' search endpoints
    const mockResults = await this.mockSearchAPI(query, market);

    return {
      success: true,
      data: mockResults,
      message: `Found ${mockResults.length} results for "${query}"`
    };
  }

  private async mockSearchAPI(query: string, market: MarketType): Promise<StockQuote[]> {
    await new Promise(resolve => setTimeout(resolve, 300));

    const searchResults: Record<MarketType, StockQuote[]> = {
      'US': [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          price: 175.50,
          change: 2.15,
          changePercent: 1.24,
          volume: 45678901,
          open: 174.20,
          high: 176.80,
          low: 173.90,
          close: 175.50,
          previousClose: 173.35,
          marketCap: 2750000000000,
          pe: 28.5,
          dividendYield: 0.52,
          market: 'US',
          currency: 'USD',
          exchange: 'NASDAQ',
          lastUpdated: new Date()
        }
      ],
      'TW': [
        {
          symbol: '2330',
          name: '台積電',
          price: 580.00,
          change: 8.00,
          changePercent: 1.40,
          volume: 23456789,
          open: 575.00,
          high: 585.00,
          low: 574.00,
          close: 580.00,
          previousClose: 572.00,
          marketCap: 15000000000000,
          pe: 18.2,
          dividendYield: 2.1,
          market: 'TW',
          currency: 'TWD',
          exchange: 'TWSE',
          lastUpdated: new Date()
        }
      ],
      'CRYPTO': [
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          price: 43500.00,
          change: 1250.00,
          changePercent: 2.96,
          volume: 28900000000,
          open: 42800.00,
          high: 44200.00,
          low: 42500.00,
          close: 43500.00,
          previousClose: 42250.00,
          market: 'CRYPTO',
          currency: 'USDT',
          exchange: 'Binance',
          lastUpdated: new Date()
        }
      ],
      'HK': [],
      'SG': [],
      'JP': []
    };

    return searchResults[market].filter(stock =>
      stock.symbol.toLowerCase().includes(query.toLowerCase()) ||
      stock.name.toLowerCase().includes(query.toLowerCase())
    );
  }

  getRateLimitStatus(): Record<string, unknown> {
    const status: Record<string, unknown> = {};

    this.providers.forEach((provider, key) => {
      status[key] = {
        name: provider.name,
        limits: provider.rateLimit,
        usage: provider.requestCount,
        lastRequest: provider.lastRequestAt,
        canMakeRequest: this.canMakeRequest(key)
      };
    });

    return status;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

export const marketDataService = new MarketDataService();