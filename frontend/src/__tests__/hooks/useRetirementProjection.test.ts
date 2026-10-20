/**
 * useRetirementProjection is pure arithmetic over the portfolio total and the
 * user's goals, and its numbers are shown as advice ("save NT$X a month"). These
 * pin the formulas: stage thresholds, the years-to-target search, the 4% rule and
 * the PMT for the monthly amount required.
 */
import { renderHook } from '@testing-library/react';
import { useRetirementProjection, FINANCIAL_STAGES } from '@/hooks/useRetirementProjection';
import { useGoals } from '@/hooks/useGoals';

jest.mock('@/hooks/useGoals', () => ({
  useGoals: jest.fn(),
}));

const mockUseGoals = useGoals as jest.Mock;

type GoalLike = { id: string; title: string; targetAmount: number; category?: string; status?: string; targetDate?: string };
const goal = (over: Partial<GoalLike>): GoalLike => ({
  id: 'g', title: 'Goal', targetAmount: 0, status: 'active', ...over,
});

function project(portfolio: Parameters<typeof useRetirementProjection>[0], goals: GoalLike[] = [], isLoading = false) {
  mockUseGoals.mockReturnValue({ data: goals, isLoading });
  return renderHook(() => useRetirementProjection(portfolio)).result.current;
}

afterEach(() => {
  jest.useRealTimers();
});

describe('target and goal selection', () => {
  it('uses the retirement goal even when another goal is larger', () => {
    const r = project({ totalValue: 1_000_000 }, [
      goal({ id: 'house', title: 'House', targetAmount: 30_000_000 }),
      goal({ id: 'fire', title: 'FIRE', targetAmount: 20_000_000 }),
    ]);

    expect(r.retirementGoal?.id).toBe('fire');
    expect(r.targetValue).toBe(20_000_000);
    expect(r.hasRetirementGoal).toBe(true);
    expect(r.progressPercent).toBe(5);
  });

  it('falls back to the largest goal so Edit Goal has something to open', () => {
    const r = project({ totalValue: 0 }, [
      goal({ id: 'a', title: 'Car', targetAmount: 900_000 }),
      goal({ id: 'b', title: 'House', targetAmount: 10_000_000 }),
    ]);

    expect(r.retirementGoal?.id).toBe('b');
  });

  it('without goals targets the larger of 3x the portfolio and 10M', () => {
    expect(project({ totalValue: 1_000_000 }).targetValue).toBe(10_000_000);
    expect(project({ totalValue: 5_000_000 }).targetValue).toBe(15_000_000);
    expect(project({ totalValue: 1_000_000 }).hasRetirementGoal).toBe(false);
  });

  it('treats a null portfolio as zero', () => {
    const r = project(null);

    expect(r.currentValue).toBe(0);
    expect(r.progressPercent).toBe(0);
    expect(r.yearsToTarget).toBeNull();
    expect(r.targetYear).toBeNull();
    expect(r.stage.key).toBe('starting');
  });

  it('passes the goals loading flag through', () => {
    expect(project(null, [], true).isLoading).toBe(true);
  });
});

describe('stages', () => {
  it.each([
    [0, 'starting'],
    [4.99, 'starting'],
    [5, 'foundation'],
    [15, 'accumulating'],
    [30, 'growing'],
    [50, 'accelerating'],
    [75, 'coasting'],
    [100, 'independence'],
  ])('%s%% of target is %s', (pct, key) => {
    const r = project({ totalValue: pct * 100_000 }, [goal({ title: 'Retire', targetAmount: 10_000_000 })]);

    expect(r.stage.key).toBe(key);
    expect(FINANCIAL_STAGES[r.stageIndex].key).toBe(key);
  });

  it('caps displayed progress at 150%', () => {
    const r = project({ totalValue: 30_000_000 }, [goal({ title: 'Retire', targetAmount: 10_000_000 })]);

    expect(r.progressPercent).toBe(150);
    expect(r.yearsToTarget).toBe(0);
  });
});

describe('years to target', () => {
  it('estimates savings as cost spread over at least 12 months', () => {
    expect(project({ totalValue: 0, totalCost: 1_200_000, holdings: [1, 2] }).estimatedMonthlySavings).toBe(100_000);
    // 10 holdings → 20 months
    expect(project({ totalValue: 0, totalCost: 1_200_000, holdings: Array(10).fill(0) }).estimatedMonthlySavings).toBe(60_000);
  });

  it('finds the first year the annuity reaches the target at 7%', () => {
    const r = project(
      { totalValue: 1_000_000, totalCost: 1_200_000, holdings: [] },
      [goal({ title: 'Retire', targetAmount: 10_000_000 })],
    );

    // Recompute independently: smallest whole month n with FV(n) >= target.
    const rate = 0.07 / 12;
    let n = 1;
    while (1_000_000 * (1 + rate) ** n + 100_000 * ((1 + rate) ** n - 1) / rate < 10_000_000) n++;

    expect(r.yearsToTarget).toBe(Math.ceil(n / 12));
    expect(r.targetYear).toBe(new Date().getFullYear() + r.yearsToTarget!);
  });

  it('uses growth alone when there are no contributions', () => {
    const r = project({ totalValue: 5_000_000, totalCost: 0 }, [goal({ title: 'Retire', targetAmount: 10_000_000 })]);

    // ln(2)/ln(1.07) = 10.24 → 11 years
    expect(r.yearsToTarget).toBe(11);
  });
});

describe('withdrawal and milestones', () => {
  it('applies the 4% rule', () => {
    const r = project({ totalValue: 12_000_000 });

    expect(r.safeWithdrawalAmount).toBe(480_000);
    expect(r.monthlyPassiveIncome).toBe(40_000);
  });

  it('marks milestones reached at their share of the target', () => {
    const r = project({ totalValue: 3_000_000 }, [goal({ title: 'Retire', targetAmount: 10_000_000 })]);
    const byKey = Object.fromEntries(r.milestones.map((m) => [m.key, m]));

    expect(r.milestones.map((m) => m.key)).toEqual([
      'firstStep', 'foundation', 'tenPercent', 'quarter', 'halfway', 'threeQuarters', 'freedom',
    ]);
    expect(byKey.quarter).toMatchObject({ amount: 2_500_000, reached: true, progress: 100 });
    expect(byKey.halfway).toMatchObject({ amount: 5_000_000, reached: false, progress: 60 });
    expect(byKey.freedom.progress).toBe(30);
  });
});

describe('monthly required (PMT)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00+08:00'));
  });

  it('is null without an explicit target date', () => {
    expect(project({ totalValue: 1_000_000 }, [goal({ title: 'Retire', targetAmount: 10_000_000 })]).monthlyRequired)
      .toBeNull();
  });

  it('is null when the target date has passed', () => {
    const r = project({ totalValue: 1_000_000 }, [
      goal({ title: 'Retire', targetAmount: 10_000_000, targetDate: '2025-01-01' }),
    ]);
    expect(r.monthlyRequired).toBeNull();
  });

  it('solves PMT for the months left', () => {
    const r = project({ totalValue: 1_000_000 }, [
      goal({ title: 'Retire', targetAmount: 10_000_000, targetDate: '2036-01-01' }),
    ]);

    const rate = 0.07 / 12;
    const months = Math.round((new Date('2036-01-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44));
    const factor = (1 + rate) ** months;
    const expected = ((10_000_000 - 1_000_000 * factor) * rate) / (factor - 1);

    expect(months).toBe(120);
    expect(r.monthlyRequired).toBeCloseTo(expected, 6);
    // Sanity: well under the naive (target - current) / months.
    expect(r.monthlyRequired!).toBeLessThan(9_000_000 / 120);
  });

  it('is zero when growth alone gets there by the deadline', () => {
    const r = project({ totalValue: 9_000_000 }, [
      goal({ title: 'Retire', targetAmount: 10_000_000, targetDate: '2036-01-01' }),
    ]);
    expect(r.monthlyRequired).toBe(0);
  });
});
