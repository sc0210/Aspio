import { sameDayNextMonth } from '@/lib/savings/nextMonth';

it.each([
  ['2026-11-07', '2026-12-07'],
  ['2026-12-15', '2027-01-15'],
  ['2026-01-31', '2026-02-28'],
  ['2028-01-31', '2028-02-29'],
  ['2026-03-31', '2026-04-30'],
])('%s → %s', (from, to) => {
  expect(sameDayNextMonth(from)).toBe(to);
});
