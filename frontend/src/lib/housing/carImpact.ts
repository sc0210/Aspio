/**
 * Car-purchase impact on the house timeline — pure, unit-testable.
 *
 * Answers "if I buy a car first, how much does it push back the day I can afford
 * a house?" A car hurts house-readiness three ways: it drains liquid cash (down
 * payment), adds debt + a monthly loan payment, and adds running costs — all of
 * which slow the climb to the liquid-funds target. It is also a *depreciating*
 * asset, so unlike a home its value is not counted toward house liquidity.
 *
 * The delay is the difference between the months-to-target WITHOUT the car
 * (full savings, full liquid) and WITH it (reduced liquid, reduced savings while
 * the loan runs, recovering to savings-minus-running-cost after payoff).
 */

import { calcMortgage } from './mortgage';
import { monthsToTarget, type TimeToTargetResult } from './timeline';

export interface CarImpactInputs {
    /** Sticker price of the car. */
    carPrice: number;
    /** Down-payment share of the price, in percent (e.g. 20). */
    downPaymentPct: number;
    /** Car-loan annual interest rate, in percent (e.g. 3.5). */
    loanRatePct: number;
    /** Car-loan term in years (e.g. 5). */
    loanTermYears: number;
    /** Annual depreciation, in percent (e.g. 12). */
    depreciationPct: number;
    /** Monthly running cost — insurance, fuel, maintenance, parking. */
    monthlyRunningCost: number;
}

/** The house-saving situation the car is measured against. */
export interface HouseTimelineContext {
    /** Liquid funds available today. */
    currentLiquid: number;
    /** Net monthly savings today, before the car (income − expenses). */
    monthlySavings: number;
    /** Liquid-funds target for house-readiness (e.g. 1,000萬). */
    liquidTarget: number;
    /** Expected annual return on saved cash, in percent. */
    annualReturnPct: number;
    /** Existing debt balance today (for context). */
    currentDebt: number;
}

interface CarImpactResult {
    downPayment: number;
    loanPrincipal: number;
    monthlyLoanPayment: number;
    totalInterest: number;
    loanMonths: number;
    /** Loan payment + running cost — the monthly hit while the loan runs. */
    monthlyBurden: number;
    monthlyRunningCost: number;

    /** Liquid funds right after paying the down payment. */
    liquidAfterCar: number;
    /** Net savings while the loan is being repaid (can go negative). */
    savingsAfterCar: number;
    /** Net savings after the loan is paid off (savings − running cost). */
    savingsAfterLoan: number;
    /** Debt balance immediately after taking the car loan. */
    debtAfterCar: number;
    /** Depreciated car value when the loan ends. */
    carValueAtLoanEnd: number;

    /** Months-to-target without the car. */
    baseline: TimeToTargetResult;
    /** Months-to-target with the car. */
    withCar: TimeToTargetResult;
    /** withCar − baseline, in months (null if either is unreachable). */
    delayMonths: number | null;
    /** Delay in whole years (rounded up), or null. */
    delayYears: number | null;
    /** True when the house target is never reached within the cap once the car is bought. */
    neverReaches: boolean;
}

/**
 * Months to reach `target` when the monthly contribution changes at loan payoff.
 * Steps month-by-month (exact, cheap) up to a cap.
 */
function monthsToTargetVarying(
    start: number,
    target: number,
    annualReturnPct: number,
    savingsDuringLoan: number,
    savingsAfterLoan: number,
    loanMonths: number,
    maxMonths = 600,
): TimeToTargetResult {
    if (start >= target) {
        return { months: 0, years: 0, targetYear: new Date().getFullYear(), alreadyThere: true };
    }
    const r = annualReturnPct / 100 / 12;
    let bal = start;
    for (let m = 1; m <= maxMonths; m++) {
        const sav = m <= loanMonths ? savingsDuringLoan : savingsAfterLoan;
        bal = bal * (1 + r) + sav;
        if (bal >= target) {
            const years = Math.ceil(m / 12);
            return { months: m, years, targetYear: new Date().getFullYear() + years, alreadyThere: false };
        }
    }
    return { months: null, years: null, targetYear: null, alreadyThere: false };
}

export function evaluateCarImpact(car: CarImpactInputs, ctx: HouseTimelineContext): CarImpactResult {
    const downPayment = car.carPrice * (car.downPaymentPct / 100);
    const loanPrincipal = Math.max(0, car.carPrice - downPayment);
    const loan = calcMortgage({ principal: loanPrincipal, annualRatePct: car.loanRatePct, termYears: car.loanTermYears });
    const loanMonths = loan.months;
    const monthlyLoanPayment = loan.monthlyPayment;
    const monthlyBurden = monthlyLoanPayment + car.monthlyRunningCost;

    const liquidAfterCar = ctx.currentLiquid - downPayment;
    const savingsAfterCar = ctx.monthlySavings - monthlyBurden;
    const savingsAfterLoan = ctx.monthlySavings - car.monthlyRunningCost;
    const debtAfterCar = ctx.currentDebt + loanPrincipal;
    const carValueAtLoanEnd = car.carPrice * Math.pow(1 - car.depreciationPct / 100, car.loanTermYears);

    const baseline = monthsToTarget({
        current: ctx.currentLiquid,
        target: ctx.liquidTarget,
        monthlySavings: ctx.monthlySavings,
        annualReturnPct: ctx.annualReturnPct,
    });

    const withCar = monthsToTargetVarying(
        liquidAfterCar,
        ctx.liquidTarget,
        ctx.annualReturnPct,
        savingsAfterCar,
        savingsAfterLoan,
        loanMonths,
    );

    const delayMonths =
        withCar.months !== null && baseline.months !== null ? withCar.months - baseline.months : null;

    return {
        downPayment,
        loanPrincipal,
        monthlyLoanPayment,
        totalInterest: loan.totalInterest,
        loanMonths,
        monthlyBurden,
        monthlyRunningCost: car.monthlyRunningCost,
        liquidAfterCar,
        savingsAfterCar,
        savingsAfterLoan,
        debtAfterCar,
        carValueAtLoanEnd,
        baseline,
        withCar,
        delayMonths,
        delayYears: delayMonths === null ? null : Math.ceil(delayMonths / 12),
        neverReaches: withCar.months === null,
    };
}

/** Sensible starting assumptions for a mid-range car in TW (≈80萬). */
export const DEFAULT_CAR_IMPACT: CarImpactInputs = {
    carPrice: 80 * 10_000,
    downPaymentPct: 20,
    loanRatePct: 3.5,
    loanTermYears: 5,
    depreciationPct: 12,
    monthlyRunningCost: 12_000,
};
