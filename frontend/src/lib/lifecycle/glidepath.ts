/**
 * The glidepath — actual leverage against target leverage, projected forward.
 *
 * The milestone this produces is the **crossover**: the year your savings have
 * grown enough that leverage falls to 1× on its own and you stop being a
 * borrower. That is the progress bar lifecycle investing actually deserves,
 * far more than "portfolio up 12%".
 *
 * Two modelling notes that matter for correctness:
 *
 *  1. Loan repayments are recorded as expense transactions in Aspiro, so the
 *     `monthlySavings` seed is **already net of debt service**. The projection
 *     therefore does not subtract the payment again — but it does hand the
 *     payment back to savings the month the loan is paid off, which is a real
 *     and sizeable acceleration. The target curve is told about that date in
 *     advance (see `freedPayment`), so it prices the raise in before it lands
 *     rather than stepping up on the day.
 *  2. The target is recomputed every year, because the PV of future savings
 *     shrinks as retirement approaches. That falling target is what makes the
 *     strategy deleverage you automatically.
 *
 * Pure functions; amounts in base currency, rates as annual percentages.
 */

import {
    computeTarget,
    presentValueOfFutureSavings,
    freedPaymentFrom,
    type LifecyclePhase,
} from './samuelson';

export interface GlidepathInputs {
    currentAge: number;
    retirementAge: number;

    /** Position today. */
    stockExposure: number;
    cashAssets: number;
    debtBalance: number;
    debtAnnualRatePct: number;
    debtMonthlyPayment: number;

    /** Net monthly savings, already net of debt service (see note 1 above). */
    monthlySavings: number;
    /** Share of monthly savings routed into stocks, 0–100. The rest stays cash. */
    investedSharePct: number;

    /** Assumptions. */
    expectedReturnPct: number;
    samuelsonSharePct: number;
    discountRatePct: number;
    savingsGrowthPct: number;
    maxLeverage: number;
}

export interface GlidepathPoint {
    /** Years from now (0 = today). */
    year: number;
    age: number;
    exposure: number;
    cash: number;
    debt: number;
    netFinancialAssets: number;
    /** Infinity while underwater — callers should guard before charting. */
    leverage: number;
    targetLeverage: number;
    targetExposure: number;
    phase: LifecyclePhase;
}

interface Glidepath {
    points: GlidepathPoint[];
    /** First year actual leverage reaches 1× or below. Null if it never does. */
    crossoverYear: number | null;
    crossoverAge: number | null;
    /** First year the investment debt is fully repaid. */
    debtFreeYear: number | null;
    debtFreeAge: number | null;
    /** Interest still to be paid on the projected schedule. */
    interestAhead: number;
    /** Net financial assets at the end of the projection. */
    finalNetAssets: number;
}

const MAX_HORIZON_YEARS = 45;

export function projectGlidepath(inputs: GlidepathInputs): Glidepath {
    const horizonYears = Math.min(
        MAX_HORIZON_YEARS,
        Math.max(1, Math.round(inputs.retirementAge - inputs.currentAge)),
    );
    const totalMonths = horizonYears * 12;

    const monthlyReturn = Math.pow(1 + inputs.expectedReturnPct / 100, 1 / 12) - 1;
    const monthlySavingsGrowth = Math.pow(1 + inputs.savingsGrowthPct / 100, 1 / 12) - 1;
    const debtMonthlyRate = inputs.debtAnnualRatePct / 100 / 12;
    const investedShare = Math.min(1, Math.max(0, inputs.investedSharePct / 100));

    let exposure = Math.max(0, inputs.stockExposure);
    let cash = Math.max(0, inputs.cashAssets);
    let debt = Math.max(0, inputs.debtBalance);
    let savings = inputs.monthlySavings;
    let payment = Math.max(0, inputs.debtMonthlyPayment);
    let interestAhead = 0;

    const points: GlidepathPoint[] = [];
    let debtFreeMonth: number | null = debt <= 0 ? 0 : null;

    const snapshot = (month: number): GlidepathPoint => {
        const netFinancialAssets = exposure + cash - debt;
        const yearsLeft = Math.max(0, inputs.retirementAge - (inputs.currentAge + month / 12));
        // Tell the PV when the loan clears. Without this it assumes the current
        // debt-suppressed savings rate runs to retirement, understating lifetime
        // wealth for every year of the loan and then correcting in one jump —
        // which drew a spike in target leverage at the payoff date.
        const pv = presentValueOfFutureSavings({
            monthlySavings: Math.max(0, savings),
            yearsToRetirement: yearsLeft,
            discountRatePct: inputs.discountRatePct,
            savingsGrowthPct: inputs.savingsGrowthPct,
            ...freedPaymentFrom(debt, inputs.debtAnnualRatePct, payment),
        });
        const target = computeTarget({
            netFinancialAssets,
            pvFutureSavings: pv,
            samuelsonSharePct: inputs.samuelsonSharePct,
            maxLeverage: inputs.maxLeverage,
        });
        return {
            year: month / 12,
            age: inputs.currentAge + month / 12,
            exposure,
            cash,
            debt,
            netFinancialAssets,
            leverage: netFinancialAssets > 0 ? exposure / netFinancialAssets : Infinity,
            targetLeverage: target.targetLeverage,
            targetExposure: target.targetExposure,
            phase: target.phase,
        };
    };

    points.push(snapshot(0));

    for (let m = 1; m <= totalMonths; m++) {
        // Debt service. A payment that doesn't cover the interest would grow the
        // balance forever, so treat it as interest-only rather than compounding
        // an input error into a runaway chart.
        if (debt > 0) {
            const interest = debt * debtMonthlyRate;
            interestAhead += interest;
            const principal = Math.min(Math.max(0, payment - interest), debt);
            debt = Math.max(0, debt - principal);
            if (debt <= 0 && debtFreeMonth === null) {
                debtFreeMonth = m;
                // The payment stops leaving your account — savings jump by it.
                savings += payment;
                payment = 0;
            }
        }

        // Contributions and market growth.
        exposure = exposure * (1 + monthlyReturn) + savings * investedShare;
        cash += savings * (1 - investedShare);
        savings *= 1 + monthlySavingsGrowth;

        if (m % 12 === 0) points.push(snapshot(m));
    }

    // Year 0 counts: someone already at or below 1× has crossed over, and
    // saying "you cross in 1 year" to a debt-free investor is simply wrong.
    const crossover = points.find((p) => Number.isFinite(p.leverage) && p.leverage <= 1) ?? null;
    const last = points[points.length - 1];

    return {
        points,
        crossoverYear: crossover ? Math.round(crossover.year) : null,
        crossoverAge: crossover ? Math.round(crossover.age) : null,
        debtFreeYear: debtFreeMonth !== null ? Math.round((debtFreeMonth / 12) * 10) / 10 : null,
        debtFreeAge:
            debtFreeMonth !== null ? Math.round(inputs.currentAge + debtFreeMonth / 12) : null,
        interestAhead,
        finalNetAssets: last.netFinancialAssets,
    };
}
