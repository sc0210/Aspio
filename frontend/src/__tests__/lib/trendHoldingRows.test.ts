import { buildTrendHoldingRows } from '@/lib/portfolio/trendHoldingRows';
import { __resetExchangeRates, setExchangeRates } from '@/utils/formatters';
import type { Portfolio, PortfolioHolding } from '@/shared/types';

const lot = (over: Partial<PortfolioHolding>): PortfolioHolding =>
  ({
    symbol: 'X', name: 'X', type: 'stock', quantity: 1, averageCost: 1, currentPrice: 1,
    totalValue: 0, totalCost: 0, currency: 'TWD', walletType: 'portfolio', ...over,
  }) as PortfolioHolding;

const portfolio = (holdings: PortfolioHolding[]) =>
  ({ currency: 'TWD', totalValue: 999_999, holdings }) as unknown as Portfolio;

const trend = [{ topHoldings: [] }, { topHoldings: [] }];

describe('buildTrendHoldingRows', () => {
  beforeEach(() => setExchangeRates({ USD: 30 }));
  afterEach(() => __resetExchangeRates());

  it('values every row in TWD and weighs it against the table, cash included', () => {
    const rows = buildTrendHoldingRows(
      portfolio([
        lot({ symbol: '2330', totalValue: 60_000 }),
        lot({ symbol: 'AAPL', currency: 'USD', totalValue: 1_000 }), // NT$30,000
        lot({ symbol: 'CASH-TWD', name: 'Life Wallet Cash', type: 'cash', totalValue: 10_000 }),
      ]),
      trend,
    );
    const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));

    // A US$1,000 lot weighed 1,000 / portfolio.totalValue: 0.1% here.
    expect(by.AAPL.currentValue).toBe(30_000);
    expect(by.AAPL.weight).toBeCloseTo(30);
    expect(by['2330'].weight).toBeCloseTo(60);
    expect(by['CASH-TWD'].weight).toBeCloseTo(10);
    expect(rows.reduce((s, r) => s + r.weight, 0)).toBeCloseTo(100);
  });

  it('merges a cash account split across wallets and weighs the merged row once', () => {
    const rows = buildTrendHoldingRows(
      portfolio([
        lot({ symbol: 'CASH-TWD', name: 'Cash', type: 'cash', totalValue: 30_000, totalCost: 30_000, quantity: 30_000 }),
        lot({ symbol: 'CASH-TWD', name: 'Cash', type: 'cash', walletType: 'emergency', totalValue: 10_000, totalCost: 10_000, quantity: 10_000 }),
        lot({ symbol: '0050', totalValue: 60_000 }),
      ]),
      trend,
    );
    expect(rows).toHaveLength(2);
    const cash = rows.find((r) => r.symbol === 'CASH-TWD')!;
    expect(cash.currentValue).toBe(40_000);
    expect(cash.weight).toBeCloseTo(40);
    expect(cash.avgCost).toBe(1);
  });

  it('keeps the average cost in the lot currency', () => {
    const [row] = buildTrendHoldingRows(
      portfolio([lot({ symbol: 'VOO', currency: 'USD', quantity: 5, averageCost: 440, totalCost: 2_200, totalValue: 2_500 })]),
      trend,
    );
    expect(row.currency).toBe('USD');
    expect(row.avgCost).toBe(440);
    expect(row.weight).toBe(100);
  });

  it('is empty without holdings or trend points', () => {
    expect(buildTrendHoldingRows(null, trend)).toEqual([]);
    expect(buildTrendHoldingRows(portfolio([lot({ totalValue: 1 })]), [])).toEqual([]);
  });
});
