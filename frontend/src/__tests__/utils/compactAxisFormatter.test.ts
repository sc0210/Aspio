import { compactAxisFormatter } from '@/utils/formatters';

/** A stand-in for the currency formatter: millions with N decimals. */
const millions = (v: number, d: number) => `${(v / 1e6).toFixed(d)}M`;

describe('compactAxisFormatter', () => {
  it('keeps one decimal when that already tells the ticks apart', () => {
    const f = compactAxisFormatter([0, 1e6, 2e6, 3e6], millions);
    expect([0, 1e6, 2e6, 3e6].map(f)).toEqual(['0.0M', '1.0M', '2.0M', '3.0M']);
  });

  it('adds decimals until close ticks stop printing alike', () => {
    const ticks = [1_900_000, 1_925_000, 1_950_000, 1_975_000, 2_000_000];
    const labels = ticks.map(compactAxisFormatter(ticks, millions));
    expect(new Set(labels).size).toBe(ticks.length);
    // Two decimals already tell them apart, so it stops there.
    expect(labels[0]).toBe('1.90M');
    expect(labels[4]).toBe('2.00M');
  });

  it('copes with no ticks', () => {
    expect(compactAxisFormatter(undefined, millions)(2e6)).toBe('2.0M');
  });
});
