import {
  formatCurrency,
  formatTWD,
  formatTWDCompact,
  toTWD,
  setExchangeRates,
  __resetExchangeRates,
} from '@/utils/formatters';

// Fix #5: single source of truth for currency formatting — local wrappers removed

describe('formatCurrency', () => {
  it('formats TWD amounts correctly', () => {
    const result = formatCurrency(1234.56, 'TWD');
    expect(result).toContain('1,234');
  });

  it('formats USD amounts correctly', () => {
    const result = formatCurrency(1234.56, 'USD');
    expect(result).toContain('1,234');
    expect(result).toContain('$');
  });

  it('handles zero without throwing', () => {
    expect(() => formatCurrency(0, 'TWD')).not.toThrow();
    expect(formatCurrency(0, 'TWD')).toBeTruthy();
  });

  it('handles negative amounts', () => {
    const result = formatCurrency(-500, 'USD');
    expect(result).toContain('500');
    expect(result).toMatch(/-|\(500/); // negative sign or parentheses
  });

  it('handles NaN gracefully (falls back to 0)', () => {
    expect(() => formatCurrency(NaN, 'TWD')).not.toThrow();
  });

  it('handles Infinity gracefully (falls back to 0)', () => {
    expect(() => formatCurrency(Infinity, 'TWD')).not.toThrow();
  });

  it('supports compact option for large numbers', () => {
    const result = formatCurrency(1_500_000, 'TWD', { compact: true });
    // Compact notation produces a short form: '萬', 'M', 'K', or similar
    expect(result.length).toBeLessThan(formatCurrency(1_500_000, 'TWD').length);
  });

  it('supports precision option', () => {
    const result = formatCurrency(1234.5678, 'USD', { precision: 0 });
    expect(result).not.toContain('.');
  });
});

describe('formatTWDCompact', () => {
    // A one-line wrapper, but now the single point 20 call sites trust — and it
    // replaced twenty-seven hand-written copies, so what it produces is worth
    // stating rather than inferring from formatTWD's options.
    it('abbreviates large amounts in the zh-TW unit, not the English one', () => {
        expect(formatTWDCompact(1_234_567)).toBe(formatTWD(1_234_567, { compact: true }));
        // 萬 (ten thousand), because formatTWD formats under zh-TW. Worth
        // stating: the `fmtNT` helper this refactor deleted formatted the same
        // figures under en-US, so demo reports grouped them the English way
        // while the rest of the app did not.
        expect(formatTWDCompact(1_234_567)).toContain('萬');
        expect(formatTWDCompact(1_234_567)).not.toMatch(/M/);
    });

    it('leaves small amounts alone', () => {
        expect(formatTWDCompact(950)).toBe(formatTWD(950, { compact: true }));
    });

    it('handles zero and negatives', () => {
        expect(formatTWDCompact(0)).toBe(formatTWD(0, { compact: true }));
        expect(formatTWDCompact(-1_500_000)).toBe(formatTWD(-1_500_000, { compact: true }));
    });
});

describe('toTWD — stablecoins', () => {
    afterEach(() => __resetExchangeRates());

    it('prices USDT like the dollar it tracks, even before rates load', () => {
        // Crypto holdings are quoted in USDT. With no entry for it, toTWD returned the
        // amount untouched and a US$1,000 position joined a TWD total as NT$1,000 —
        // the mixed-currency sum, one currency code further along.
        expect(toTWD(1_000, 'USDT')).toBeCloseTo(toTWD(1_000, 'USD'));
    });

    it('follows the dollar when live rates land without a USDT quote', () => {
        setExchangeRates({ USD: 30 });
        expect(toTWD(1_000, 'USDT')).toBeCloseTo(30_000);
    });

    it('defers to a real USDT quote when the feed sends one', () => {
        setExchangeRates({ USD: 30, USDT: 29.9 });
        expect(toTWD(1_000, 'USDT')).toBeCloseTo(29_900);
    });
});
