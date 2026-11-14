import { canMoveGoalCash, goalHorizonRisk, goalProgressAmount, goalReached } from '@/lib/goals/goalMoney';

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

describe('emergency-fund goals', () => {
  it('read the Emergency Wallet balance as progress, invested or not', () => {
    expect(goalProgressAmount({ currentAmount: 0, targetAmount: 180000, valueAmount: '120000.00', tracksEmergency: true })).toBe(120000);
  });

  it('count as reached once the wallet covers the target', () => {
    const goal = { currentAmount: 0, targetAmount: 100000, valueAmount: 150000, tracksEmergency: true, atRiskAmount: 5000, targetDate: inMonths(6) };
    expect(goalHorizonRisk(goal)).toBe(false);
  });
});

describe('reached, and whether there is cash to move', () => {
  it('judges an invested goal on money put in, not a market rise', () => {
    const goal = { currentAmount: 80000, targetAmount: 100000, investedAmount: 50000, valueAmount: 120000, atRiskAmount: 50000, targetDate: inMonths(12) };
    expect(goalReached(goal)).toBe(false);
    expect(goalHorizonRisk(goal)).toBe(true);
  });

  it('offers Reserve / Release only when there is something to do', () => {
    expect(canMoveGoalCash({ currentAmount: 100, targetAmount: 100, reservedAmount: 0 })).toBe(false);   // reached, holds nothing
    expect(canMoveGoalCash({ currentAmount: 100, targetAmount: 100, reservedAmount: 40 })).toBe(true);   // reached, can release
    expect(canMoveGoalCash({ currentAmount: 10, targetAmount: 100, reservedAmount: 0 })).toBe(true);     // open
    expect(canMoveGoalCash({ currentAmount: 0, targetAmount: 100, reservedAmount: 0, tracksEmergency: true })).toBe(false);
  });
});
