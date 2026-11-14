import { goalHorizonRisk, goalProgressAmount } from '@/lib/goals/goalMoney';

const inMonths = (m: number) => new Date(Date.now() + m * 30.44 * 86_400_000).toISOString();

describe('goalProgressAmount', () => {
  it('reads market value once something is invested, what was put in otherwise', () => {
    expect(goalProgressAmount({ currentAmount: '50000.00', targetAmount: 1, investedAmount: '10250.00', valueAmount: '45250.00' })).toBe(45250);
    // Nothing invested: keep currentAmount, which a retirement goal gets from the portfolio upstream.
    expect(goalProgressAmount({ currentAmount: 812000, targetAmount: 1, investedAmount: '0', valueAmount: '0' })).toBe(812000);
  });
});

describe('goalHorizonRisk', () => {
  const base = { currentAmount: 1000, targetAmount: 100000, atRiskAmount: '5000' };

  it('warns for a goal due within 3 years with money in a market', () => {
    expect(goalHorizonRisk({ ...base, targetDate: inMonths(18) })).toBe(true);
  });

  it('stays quiet when the date is far, the money is steady, or the goal is reached', () => {
    expect(goalHorizonRisk({ ...base, targetDate: inMonths(48) })).toBe(false);
    expect(goalHorizonRisk({ ...base, atRiskAmount: '0', targetDate: inMonths(18) })).toBe(false);
    expect(goalHorizonRisk({ ...base, status: 'completed', targetDate: inMonths(18) })).toBe(false);
    expect(goalHorizonRisk({ ...base, targetDate: null })).toBe(false);
  });
});
