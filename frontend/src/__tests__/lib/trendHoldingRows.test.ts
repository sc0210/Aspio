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

  it('counts a symbol split across wallets or goals once', () => {
    // The trend series is by symbol: each piece already carries 0050's figures.
    const series = [
      { topHoldings: [{ symbol: '0050', change: 0, value: 100_000 }] },
      { topHoldings: [{ symbol: '0050', change: 4_000, value: 104_000 }] },
      { topHoldings: [{ symbol: '0050', change: 6_000, value: 110_000 }] },
    ];
    const rows = buildTrendHoldingRows(
      portfolio([
        lot({ symbol: '0050', name: 'Yuanta 50', quantity: 600, totalValue: 66_000, totalCost: 60_000 }),
        lot({ symbol: '0050', name: 'Yuanta 50', quantity: 400, totalValue: 44_000, totalCost: 40_000, goalId: 'g1' }),
      ]),
      series,
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect([row.startValue, row.endValue, row.periodChange]).toEqual([100_000, 110_000, 10_000]);
    expect(row.periodChangePct).toBeCloseTo(10);
    expect([row.quantity, row.currentValue, row.lotCount]).toEqual([1_000, 110_000, 2]);
  });

  it('merges a security by symbol whatever each piece is called, and keeps Emergency apart', () => {
    const series = [
      { topHoldings: [{ symbol: '0050', change: 0, value: 100_000 }] },
      { topHoldings: [{ symbol: '0050', change: 10_000, value: 110_000 }] },
    ];
    const rows = buildTrendHoldingRows(
      portfolio([
        lot({ symbol: '0050', name: 'Yuanta 50', quantity: 600, totalValue: 66_000 }),
        lot({ symbol: '0050', name: '元大台灣50', quantity: 400, totalValue: 44_000, goalId: 'g1' }),
        lot({ symbol: '0050', name: 'Yuanta 50', quantity: 100, totalValue: 11_000, walletType: 'emergency' }),
      ]),
      series,
    );
    expect(rows).toHaveLength(2);
    const [held, reserve] = rows;
    // The Portfolio pieces, goal included, are the series' 0050.
    expect([held.quantity, held.startValue, held.endValue, held.periodChange]).toEqual([1_000, 100_000, 110_000, 10_000]);
    // The series leaves the Emergency wallet out: no figures to borrow.
    expect([reserve.quantity, reserve.startValue, reserve.endValue, reserve.periodChange]).toEqual([100, null, null, null]);
    expect(reserve.isPartialPeriod).toBe(false);
  });

  it('weighs overdrawn cash as 0 instead of shrinking the total', () => {
    const rows = buildTrendHoldingRows(
      portfolio([
        lot({ symbol: '2330', totalValue: 100_000 }),
        lot({ symbol: 'CASH-TWD', name: 'Life Wallet Cash', type: 'cash', totalValue: -40_000 }),
      ]),
      trend,
    );
    const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    expect(by['2330'].weight).toBe(100);
    expect(by['CASH-TWD'].weight).toBe(0);
    expect(by['CASH-TWD'].currentValue).toBe(-40_000);
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

  it('converts with the rates it is given', () => {
    const [row] = buildTrendHoldingRows(
      portfolio([lot({ symbol: 'AAPL', currency: 'USD', totalValue: 100 })]),
      trend,
      (amount, currency) => (currency === 'USD' ? amount * 32 : amount),
    );
    expect(row.currentValue).toBe(3_200);
  });

  it('is empty without holdings or trend points', () => {
    expect(buildTrendHoldingRows(null, trend)).toEqual([]);
    expect(buildTrendHoldingRows(portfolio([lot({ totalValue: 1 })]), [])).toEqual([]);
  });
});
