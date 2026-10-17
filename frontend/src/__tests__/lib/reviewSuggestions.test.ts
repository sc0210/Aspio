import { buildMonthReview, monthRange, type MonthContext } from '@/lib/review';
import { monthSuggestions, MAX_SUGGESTIONS } from '@/lib/review/suggestions';

const after = new Date(2026, 9, 20); // 20 Oct 2026 — September is complete
const sep = monthRange('2026-09', after);

const spending = (income: number, cats: Record<string, number>) => ({
  totalIncome: income,
  totalExpenses: Object.values(cats).reduce((s, v) => s + v, 0),
  categoryBreakdown: Object.entries(cats).map(([category, amount]) => ({ category, amount })),
});

const kinds = (s: ReturnType<typeof monthSuggestions>) => s.map((x) => x.kind);

describe('monthSuggestions', () => {
  it('an overspent month leads with the shortfall and names the biggest category', () => {
    const r = buildMonthReview(sep, spending(50_000, { Rent: 40_000, Dining: 15_000 }), spending(50_000, { Rent: 40_000, Dining: 5_000 }));
    const s = monthSuggestions(r);
    expect(s[0]).toMatchObject({ kind: 'overspent', shortfall: 5_000, category: 'Rent' });
  });

  it('flags a category that rose sharply, with last month beside it', () => {
    const r = buildMonthReview(sep, spending(100_000, { Rent: 40_000, Dining: 15_000 }), spending(100_000, { Rent: 40_000, Dining: 6_000 }));
    expect(monthSuggestions(r)).toContainEqual(expect.objectContaining({ kind: 'categorySpike', category: 'Dining', amount: 15_000, previous: 6_000, percent: 150 }));
  });

  it('ignores small drifts', () => {
    const r = buildMonthReview(sep, spending(100_000, { Rent: 40_000, Dining: 6_300 }), spending(100_000, { Rent: 40_000, Dining: 6_000 }));
    expect(kinds(monthSuggestions(r))).not.toContain('categorySpike');
  });

  it('under 20% saved: says how much more reaches 20%', () => {
    const r = buildMonthReview(sep, spending(100_000, { Rent: 90_000 }), spending(100_000, { Rent: 90_000 }));
    expect(monthSuggestions(r)).toContainEqual(expect.objectContaining({ kind: 'saveMore', gap: 10_000 }));
  });

  it('a strong month suggests putting the surplus to work', () => {
    const r = buildMonthReview(sep, spending(100_000, { Rent: 40_000 }), spending(100_000, { Rent: 40_000 }));
    expect(monthSuggestions(r)).toContainEqual(expect.objectContaining({ kind: 'putToWork', kept: 60_000 }));
  });

  it('notes a sizeable category last month did not have', () => {
    const r = buildMonthReview(sep, spending(100_000, { Rent: 40_000, Travel: 12_000 }), spending(100_000, { Rent: 40_000 }));
    expect(monthSuggestions(r)).toContainEqual(expect.objectContaining({ kind: 'newCategory', category: 'Travel' }));
  });

  it('compares against the twelve-month average when the month ranks', () => {
    const r = buildMonthReview(sep, spending(100_000, { Rent: 85_000 }), spending(100_000, { Rent: 85_000 }));
    const ctx = { averageNet: 40_000, vsAverage: 15_000 - 40_000 } as MonthContext;
    expect(monthSuggestions(r, ctx)).toContainEqual(expect.objectContaining({ kind: 'belowAverage', gap: 25_000 }));
  });

  it('a running month judges the pace against last month, not the partial total', () => {
    const oct = monthRange('2026-10', new Date(2026, 9, 16)); // 16 days in
    const r = buildMonthReview(oct, spending(0, { Dining: 32_000 }), spending(100_000, { Dining: 30_000 }));
    const s = monthSuggestions(r);
    // 2,000/day × 31 days = 62,000 (16 days in) against last month's 30,000.
    expect(s).toContainEqual(expect.objectContaining({ kind: 'pace', projected: 62_000, previous: 30_000 }));
    expect(kinds(s)).not.toContain('overspent');
  });

  it('never more than three, the most money first; nothing for an empty month', () => {
    const r = buildMonthReview(sep, spending(50_000, { Rent: 40_000, Dining: 15_000, Travel: 9_000 }), spending(50_000, { Rent: 40_000, Dining: 5_000 }));
    const s = monthSuggestions(r, { averageNet: 10_000, vsAverage: -24_000 } as MonthContext);
    expect(s.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(s.map((x) => x.weight)).toEqual([...s.map((x) => x.weight)].sort((a, b) => b - a));
    expect(monthSuggestions(buildMonthReview(sep, undefined, undefined))).toEqual([]);
  });
});

it('an expense-only month (no income recorded) is not called overspent', () => {
  const r = buildMonthReview(sep, spending(0, { Rent: 40_000 }), spending(0, { Rent: 40_000 }));
  expect(kinds(monthSuggestions(r))).not.toContain('overspent');
});

it('no pace projection in the first half of a month — early rent would triple it', () => {
  const oct8 = monthRange('2026-10', new Date(2026, 9, 8));
  const r = buildMonthReview(oct8, spending(0, { Rent: 20_000 }), spending(100_000, { Rent: 25_000 }));
  expect(kinds(monthSuggestions(r))).not.toContain('pace');
});
