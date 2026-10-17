import { aggregateHoldingsBySymbol } from '@/utils/portfolio-aggregation';
import { PortfolioHolding } from '@/shared/types';

function lot(overrides: Partial<PortfolioHolding> & { quantity: number }): PortfolioHolding {
  const quantity = overrides.quantity;
  const currentPrice = overrides.currentPrice ?? 106.4;
  const previousClose = overrides.previousClose ?? 105.2;
  return {
    id: `lot-${quantity}`,
    symbol: '0050',
    name: '元大台灣50',
    type: 'etf',
    averageCost: 72.66,
    currentPrice,
    totalValue: quantity * currentPrice,
    totalCost: quantity * 72.66,
    gainLoss: quantity * (currentPrice - 72.66),
    gainLossPercentage: 0,
    currency: 'TWD',
    exchange: 'TPE',
    market: 'TW',
    walletType: 'portfolio',
    previousClose,
    dayChange: (currentPrice - previousClose) * quantity,
    dayChangePercentage: ((currentPrice - previousClose) / previousClose) * 100,
    lastUpdated: new Date('2026-08-14T05:30:00Z'),
    ...overrides,
  } as PortfolioHolding;
}

describe('aggregateHoldingsBySymbol — day change', () => {
  it('sums day change across every lot rather than inheriting the first', () => {
    // Regression: the aggregate spread ...lots[0] and never overrode dayChange,
    // so a 22-lot 0050 position displayed the largest lot's +NT$7,742.40
    // (6,452 shares) beside its full 17,268-share quantity.
    const lots = [lot({ quantity: 6452 }), lot({ quantity: 2000 }), lot({ quantity: 8816 })];

    const [aggregated] = aggregateHoldingsBySymbol(lots);

    expect(aggregated.quantity).toBe(17268);
    // (106.40 - 105.20) * 17268
    expect(aggregated.dayChange).toBeCloseTo(20721.6, 2);
    expect(aggregated.dayChangePercentage).toBeCloseTo(1.1407, 3);
  });

  it('derives the percentage from aggregate value when lot prices disagree', () => {
    // A partial price refresh leaves lots of one symbol at different prices;
    // copying a single lot's percentage would then misreport the whole row.
    const lots = [
      lot({ quantity: 100, currentPrice: 106.4, previousClose: 105.2 }),
      lot({ quantity: 100, currentPrice: 102.85, previousClose: 105.2, id: 'stale' }),
    ];

    const [aggregated] = aggregateHoldingsBySymbol(lots);

    const expectedDayChange = (106.4 - 105.2) * 100 + (102.85 - 105.2) * 100;
    expect(aggregated.dayChange).toBeCloseTo(expectedDayChange, 2);
    const previousValue = aggregated.totalValue - aggregated.dayChange!;
    expect(aggregated.dayChangePercentage).toBeCloseTo(
      (aggregated.dayChange! / previousValue) * 100,
      6,
    );
  });

  it('leaves day change undefined when no lot has one', () => {
    const lots = [
      lot({ quantity: 100, dayChange: undefined, dayChangePercentage: undefined, previousClose: undefined }),
      lot({ quantity: 200, dayChange: undefined, dayChangePercentage: undefined, previousClose: undefined, id: 'b' }),
    ];

    const [aggregated] = aggregateHoldingsBySymbol(lots);

    expect(aggregated.dayChange).toBeUndefined();
    expect(aggregated.dayChangePercentage).toBeUndefined();
  });
});
