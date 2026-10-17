import { mapExternalTimeframe } from '@/components/portfolio/PortfolioChart';

// Fix #3: mapExternalTimeframe is now module-scoped (stable reference, no closure bugs)
// Fix #7: '7D' correctly maps to '1W' instead of '1M'

describe('mapExternalTimeframe', () => {
  it('returns 6M for undefined', () => {
    expect(mapExternalTimeframe(undefined)).toBe('6M');
  });

  it('maps 7D to 1W (fix #7: was incorrectly mapping to 1M)', () => {
    expect(mapExternalTimeframe('7D')).toBe('1W');
  });

  it('maps 30D to 1M', () => {
    expect(mapExternalTimeframe('30D')).toBe('1M');
  });

  it('maps 90D to 3M', () => {
    expect(mapExternalTimeframe('90D')).toBe('3M');
  });

  it('maps 1Y to 1Y', () => {
    expect(mapExternalTimeframe('1Y')).toBe('1Y');
  });

  it('maps YTD to 6M', () => {
    expect(mapExternalTimeframe('YTD')).toBe('6M');
  });

  it('maps MAX to ALL', () => {
    expect(mapExternalTimeframe('MAX')).toBe('ALL');
  });

  it('returns 6M for unknown values', () => {
    expect(mapExternalTimeframe('BOGUS')).toBe('6M');
  });
});
