import { demoGoalToGoal, goalProgressPercent } from '@/hooks/useGoals';
import type { FinancialGoal } from '@/shared/types';

describe('goalProgressPercent', () => {
    it('uses the server figure when there is one', () => {
        expect(goalProgressPercent({ currentAmount: 0, targetAmount: 100, progressPercentage: 42 })).toBe(42);
    });

    it('derives from current/target when the figure is missing, so it never reads as on-track by accident', () => {
        // `undefined < 70` is false — the bug that showed At-Risk 0 for three overdue goals.
        const p = goalProgressPercent({ currentAmount: 3_200, targetAmount: 8_000 });
        expect(p).toBe(40);
        expect(p < 70).toBe(true);
    });

    it('is 0 for a goal with no target', () => {
        expect(goalProgressPercent({ currentAmount: 10, targetAmount: 0 })).toBe(0);
    });
});

describe('demoGoalToGoal', () => {
    it('fills the derived fields the pages read', () => {
        const fixture = {
            id: '3', userId: 'demo-user', title: 'Japan', currentAmount: 3_200, targetAmount: 8_000,
            currency: 'TWD', targetDate: new Date('2026-12-09T00:00:00Z'), category: 'vacation',
            status: 'active', priority: 'medium', milestones: [], contributions: [],
            createdAt: new Date('2024-01-01T00:00:00Z'), updatedAt: new Date('2024-01-15T00:00:00Z'),
        } as FinancialGoal;
        const goal = demoGoalToGoal(fixture);
        expect(goal.progressPercentage).toBe(40);
        expect(goal.remainingAmount).toBe(4_800);
        expect(goal.targetDate).toBe('2026-12-09T00:00:00.000Z');
    });
});

describe('demo goals', () => {
    // Imported lazily so the module-level mocks above stay irrelevant to it.
    const { renderHook } = jest.requireActual('@testing-library/react') as typeof import('@testing-library/react');
    const { DemoProvider, useDemo } = jest.requireActual('@/contexts/DemoContext') as typeof import('@/contexts/DemoContext');

    it('are dated in the future, and one sits inside the default 90-day alert window', () => {
        const { result } = renderHook(() => useDemo(), { wrapper: DemoProvider });
        const now = Date.now();
        const goals = result.current.demoGoals.map(demoGoalToGoal);
        for (const g of goals) expect(new Date(g.targetDate!).getTime()).toBeGreaterThan(now);

        const ninetyDays = 90 * 24 * 60 * 60 * 1000;
        const atRisk = goals.filter(
            (g) => new Date(g.targetDate!).getTime() - now <= ninetyDays && goalProgressPercent(g) < 70,
        );
        expect(atRisk.map((g) => g.title)).toEqual(['Japan Vacation']);
    });
});
