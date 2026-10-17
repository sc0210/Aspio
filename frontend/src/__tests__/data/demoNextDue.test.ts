import { demoLoans } from '@/data/demoData';

afterEach(() => jest.useRealTimers());

const due = (i: number) => demoLoans[i].next_payment_date;

it('demo loans are always due soon, recomputed on each read', () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 8, 12)); // 8 Oct
  expect(due(0)).toBe('2026-11-05'); // the 5th has passed: next month
  expect(due(1)).toBe('2026-10-20');
  jest.setSystemTime(new Date(2026, 9, 21, 12)); // the server kept running
  expect(due(1)).toBe('2026-11-20');
});

it('today counts as due, and December rolls into January', () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 20, 9));
  expect(due(1)).toBe('2026-12-20');
  jest.setSystemTime(new Date(2026, 11, 21, 9));
  expect(due(1)).toBe('2027-01-20');
});
