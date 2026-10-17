/**
 * Change in a balance over the selected period, read off the wallet-trend
 * series.
 *
 * Both headline deltas on the dashboard strip use this, so they share one time
 * base and cannot drift apart — they were two near-identical copies before, and
 * the copies did diverge.
 *
 * Note this measures a *balance*, so contributions and withdrawals count toward
 * it, not just market movement. The Portfolio tile says so on hover; buying a
 * holding debits Life and credits Portfolio, which moves this figure with a
 * flat market.
 */

interface PeriodChange {
    /** Undefined when the window starts at or below zero — there is no meaningful percentage of a non-positive base. */
    percent: number | undefined;
    /** Undefined only when there is genuinely nothing to report. */
    amount: number | undefined;
}

const NOTHING: PeriodChange = { percent: undefined, amount: undefined };

export function periodChange<K extends string>(
    points: ReadonlyArray<Record<K, number>> | undefined | null,
    field: K,
): PeriodChange {
    if (!points || points.length < 2) return NOTHING;

    const first = Number(points[0][field]) || 0;
    const last = Number(points[points.length - 1][field]) || 0;

    // A window that starts at zero or below has no meaningful percentage —
    // dividing by it is Infinity, and against a negative base the sign is
    // nonsense. The money that moved is still real, so report the amount alone.
    // It is always last − first: the Life wallet can go negative on overspend,
    // so neither endpoint can be assumed positive, and reporting `last` would
    // both hide a fall into the red and understate a climb out of it.
    if (first <= 0) {
        const delta = last - first;
        return { percent: undefined, amount: delta !== 0 ? delta : undefined };
    }

    return { percent: ((last - first) / first) * 100, amount: last - first };
}

/**
 * Net worth on one day of the trend series: what is owned minus what is owed.
 *
 * One definition, because the two quantities move independently and confusing
 * them is not a rounding error. Borrowing raises assets and debt together and
 * leaves net worth nearly unchanged — on a levered account the desktop Net Worth
 * card read +53.2% (the *asset* growth) against a true +5.7%, because the change
 * was computed off `totalAsset` under a variable merely named for net worth.
 *
 * `debtBalance` is optional on the payload: a series without it predates the
 * field, and treating that as zero debt is the same assumption the rest of the
 * dashboard already makes.
 */
export function netWorthOf(point: { totalAsset: number; debtBalance?: number }): number {
    return (Number(point.totalAsset) || 0) - (Number(point.debtBalance) || 0);
}
