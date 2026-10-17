import { upcomingPayments, type UpcomingLoanLike } from '@/lib/loans/upcoming';

const loan = (over: Partial<UpcomingLoanLike>): UpcomingLoanLike => ({
  id: 'x', name: 'Loan', status: 'active', currency: 'TWD', minimum_payment: 1000, next_payment_date: null, ...over,
});
const today = new Date(2026, 9, 8); // 8 Oct 2026

it('lists each active loan\'s next due date inside the window, soonest first', () => {
  const r = upcomingPayments([
    loan({ id: 'b', name: 'Card', next_payment_date: '2026-10-20', minimum_payment: '5000' }),
    loan({ id: 'a', name: 'Mortgage', next_payment_date: '2026-10-11', minimum_payment: 22000 }),
    loan({ id: 'c', name: 'Paid', status: 'paid_off', next_payment_date: '2026-10-12' }),
    loan({ id: 'd', name: 'No date' }),
  ], today);
  expect(r.map((p) => [p.name, p.date, p.amount, p.daysAway])).toEqual([
    ['Mortgage', '2026-10-11', 22000, 3],
    ['Card', '2026-10-20', 5000, 12],
  ]);
});

it('projects a second payment when the next month also falls inside the window', () => {
  const r = upcomingPayments([loan({ next_payment_date: '2026-10-09' })], today);
  expect(r.map((p) => p.date)).toEqual(['2026-10-09', '2026-11-09'].filter((d) => d <= '2026-11-07'));
  const r2 = upcomingPayments([loan({ next_payment_date: '2026-10-09' })], today, 35);
  expect(r2.map((p) => p.date)).toEqual(['2026-10-09', '2026-11-09']);
});

it('keeps an overdue payment, flagged with negative days', () => {
  const r = upcomingPayments([loan({ next_payment_date: '2026-10-05' })], today);
  // Overdue once, then next month's real date (outside 30 days here: 11-05 is 28 days away, inside).
  expect(r.map((p) => [p.date, p.daysAway])).toEqual([['2026-10-05', -3], ['2026-11-05', 28]]);
});

it('the 31st becomes the last day of a shorter month', () => {
  const r = upcomingPayments([loan({ next_payment_date: '2026-10-31' })], new Date(2026, 9, 30), 31);
  expect(r.map((p) => p.date)).toEqual(['2026-10-31', '2026-11-30']);
});

it('a long-stale due date is one overdue row plus the real upcoming one — no invented missed months', () => {
  const r = upcomingPayments([loan({ next_payment_date: '2026-08-29' })], today); // 40 days stale, due on the 29th
  expect(r.map((p) => [p.date, p.daysAway])).toEqual([['2026-08-29', -40], ['2026-10-29', 21]]);
});

it('a loan with no minimum payment is not listed', () => {
  expect(upcomingPayments([loan({ next_payment_date: '2026-10-10', minimum_payment: 0 })], today)).toEqual([]);
});
