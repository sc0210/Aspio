/**
 * The calendar month a review is about, as the API's date strings.
 *
 * Everything here is local-time arithmetic on `YYYY-MM` and `YYYY-MM-DD`
 * strings, never `toISOString()`. A `Date` at midnight Taipei serialises to
 * the *previous* day in UTC, so `new Date(2026, 8, 1).toISOString()` yields
 * `2026-08-31` — which asks the backend for a window opening one day early and
 * silently pulls the last day of the previous month into the review. The
 * dashboard has been bitten by that class of bug before; this module exists so
 * the page never builds a date string by hand.
 */

/** A month, and the window inside it that has actually happened. */
export interface MonthRange {
    /** `YYYY-MM` — the month itself. */
    key: string;
    /** `YYYY-MM-DD`, the 1st. */
    from: string;
    /** `YYYY-MM-DD` — the last day, or today while the month is still running. */
    to: string;
    /**
     * Days the window covers, inclusive. A daily average taken over the
     * calendar length of a month that is four days old reads four times too
     * low, so the figure the page divides by is this, not `daysInMonth`.
     */
    days: number;
    /** The month has not finished — figures are "so far", not final. */
    partial: boolean;
    /**
     * `YYYY-MM-DD` — the day this range was measured against.
     *
     * Carried so that anything rendering a range reads the same clock the range
     * was built from, instead of calling `new Date()` again for itself. Two
     * clocks in one component is how MonthPicker's "next month is disabled"
     * ended up disagreeing with the month it was showing.
     */
    today: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM` for a date, in local time. */
export function monthKeyOf(date: Date = new Date()): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** `YYYY-MM-DD` for a date, in local time. */
export function dayStringOf(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseKey(key: string): { year: number; month: number } {
    const [year, month] = key.split('-').map(Number);
    return { year, month };
}

/** The same month `delta` months away — `shiftMonth('2026-01', -1)` is `2025-12`. */
export function shiftMonth(key: string, delta: number): string {
    const { year, month } = parseKey(key);
    // Day 1 keeps this safe on the 31st: `new Date(y, m, 31)` rolls into the
    // next month for any 30-day neighbour.
    return monthKeyOf(new Date(year, month - 1 + delta, 1));
}

/**
 * The window to ask the API for, for one month.
 *
 * A month still in progress is clamped to today rather than reported through
 * its full length: asking for a window that runs into the future is harmless
 * to the query but makes every average wrong.
 */
export function monthRange(key: string, today: Date = new Date()): MonthRange {
    const { year, month } = parseKey(key);
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0); // day 0 of the next month
    const partial = last > today;
    const end = partial && first <= today ? today : last;

    return {
        key,
        from: dayStringOf(first),
        to: dayStringOf(end),
        today: dayStringOf(today),
        // A future month has nothing in it; `end` is its last day, which would
        // otherwise report a full month of days that have not happened.
        days: first > today ? 0 : end.getDate(),
        partial,
    };
}

/** "September 2026" / "2026年9月", in the reader's language. */
export function monthLabel(key: string, locale: string): string {
    const { year, month } = parseKey(key);
    return new Date(year, month - 1, 1).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
    });
}

/**
 * The month a reader opening the page means.
 *
 * The current month, except in its first days — on the 2nd, "this month" is a
 * near-empty page that looks like a broken account, while the month that just
 * ended is complete and is what "review" means at that moment. Three days is
 * enough for the current month to be worth reading and short enough that the
 * page stops surprising anyone who visits mid-month.
 */
const REVIEW_HANDOVER_DAY = 4;

export function defaultReviewMonth(today: Date = new Date()): string {
    const key = monthKeyOf(today);
    return today.getDate() < REVIEW_HANDOVER_DAY ? shiftMonth(key, -1) : key;
}
