import { lastSessionWeekday, marketSummaries, sessionMarket } from '@/utils/marketStatus';
import type { PortfolioHolding } from '@/shared/types';

jest.mock('@/utils/formatters', () => ({
  ...jest.requireActual('@/utils/formatters'),
  toTWD: (amount: number, currency: string) => (currency === 'USD' ? amount * 32 : amount),
  areRatesLive: () => true,
  getUnconvertedCurrencies: () => [],
}));

const h = (over: Partial<PortfolioHolding>): PortfolioHolding =>
  ({ quantity: 1, currency: 'TWD', walletType: 'portfolio', previousClose: 100, market: 'TW', ...over } as PortfolioHolding);

describe('marketStatus', () => {
  it('groups exchange labels into sessions', () => {
    expect(sessionMarket('NASDAQ')).toBe('US');
    expect(sessionMarket('twse')).toBe('TW');
  });

  it('summarises each market once, open if any holding says so, with its latest session', () => {
    const rows = marketSummaries([
      h({ market: 'TW', marketState: 'closed', priceSession: '2026-05-14' }),
      h({ market: 'TWSE' as PortfolioHolding['market'], marketState: 'closed', priceSession: '2026-05-15' }),
      h({ market: 'NYSE' as PortfolioHolding['market'], marketState: 'open', priceSession: '2026-05-15' }),
      h({ market: 'CRYPTO', marketState: 'manual' }),
    ]);
    expect(rows).toEqual([
      { market: 'TW', state: 'closed', lastSession: '2026-05-15' },
      { market: 'US', state: 'open', lastSession: '2026-05-15' },
    ]);
  });

  it('calls the move "today" while a market trades, and names the session when none does', () => {
    const saturday = new Date('2026-05-16T12:00:00');
    expect(lastSessionWeekday([h({ marketState: 'open', priceSession: '2026-05-15' })], 'en', saturday)).toBeNull();
    expect(lastSessionWeekday([h({ marketState: 'closed', priceSession: '2026-05-15' })], 'en', saturday)).toBe('Fri');
    // Prices from today's session are today's move.
    expect(lastSessionWeekday([h({ marketState: 'closed', priceSession: '2026-05-16' })], 'en', saturday)).toBeNull();
  });

  it("asks \"is it today\" in the market's own zone", () => {
    // 2026-05-15 Fri 23:00 New York = Sat 11:00 Taipei: a Friday US session is
    // still today in New York, so a Taipei viewer sees "today" until it is over there.
    const fridayNightNY = new Date('2026-05-16T03:00:00Z');
    expect(lastSessionWeekday([h({ market: 'US', marketState: 'closed', priceSession: '2026-05-15' })], 'en', fridayNightNY)).toBeNull();
    // The same session seen once New York is in Saturday too.
    const saturdayNY = new Date('2026-05-16T15:00:00Z');
    expect(lastSessionWeekday([h({ market: 'US', marketState: 'closed', priceSession: '2026-05-15' })], 'en', saturdayNY)).toBe('Fri');
  });
});
