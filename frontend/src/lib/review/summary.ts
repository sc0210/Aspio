/**
 * The month's figures, reduced to what the review page actually says.
 *
 * All of it is derived here rather than in the page so the arithmetic is
 * testable without mounting anything, and so the same rule is applied to every
 * figure on the screen — a month-over-month change means one thing on this
 * page, not four things that happen to look alike.
 *
 * Inputs are structural on purpose: the shapes below are the fields this
 * module reads off `SpendingReport`, not the whole report. That keeps the
 * tests free of fixture ceremony and keeps this file from depending on the
 * service layer.
 */

import type { MonthRange } from './monthRange';

export interface CategoryAmount {
    category: string;
    amount: number;
    transactionCount?: number;
    color?: string;
}

export interface SpendingLike {
    totalIncome: number;
    totalExpenses: number;
    categoryBreakdown?: CategoryAmount[];
    incomeBreakdown?: CategoryAmount[];
    topMerchants?: Array<{ name?: string; amount?: number }>;
}

/**
 * A change against the month before.
 *
 * `percent` is undefined when the previous month was zero or negative — the
 * same rule `lib/dashboard/periodChange` applies to balances, for the same
 * reason: there is no meaningful percentage of a non-positive base, and the
 * sign of one against a negative base is nonsense. The money that moved is
 * still real, so `amount` is always reported.
 */
export interface Delta {
    amount: number;
    percent: number | undefined;
}

export function delta(current: number, previous: number): Delta {
    const amount = current - previous;
    return { amount, percent: previous > 0 ? (amount / previous) * 100 : undefined };
}

/** One category — of spending or of income — this month beside last. */
export interface CategoryLine {
    category: string;
    /** This month's amount. Zero for a category only last month had. */
    amount: number;
    /** Last month's amount. Zero for one that is new this month. */
    previous: number;
    /** `amount - previous`. Positive means more than last month. */
    change: number;
    /** Share of this month's total of its kind (expenses or income), 0–100. */
    share: number;
    transactionCount: number;
    color?: string;
}

/**
 * How the month went, in one word — the page picks its headline from this.
 *
 * Thresholds are the savings-rate rules of thumb the rest of the app already
 * states (`MonthlyInsightCard` colours the same figure at 20%); the point of
 * naming them once here is that the verdict sentence and the colour beside it
 * cannot disagree.
 */
export type Verdict = 'over' | 'tight' | 'steady' | 'strong';

export function verdictFor(net: number, savingsRate: number | undefined): Verdict {
    if (net < 0) return 'over';
    if (savingsRate === undefined) return 'steady';
    if (savingsRate < 10) return 'tight';
    if (savingsRate < 30) return 'steady';
    return 'strong';
}

export interface MonthReview {
    range: MonthRange;
    income: number;
    expenses: number;
    /** Income minus expenses. Negative is a month that ate into savings. */
    net: number;
    /**
     * Net as a share of income, 0–100 — undefined when no income was recorded,
     * because a percentage of nothing is not zero, it is unanswerable.
     */
    savingsRate: number | undefined;
    incomeChange: Delta;
    expensesChange: Delta;
    netChange: Delta;
    /** Spending per day *elapsed*, so a month in progress is not flattered. */
    perDay: number;
    transactionCount: number;
    /** Every category either month saw, biggest spend first. */
    categories: CategoryLine[];
    /** The category that moved most, if anything moved enough to be worth saying. */
    biggestMover: CategoryLine | undefined;
    /** Every income category either month saw, biggest first. */
    incomeCategories: CategoryLine[];
    /** The income category that moved most, under the same floor as spending. */
    biggestIncomeMover: CategoryLine | undefined;
    topMerchant: { name: string; amount: number } | undefined;
    verdict: Verdict;
    /** False when there is no previous month to compare against. */
    hasPrevious: boolean;
    /** Nothing was recorded — the page shows an empty state, not zeroes. */
    isEmpty: boolean;
}

/** The category's change, under the same rule as every other delta on the page. */
export function lineDelta(line: CategoryLine): Delta {
    return delta(line.amount, line.previous);
}

const num = (value: unknown): number => Number(value) || 0;

/**
 * A mover has to clear 1% of the larger month's spending to be called one.
 *
 * Without a floor the "biggest change" line reports whichever category drifted
 * by NT$40, which is true and worthless.
 */
const MOVER_FLOOR = 0.01;

function mergeCategories(
    current: CategoryAmount[],
    previous: CategoryAmount[],
    /** This month's total of the same kind, for each line's share. */
    total: number,
): CategoryLine[] {
    const lines = new Map<string, CategoryLine>();

    for (const entry of current) {
        const amount = num(entry.amount);
        lines.set(entry.category, {
            category: entry.category,
            amount,
            previous: 0,
            change: amount,
            share: total > 0 ? (amount / total) * 100 : 0,
            transactionCount: num(entry.transactionCount),
            color: entry.color,
        });
    }

    for (const entry of previous) {
        const was = num(entry.amount);
        const line = lines.get(entry.category);
        if (line) {
            line.previous = was;
            line.change = line.amount - was;
        } else {
            // A category that stopped: nothing this month, so it sorts last by
            // amount, but its disappearance is often the month's real story.
            lines.set(entry.category, {
                category: entry.category,
                amount: 0,
                previous: was,
                change: -was,
                share: 0,
                transactionCount: 0,
                color: entry.color,
            });
        }
    }

    return [...lines.values()].sort(
        (a, b) => b.amount - a.amount || Math.abs(b.change) - Math.abs(a.change),
    );
}

function findMover(lines: CategoryLine[], expenses: number, previousExpenses: number): CategoryLine | undefined {
    const floor = Math.max(expenses, previousExpenses) * MOVER_FLOOR;
    let biggest: CategoryLine | undefined;

    for (const line of lines) {
        if (Math.abs(line.change) < floor) continue;
        if (!biggest || Math.abs(line.change) > Math.abs(biggest.change)) biggest = line;
    }

    return biggest;
}

export function buildMonthReview(
    range: MonthRange,
    current: SpendingLike | undefined,
    previous: SpendingLike | undefined,
): MonthReview {
    const income = num(current?.totalIncome);
    const expenses = num(current?.totalExpenses);
    const net = income - expenses;
    const savingsRate = income > 0 ? (net / income) * 100 : undefined;

    const previousIncome = num(previous?.totalIncome);
    const previousExpenses = num(previous?.totalExpenses);

    const categories = mergeCategories(
        current?.categoryBreakdown ?? [],
        previous?.categoryBreakdown ?? [],
        expenses,
    );

    const incomeCategories = mergeCategories(
        current?.incomeBreakdown ?? [],
        previous?.incomeBreakdown ?? [],
        income,
    );

    const merchant = current?.topMerchants?.[0];

    return {
        range,
        income,
        expenses,
        net,
        savingsRate,
        incomeChange: delta(income, previousIncome),
        expensesChange: delta(expenses, previousExpenses),
        netChange: delta(net, previousIncome - previousExpenses),
        perDay: range.days > 0 ? expenses / range.days : 0,
        transactionCount: categories.reduce((sum, line) => sum + line.transactionCount, 0),
        categories,
        biggestMover: findMover(categories, expenses, previousExpenses),
        incomeCategories,
        biggestIncomeMover: findMover(incomeCategories, income, previousIncome),
        topMerchant:
            merchant?.name !== undefined
                ? { name: merchant.name, amount: num(merchant.amount) }
                : undefined,
        verdict: verdictFor(net, savingsRate),
        hasPrevious: previousIncome > 0 || previousExpenses > 0,
        isEmpty: income === 0 && expenses === 0,
    };
}
