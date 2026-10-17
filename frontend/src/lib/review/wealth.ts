/**
 * What the balances did over the month, read off the daily wallet-trend series.
 *
 * The trend endpoint answers in fixed presets (`30d`, `1y`, …), not arbitrary
 * ranges, so the review asks for a year once and slices the month out of it
 * here. That also gives the window a true opening balance: the point *before*
 * the 1st is in the series, so the month's first day counts — taking
 * `last - first` over the in-range points alone measures a day less than the
 * month, which is exactly the bug `useWalletTrendBaseline` exists to fix on
 * the dashboard.
 *
 * These are balances, so contributions count toward the change, not just
 * market movement — buying a holding debits Life and credits Portfolio and
 * moves both figures with a flat market. The page says so beside the number.
 */

import { netWorthOf } from '@/lib/dashboard/periodChange';
import type { MonthRange } from './monthRange';

interface TrendPointLike {
    date: string;
    lifeWallet?: number;
    portfolioWallet?: number;
    emergencyWallet?: number;
    totalAsset?: number;
    debtBalance?: number;
}

export interface WealthMove {
    open: number;
    close: number;
    change: number;
    /** Undefined when the month opened at or below zero — see `periodChange`. */
    percent: number | undefined;
    /**
     * The opening balance came from inside the month because the series does
     * not reach back before it — so the change is measured over a shorter
     * window than the month, and the page says "since the 2nd", not "in March".
     */
    openedInside: boolean;
    /** The day the opening balance was read from, `YYYY-MM-DD`. */
    openedOn: string;
}

/**
 * One balance read off a trend point, or undefined when the point does not
 * carry it. Missing is not zero: a point without the field read as a NT$0
 * balance turns the whole balance into the month's "change".
 */
type Reader = (point: TrendPointLike) => number | undefined;

/** The trend payload's dates may carry a time; the review only ever compares days. */
const day = (value: string): string => String(value ?? '').slice(0, 10);

const field = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
};

/**
 * Every balance the card reads, over one month, from one pass over the series.
 *
 * The year of daily points is sorted and split around the month once, however
 * many readers there are — the card reads four balances, and each used to copy,
 * sort and filter all ~365 points again.
 */
export function wealthMoves<K extends string>(
    points: ReadonlyArray<TrendPointLike> | undefined | null,
    range: MonthRange,
    readers: Record<K, Reader>,
): Record<K, WealthMove | undefined> {
    const keys = Object.keys(readers) as K[];
    const result = {} as Record<K, WealthMove | undefined>;

    const sorted = points?.length
        ? [...points].sort((a, b) => day(a.date).localeCompare(day(b.date)))
        : [];
    const before = sorted.filter((p) => day(p.date) < range.from);
    const inside = sorted.filter((p) => day(p.date) >= range.from && day(p.date) <= range.to);

    for (const key of keys) {
        result[key] = moveOver(before, inside, readers[key]);
    }
    return result;
}

/**
 * Balances at both ends of the month, or undefined when nothing inside it
 * carries this balance — an account with no snapshots yet, or a month before it
 * started.
 */
export function wealthMove(
    points: ReadonlyArray<TrendPointLike> | undefined | null,
    range: MonthRange,
    read: Reader,
): WealthMove | undefined {
    return wealthMoves(points, range, { move: read }).move;
}

function moveOver(
    before: ReadonlyArray<TrendPointLike>,
    inside: ReadonlyArray<TrendPointLike>,
    read: Reader,
): WealthMove | undefined {
    // Only points that carry this balance count, at either end.
    let closing: TrendPointLike | undefined;
    let close = 0;
    for (let i = inside.length - 1; i >= 0; i--) {
        const value = read(inside[i]);
        if (value !== undefined) {
            closing = inside[i];
            close = value;
            break;
        }
    }
    if (!closing) return undefined;

    let opening: TrendPointLike | undefined;
    let open = 0;
    for (let i = before.length - 1; i >= 0; i--) {
        const value = read(before[i]);
        if (value !== undefined) {
            opening = before[i];
            open = value;
            break;
        }
    }

    const openedInside = !opening;
    if (!opening) {
        for (const point of inside) {
            const value = read(point);
            if (value !== undefined) {
                opening = point;
                open = value;
                break;
            }
        }
    }

    const change = close - open;
    return {
        open,
        close,
        change,
        percent: open > 0 ? (change / open) * 100 : undefined,
        openedInside,
        openedOn: day((opening ?? closing).date),
    };
}

/**
 * The month ended before the series starts — so `wealthMove` returning nothing
 * means "not fetched", not "never recorded".
 *
 * The page asks for a year of daily balances, because the trend endpoint takes
 * fixed presets rather than arbitrary ranges. Step back past that and the
 * balances are simply outside what was requested; saying "no daily balances
 * were recorded for this month" there is a claim about the account that
 * nothing in the data supports.
 */
export function monthPrecedesSeries(
    points: ReadonlyArray<TrendPointLike> | undefined | null,
    range: MonthRange,
): boolean {
    if (!points?.length) return false;
    const earliest = points.reduce((min, p) => (day(p.date) < min ? day(p.date) : min), day(points[0].date));
    return range.to < earliest;
}

/** The readings the review takes. Net worth is assets minus debt, once. */
export const READ = {
    portfolio: (p: TrendPointLike) => field(p.portfolioWallet),
    // Day-to-day cash. It falls when money is invested or set aside — a
    // purchase debits Life and credits Portfolio, a transfer moves it to
    // Emergency — so the card reads it beside those rows, not as spending.
    life: (p: TrendPointLike) => field(p.lifeWallet),
    emergency: (p: TrendPointLike) => field(p.emergencyWallet),
    totalAsset: (p: TrendPointLike) => field(p.totalAsset),
    netWorth: (p: TrendPointLike) => {
        const totalAsset = field(p.totalAsset);
        return totalAsset === undefined ? undefined : netWorthOf({ totalAsset, debtBalance: p.debtBalance });
    },
} satisfies Record<string, Reader>;
