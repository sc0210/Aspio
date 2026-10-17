/**
 * "How long until I'm ready?" — solve for the number of months of saving +
 * compounding needed to grow `current` up to `target`.
 *
 * Future value of a growing balance with fixed monthly contributions:
 *   FV(n) = current·(1+r)^n + monthly·((1+r)^n − 1)/r
 * We step month-by-month (cheap, exact, avoids log edge cases) up to a cap.
 */

interface TimeToTargetInputs {
    current: number;
    target: number;
    /** Net amount saved per month. */
    monthlySavings: number;
    /** Expected annual return on the growing balance, in percent. */
    annualReturnPct: number;
    /** Safety cap in months (default 600 = 50 years). */
    maxMonths?: number;
}

export interface TimeToTargetResult {
    /** Months to reach the target, or null if not reached within the cap. */
    months: number | null;
    /** Whole years (rounded up), or null. */
    years: number | null;
    /** Calendar year the target is reached, or null. */
    targetYear: number | null;
    /** Already at/above target at month 0. */
    alreadyThere: boolean;
}

export function monthsToTarget({
    current,
    target,
    monthlySavings,
    annualReturnPct,
    maxMonths = 600,
}: TimeToTargetInputs): TimeToTargetResult {
    if (current >= target) {
        return { months: 0, years: 0, targetYear: new Date().getFullYear(), alreadyThere: true };
    }

    const r = annualReturnPct / 100 / 12;
    let balance = current;
    for (let m = 1; m <= maxMonths; m++) {
        balance = balance * (1 + r) + monthlySavings;
        if (balance >= target) {
            const years = Math.ceil(m / 12);
            return {
                months: m,
                years,
                targetYear: new Date().getFullYear() + years,
                alreadyThere: false,
            };
        }
    }
    return { months: null, years: null, targetYear: null, alreadyThere: false };
}
