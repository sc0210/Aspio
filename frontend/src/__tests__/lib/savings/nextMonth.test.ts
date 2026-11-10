import { nextOccurrence, perMonth, sameDayNextMonth } from '@/lib/savings/nextMonth';

it.each([
  ['2026-11-07', '2026-12-07'],
  ['2026-12-15', '2027-01-15'],
  ['2026-01-31', '2026-02-28'],
  ['2028-01-31', '2028-02-29'],
  ['2026-03-31', '2026-04-30'],
])('%s → %s', (from, to) => {
  expect(sameDayNextMonth(from)).toBe(to);
});

describe('nextOccurrence', () => {
  it('steps a week, a month (clamped) or a year (29 Feb → 28 Feb)', () => {
    expect(nextOccurrence('2026-12-29', 'weekly')).toBe('2027-01-05');
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrence('2026-03-15', 'yearly')).toBe('2027-03-15');
    expect(nextOccurrence('2028-02-29', 'yearly')).toBe('2029-02-28');
  });
});

describe('perMonth', () => {
  it('spreads a weekly bill over 52 weeks and a yearly one over 12 months', () => {
    expect(perMonth(1200, 'monthly')).toBe(1200);
    expect(perMonth(1200, 'yearly')).toBe(100);
    expect(perMonth(300, 'weekly')).toBe(1300);
  });
});
