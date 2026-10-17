/**
 * The reviewed month against the twelve around it.
 *
 * "You spent NT$900 more than last month" is a fact about two months, and two
 * months is a small sample: one bonus, one insurance renewal, one trip, and
 * the comparison says something that is true and misleading. This is the
 * longer horizon — where the month sits among its neighbours, and how far it
 * is from what a normal month looks like for this account.
 *
 * The series comes from the spending report's own `monthlyTrends`, which sums
 * the same rows over the same filters as the totals on the page above it.
 * That is the whole reason it is not read from `/transactions/monthly-summary`,
 * which looks like the same numbers but excludes deleted and non-completed
 * rows and converts currencies — a second definition sitting beside the first
 * is how a page ends up disagreeing with itself.
 */

import { monthKeyOf, shiftMonth, type MonthRange } from './monthRange';

/** A row of `SpendingReport.monthlyTrends`. */
interface MonthlyPoint {
    month: string; // YYYY-MM
    income?: number;
    expenses?: number;
    net?: number;
}

export interface ContextMonth {
    key: string;
    income: number;
    expenses: number;
    net: number;
    /** The month under review. */
    selected: boolean;
    /** Still running — its figures are not comparable with a full month's. */
    partial: boolean;
    /** No transactions at all. Drawn as a gap, not as a zero-saving month. */
    empty: boolean;
}

export interface MonthContext {
    /** Twelve months, oldest first, gaps filled — a timeline, not a list of rows. */
    months: ContextMonth[];
    selected: ContextMonth | undefined;
    /**
     * Where the month ranks by net saved, 1 being the best. Undefined when the
     * month is still running or has nothing in it: ranking ten days against
     * eleven full months produces a number that means nothing.
     */
    rank: number | undefined;
    /** How many months the rank is out of — complete months with activity. */
    of: number;
    /** Mean net of those months. */
    averageNet: number;
    /** The month against that mean. Undefined when it cannot be ranked. */
    vsAverage: number | undefined;
    /** The month is older than the window — nothing to place it against. */
    outOfWindow: boolean;
}

const WINDOW = 12;

const num = (value: unknown): number => Number(value) || 0;

export function buildMonthContext(
    trends: ReadonlyArray<MonthlyPoint> | undefined | null,
    range: MonthRange,
    today: Date = new Date(),
): MonthContext {
    const currentKey = monthKeyOf(today);
    // The window ends at the current month and runs back a year, so it does not
    // move as the reader steps between months — one fetch serves the whole page.
    const keys = Array.from({ length: WINDOW }, (_, i) => shiftMonth(currentKey, i - (WINDOW - 1)));

    const bySource = new Map<string, MonthlyPoint>();
    for (const point of trends ?? []) {
        if (point?.month) bySource.set(String(point.month).slice(0, 7), point);
    }

    const months: ContextMonth[] = keys.map((key) => {
        const point = bySource.get(key);
        const income = num(point?.income);
        const expenses = num(point?.expenses);
        return {
            key,
            income,
            expenses,
            net: point?.net !== undefined ? num(point.net) : income - expenses,
            selected: key === range.key,
            partial: key === currentKey,
            empty: !point || (income === 0 && expenses === 0),
        };
    });

    const selected = months.find((month) => month.selected);
    // Only complete months with something in them can be averaged or ranked
    // against — an account that started in June has no May to compare with.
    const comparable = months.filter((month) => !month.partial && !month.empty);
    const averageNet = comparable.length
        ? comparable.reduce((sum, month) => sum + month.net, 0) / comparable.length
        : 0;

    const rankable = selected && !selected.partial && !selected.empty;
    const rank = rankable
        ? comparable.filter((month) => month.net > selected!.net).length + 1
        : undefined;

    return {
        months,
        selected,
        rank,
        of: comparable.length,
        averageNet,
        vsAverage: rankable ? selected!.net - averageNet : undefined,
        outOfWindow: !selected,
    };
}
