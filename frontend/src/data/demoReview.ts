// Demo-mode fixtures for the /review page: one calendar month, and the month
// before it, at the demo story's monthly scale: income NT$78,000 a month.

import type { SpendingReport } from '@/services/reportsService';
import type { ReviewExpense } from '@/hooks/useReviewTopExpenses';

const MONTHLY_INCOME = 78_000;

// Sums to totalExpenses. Kept as literals: the split is the point of the page.
const THIS_MONTH = [
    { category: 'Housing', amount: 10_000, transactionCount: 1, color: '#3b82f6' },
    { category: 'Food & Dining', amount: 4_600, transactionCount: 24, color: '#f59e0b' },
    { category: 'Utilities', amount: 3_000, transactionCount: 2, color: '#10b981' },
    { category: 'Shopping', amount: 2_700, transactionCount: 3, color: '#8b5cf6' },
    { category: 'Healthcare', amount: 2_600, transactionCount: 1, color: '#ef4444' },
    { category: 'Transportation', amount: 1_700, transactionCount: 8, color: '#06b6d4' },
    { category: 'Entertainment', amount: 1_600, transactionCount: 3, color: '#ec4899' },
];

const LAST_MONTH = [
    { category: 'Housing', amount: 10_000, transactionCount: 1, color: '#3b82f6' },
    { category: 'Food & Dining', amount: 3_900, transactionCount: 21, color: '#f59e0b' },
    { category: 'Shopping', amount: 3_400, transactionCount: 5, color: '#8b5cf6' },
    { category: 'Utilities', amount: 2_800, transactionCount: 2, color: '#10b981' },
    { category: 'Healthcare', amount: 2_600, transactionCount: 1, color: '#ef4444' },
    { category: 'Transportation', amount: 1_600, transactionCount: 7, color: '#06b6d4' },
    { category: 'Entertainment', amount: 1_000, transactionCount: 2, color: '#ec4899' },
];

// Where the income came from. Both months sum to MONTHLY_INCOME, so the income
// card and the hero's income figure agree; the split moves so the card has a
// change worth reading (a bonus this month, less freelance work).
const INCOME_THIS_MONTH = [
    { category: 'Salary', amount: 68_000, transactionCount: 1, color: '#10b981' },
    { category: 'Bonus', amount: 6_000, transactionCount: 1, color: '#22c55e' },
    { category: 'Freelance', amount: 3_000, transactionCount: 2, color: '#14b8a6' },
    { category: 'Dividends', amount: 1_000, transactionCount: 1, color: '#84cc16' },
];

const INCOME_LAST_MONTH = [
    { category: 'Salary', amount: 68_000, transactionCount: 1, color: '#10b981' },
    { category: 'Freelance', amount: 9_000, transactionCount: 3, color: '#14b8a6' },
    { category: 'Dividends', amount: 1_000, transactionCount: 1, color: '#84cc16' },
];

const total = (rows: typeof THIS_MONTH) => rows.reduce((sum, row) => sum + row.amount, 0);

function withPercentages(rows: typeof THIS_MONTH) {
    const expenses = total(rows);
    return rows.map((row) => ({
        ...row,
        percentage: Math.round((row.amount / expenses) * 1000) / 10,
    }));
}

const THIS_MONTH_EXPENSES = total(THIS_MONTH);
const LAST_MONTH_EXPENSES = total(LAST_MONTH);

export const demoReviewPreviousMonth: SpendingReport = {
    totalIncome: MONTHLY_INCOME,
    totalExpenses: LAST_MONTH_EXPENSES,
    netSavings: MONTHLY_INCOME - LAST_MONTH_EXPENSES,
    savingsRate: Math.round(((MONTHLY_INCOME - LAST_MONTH_EXPENSES) / MONTHLY_INCOME) * 1000) / 10,
    categoryBreakdown: withPercentages(LAST_MONTH),
    incomeBreakdown: withPercentages(INCOME_LAST_MONTH),
    monthlyTrends: [],
    topMerchants: [
        { name: 'Taipei Apartment (Rent)', amount: 10_000 },
        { name: 'PX Mart', amount: 2_100 },
        { name: 'Eslite Bookstore', amount: 1_900 },
    ],
    averageDailySpending: Math.round(LAST_MONTH_EXPENSES / 30),
    insights: [],
};

export const demoReviewMonth: SpendingReport = {
    totalIncome: MONTHLY_INCOME,
    totalExpenses: THIS_MONTH_EXPENSES,
    netSavings: MONTHLY_INCOME - THIS_MONTH_EXPENSES,
    savingsRate: Math.round(((MONTHLY_INCOME - THIS_MONTH_EXPENSES) / MONTHLY_INCOME) * 1000) / 10,
    categoryBreakdown: withPercentages(THIS_MONTH),
    incomeBreakdown: withPercentages(INCOME_THIS_MONTH),
    monthlyTrends: [],
    topMerchants: [
        { name: 'Taipei Apartment (Rent)', amount: 10_000 },
        { name: 'PX Mart', amount: 2_300 },
        { name: 'Taipei Power Company', amount: 1_800 },
        { name: 'MRT / EasyCard', amount: 1_400 },
        { name: 'Eslite Bookstore', amount: 1_200 },
    ],
    averageDailySpending: Math.round(THIS_MONTH_EXPENSES / 30),
    insights: [
        {
            type: 'positive',
            title: 'Two-thirds of income kept',
            description: 'A savings rate above 60% is well past the 20% rule of thumb.',
            impact: 'high',
        },
        {
            type: 'neutral',
            title: 'Eating out drifted up',
            description: 'Food & Dining rose against last month while everything else held.',
            impact: 'medium',
        },
    ],
    comparisonPeriod: {
        income: MONTHLY_INCOME,
        expenses: LAST_MONTH_EXPENSES,
        netSavings: MONTHLY_INCOME - LAST_MONTH_EXPENSES,
    },
};

/**
 * Twelve months of totals for the demo's month-in-context strip.
 *
 * Only `monthlyTrends` is read from this, but it is typed as a full report so
 * the demo takes the same shape as the live answer — a fixture that is a
 * different shape from the thing it stands in for is how demo mode drifts.
 * Expenses wander around the NT$26,000 the current month spends, with a
 * December that a year-end trip made expensive, so the strip has something to
 * show and a rank to state.
 */
const TRAILING_EXPENSES = [30_000, 28_000, 60_000, 25_000, 26_000, 24_000, 27_000, 31_000, 29_000, 26_000, 25_300, 26_200];

function monthsBack(count: number): string[] {
    const now = new Date();
    return Array.from({ length: count }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
}

export const demoReviewTrends: SpendingReport = {
    ...demoReviewMonth,
    monthlyTrends: monthsBack(TRAILING_EXPENSES.length).map((month, i) => ({
        month,
        income: MONTHLY_INCOME,
        expenses: TRAILING_EXPENSES[i],
        net: MONTHLY_INCOME - TRAILING_EXPENSES[i],
        amount: TRAILING_EXPENSES[i],
    })),
};

/**
 * The month's biggest single expenses, for the "Biggest expenses" card. Drawn
 * from THIS_MONTH so each row sits inside its category's total above it.
 */
const DEMO_TOP_EXPENSES = [
    { id: 'demo-top-1', description: 'Taipei Apartment (Rent)', category: 'Housing', amount: 10_000, currency: 'TWD', day: 3 },
    { id: 'demo-top-2', description: 'Annual health check', category: 'Healthcare', amount: 2_600, currency: 'TWD', day: 12 },
    { id: 'demo-top-3', description: 'Taipei Power Company', category: 'Utilities', amount: 1_800, currency: 'TWD', day: 8 },
    { id: 'demo-top-4', description: 'Running shoes', category: 'Shopping', amount: 1_500, currency: 'TWD', day: 17 },
    { id: 'demo-top-5', description: 'Concert tickets', category: 'Entertainment', amount: 1_200, currency: 'TWD', day: 21 },
];

/**
 * Demo rows dated inside the month on screen, never after its last elapsed day
 * — a running month shows no expense from the future.
 */
export function demoReviewTopExpenses(range: { key: string; days: number }): ReviewExpense[] {
    const last = Math.max(1, range.days);
    return DEMO_TOP_EXPENSES.map(({ day, ...row }) => ({
        ...row,
        date: `${range.key}-${String(Math.min(day, last)).padStart(2, '0')}`,
    }));
}

/** Whole months from `monthKey` back to today's month (0 = this month). */
function monthsAgo(monthKey: string, today: Date = new Date()): number {
    const [y, m] = monthKey.split('-').map(Number);
    return (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
}

const FIXED_CATEGORIES = new Set(['Housing']);

/**
 * An older demo month, derived rather than hand-written: last month's split
 * with the variable categories scaled to that month's total on the trend strip
 * (rent stays rent). Every month used to reuse this month's report, so
 * September and October read identically.
 */
function scaledMonth(expensesTarget: number, previousTarget: number | null): SpendingReport {
    const fixed = LAST_MONTH.filter((r) => FIXED_CATEGORIES.has(r.category)).reduce((s, r) => s + r.amount, 0);
    const variable = LAST_MONTH_EXPENSES - fixed;
    const factor = variable > 0 ? Math.max(0, expensesTarget - fixed) / variable : 1;
    const rows = LAST_MONTH.map((row) =>
        FIXED_CATEGORIES.has(row.category)
            ? row
            : { ...row, amount: Math.round(row.amount * factor), transactionCount: Math.max(1, Math.round(row.transactionCount * factor)) },
    ).sort((a, b) => b.amount - a.amount);
    const expenses = total(rows);
    return {
        totalIncome: MONTHLY_INCOME,
        totalExpenses: expenses,
        netSavings: MONTHLY_INCOME - expenses,
        savingsRate: Math.round(((MONTHLY_INCOME - expenses) / MONTHLY_INCOME) * 1000) / 10,
        categoryBreakdown: withPercentages(rows),
        incomeBreakdown: withPercentages(INCOME_LAST_MONTH),
        monthlyTrends: [],
        topMerchants: [{ name: 'Taipei Apartment (Rent)', amount: 10_000 }],
        averageDailySpending: Math.round(expenses / 30),
        insights: [],
        ...(previousTarget !== null
            ? { comparisonPeriod: { income: MONTHLY_INCOME, expenses: previousTarget, netSavings: MONTHLY_INCOME - previousTarget } }
            : {}),
    };
}

/**
 * The demo report for one calendar month, or null (an empty month) outside the
 * twelve the trend strip covers — including any month after this one.
 */
export function demoReviewForMonth(monthKey: string, today: Date = new Date()): SpendingReport | null {
    const ago = monthsAgo(monthKey, today);
    if (ago === 0) return demoReviewMonth;
    if (ago === 1) return demoReviewPreviousMonth;
    if (ago < 0 || ago >= TRAILING_EXPENSES.length) return null;
    const at = TRAILING_EXPENSES.length - 1 - ago;
    return scaledMonth(TRAILING_EXPENSES[at], at > 0 ? TRAILING_EXPENSES[at - 1] : null);
}

/** Top expenses only for months that have a demo report; an empty month has none. */
export function demoReviewTopExpensesForMonth(range: { key: string; days: number }, today: Date = new Date()): ReviewExpense[] {
    return demoReviewForMonth(range.key, today) ? demoReviewTopExpenses(range) : [];
}
