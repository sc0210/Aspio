import type { PortfolioHolding } from '@/shared/types';
import { hasPortfolioDataIssues, portfolioDataIssues } from '@/utils/portfolioDataIssues';
import { __resetExchangeRates } from '@/utils/formatters';

function holding(overrides: Partial<PortfolioHolding>): PortfolioHolding {
  return {
    id: overrides.symbol ?? 'h', symbol: '0050', name: '0050', type: 'etf', quantity: 10,
    averageCost: 100, currentPrice: 102.5, totalValue: 1025, totalCost: 1000, gainLoss: 25,
    gainLossPercentage: 2.5, currency: 'TWD', exchange: 'TWSE', market: 'TW',
    walletType: 'portfolio', marketState: 'closed', priceSession: '2026-11-13',
    previousClose: 100.95, lastUpdated: new Date(),
    ...overrides,
  };
}

// Friday 2026-11-13, 22:00 in Taipei.
const NOW = new Date('2026-11-13T14:00:00Z');

beforeEach(() => __resetExchangeRates());

describe('portfolioDataIssues', () => {
  it('finds nothing wrong with current prices that have a previous close', () => {
    expect(hasPortfolioDataIssues(portfolioDataIssues([holding({})], NOW))).toBe(false);
  });

  it('flags a price two sessions old, with the oldest date', () => {
    // A real case: prices stuck at Tuesday 11-10 while the market traded on.
    const issues = portfolioDataIssues([
      holding({ symbol: '2330', priceSession: '2026-11-10' }),
      holding({ symbol: '0050', priceSession: '2026-11-11' }),
      holding({ symbol: 'VT', market: 'US', priceSession: '2026-11-12' }),
    ], NOW);
    expect(issues.staleSymbols).toEqual(['0050', '2330']);
    expect(issues.oldestSession).toBe('2026-11-10');
  });

  it("does not call one session behind stale (a Friday close read on Monday)", () => {
    const monday = new Date('2026-11-16T01:00:00Z'); // 09:00 Taipei
    expect(portfolioDataIssues([holding({ priceSession: '2026-11-13' })], monday).staleSymbols).toEqual([]);
  });

  it("trusts the backend's holiday-aware flag over the weekday count", () => {
    // Lunar New Year: a week of weekdays without a session is not staleness.
    const lny = new Date('2026-02-20T02:00:00Z');
    const quiet = holding({ priceSession: '2026-02-12', priceStale: false });
    expect(portfolioDataIssues([quiet], lny).staleSymbols).toEqual([]);
    const stuck = holding({ priceSession: '2026-11-12', priceStale: true });
    expect(portfolioDataIssues([stuck], NOW).staleSymbols).toEqual(['0050']);
  });

  it('flags a priced holding with no previous close, once per symbol', () => {
    const issues = portfolioDataIssues([
      holding({ id: 'a', symbol: 'BTC-USD', previousClose: undefined }),
      holding({ id: 'b', symbol: 'BTC-USD', previousClose: undefined }),
    ], NOW);
    expect(issues.noDayChangeSymbols).toEqual(['BTC-USD']);
  });

  it('ignores cash, hand-priced and Emergency-wallet holdings', () => {
    const issues = portfolioDataIssues([
      holding({ symbol: 'CASH', type: 'cash', previousClose: undefined, priceSession: '2025-01-01' }),
      holding({ symbol: 'CPF-OA', manuallyPriced: true, marketState: 'manual', previousClose: undefined }),
      holding({ symbol: 'EMERGENCY-USD', walletType: 'emergency', previousClose: undefined }),
    ], NOW);
    expect(hasPortfolioDataIssues(issues)).toBe(false);
  });

  it('reports a held currency there is no rate for, before anything renders it', () => {
    // No toTWD call first: the check must not depend on a sibling having rendered.
    const issues = portfolioDataIssues([holding({ currency: 'XYZ' }), holding({ currency: 'USD' })], NOW);
    expect(issues.unconvertedCurrencies).toEqual(['XYZ']);
  });

  it('stops reporting it once the fetched rates include it', () => {
    const issues = portfolioDataIssues([holding({ currency: 'XYZ' })], NOW, { XYZ: 4.2 });
    expect(issues.unconvertedCurrencies).toEqual([]);
  });
});
