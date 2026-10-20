/**
 * Services that are mostly one apiClient call each. What can break in them is the
 * contract with the backend: the route, the query-string spelling, and (for
 * rebalancing) the unit conversion — the backend stores target percentages as
 * 0-1 on write but reports them as 0-100 on read. Every route asserted here was
 * checked against a backend router when this file was written.
 */
import { apiClient } from '@/lib/api-client';
import { loanService } from '@/services/loanService';
import { dashboardService } from '@/services/dashboardService';
import { reportsService } from '@/services/reportsService';
import symbolService from '@/services/symbolService';
import { rebalancingService } from '@/services/rebalancingService';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;
const ok = (data: unknown = {}) => ({ success: true, data });

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue(ok());
  api.post.mockResolvedValue(ok());
  api.put.mockResolvedValue(ok());
  api.delete.mockResolvedValue(ok());
});

describe('loanService routes', () => {
  it.each([
    ['getLoans', () => loanService.getLoans(), 'get', ['/loans/']],
    ['getSummary', () => loanService.getSummary(), 'get', ['/loans/summary']],
    ['getLoan', () => loanService.getLoan('L1'), 'get', ['/loans/L1']],
    ['createLoan', () => loanService.createLoan({ name: 'x' } as never), 'post', ['/loans/', { name: 'x' }]],
    ['updateLoan', () => loanService.updateLoan('L1', { name: 'y' } as never), 'put', ['/loans/L1', { name: 'y' }]],
    ['deleteLoan', () => loanService.deleteLoan('L1'), 'delete', ['/loans/L1']],
    ['recordPayment', () => loanService.recordPayment('L1', { amount: 5 } as never), 'post', ['/loans/L1/payment', { amount: 5 }]],
    ['getPayments', () => loanService.getPayments('L1'), 'get', ['/loans/L1/payments']],
    ['updatePayment', () => loanService.updatePayment('L1', 'T1', { amount: 6 } as never), 'put', ['/loans/L1/payments/T1', { amount: 6 }]],
    ['deletePayment', () => loanService.deletePayment('L1', 'T1'), 'delete', ['/loans/L1/payments/T1']],
  ] as const)('%s', async (_name, call, method, args) => {
    await expect(call()).resolves.toEqual(ok());
    expect(api[method]).toHaveBeenCalledWith(...args);
  });
});

describe('dashboardService routes', () => {
  it.each([
    ['getDashboardStats default', () => dashboardService.getDashboardStats(), '/dashboard/stats?period=month'],
    ['getDashboardStats', () => dashboardService.getDashboardStats('ytd'), '/dashboard/stats?period=ytd'],
    ['getRecentActivity', () => dashboardService.getRecentActivity(), '/dashboard/recent-activity?limit=10'],
    ['getDashboardData', () => dashboardService.getDashboardData(), '/dashboard/overview'],
    ['getUpcomingEvents', () => dashboardService.getUpcomingEvents(), '/dashboard/upcoming-events'],
    ['getMonthlyTrend', () => dashboardService.getMonthlyTrend(6), '/dashboard/monthly-trend?months=6'],
    ['getSpendingByCategory', () => dashboardService.getSpendingByCategory(), '/dashboard/spending-by-category?period=30d'],
    ['getIncomeByCategory', () => dashboardService.getIncomeByCategory('1y'), '/dashboard/income-by-category?period=1y'],
    ['getHistoricalTrends', () => dashboardService.getHistoricalTrends('90d'), '/dashboard/historical-trends?period=90d'],
    ['getWalletTrends', () => dashboardService.getWalletTrends('6m'), '/dashboard/wallet-trends?period=6m'],
  ] as const)('%s', async (_name, call, url) => {
    await call();
    expect(api.get).toHaveBeenCalledWith(url);
  });

  it('refreshDashboard posts', async () => {
    await dashboardService.refreshDashboard();
    expect(api.post).toHaveBeenCalledWith('/dashboard/refresh');
  });
});

describe('reportsService', () => {
  it.each([
    ['getSpendingReport', (f: object) => reportsService.getSpendingReport(f), '/reports/spending'],
    ['getMonthlyTrends', (f: object) => reportsService.getMonthlyTrends(f), '/reports/monthly-trends'],
    ['getGoalsReport', (f: object) => reportsService.getGoalsReport(f), '/reports/goals'],
  ] as const)('%s sends the range as snake_case and returns the envelope', async (_name, call, path) => {
    const envelope = ok({ any: 1 });
    api.get.mockResolvedValue(envelope);

    await expect(call({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })).resolves.toBe(envelope);
    expect(api.get).toHaveBeenLastCalledWith(`${path}?date_from=2026-01-01&date_to=2026-01-31`);

    await call({});
    expect(api.get).toHaveBeenLastCalledWith(`${path}?`);
  });
});

describe('symbolService', () => {
  const quote = (over: object = {}) => ({
    symbol: '0050', name: 'Yuanta 50', market: 'TW', exchange: 'TWSE', currency: 'TWD',
    current_price: 180, market_open: true, last_updated: '2026-10-20', status: 'success', ...over,
  });

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('getQuote adds the market only when given', async () => {
    api.get.mockResolvedValue(ok(quote()));

    await expect(symbolService.getQuote('0050')).resolves.toMatchObject({ symbol: '0050' });
    expect(api.get).toHaveBeenLastCalledWith('/portfolio/symbol/quote/0050');

    await symbolService.getQuote('VT', 'US');
    expect(api.get).toHaveBeenLastCalledWith('/portfolio/symbol/quote/VT?market=US');
  });

  it('getQuote rethrows', async () => {
    api.get.mockRejectedValue(new Error('down'));
    await expect(symbolService.getQuote('X')).rejects.toThrow('down');
  });

  it('getPopularSymbols defaults to [] and rethrows', async () => {
    api.get.mockResolvedValueOnce({ success: true });
    await expect(symbolService.getPopularSymbols('TW')).resolves.toEqual([]);
    expect(api.get).toHaveBeenLastCalledWith('/portfolio/symbol/popular?market=TW');

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(symbolService.getPopularSymbols()).rejects.toThrow('down');
  });

  it.each([
    [quote(), true],
    [quote({ status: 'no_data' }), false],
    [quote({ current_price: null }), false],
  ])('validateSymbol needs a successful, priced quote (%#)', async (q, valid) => {
    api.get.mockResolvedValue(ok(q));
    await expect(symbolService.validateSymbol('0050')).resolves.toMatchObject({ valid });
  });

  it('validateSymbol is invalid when the lookup fails', async () => {
    api.get.mockRejectedValue(new Error('404'));
    await expect(symbolService.validateSymbol('NOPE')).resolves.toEqual({ valid: false });
  });

  it('searchSymbol matches symbol or name, case-insensitively', async () => {
    api.get.mockResolvedValue(ok([
      { symbol: '0050', name: 'Yuanta Taiwan 50', type: 'etf', market: 'TW' },
      { symbol: 'VT', name: 'Vanguard Total World', type: 'etf', market: 'US' },
      { symbol: 'BTC-USD', name: null, type: 'crypto', market: 'CRYPTO' },
    ]));

    const byName = await symbolService.searchSymbol('vanguard');
    const bySymbol = await symbolService.searchSymbol('btc');

    expect(byName.data.map((s) => s.symbol)).toEqual(['VT']);
    expect(bySymbol.data.map((s) => s.symbol)).toEqual(['BTC-USD']);
    expect(api.get).toHaveBeenCalledWith('/portfolio/symbol/popular?market=ALL');
  });

  it('searchSymbol reports failure instead of throwing', async () => {
    api.get.mockRejectedValue(new Error('down'));
    await expect(symbolService.searchSymbol('x')).resolves.toEqual({ success: false, data: [] });
  });

  it('getQuotes keeps the quotes that resolved and drops the ones that failed', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/BAD')) throw new Error('404');
      return ok(quote({ symbol: url.split('/').pop() }));
    });

    const quotes = await symbolService.getQuotes(['0050', 'BAD', 'VT']);

    expect([...quotes.keys()].sort()).toEqual(['0050', 'VT']);
  });
});

describe('rebalancingService', () => {
  it('converts whole-number targets to the 0-1 fractions the backend validates', async () => {
    await rebalancingService.updateTargetAllocations([
      { asset: '0050', targetPct: 45, assetName: 'Yuanta 50', assetType: 'etf' },
      { asset: 'CASH', targetPct: 55 },
    ]);

    expect(api.put).toHaveBeenCalledWith('/portfolio/rebalancing/target-allocations', {
      targets: [
        { asset: '0050', targetPct: 0.45, assetName: 'Yuanta 50', assetType: 'etf' },
        { asset: 'CASH', targetPct: 0.55, assetName: 'CASH', assetType: 'unknown' },
      ],
    });
  });

  it('throws when the update is refused', async () => {
    api.put.mockResolvedValue({ success: false });
    await expect(rebalancingService.updateTargetAllocations([])).rejects.toThrow('Failed to update target allocations');
  });

  it('maps the dashboard payload, parsing Decimal strings', async () => {
    api.get.mockResolvedValue(ok({
      allocation_summary: {
        total_portfolio_value: '1000',
        requires_rebalancing: true,
        largest_deviation: '15.5',
        last_rebalance_date: '2026-09-01',
        allocations: [
          {
            asset_symbol: '0050', asset_name: 'Yuanta 50', asset_type: 'etf', current_value: '600',
            current_percentage: '60', target_percentage: '45', delta_amount: '-150', action: 'sell',
          },
        ],
      },
      rebalancing_plan: {
        available_funds: '200', total_buy_amount: '300', total_sell_amount: '150', total_fees: '3',
        transactions: [
          { asset_symbol: '0050', asset_name: 'Yuanta 50', action: 'sell', amount: '150', priority: 1, notes: 'trim' },
          { asset_symbol: 'VT', asset_name: 'VT', action: 'buy', amount: '300', priority: 2 },
          { asset_symbol: 'X', asset_name: 'X', action: 'buy', amount: '1', priority: 7 },
        ],
      },
      fx_accumulation: [
        {
          currency: 'USD', accumulated_amount: '100', accumulated_twd: '3200', conversion_threshold: '1000',
          current_fx_rate: '32', ready_to_convert: false, next_conversion_target: '900',
        },
      ],
    }));

    const data = await rebalancingService.getRebalancingDashboard();

    expect(api.get).toHaveBeenCalledWith('/portfolio/rebalancing/dashboard');
    expect(data.allocations[0]).toEqual({
      asset: '0050', assetName: 'Yuanta 50', assetType: 'etf', currency: 'TWD', currentValue: 600,
      currentPct: 60, targetPct: 45, targetValue: 450, delta: -150, action: 'SELL', suggestedAmount: 150,
      colorCode: '#6B7280',
    });
    expect(data.actions.map((a) => [a.action, a.priority, a.amount, a.reason])).toEqual([
      ['SELL', 'high', 150, 'trim'],
      ['BUY', 'medium', 300, ''],
      ['BUY', 'low', 1, ''],
    ]);
    expect(data.fxAccumulation[0]).toMatchObject({
      currency: 'USD', accumulatedTwd: 3200, currentFxRate: 32, estimatedConversionFee: 0,
      lastConversionDate: undefined,
    });
    expect(data).toMatchObject({
      totalAssets: 1000, availableFunds: 200, requiresRebalancing: true, largestDeviation: 15.5,
    });
    expect(data.lastRebalanceDate).toEqual(new Date('2026-09-01'));
  });

  it('measures the deficit as what the purchases need, not purchases minus sales', async () => {
    // 200 available against 300 of buys is short, even though 150 of sales
    // would cover the difference — RebalancingPlanCard must show 資金不足.
    api.get.mockResolvedValue(ok({
      rebalancing_plan: { available_funds: '200', total_buy_amount: '300', total_sell_amount: '150', total_fees: '0' },
    }));

    const data = await rebalancingService.getRebalancingDashboard();

    expect(data.totalDeficit).toBe(300);
    expect(data.availableFunds < data.totalDeficit).toBe(true);
  });

  it('returns empty, zeroed data for an empty payload', async () => {
    api.get.mockResolvedValue(ok({}));

    await expect(rebalancingService.getDashboardData()).resolves.toEqual({
      allocations: [], actions: [], totalAssets: 0, availableFunds: 0, totalDeficit: 0,
      fxAccumulation: [], requiresRebalancing: false, largestDeviation: 0, lastRebalanceDate: undefined,
    });
  });

  it('throws when the dashboard call is unsuccessful', async () => {
    api.get.mockResolvedValue({ success: false });
    await expect(rebalancingService.getDashboardData()).rejects.toThrow('Failed to fetch rebalancing dashboard data');
  });
});
