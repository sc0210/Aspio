import { planGoals, planTrajectory, MAX_PLAN_MONTHS, type PlanInputs } from '@/hooks/useGoalPlanning';

// 1M net worth (600k invested), saving 50k/mo, 12%/yr, 80% invested.
const base: PlanInputs = {
    netWorth: 1_000_000,
    portfolioWallet: 600_000,
    monthlySavings: 50_000,
    annualReturnPct: 12,
    investedPct: 80,
};

const goal = (over: Partial<{ id: string; title: string; category: string; targetAmount: number; targetDate: string | null }> = {}) => ({
    id: 'g1', title: 'House', category: 'house_down_payment', targetAmount: 2_000_000, targetDate: null, ...over,
});

function futureDate(months: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString();
}

describe('planTrajectory', () => {
    it('month 0 equals net worth; grows with savings + return', () => {
        const t = planTrajectory(base, 12);
        expect(t[0]).toBe(1_000_000);
        expect(t[12]).toBeGreaterThan(1_000_000 + 12 * 50_000); // savings plus some return
    });

    it('with 0% return and 0% invested it is pure accumulation', () => {
        const t = planTrajectory({ ...base, annualReturnPct: 0, investedPct: 0 }, 10);
        expect(t[10]).toBeCloseTo(1_000_000 + 10 * 50_000, 6);
    });
});

describe('planGoals', () => {
    it('target below current net worth → affordable now (ETA 0)', () => {
        const [p] = planGoals(base, [goal({ targetAmount: 800_000 })]);
        expect(p.status).toBe('affordable');
        expect(p.etaMonths).toBe(0);
    });

    it('undated goal → etaOnly with a sensible crossing month', () => {
        const [p] = planGoals(base, [goal()]); // 2M target
        expect(p.status).toBe('etaOnly');
        expect(p.etaMonths).toBeGreaterThan(6);
        expect(p.etaMonths!).toBeLessThan(30); // ~1M gap at 50k+returns/mo
        const t = planTrajectory(base);
        expect(t[p.etaMonths!]).toBeGreaterThanOrEqual(2_000_000);
        expect(t[p.etaMonths! - 1]).toBeLessThan(2_000_000);
    });

    it('generous deadline → onTrack with zero extra needed', () => {
        const [p] = planGoals(base, [goal({ targetDate: futureDate(36) })]);
        expect(p.status).toBe('onTrack');
        expect(p.requiredExtraPerMonth).toBe(0);
    });

    it('tight deadline → short, and the extra amount actually closes the gap', () => {
        const deadline = 10;
        const [p] = planGoals(base, [goal({ targetDate: futureDate(deadline) })]);
        expect(p.status).toBe('short');
        expect(p.requiredExtraPerMonth).toBeGreaterThan(0);
        // Verify: rerun with savings raised by the suggested extra → on/at target by deadline.
        const t = planTrajectory({ ...base, monthlySavings: base.monthlySavings + p.requiredExtraPerMonth! });
        expect(t[deadline + 1]).toBeGreaterThanOrEqual(2_000_000 * 0.999); // ceil + month-rounding slack
    });

    it('negative savings and unreachable target → unreachable', () => {
        const [p] = planGoals(
            { ...base, monthlySavings: -10_000, annualReturnPct: 0 },
            [goal({ targetAmount: 5_000_000 })],
        );
        expect(p.status).toBe('unreachable');
        expect(p.etaMonths).toBeNull();
    });

    it('caps the search at MAX_PLAN_MONTHS', () => {
        const t = planTrajectory(base);
        expect(t.length).toBe(MAX_PLAN_MONTHS + 1);
    });
});
