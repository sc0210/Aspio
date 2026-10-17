/**
 * What a bad market actually does to a levered position — and, more to the
 * point here, whether you can keep paying the loan while it happens.
 *
 * *Lifecycle Investing* assumes margin or LEAPs, where the worst case is that
 * the position closes. A personal loan (信貸) is **recourse, amortizing debt**:
 * the payment is due on schedule whatever the market did, and you cannot
 * deleverage by simply selling. So the binding constraint is rarely the
 * leverage ratio — it is cash flow. If a drawdown ever forces you to liquidate
 * holdings to make a loan payment, the strategy has failed in the one way it
 * cannot recover from: selling the bottom.
 *
 * Two gauges therefore matter more than the ratio itself:
 *   - coverage — how much of your free cash flow the payment consumes
 *   - runway   — how many payments your reserves cover with zero income
 *
 * Pure functions; amounts in base currency.
 */

/** Drawdowns worth showing: ordinary correction → bear market → 2008. */
const DEFAULT_DROPS = [10, 20, 30, 40, 50];

export type Severity = 'safe' | 'watch' | 'danger';

interface StressInputs {
    stockExposure: number;
    cashAssets: number;
    investmentDebt: number;
    /** Total monthly payment across the investment loans. */
    monthlyPayment: number;
    /**
     * Net monthly savings — income minus expenses. Loan repayments are recorded
     * as expense transactions in Aspiro, so this figure is **already net of
     * debt service**; `preDebtSurplus` adds the payment back to recover free
     * cash flow before the loan.
     */
    monthlySavings: number;
    /** Cash you could actually reach without selling stock: Emergency + Life. */
    liquidReserve: number;
    /** Drawdown scenarios to evaluate, in percent. */
    drops?: number[];
}

export interface StressScenario {
    dropPct: number;
    exposureAfter: number;
    /** Net financial assets once the drop lands. Negative means insolvent. */
    netAfter: number;
    /** Leverage after the drop — null once net assets hit zero. */
    leverageAfter: number | null;
    /** Paper loss taken by your own money, as a percent of net assets today. */
    ownMoneyLossPct: number;
    wipedOut: boolean;
}

export interface StressResult {
    /** Stock exposure today — what a market drop applies to. */
    exposure: number;
    /** Net financial assets today: exposure + cash − investment debt. */
    net: number;
    leverage: number;
    /**
     * The drawdown that takes net financial assets to zero, exactly 1 ÷ leverage.
     * Null when leverage ≤ 1 — no market drop alone can wipe out an unlevered
     * position.
     */
    wipeoutDropPct: number | null;
    scenarios: StressScenario[];
    /** Free cash flow before the loan payment. */
    preDebtSurplus: number;
    /** preDebtSurplus ÷ payment. 2.0 = the payment eats half your free cash flow. */
    coverageRatio: number | null;
    coverageSeverity: Severity;
    /** Months of payments the reserve covers with no income at all. */
    runwayMonths: number | null;
    runwaySeverity: Severity;
    /** The scenario this page exists to prevent: a drawdown forcing a sale. */
    forcedSaleRisk: boolean;
}

/** Below 1.5× the payment leaves nothing for a bad month; below 1.0 you're eating reserves. */
function coverageSeverityFor(ratio: number | null): Severity {
    if (ratio === null) return 'safe';
    if (ratio >= 2) return 'safe';
    if (ratio >= 1.3) return 'watch';
    return 'danger';
}

/** Six months of payments is the floor; a year is where you stop worrying. */
function runwaySeverityFor(months: number | null): Severity {
    if (months === null) return 'safe';
    if (months >= 12) return 'safe';
    if (months >= 6) return 'watch';
    return 'danger';
}

/**
 * One drawdown against today's position. Exported so a page can evaluate any
 * drop the user picks with exactly the arithmetic the fixed table uses.
 */
export function scenarioAt(exposure: number, net: number, dropPct: number): StressScenario {
    const loss = exposure * (dropPct / 100);
    const exposureAfter = exposure - loss;
    const netAfter = net - loss;
    return {
        dropPct,
        exposureAfter,
        netAfter,
        leverageAfter: netAfter > 0 ? exposureAfter / netAfter : null,
        ownMoneyLossPct: net > 0 ? (loss / net) * 100 : 100,
        wipedOut: netAfter <= 0,
    };
}

export function evaluateStress({
    stockExposure,
    cashAssets,
    investmentDebt,
    monthlyPayment,
    monthlySavings,
    liquidReserve,
    drops = DEFAULT_DROPS,
}: StressInputs): StressResult {
    const exposure = Math.max(0, stockExposure);
    const net = exposure + Math.max(0, cashAssets) - Math.max(0, investmentDebt);
    const leverage = net > 0 ? exposure / net : Infinity;

    // Net assets after a drop d are net − exposure·d, so they hit zero at
    // d = net/exposure = 1/leverage. Above 100% is unreachable, hence null.
    const wipeoutDropPct =
        net > 0 && exposure > 0 && leverage > 1 ? 100 / leverage : null;

    const scenarios: StressScenario[] = drops.map((dropPct) => scenarioAt(exposure, net, dropPct));

    // No balance means no obligation, whatever payment figure came in. A loan
    // that is repaid but still flagged active keeps its `minimum_payment`, and
    // treating that as live would invent a debt-service burden: it would depress
    // the coverage ratio, shorten the runway, and flag forced-sale risk against
    // a payment nobody is making.
    const payment = investmentDebt > 0 ? Math.max(0, monthlyPayment) : 0;
    const preDebtSurplus = monthlySavings + payment;
    const coverageRatio = payment > 0 ? preDebtSurplus / payment : null;
    const runwayMonths = payment > 0 ? Math.max(0, liquidReserve) / payment : null;

    const coverageSeverity = coverageSeverityFor(coverageRatio);
    const runwaySeverity = runwaySeverityFor(runwayMonths);

    return {
        exposure,
        net,
        leverage,
        wipeoutDropPct,
        scenarios,
        preDebtSurplus,
        coverageRatio,
        coverageSeverity,
        runwayMonths,
        runwaySeverity,
        // Either gauge in the red means a bad market can force your hand: no
        // spare cash flow to make the payment, or no reserve to make it from.
        forcedSaleRisk:
            payment > 0 && (coverageSeverity === 'danger' || runwaySeverity === 'danger'),
    };
}
