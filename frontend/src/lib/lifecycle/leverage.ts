/**
 * Where the position actually stands today.
 *
 * **Leverage is measured against net financial assets, not against the
 * portfolio alone.** Cash you hold is a negative debt position: borrowing
 * 1,000,000 while sitting on 400,000 of cash leaves you 600,000 levered, not
 * 1,000,000. Using net financial assets as the denominator also makes the
 * wipeout identity exact — see `stress.ts`, where the drawdown that zeroes you
 * out is simply 1 ÷ leverage.
 *
 *     leverage = stock exposure ÷ (stock exposure + cash − investment debt)
 *
 * Pure functions; amounts in base currency.
 */

interface PositionInputs {
    /** Market value of the levered position — the Portfolio wallet. */
    stockExposure: number;
    /** Cash and reserves: Life + Emergency wallets. */
    cashAssets: number;
    /** Balance of the loans taken on to invest. */
    investmentDebt: number;
    /** Any other debt (mortgage, car). Reduces net worth but isn't part of the strategy. */
    otherDebt?: number;
}

export interface Position {
    stockExposure: number;
    cashAssets: number;
    investmentDebt: number;
    /** Stock exposure + cash − investment debt. The denominator of leverage. */
    netFinancialAssets: number;
    /** Net financial assets less any non-investment debt. */
    netWorth: number;
    /** Exposure ÷ net financial assets. Infinity when you're underwater. */
    leverage: number;
    /** Share of exposure funded by borrowing, 0–1. */
    borrowedShare: number;
    /** True when debt exceeds everything you own. */
    isUnderwater: boolean;
}

export function evaluatePosition({
    stockExposure,
    cashAssets,
    investmentDebt,
    otherDebt = 0,
}: PositionInputs): Position {
    const exposure = Math.max(0, stockExposure);
    const cash = Math.max(0, cashAssets);
    const debt = Math.max(0, investmentDebt);

    const netFinancialAssets = exposure + cash - debt;
    const isUnderwater = netFinancialAssets <= 0;

    return {
        stockExposure: exposure,
        cashAssets: cash,
        investmentDebt: debt,
        netFinancialAssets,
        netWorth: netFinancialAssets - Math.max(0, otherDebt),
        leverage: isUnderwater ? Infinity : exposure / netFinancialAssets,
        borrowedShare: exposure > 0 ? Math.min(1, debt / exposure) : 0,
        isUnderwater,
    };
}

/** How the live position compares to the target the Samuelson share implies. */
export type TrackingVerdict = 'under' | 'on-track' | 'over' | 'breach';

export interface Tracking {
    verdict: TrackingVerdict;
    /** actual − target, in leverage points. */
    leverageGap: number;
    /** Exposure you'd add (+) or shed (−) to sit exactly on target, in currency. */
    exposureGap: number;
    /** True when actual leverage exceeds the hard ceiling — the one red line. */
    overCeiling: boolean;
}

/**
 * `on-track` deliberately spans a band rather than a point: rebalancing to the
 * exact target every month would churn the portfolio for no benefit. The book's
 * own guidance is to rebalance on meaningful drift, so anything within ±0.1 of
 * target counts as on plan.
 */
export function evaluateTracking(
    position: Position,
    targetLeverage: number,
    targetExposure: number,
    maxLeverage: number,
    band = 0.1,
): Tracking {
    if (position.isUnderwater) {
        return { verdict: 'breach', leverageGap: Infinity, exposureGap: 0, overCeiling: true };
    }

    const leverageGap = position.leverage - targetLeverage;
    const cappedTargetExposure = Math.min(targetExposure, position.netFinancialAssets * maxLeverage);
    const exposureGap = cappedTargetExposure - position.stockExposure;

    const overCeiling = position.leverage > maxLeverage;
    const verdict: TrackingVerdict = overCeiling
        ? 'breach'
        : leverageGap > band
            ? 'over'
            : leverageGap < -band
                ? 'under'
                : 'on-track';

    return { verdict, leverageGap, exposureGap, overCeiling };
}
