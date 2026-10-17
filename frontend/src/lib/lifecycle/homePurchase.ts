/**
 * What buying a home does to the lifecycle position.
 *
 * The house is not a financial asset and the mortgage is not investment debt,
 * so neither enters leverage directly. What does: the cash that leaves at
 * closing (down payment + buying costs). It is paid from cash first; anything
 * beyond the cash on hand has to come from selling investments. Net financial
 * assets fall by the full amount either way, so leverage — exposure ÷ net
 * financial assets — rises even when no stock is sold.
 *
 * Pure: the caller supplies today's position and the scenario's figures.
 */

import type { Position } from './leverage';

interface HomePurchaseInputs {
    /** Cash needed at closing: down payment + buying costs. */
    upfrontCash: number;
    /** Mortgage payment plus ownership costs, per month. */
    monthlyHousingCost: number;
    /** Rent paid today, which stops on moving in. */
    monthlyRent: number;
}

interface HomePurchaseImpact {
    upfrontCash: number;
    /** Paid out of spendable cash (the Life wallet). */
    fromCash: number;
    /** Paid by selling investments: closing costs beyond the spendable cash. */
    fromStock: number;
    /** What neither cash nor investments can cover. Above 0, the purchase can't be funded. */
    shortfall: number;
    /** Spendable cash left after closing. The Emergency fund is not touched. */
    cashLeft: number;
    leverageBefore: number;
    /** Infinity when net financial assets go to zero or below. */
    leverageAfter: number;
    netFinancialAssetsAfter: number;
    /** Monthly housing cost minus the rent that stops; positive = less to save each month. */
    monthlyCashFlowChange: number;
    exceedsMaxLeverage: boolean;
}

export function homePurchaseImpact(
    position: Position,
    inputs: HomePurchaseInputs,
    maxLeverage: number,
    /**
     * Cash that may be spent: the Life wallet. The Emergency fund is a reserve
     * in the three-wallet model, not house money. Defaults to all cash.
     */
    spendableCash: number = position.cashAssets,
): HomePurchaseImpact {
    const upfront = Math.max(0, inputs.upfrontCash);
    const cash = Math.max(0, Math.min(spendableCash, position.cashAssets));
    const fromCash = Math.min(cash, upfront);
    const fromStock = Math.min(Math.max(0, position.stockExposure), upfront - fromCash);
    const exposureAfter = Math.max(0, position.stockExposure) - fromStock;
    const netAfter = position.netFinancialAssets - upfront;
    const leverageAfter = netAfter > 0 ? exposureAfter / netAfter : Infinity;
    return {
        upfrontCash: upfront,
        fromCash,
        fromStock,
        shortfall: upfront - fromCash - fromStock,
        cashLeft: cash - fromCash,
        leverageBefore: position.leverage,
        leverageAfter,
        netFinancialAssetsAfter: netAfter,
        monthlyCashFlowChange: inputs.monthlyHousingCost - inputs.monthlyRent,
        exceedsMaxLeverage: !Number.isFinite(leverageAfter) || leverageAfter > maxLeverage,
    };
}
