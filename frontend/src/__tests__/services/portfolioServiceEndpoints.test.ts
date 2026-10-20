/**
 * portfolioService methods that talk to one endpoint each: the mapping from the
 * backend's snake_case (and Decimal-as-string) payloads to what the UI reads, and
 * what each method does when the call fails — some rethrow, some degrade to null
 * so a card can hide itself. A mapping slip here renders as a blank or NaN figure,
 * not an error, so it is asserted field by field.
 */
import { portfolioService } from '@/services/portfolioService';
import { apiClient } from '@/lib/api-client';
import { getSession } from 'next-auth/react';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/services/marketDataService', () => ({
  marketDataService: {
    getMultipleMarketData: jest.fn().mockResolvedValue({ success: false, data: [] }),
  },
}));

jest.mock('@/services/priceService', () => ({
  priceService: { getLatestPricesBulk: jest.fn() },
}));

jest.mock('next-auth/react', () => ({
  getSession: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/api-url', () => ({
  getPublicApiUrl: () => 'https://api.test/api/v1',
}));

const api = apiClient as jest.Mocked<typeof apiClient>;
const mockGetSession = getSession as jest.Mock;

const DEMO_HOLDINGS_KEY = 'aspiro_demo_holdings';
const DEMO_PORTFOLIO_KEY = 'aspiro_demo_portfolio';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockGetSession.mockResolvedValue(null);
});

describe('updateHolding', () => {
  it('sends snake_case keys, drops undefined fields, and normalises the reply', async () => {
    api.put.mockResolvedValue({
      success: true,
      // Pydantic serialises Decimal as a string; the normaliser must parse it.
      data: { id: 'h1', symbol: '0050', quantity: '10', average_cost: '100.5', current_price: '120' },
    });

    const result = await portfolioService.updateHolding({
      id: 'h1',
      quantity: 10,
      averageCost: 100.5,
      purchaseDate: '2026-01-02',
      currentPrice: undefined,
    } as Parameters<typeof portfolioService.updateHolding>[0]);

    expect(api.put).toHaveBeenCalledWith('/portfolio/holdings/h1', {
      quantity: 10,
      average_cost: 100.5,
      purchase_date: '2026-01-02',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'h1',
      quantity: 10,
      averageCost: 100.5,
      currentPrice: 120,
      totalValue: 1200,
      totalCost: 1005,
    });
    expect(typeof result.data!.totalValue).toBe('number');
  });

  it('accepts the legacy { holding } envelope', async () => {
    api.put.mockResolvedValue({ success: true, holding: { id: 'h1', quantity: 2, average_cost: 5 } } as never);

    const result = await portfolioService.updateHolding({ id: 'h1', quantity: 2 } as never);

    expect(result.data).toMatchObject({ id: 'h1', quantity: 2, averageCost: 5, currentPrice: 5 });
  });

  it('passes an unsuccessful envelope through untouched', async () => {
    const failure = { success: false, message: 'nope' };
    api.put.mockResolvedValue(failure);

    await expect(portfolioService.updateHolding({ id: 'h1', quantity: 1 } as never)).resolves.toBe(failure);
  });

  it('rethrows for a real holding when the request fails', async () => {
    api.put.mockRejectedValue(new Error('500'));

    await expect(portfolioService.updateHolding({ id: 'h1', quantity: 1 } as never)).rejects.toThrow('500');
  });

  it('updates a demo holding in localStorage and recomputes value and gain', async () => {
    const demo = {
      id: 'demo-holding-1', symbol: 'VT', quantity: 1, averageCost: 100, currentPrice: 100,
      totalValue: 100, gainLoss: 0, gainLossPercentage: 0, currency: 'TWD',
    };
    localStorage.setItem(DEMO_HOLDINGS_KEY, JSON.stringify([demo]));
    localStorage.setItem(DEMO_PORTFOLIO_KEY, JSON.stringify({ id: 'p', holdings: [demo] }));
    api.put.mockRejectedValue(new Error('401'));

    const result = await portfolioService.updateHolding({
      id: 'demo-holding-1', quantity: 2, currentPrice: 150,
    } as never);

    expect(result.data).toMatchObject({ quantity: 2, totalValue: 300, gainLoss: 100, gainLossPercentage: 50 });
    const stored = JSON.parse(localStorage.getItem(DEMO_HOLDINGS_KEY)!);
    expect(stored[0]).toMatchObject({ quantity: 2, totalValue: 300 });
    expect(JSON.parse(localStorage.getItem(DEMO_PORTFOLIO_KEY)!).holdings[0].quantity).toBe(2);
  });

  it('reports 0% gain rather than dividing by a zero cost basis', async () => {
    const demo = { id: 'demo-holding-1', quantity: 1, averageCost: 0, currentPrice: 10, currency: 'TWD' };
    localStorage.setItem(DEMO_HOLDINGS_KEY, JSON.stringify([demo]));
    api.put.mockRejectedValue(new Error('401'));

    const result = await portfolioService.updateHolding({ id: 'demo-holding-1', quantity: 3 } as never);

    expect(result.data!.gainLossPercentage).toBe(0);
    expect(result.data!.totalValue).toBe(30);
  });
});

describe('deleteHolding', () => {
  it('deletes through the API', async () => {
    api.delete.mockResolvedValue({ success: true });

    await expect(portfolioService.deleteHolding('h1')).resolves.toMatchObject({ success: true });
    expect(api.delete).toHaveBeenCalledWith('/portfolio/holdings/h1');
  });

  it('removes a demo holding from localStorage when the API refuses', async () => {
    localStorage.setItem(DEMO_HOLDINGS_KEY, JSON.stringify([
      { id: 'demo-holding-1', quantity: 1, currentPrice: 1, averageCost: 1, currency: 'TWD' },
      { id: 'demo-holding-2', quantity: 1, currentPrice: 1, averageCost: 1, currency: 'TWD' },
    ]));
    api.delete.mockRejectedValue(new Error('401'));

    await portfolioService.deleteHolding('demo-holding-1');

    const ids = JSON.parse(localStorage.getItem(DEMO_HOLDINGS_KEY)!).map((h: { id: string }) => h.id);
    expect(ids).toEqual(['demo-holding-2']);
  });

  it('rethrows for a real holding', async () => {
    api.delete.mockRejectedValue(new Error('500'));

    await expect(portfolioService.deleteHolding('h1')).rejects.toThrow('500');
  });
});

describe('updateHoldingsBySymbol', () => {
  it('patches every lot of the symbol', async () => {
    api.patch.mockResolvedValue({ success: true });

    const result = await portfolioService.updateHoldingsBySymbol('0050', { sector: 'ETF' });

    expect(api.patch).toHaveBeenCalledWith('/portfolio/holdings/symbol/0050', { sector: 'ETF' });
    expect(result.success).toBe(true);
  });

  it('rethrows on failure', async () => {
    api.patch.mockRejectedValue(new Error('boom'));

    await expect(portfolioService.updateHoldingsBySymbol('0050', {})).rejects.toThrow('boom');
  });
});

describe('sellHolding', () => {
  const sale = {
    transaction_id: 't1', holding_id: 'h1', symbol: 'VT', quantity_sold: 2, sale_price: 110,
    total_proceeds: 220, fees: 1, taxes: 2, net_proceeds: 217, realized_gain_loss: 17,
    realized_gain_loss_percentage: 8.5, remaining_quantity: 3, cash_wallet_balance: 5000,
    transaction_date: '2026-10-20',
  };

  it('posts the sale with zero-defaulted costs and maps the receipt', async () => {
    api.post.mockResolvedValue({ success: true, data: sale });

    const result = await portfolioService.sellHolding({ holdingId: 'h1', quantity: 2, price: 110 });

    expect(api.post).toHaveBeenCalledWith('/portfolio/holdings/h1/sell', {
      quantity: 2, price: 110, fees: 0, taxes: 0, notes: undefined, transaction_date: undefined,
    });
    expect(result.data).toEqual({
      transactionId: 't1', holdingId: 'h1', symbol: 'VT', quantitySold: 2, salePrice: 110,
      totalProceeds: 220, fees: 1, taxes: 2, netProceeds: 217, realizedGainLoss: 17,
      realizedGainLossPercentage: 8.5, remainingQuantity: 3, cashWalletBalance: 5000,
      transactionDate: '2026-10-20',
    });
  });

  it('throws when the server reports failure instead of returning an empty receipt', async () => {
    api.post.mockResolvedValue({ success: false, message: 'Insufficient quantity' });

    await expect(portfolioService.sellHolding({ holdingId: 'h1', quantity: 99 })).rejects.toThrow(
      'Invalid response from server'
    );
  });
});

describe('getTimeWeightedReturn', () => {
  it('reads snake_case fields and the nested data-quality share', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: {
        annualized_return_percentage: 12.5,
        total_return_percentage: 40,
        start_date: '2024-01-01',
        data_quality: { real_price_share: 0.9 },
      },
    });

    await expect(portfolioService.getTimeWeightedReturn()).resolves.toEqual({
      annualizedReturnPct: 12.5, totalReturnPct: 40, startDate: '2024-01-01', realPriceShare: 0.9,
    });
  });

  it('reads camelCase too, and turns non-finite numbers into null', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: { annualizedReturnPercentage: null, totalReturnPercentage: Number.NaN, dataQuality: {} },
    });

    await expect(portfolioService.getTimeWeightedReturn()).resolves.toEqual({
      annualizedReturnPct: null, totalReturnPct: null, startDate: null, realPriceShare: null,
    });
  });

  it('resolves null on failure', async () => {
    api.get.mockRejectedValue(new Error('down'));

    await expect(portfolioService.getTimeWeightedReturn()).resolves.toBeNull();
  });
});

describe('recalculateIRR', () => {
  it('wraps the reply', async () => {
    api.post.mockResolvedValue({ success: true, data: { updated: 3 } });

    const result = await portfolioService.recalculateIRR();

    expect(api.post).toHaveBeenCalledWith('/portfolio/calculate-irr');
    expect(result.success).toBe(true);
  });

  it('never throws: IRR is non-critical', async () => {
    api.post.mockRejectedValue(new Error('down'));

    await expect(portfolioService.recalculateIRR()).resolves.toMatchObject({ success: false });
  });
});

describe('refreshPortfolioPrices', () => {
  it('passes force and a long timeout, and clears the demo cache on success', async () => {
    localStorage.setItem(DEMO_HOLDINGS_KEY, '[]');
    localStorage.setItem(DEMO_PORTFOLIO_KEY, '{}');
    const stats = { total: 3, updated: 2, cached: 1, failed: 0 };
    api.post.mockResolvedValue({ success: true, data: stats });

    const result = await portfolioService.refreshPortfolioPrices(true);

    expect(api.post).toHaveBeenCalledWith('/portfolio/refresh-prices?force=true', null, { timeout: 120000 });
    expect(result).toMatchObject({ success: true, data: stats });
    expect(localStorage.getItem(DEMO_HOLDINGS_KEY)).toBeNull();
    expect(localStorage.getItem(DEMO_PORTFOLIO_KEY)).toBeNull();
  });

  it('returns zeroed stats when the envelope carries no data', async () => {
    api.post.mockResolvedValue({ success: false });

    await expect(portfolioService.refreshPortfolioPrices()).resolves.toMatchObject({
      success: false, data: { total: 0, updated: 0, cached: 0, failed: 0 },
    });
  });

  it('falls back to cached demo prices on a 401', async () => {
    localStorage.setItem(DEMO_HOLDINGS_KEY, JSON.stringify([{ id: 'a' }, { id: 'b' }]));
    api.post.mockRejectedValue(new Error('HTTP 401: Unauthorized'));

    await expect(portfolioService.refreshPortfolioPrices()).resolves.toMatchObject({
      success: true, data: { total: 2, cached: 2, updated: 0 },
    });
  });

  it('rethrows rate limits and network errors so the caller can surface them', async () => {
    api.post.mockRejectedValue(new Error('HTTP 429: Too Many Requests'));

    await expect(portfolioService.refreshPortfolioPrices()).rejects.toThrow('429');
  });
});

describe('getPortfolioAnalytics', () => {
  it('returns the backend analytics as-is when the call succeeds', async () => {
    const analytics = { diversificationScore: 80, riskScore: 30 };
    api.get.mockResolvedValue({ success: true, data: analytics });

    await expect(portfolioService.getPortfolioAnalytics()).resolves.toEqual({
      success: true, data: analytics, message: 'Analytics retrieved successfully',
    });
  });

  it('computes allocation locally when the backend declines', async () => {
    const holding = (id: string, sector: string, market: string, value: number) => ({
      id, symbol: id, name: id, type: 'stock', quantity: 1, average_cost: value,
      current_price: value, total_value: value, total_cost: value, currency: 'TWD',
      market, sector, region: market === 'TW' ? 'Asia Pacific' : 'North America',
    });
    api.get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/analytics') return { success: false };
      return {
        success: true,
        data: {
          id: 'p', name: 'P', currency: 'TWD', total_value: 400, total_cost: 400,
          holdings: [holding('A', 'Tech', 'TW', 300), holding('B', 'Bonds', 'US', 100)],
        },
      };
    });

    const result = await portfolioService.getPortfolioAnalytics();

    expect(result.success).toBe(true);
    const bySector = Object.fromEntries(result.data!.allocation.bySector.map((s) => [s.sector, s.percentage]));
    expect(bySector).toEqual({ Tech: 75, Bonds: 25 });
    const byRegion = Object.fromEntries(result.data!.allocation.byRegion.map((r) => [r.region, r.percentage]));
    expect(byRegion).toEqual({ 'Asia Pacific': 75, 'North America': 25 });
    expect(result.data!.topPerformers.length).toBe(2);
    expect(result.data!.diversificationScore).toBeGreaterThan(0);
    expect(result.data!.diversificationScore).toBeLessThanOrEqual(100);
  });

  it('reports failure instead of throwing when nothing is reachable', async () => {
    api.get.mockRejectedValue(new Error('down'));

    await expect(portfolioService.getPortfolioAnalytics()).resolves.toMatchObject({ success: false });
  });
});

describe('getHolding', () => {
  it('normalises an API holding', async () => {
    api.get.mockResolvedValue({ success: true, data: { id: 'h1', symbol: 'VT', quantity: '4', average_cost: '25' } });

    const result = await portfolioService.getHolding('h1');

    expect(api.get).toHaveBeenCalledWith('/portfolio/holdings/h1');
    expect(result.data).toMatchObject({ id: 'h1', quantity: 4, averageCost: 25, totalCost: 100 });
  });

  it('reads a demo holding from localStorage without calling the API', async () => {
    localStorage.setItem(DEMO_HOLDINGS_KEY, JSON.stringify([{ id: 'demo-holding-9', symbol: 'X' }]));

    const found = await portfolioService.getHolding('demo-holding-9');
    const missing = await portfolioService.getHolding('demo-holding-404');

    expect(found).toMatchObject({ success: true, data: { symbol: 'X' } });
    expect(missing.success).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('reports not-found and errors without throwing', async () => {
    api.get.mockResolvedValueOnce({ success: false });
    await expect(portfolioService.getHolding('h1')).resolves.toMatchObject({ success: false, message: 'Holding not found' });

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(portfolioService.getHolding('h1')).resolves.toMatchObject({ success: false });
  });
});

describe('getDailyPerformance', () => {
  it('coerces every numeric field and accepts snake_case aliases', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: [
        { date: '2026-10-01', value: '1000', costBasis: '900', change: '10', change_percent: '1.5', capital_added: '50' },
        { date: '2026-10-02', value: null, change: 'x' },
      ],
    });

    const result = await portfolioService.getDailyPerformance(7);

    expect(api.get).toHaveBeenCalledWith('/portfolio/daily-performance?days=7');
    expect(result.data![0]).toMatchObject({
      date: '2026-10-01', value: 1000, costBasis: 900, change: 10, changePercent: 1.5, capitalAdded: 50,
      purchases: [], topHoldings: [],
    });
    // Garbage becomes 0 rather than NaN, which would break the chart scale.
    expect(result.data![1]).toMatchObject({ value: 0, change: 0, changePercent: 0, capitalAdded: 0 });
    expect((result.data![1] as { costBasis?: number }).costBasis).toBeUndefined();
  });

  it('accepts a bare array body', async () => {
    api.get.mockResolvedValue([{ date: '2026-10-01', value: 5 }] as never);

    await expect(portfolioService.getDailyPerformance()).resolves.toMatchObject({ success: true, data: [{ value: 5 }] });
  });

  it('reports empty data and errors as unsuccessful with an empty series', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    api.get.mockResolvedValueOnce({ success: true, data: [] });
    await expect(portfolioService.getDailyPerformance()).resolves.toEqual(
      expect.objectContaining({ success: false, data: [] })
    );

    api.get.mockRejectedValueOnce(new Error('timeout'));
    await expect(portfolioService.getDailyPerformance()).resolves.toEqual(
      expect.objectContaining({ success: false, data: [], message: 'timeout' })
    );
  });
});

describe('getHistoricalPrices', () => {
  it('returns the prices array from the envelope, or [] on failure', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const prices = [{ date: '2026-10-01', open: 1, high: 2, low: 1, close: 2, volume: 10, currency: 'TWD' }];

    api.get.mockResolvedValueOnce({ success: true, data: { prices } });
    await expect(portfolioService.getHistoricalPrices('0050', 30)).resolves.toEqual(prices);
    expect(api.get).toHaveBeenCalledWith('/portfolio/historical-prices/0050?days=30');

    api.get.mockResolvedValueOnce({ success: true, data: {} });
    await expect(portfolioService.getHistoricalPrices('0050')).resolves.toEqual([]);

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(portfolioService.getHistoricalPrices('0050')).resolves.toEqual([]);
  });
});

describe('getBenchmarkData', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));

  it('URL-encodes the symbol and returns the series', async () => {
    const series = { symbol: '^GSPC', name: 'S&P 500', color: '#000', points: [] };
    api.get.mockResolvedValue({ success: true, data: series });

    await expect(portfolioService.getBenchmarkData('^GSPC', 90)).resolves.toEqual(series);
    expect(api.get).toHaveBeenCalledWith('/portfolio/benchmark?symbol=%5EGSPC&days=90');
  });

  it("throws the backend's message so React Query can show it", async () => {
    api.get.mockResolvedValue({ success: false, message: 'Invalid ticker' });

    await expect(portfolioService.getBenchmarkData('NOPE')).rejects.toThrow('Invalid ticker');
  });

  it('returns null when there is neither data nor a message', async () => {
    api.get.mockResolvedValue({ success: false });

    await expect(portfolioService.getBenchmarkData('SPY')).resolves.toBeNull();
  });
});

describe('getRiskMetrics', () => {
  it('maps every field and keeps nulls as null', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: {
        cagr: 0.1, cagr_percentage: 10, max_drawdown: null, max_drawdown_percentage: null,
        annualized_volatility: 0.2, annualized_volatility_percentage: 20, sharpe_ratio: 1.1,
        hhi: 0.3, hhi_label: 'Moderate', beta: 0.9, alpha: 0.01, alpha_percentage: 1,
        benchmark_symbol: 'VT', risk_free_rate: 0.02, data_days: 400, has_historical_data: true,
      },
    });

    await expect(portfolioService.getRiskMetrics()).resolves.toEqual({
      cagr: 0.1, cagrPercentage: 10, maxDrawdown: null, maxDrawdownPercentage: null,
      annualizedVolatility: 0.2, annualizedVolatilityPercentage: 20, sharpeRatio: 1.1,
      hhi: 0.3, hhiLabel: 'Moderate', beta: 0.9, alpha: 0.01, alphaPercentage: 1,
      benchmarkSymbol: 'VT', riskFreeRate: 0.02, dataDays: 400, hasHistoricalData: true,
    });
  });

  it('fills defaults for an empty payload', async () => {
    api.get.mockResolvedValue({ success: true, data: {} });

    await expect(portfolioService.getRiskMetrics()).resolves.toMatchObject({
      cagr: null, hhiLabel: 'Unknown', benchmarkSymbol: 'SPY', riskFreeRate: 0.04, dataDays: 0,
      hasHistoricalData: false,
    });
  });

  it('resolves null on failure or an unsuccessful envelope', async () => {
    api.get.mockResolvedValueOnce({ success: false });
    await expect(portfolioService.getRiskMetrics()).resolves.toBeNull();

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(portfolioService.getRiskMetrics()).resolves.toBeNull();
  });
});

describe('getDividendIncome', () => {
  it('maps the totals and each payment', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: {
        total_dividends: 1200, dividend_yield: 3.2, projected_annual: 1500, yield_on_cost: 4, yield_on_value: 3,
        payments: [
          { date: '2026-07-01', symbol: '0056', amount: 600, currency: 'TWD', shares: 1000, per_share: 0.6 },
          { date: '2026-08-01', symbol: 'VT', amount: 20, currency: 'USD' },
        ],
      },
    });

    const result = await portfolioService.getDividendIncome('6m');

    expect(api.get).toHaveBeenCalledWith('/portfolio/dividends?period=6m');
    expect(result).toMatchObject({
      totalDividends: 1200, dividendYield: 3.2, projectedAnnual: 1500, yieldOnCost: 4, yieldOnValue: 3,
    });
    expect(result!.payments).toEqual([
      { date: '2026-07-01', symbol: '0056', amount: 600, currency: 'TWD', shares: 1000, perShare: 0.6 },
      { date: '2026-08-01', symbol: 'VT', amount: 20, currency: 'USD', shares: 0, perShare: 0 },
    ]);
  });

  it('resolves null on failure', async () => {
    api.get.mockRejectedValue(new Error('down'));

    await expect(portfolioService.getDividendIncome()).resolves.toBeNull();
  });
});

describe('getRealizedPnl', () => {
  it('maps the totals, defaulting missing ones to 0', async () => {
    api.get.mockResolvedValueOnce({ success: true, data: { realized_gain_loss: -250, realized_count: 3 } });
    await expect(portfolioService.getRealizedPnl()).resolves.toEqual({ realizedGainLoss: -250, realizedCount: 3 });

    api.get.mockResolvedValueOnce({ success: true, data: {} });
    await expect(portfolioService.getRealizedPnl()).resolves.toEqual({ realizedGainLoss: 0, realizedCount: 0 });
  });

  it('resolves null so the figure can be hidden', async () => {
    api.get.mockRejectedValue(new Error('down'));

    await expect(portfolioService.getRealizedPnl()).resolves.toBeNull();
  });
});

describe('syncHistoricalPrices', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  it('maps the sync stats', async () => {
    api.post.mockResolvedValue({
      success: true,
      data: { total_symbols: 5, successful: 3, failed: 1, cached: 1, total_records: 300 },
    });

    const result = await portfolioService.syncHistoricalPrices(30);

    expect(api.post).toHaveBeenCalledWith('/portfolio/sync-historical-prices?days=30', {}, { timeout: 180000 });
    expect(result).toEqual({
      success: true,
      data: { totalSymbols: 5, successful: 3, failed: 1, cached: 1, totalRecords: 300 },
      message: 'Historical data synced for 4 symbols',
    });
  });

  it('returns zeroed stats for an unexpected body', async () => {
    api.post.mockResolvedValue({ success: false, message: 'No holdings found in portfolio' });

    await expect(portfolioService.syncHistoricalPrices()).resolves.toMatchObject({
      success: false, data: { totalSymbols: 0 },
    });
  });

  it.each([
    [{ response: { data: { detail: 'detail msg' } } }, 'detail msg'],
    [{ response: { data: { message: 'body msg' } } }, 'body msg'],
    [new Error('plain msg'), 'plain msg'],
    [{}, 'Failed to sync historical data'],
  ])('surfaces the most specific error message (%#)', async (error, expected) => {
    api.post.mockRejectedValue(error);

    await expect(portfolioService.syncHistoricalPrices()).resolves.toMatchObject({ success: false, message: expected });
  });
});

describe('downloadCSV / downloadTemplate', () => {
  const realFetch = global.fetch;
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    clicked = [];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('requests xlsx with the date range and a bearer token, then saves it', async () => {
    mockGetSession.mockResolvedValue({ accessToken: 'tok' });

    await portfolioService.downloadCSV('2026-01-01', '2026-06-30');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/v1/portfolio/export?format=xlsx&date_from=2026-01-01&date_to=2026-06-30',
      { headers: { 'ngrok-skip-browser-warning': 'true', Authorization: 'Bearer tok' } }
    );
    expect(clicked[0].download).toBe('portfolio_2026-01-01_2026-06-30.xlsx');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('names an unbounded export all_time and sends no token without a session', async () => {
    await portfolioService.downloadCSV();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/v1/portfolio/export?format=xlsx',
      { headers: { 'ngrok-skip-browser-warning': 'true' } }
    );
    expect(clicked[0].download).toBe('portfolio_all_time.xlsx');
  });

  it('throws on a failed export rather than saving an error page', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });

    await expect(portfolioService.downloadCSV()).rejects.toThrow('Export failed: 403');
    expect(clicked).toHaveLength(0);
  });

  it('downloads the import template', async () => {
    await portfolioService.downloadTemplate();

    expect(global.fetch).toHaveBeenCalledWith('https://api.test/api/v1/portfolio/template', expect.any(Object));
    expect(clicked[0].download).toBe('portfolio_template.xlsx');

    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await expect(portfolioService.downloadTemplate()).rejects.toThrow('Template download failed: 500');
  });
});
