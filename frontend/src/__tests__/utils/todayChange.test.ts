import { todayChange } from '@/utils/todayChange';
import type { PortfolioHolding } from '@/shared/types';

jest.mock('@/utils/formatters', () => ({
  toTWD: (amount: number, currency: string) => (currency === 'USD' ? amount * 32 : amount),
}));

const h = (over: Partial<PortfolioHolding>): PortfolioHolding =>
  ({ quantity: 10, currency: 'TWD', walletType: 'portfolio', previousClose: 100, dayChange: 50, ...over } as PortfolioHolding);

describe('todayChange', () => {
  it('divides by the value at the previous close, not today\'s value', () => {
    // 10 × 100 → 10 × 105: +50 on a base of 1,000 is +5%, not 50 / 1,050.
    expect(todayChange([h({})])).toEqual({ gain: 50, percentage: 5, counted: 1 });
  });

  it('counts only Portfolio-wallet holdings on both sides', () => {
    const result = todayChange([h({}), h({ walletType: 'emergency', dayChange: 500 })]);
    expect(result.gain).toBe(50);
    expect(result.percentage).toBe(5);
  });

  it('converts foreign holdings on both sides', () => {
    // US$: base 10 × 100 × 32 = 32,000; gain 50 × 32 = 1,600 → 5%.
    expect(todayChange([h({ currency: 'USD' })])).toEqual({ gain: 1600, percentage: 5, counted: 1 });
  });

  it('leaves out holdings with no previous close', () => {
    expect(todayChange([h({ previousClose: undefined, dayChange: undefined })])).toEqual({ gain: 0, percentage: 0, counted: 0 });
  });

  it('leaves out a stale price: its last move is days old, not today\'s', () => {
    expect(todayChange([h({}), h({ priceStale: true, dayChange: 900 })])).toEqual({ gain: 50, percentage: 5, counted: 1 });
  });
});
