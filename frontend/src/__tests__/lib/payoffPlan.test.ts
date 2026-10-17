import { minimumsOnly, payoffPlan, planInputs, MAX_MONTHS, type PayoffLoan } from '@/lib/finance/payoffPlan';

const loan = (id: string, balance: number, annualRatePct: number, minimumPayment: number): PayoffLoan =>
  ({ id, name: id, balance, annualRatePct, minimumPayment });

describe('payoff plan', () => {
  it('an interest-free loan clears in balance / payment months', () => {
    const l = [loan('a', 12_000, 0, 1_000)];
    expect(minimumsOnly(l).months).toBe(12);
    expect(minimumsOnly(l).totalInterest).toBe(0);
    expect(payoffPlan(l, 'avalanche', 1_000).months).toBe(6);
  });

  it('series starts at today and ends at zero', () => {
    const r = payoffPlan([loan('a', 3_000, 0, 1_000)], 'snowball', 0);
    expect(r.series).toEqual([3_000, 2_000, 1_000, 0]);
  });

  it('rolls a cleared minimum into the next target (budget stays constant)', () => {
    // b clears in month 1; its 1,000 then goes to a, so a needs fewer months than alone.
    const loans = [loan('a', 10_000, 0, 1_000), loan('b', 1_000, 0, 1_000)];
    expect(minimumsOnly(loans).months).toBe(10);
    expect(payoffPlan(loans, 'snowball', 0).months).toBe(6);
  });

  it('avalanche targets the highest rate, snowball the smallest balance', () => {
    const loans = [loan('cheap-small', 5_000, 2, 200), loan('dear-big', 50_000, 15, 1_000)];
    const av = payoffPlan(loans, 'avalanche', 3_000);
    const sb = payoffPlan(loans, 'snowball', 3_000);
    expect(sb.payoffOrder[0].id).toBe('cheap-small');
    expect(av.totalInterest).toBeLessThan(sb.totalInterest);
  });

  it('a minimum below the monthly interest never pays off on its own', () => {
    // 12%/yr on 100k is 1,000/mo of interest; a 500 minimum loses ground.
    const l = [loan('a', 100_000, 12, 500)];
    const base = minimumsOnly(l);
    expect(base.months).toBeNull();
    expect(base.series).toHaveLength(MAX_MONTHS + 1);
    // An extra 1,500 turns it into a plan with a date.
    expect(payoffPlan(l, 'avalanche', 1_500).months).not.toBeNull();
  });

  it('extra money never makes the plan slower or dearer than minimums', () => {
    const loans = [loan('m', 1_200_000, 2.1, 22_000), loan('c', 45_000, 15, 5_000)];
    const base = minimumsOnly(loans);
    const plan = payoffPlan(loans, 'avalanche', 5_000);
    expect(plan.months!).toBeLessThan(base.months!);
    expect(plan.totalInterest).toBeLessThan(base.totalInterest);
  });
});

describe('planInputs', () => {
  const rec = (id: string, currency: string, balance: unknown, rate: unknown = '2.1', min: unknown = '1000') =>
    ({ id, name: id, currency, current_balance: balance as number, interest_rate: rate as number, minimum_payment: min as number });

  it('keeps the currency with the most debt and counts what it left out', () => {
    const r = planInputs([rec('a', 'TWD', '900000'), rec('b', 'USD', '5000'), rec('c', 'TWD', 100)]);
    expect(r.currency).toBe('TWD');
    expect(r.loans.map((l) => l.id)).toEqual(['a', 'c']);
    expect(r.excluded).toBe(1);
  });

  it('coerces decimal strings and turns junk into 0 rather than NaN', () => {
    const [l] = planInputs([rec('a', 'TWD', '1200.50', null, 'n/a')]).loans;
    expect(l).toMatchObject({ balance: 1200.5, annualRatePct: 0, minimumPayment: 0 });
  });
});
