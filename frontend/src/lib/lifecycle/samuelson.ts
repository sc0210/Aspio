/**
 * Lifecycle investing — the Samuelson share and the dollar target it implies.
 *
 * The strategy (Ayres & Nalebuff, *Lifecycle Investing*) rests on one idea:
 * your target stock allocation is a constant share of **lifetime** wealth, not
 * of the money you happen to have saved so far. Lifetime wealth is
 *
 *     net financial assets today  +  present value of future savings
 *
 * When you are young the second term dominates, so the dollar target sits far
 * above what you hold — which is what a young investor uses leverage to close.
 * As savings accumulate the future-savings term shrinks, the target leverage
 * falls on its own, and the strategy deleverages you without any market call.
 *
 * Everything here is pure and unit-testable. Amounts are in base currency
 * (TWD); rates are annual percentages (e.g. 4 = 4%/yr).
 */

import { monthsToPayoff } from '@/lib/finance/amortization';

/** Which of the three lifecycle phases the *target* puts you in. */
export type LifecyclePhase = 'accumulate' | 'deleverage' | 'glide' | 'underwater';

interface FutureSavingsInputs {
    /** Net savings per month, in base currency. */
    monthlySavings: number;
    /** Years of saving left before retirement. */
    yearsToRetirement: number;
    /** Rate used to discount future savings back to today. */
    discountRatePct: number;
    /** Expected annual growth of your savings rate (raises, promotions). */
    savingsGrowthPct: number;
    /**
     * A monthly outgoing that is known to stop on a fixed future date, after
     * which it becomes savings — a loan payment, typically.
     *
     * Without this the PV assumes today's debt-suppressed savings rate lasts
     * until retirement, which understates lifetime wealth for every year of the
     * loan and then corrects in one jump the month it clears. That jump showed
     * up on the glidepath as a spike in target leverage at the payoff date.
     */
    freedPayment?: number;
    /** Months from now until `freedPayment` stops. Omit if it never does. */
    monthsUntilFreed?: number | null;
}

/**
 * Present value of a growing monthly annuity.
 *
 *     PV = C/(r−g) · [1 − ((1+g)/(1+r))^n]
 *
 * with monthly discount rate r, monthly growth g and n months. The r ≈ g case
 * degenerates to C·n/(1+r) and is handled separately.
 */
function growingAnnuityPV(c: number, n: number, r: number, g: number): number {
    if (n <= 0 || c <= 0) return 0;
    if (Math.abs(r - g) < 1e-12) return (c * n) / (1 + r);
    return (c / (r - g)) * (1 - Math.pow((1 + g) / (1 + r), n));
}

/**
 * Present value of the savings still ahead of you.
 *
 * This is the "human capital" term, but only the part you actually intend to
 * save — deliberately not your whole future salary, which would overstate the
 * target by everything you plan to spend.
 *
 * It is forward-looking about a known payoff date: a loan payment that stops in
 * `monthsUntilFreed` months is added as a deferred annuity from that point, so
 * the value does not step up on the day the loan clears.
 */
export function presentValueOfFutureSavings({
    monthlySavings,
    yearsToRetirement,
    discountRatePct,
    savingsGrowthPct,
    freedPayment = 0,
    monthsUntilFreed = null,
}: FutureSavingsInputs): number {
    const n = Math.max(0, Math.round(yearsToRetirement * 12));
    if (n === 0) return 0;

    const r = discountRatePct / 100 / 12;
    const g = savingsGrowthPct / 100 / 12;

    const base = growingAnnuityPV(Math.max(0, monthlySavings), n, r, g);

    // The freed payment is a deferred growing annuity: nothing until the loan
    // clears at month k, then `freedPayment` a month, growing like the rest of
    // your savings. Discount that stream back over the k months of waiting.
    const k = monthsUntilFreed;
    if (freedPayment > 0 && k !== null && k < n) {
        const deferred = growingAnnuityPV(freedPayment, n - Math.max(0, k), r, g);
        return base + deferred / Math.pow(1 + r, Math.max(0, k));
    }

    return base;
}

/**
 * Build the freed-payment half of `presentValueOfFutureSavings` from a debt
 * position.
 *
 * Exists so the page's headline target and the projected glidepath cannot
 * derive it differently — they did once, and the headline double-counted a
 * cleared loan's payment while the chart did not.
 *
 * A zero balance yields a zero payment: nothing is owed, so nothing is going to
 * be freed, and the caller's `monthlySavings` already contains that money.
 */
export function freedPaymentFrom(
    debtBalance: number,
    debtAnnualRatePct: number,
    monthlyPayment: number,
): Pick<FutureSavingsInputs, 'freedPayment' | 'monthsUntilFreed'> {
    if (debtBalance <= 0 || monthlyPayment <= 0) {
        return { freedPayment: 0, monthsUntilFreed: 0 };
    }
    return {
        freedPayment: monthlyPayment,
        monthsUntilFreed: monthsToPayoff(debtBalance, debtAnnualRatePct, monthlyPayment),
    };
}

interface TargetInputs {
    /** All financial assets minus all debt — your own money today. */
    netFinancialAssets: number;
    /** PV of the savings still ahead of you. */
    pvFutureSavings: number;
    /** Constant share of lifetime wealth targeted at stocks, in percent. */
    samuelsonSharePct: number;
    /** Hard leverage ceiling — the book's own rule is 2:1, never more. */
    maxLeverage: number;
}

export interface TargetPosition {
    /** Net financial assets + PV of future savings. */
    lifetimeWealth: number;
    /** Fraction of lifetime wealth that is still unearned (0–1). */
    futureSavingsShare: number;
    /** Samuelson share × lifetime wealth — the dollar exposure you are aiming at. */
    targetExposure: number;
    /** Exposure ÷ own money, before the ceiling is applied. */
    unconstrainedLeverage: number;
    /** The leverage you should actually run: unconstrained, capped at maxLeverage. */
    targetLeverage: number;
    /** The exposure that capped leverage actually allows. */
    allowedExposure: number;
    /** True when the ceiling is what's holding you back, not your own money. */
    cappedByMax: boolean;
    /** Which lifecycle phase the target implies. */
    phase: LifecyclePhase;
}

/**
 * The phase is a property of the *target*, not of what you currently hold — it
 * says where you are in life, and actual leverage is then measured against it.
 *
 *  - accumulate  — you want more exposure than the 2:1 ceiling allows (phase 1)
 *  - deleverage  — target sits between 1× and the ceiling; it falls every year (phase 2)
 *  - glide       — target is at or below 1×; leverage is done, equity share declines (phase 3)
 *  - underwater  — you owe more than you own; leverage is undefined
 */
export function phaseFor(unconstrainedLeverage: number, maxLeverage: number): LifecyclePhase {
    if (!Number.isFinite(unconstrainedLeverage) || unconstrainedLeverage <= 0) return 'underwater';
    if (unconstrainedLeverage >= maxLeverage) return 'accumulate';
    if (unconstrainedLeverage > 1) return 'deleverage';
    return 'glide';
}

export function computeTarget({
    netFinancialAssets,
    pvFutureSavings,
    samuelsonSharePct,
    maxLeverage,
}: TargetInputs): TargetPosition {
    const lifetimeWealth = netFinancialAssets + pvFutureSavings;
    const targetExposure = Math.max(0, (lifetimeWealth * samuelsonSharePct) / 100);

    // Owing more than you own makes every ratio meaningless — report the state
    // rather than an Infinity that would silently poison the charts.
    if (netFinancialAssets <= 0) {
        return {
            lifetimeWealth,
            futureSavingsShare: lifetimeWealth > 0 ? pvFutureSavings / lifetimeWealth : 1,
            targetExposure,
            unconstrainedLeverage: Infinity,
            targetLeverage: maxLeverage,
            allowedExposure: 0,
            cappedByMax: true,
            phase: 'underwater',
        };
    }

    const unconstrainedLeverage = targetExposure / netFinancialAssets;
    const targetLeverage = Math.min(unconstrainedLeverage, maxLeverage);

    return {
        lifetimeWealth,
        futureSavingsShare: lifetimeWealth > 0 ? pvFutureSavings / lifetimeWealth : 0,
        targetExposure,
        unconstrainedLeverage,
        targetLeverage,
        allowedExposure: netFinancialAssets * targetLeverage,
        cappedByMax: unconstrainedLeverage > maxLeverage,
        phase: phaseFor(unconstrainedLeverage, maxLeverage),
    };
}
