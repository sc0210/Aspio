'use client';

import { useMemo } from 'react';

/**
 * Near-term asset-growth projection.
 *
 * Models how Total Asset evolves over the next few months given:
 *  - a monthly net-savings amount (real income − expense by default), and
 *  - an expected annual return applied to the *invested* portion only.
 *
 * The Portfolio wallet (`portfolioWallet`) is the part that compounds at the
 * return rate; everything else (Life + Emergency cash) only grows by the cash
 * share of monthly savings. This mirrors the three-wallet model where market
 * return accrues to invested assets, not to cash.
 *
 * Pure calculation — no data fetching — so it is trivially unit-testable.
 */

interface GrowthForecastInputs {
    /** Current total assets across all wallets. */
    totalAsset: number;
    /** Current invested assets (Portfolio wallet) — grows at the return rate. */
    portfolioWallet: number;
    /** Real monthly income for the period. */
    monthlyIncome: number;
    /** Real monthly expenses for the period. */
    monthlyExpenses: number;
}

interface GrowthForecastControls {
    /** Expected annual return on invested assets, in percent (e.g. 7 = 7%). */
    annualReturnPct: number;
    /** Net savings added each month (can be negative if overspending). */
    monthlySavings: number;
    /** Projection window in months (e.g. 6, 12, 36). */
    horizonMonths: number;
    /** Share of monthly savings routed into investments, 0–100. The rest stays as cash. */
    investedPct: number;
}

interface ForecastPoint {
    /** Months from today (0 = now). */
    month: number;
    /** Projected total assets. */
    total: number;
    /** Projected invested (portfolio) balance. */
    portfolio: number;
    /** Projected cash balance. */
    cash: number;
}

interface GrowthForecastResult {
    /** Projection including investment return, one point per month (month 0 = today). */
    points: ForecastPoint[];
    /** Same contributions with a 0% return — "if you only saved" baseline. */
    baselinePoints: ForecastPoint[];
    /** Total assets today. */
    startTotal: number;
    /** Projected total assets at the horizon. */
    projectedTotal: number;
    /** projectedTotal − startTotal. */
    gain: number;
    /** Gain as a percentage of today's total (0 when starting from 0). */
    gainPct: number;
    /** Savings-only total at the horizon (no market return). */
    baselineTotal: number;
    /** Portion of the projected total attributable to investment return. */
    marketContribution: number;
}

function project(
    p0: number,
    c0: number,
    savings: number,
    investedFraction: number,
    monthlyRate: number,
    horizonMonths: number,
): ForecastPoint[] {
    const investedContribution = savings * investedFraction;
    const cashContribution = savings * (1 - investedFraction);

    let port = p0;
    let cash = c0;
    const points: ForecastPoint[] = [{ month: 0, total: p0 + c0, portfolio: p0, cash: c0 }];

    for (let m = 1; m <= horizonMonths; m++) {
        port = port * (1 + monthlyRate) + investedContribution;
        cash = cash + cashContribution;
        points.push({ month: m, total: port + cash, portfolio: port, cash });
    }
    return points;
}

export function useGrowthForecast(
    inputs: GrowthForecastInputs,
    controls: GrowthForecastControls,
): GrowthForecastResult {
    const { totalAsset, portfolioWallet, monthlyIncome, monthlyExpenses } = inputs;
    const { annualReturnPct, monthlySavings, horizonMonths, investedPct } = controls;

    return useMemo(() => {
        const startTotal = totalAsset;
        const p0 = Math.max(0, portfolioWallet);
        const c0 = startTotal - p0;

        const horizon = Math.max(1, Math.round(horizonMonths));
        const monthlyRate = annualReturnPct / 100 / 12;
        const investedFraction = Math.min(1, Math.max(0, investedPct / 100));

        // monthlyIncome/monthlyExpenses are kept on the inputs so callers can seed
        // the default savings; the projection itself uses the (possibly overridden)
        // monthlySavings control.
        void monthlyIncome;
        void monthlyExpenses;

        const points = project(p0, c0, monthlySavings, investedFraction, monthlyRate, horizon);
        const baselinePoints = project(p0, c0, monthlySavings, investedFraction, 0, horizon);

        const projectedTotal = points[points.length - 1].total;
        const baselineTotal = baselinePoints[baselinePoints.length - 1].total;
        const gain = projectedTotal - startTotal;
        const gainPct = startTotal > 0 ? (gain / startTotal) * 100 : 0;
        const marketContribution = projectedTotal - baselineTotal;

        return {
            points,
            baselinePoints,
            startTotal,
            projectedTotal,
            gain,
            gainPct,
            baselineTotal,
            marketContribution,
        };
    }, [totalAsset, portfolioWallet, monthlyIncome, monthlyExpenses, annualReturnPct, monthlySavings, horizonMonths, investedPct]);
}
