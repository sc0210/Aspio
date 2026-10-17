import { selectPrimaryGoal } from '@/hooks/useDashboardSummary';
import type { Goal } from '@/hooks/useGoals';

const goal = (over: Partial<Goal> & { title: string }): Goal =>
    ({ id: over.title, currentAmount: 0, targetAmount: 0, ...over } as Goal);

const PORTFOLIO = 4_916_000; // NT$491.6萬

describe('selectPrimaryGoal', () => {
    it('shows a retirement goal at its portfolio value, not its (empty) stored amount', () => {
        // The reported bug: "Retirement Fund" rendered NT$0 · 0% against a 600萬
        // target while the portfolio sat at millions. Nothing is ever deposited
        // into a retirement goal — the portfolio IS its progress.
        const { primaryGoal, goalPct } = selectPrimaryGoal(
            [goal({ title: 'Retirement Fund', currentAmount: 0, targetAmount: 6_000_000 })],
            PORTFOLIO,
        );
        expect(primaryGoal!.currentAmount).toBe(PORTFOLIO);
        expect(Math.round(goalPct)).toBe(82);
    });

    it('matches retirement goals by the shared heuristic, including Chinese titles', () => {
        for (const title of ['退休金', '財務自由', 'FIRE number']) {
            const { goalPct } = selectPrimaryGoal(
                [goal({ title, currentAmount: 0, targetAmount: 6_000_000 })],
                PORTFOLIO,
            );
            expect(goalPct).toBeGreaterThan(0);
        }
    });

    it('never lowers a retirement goal that has more saved than the portfolio', () => {
        const { primaryGoal } = selectPrimaryGoal(
            [goal({ title: 'Retirement', currentAmount: 9_000_000, targetAmount: 20_000_000 })],
            PORTFOLIO,
        );
        expect(primaryGoal!.currentAmount).toBe(9_000_000);
    });

    it('leaves non-retirement goals on their own stored amount', () => {
        const { primaryGoal, goalPct } = selectPrimaryGoal(
            [goal({ title: 'House Down Payment', currentAmount: 45_000, targetAmount: 100_000 })],
            PORTFOLIO,
        );
        expect(primaryGoal!.currentAmount).toBe(45_000);
        expect(goalPct).toBe(45);
    });

    it('compares targets numerically — string Decimals must not sort lexicographically', () => {
        // The backend serialises Decimal as strings. "600000" > "1000000" is true
        // for strings, which would feature the smaller goal.
        const { primaryGoal } = selectPrimaryGoal(
            [
                goal({ title: 'Small', targetAmount: '600000' as unknown as number }),
                goal({ title: 'Big', targetAmount: '1000000' as unknown as number }),
            ],
            0,
        );
        expect(primaryGoal!.title).toBe('Big');
    });

    it('caps at 100% and never goes negative', () => {
        const over = selectPrimaryGoal(
            [goal({ title: 'Done', currentAmount: 500, targetAmount: 100 })], 0);
        expect(over.goalPct).toBe(100);

        const neg = selectPrimaryGoal(
            [goal({ title: 'Odd', currentAmount: -50, targetAmount: 100 })], 0);
        expect(neg.goalPct).toBe(0);
    });

    it('handles no goals and a zero target without dividing by zero', () => {
        expect(selectPrimaryGoal([], PORTFOLIO)).toEqual({ primaryGoal: null, goalPct: 0 });

        const { goalPct } = selectPrimaryGoal(
            [goal({ title: 'Untargeted', currentAmount: 10, targetAmount: 0 })], 0);
        expect(goalPct).toBe(0);
        expect(Number.isNaN(goalPct)).toBe(false);
    });

    it('credits the portfolio to one retirement goal, not to each that matches', () => {
        // Two matches used to both read the whole portfolio, counting it twice.
        const goals = [
            goal({ title: 'Retirement Fund', currentAmount: 0, targetAmount: 6_000_000 }),
            goal({ title: 'FIRE by 45', currentAmount: 0, targetAmount: 3_000_000 }),
        ];
        const { primaryGoal } = selectPrimaryGoal(goals, PORTFOLIO);
        expect(primaryGoal!.title).toBe('Retirement Fund');
        expect(primaryGoal!.currentAmount).toBe(PORTFOLIO);

        const { primaryGoal: other } = selectPrimaryGoal([goals[1]], 0);
        expect(other!.currentAmount).toBe(0);
    });

        it('does not apply the override when the portfolio is empty', () => {
        const { primaryGoal } = selectPrimaryGoal(
            [goal({ title: 'Retirement Fund', currentAmount: 0, targetAmount: 6_000_000 })],
            0,
        );
        expect(primaryGoal!.currentAmount).toBe(0);
    });
});
