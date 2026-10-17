import { isNearTarget, isOffTarget } from '@/lib/portfolio/rebalanceThreshold';

describe('rebalance threshold (matches the backend: trade only above 5 points)', () => {
  it('is not off target at exactly 5 points, either direction', () => {
    expect(isOffTarget(5)).toBe(false);
    expect(isOffTarget(-5)).toBe(false);
  });

  it('is off target above 5 points', () => {
    expect(isOffTarget(5.01)).toBe(true);
    expect(isOffTarget(-7)).toBe(true);
  });

  it('ignores float noise at the boundary', () => {
    expect(isOffTarget(55.0000001 - 50)).toBe(false);
  });

  it('still alarms a real drift just over 5, as the backend trades it', () => {
    expect(isOffTarget(5.004)).toBe(true);
  });

  it('calls 3 to 5 points near target, and never both', () => {
    expect(isNearTarget(3)).toBe(true);
    expect(isNearTarget(5)).toBe(true);
    expect(isNearTarget(2.99)).toBe(false);
    expect(isNearTarget(6)).toBe(false);
  });
});
