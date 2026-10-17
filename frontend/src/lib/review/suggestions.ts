/**
 * What to do next month — a few concrete prompts read off the month's figures.
 *
 * Every suggestion is arithmetic on numbers the page already shows (the month,
 * the one before, the twelve-month context), never a guess: each carries the
 * figures its sentence quotes, so the copy cannot say something the data
 * doesn't. Rules are ranked by how much money they are about, and the page
 * shows at most `MAX_SUGGESTIONS` — a list of eight is a report, not advice.
 *
 * The savings-rate thresholds are the ones `verdictFor` already uses, so the
 * advice and the verdict above it cannot disagree.
 */

import type { MonthContext } from './context';
import type { CategoryLine, MonthReview } from './summary';

export type SuggestionTone = 'warn' | 'good' | 'info';

export type Suggestion =
    /** Spent more than came in. */
    | { kind: 'overspent'; tone: 'warn'; weight: number; shortfall: number; category: string | undefined }
    /** One category jumped against last month. */
    | { kind: 'categorySpike'; tone: 'warn'; weight: number; category: string; amount: number; previous: number; percent: number | undefined }
    /** Spending in a category that last month didn't have. */
    | { kind: 'newCategory'; tone: 'info'; weight: number; category: string; amount: number }
    /** Positive but under the 20% rule of thumb. */
    | { kind: 'saveMore'; tone: 'info'; weight: number; rate: number; gap: number }
    /** A strong month — put the surplus to work. */
    | { kind: 'putToWork'; tone: 'good'; weight: number; kept: number }
    /** Net well below the user's own twelve-month average. */
    | { kind: 'belowAverage'; tone: 'warn'; weight: number; gap: number; average: number }
    /** Month in progress: where spending lands at this pace. */
    | { kind: 'pace'; tone: 'info'; weight: number; projected: number; previous: number };
export const MAX_SUGGESTIONS = 3;

/** Rule-of-thumb savings rate; the verdict calls under 10% "tight", 30%+ "strong". */
const TARGET_RATE = 20;
const STRONG_RATE = 30;

/** A category change must be this big a share of the month's spending to mention. */
const SPIKE_SHARE = 0.05;
/** …and at least this much of a rise against last month. */
const SPIKE_PERCENT = 25;
/** A below-average month must miss by this share of the average to mention. */
const AVERAGE_MISS = 0.25;

function biggestRise(lines: CategoryLine[]): CategoryLine | undefined {
    return lines
        .filter((l) => l.previous > 0 && l.change > 0)
        .sort((a, b) => b.change - a.change)[0];
}

export function monthSuggestions(review: MonthReview, context?: MonthContext): Suggestion[] {
    if (review.isEmpty) return [];
    const out: Suggestion[] = [];
    const spend = Math.max(review.expenses, 1);
    const top = review.categories.find((c) => c.amount > 0);

    if (review.range.partial) {
        // A running month: totals are incomplete, so judge the pace, not the month.
        // `range.days` is days elapsed; the projection needs the whole month.
        const [y, m] = review.range.key.split('-').map(Number);
        const monthDays = new Date(y, m, 0).getDate();
        const projected = review.perDay * monthDays;
        const previous = review.expenses - review.expensesChange.amount;
        // Rent and bills land early, so a straight-line projection in the first
        // half of a month triples them. Only project once half the month is in.
        const enoughOfMonth = review.range.days * 2 >= monthDays;
        if (enoughOfMonth && review.hasPrevious && previous > 0 && projected > previous * 1.1) {
            out.push({ kind: 'pace', tone: 'info', weight: projected - previous, projected, previous });
        }
    } else if (review.net < 0 && review.income > 0) {
        // No income recorded: "spent more than came in" is true of every such month and says nothing.
        out.push({ kind: 'overspent', tone: 'warn', weight: -review.net * 2, shortfall: -review.net, category: top?.category });
    } else if (review.savingsRate !== undefined && review.savingsRate < TARGET_RATE) {
        const gap = (TARGET_RATE / 100) * review.income - review.net;
        if (gap > 0) out.push({ kind: 'saveMore', tone: 'info', weight: gap, rate: review.savingsRate, gap });
    } else if (review.savingsRate !== undefined && review.savingsRate >= STRONG_RATE) {
        out.push({ kind: 'putToWork', tone: 'good', weight: review.net * 0.5, kept: review.net });
    }

    if (review.hasPrevious) {
        const rise = biggestRise(review.categories);
        if (rise && rise.change >= spend * SPIKE_SHARE) {
            const percent = rise.previous > 0 ? (rise.change / rise.previous) * 100 : undefined;
            if (percent === undefined || percent >= SPIKE_PERCENT) {
                out.push({ kind: 'categorySpike', tone: 'warn', weight: rise.change, category: rise.category, amount: rise.amount, previous: rise.previous, percent });
            }
        }
        const fresh = review.categories
            .filter((l) => l.previous === 0 && l.amount >= spend * SPIKE_SHARE)
            .sort((a, b) => b.amount - a.amount)[0];
        if (fresh) {
            out.push({ kind: 'newCategory', tone: 'info', weight: fresh.amount * 0.5, category: fresh.category, amount: fresh.amount });
        }
    }

    if (context && context.vsAverage !== undefined && context.averageNet > 0) {
        const gap = -context.vsAverage;
        if (gap >= context.averageNet * AVERAGE_MISS && review.net >= 0) {
            out.push({ kind: 'belowAverage', tone: 'warn', weight: gap, gap, average: context.averageNet });
        }
    }

    return out.sort((a, b) => b.weight - a.weight).slice(0, MAX_SUGGESTIONS);
}
