import { demoGroupExpenses, demoLoans } from '@/data/demoData';
import { demoReviewForMonth, demoReviewMonth, demoReviewPreviousMonth } from '@/data/demoReview';
import { minimumsOnly } from '@/lib/finance/payoffPlan';

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shift = (months: number) => {
    const now = new Date();
    return key(new Date(now.getFullYear(), now.getMonth() + months, 1));
};

describe('demo group expenses', () => {
    it('are never dated after now', () => {
        const now = Date.now();
        for (const expenses of Object.values(demoGroupExpenses)) {
            for (const e of expenses) expect(new Date(e.created_at).getTime()).toBeLessThanOrEqual(now);
        }
    });
});

describe('demo loans', () => {
    it("state payoff figures the Loans page's own planner agrees with", () => {
        for (const loan of demoLoans) {
            const plan = minimumsOnly([{
                id: loan.id, name: loan.name, balance: Number(loan.current_balance),
                annualRatePct: Number(loan.interest_rate), minimumPayment: Number(loan.minimum_payment),
            }]);
            expect(loan.payoff_months_estimate).toBe(plan.months);
            expect(loan.total_interest_remaining).toBe(Math.round(plan.totalInterest));
        }
    });

    it('no longer claims ~206 payments for NT$1.2M at 2.1% and NT$22K a month', () => {
        const mortgage = demoLoans.find((l) => l.account_type === 'mortgage')!;
        expect(mortgage.payoff_months_estimate).toBeGreaterThan(50);
        expect(mortgage.payoff_months_estimate).toBeLessThan(65);
        expect(mortgage.total_interest_remaining).toBeLessThan(100_000);
    });
});

describe('demo /review months', () => {
    it('keeps the hand-written current and previous months', () => {
        expect(demoReviewForMonth(shift(0))).toBe(demoReviewMonth);
        expect(demoReviewForMonth(shift(-1))).toBe(demoReviewPreviousMonth);
    });

    it('does not reuse one month\'s figures for another', () => {
        const totals = [0, -1, -2, -3].map((m) => demoReviewForMonth(shift(m))?.totalExpenses);
        expect(new Set(totals).size).toBe(totals.length);
    });

    it('reads a future month, or one past the trend window, as empty', () => {
        expect(demoReviewForMonth(shift(1))).toBeNull();
        expect(demoReviewForMonth(shift(-12))).toBeNull();
    });
});
