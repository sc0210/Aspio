/**
 * Buy-readiness scoring — pure, unit-testable.
 *
 * Encodes the four conditions for "可安心進場" (safe to buy):
 *   ① 信貸已清償 / 已轉貸低利   — debt cleared or refinanced low
 *   ② 可動用資金達 1,000–1,200萬 — liquid funds
 *   ③ 買房後仍留 400–600萬金融資產 — post-purchase buffer
 *   ④ 月剩餘現金流 ≥ 3–5萬        — monthly surplus after housing cost
 *
 * The philosophy behind ③ and ④ (keep a safety margin, cash flow beats price):
 * a home should raise quality of life, not chain you to a mortgage. See the
 * "買房心法" principles rendered alongside these gauges.
 *
 * Amounts are in base currency (TWD). One "萬" = 10,000.
 */

export const WAN = 10_000;

export type ConditionStatus = 'clear' | 'close' | 'gap';

export interface ReadinessCondition {
    key: 'debt' | 'liquidFunds' | 'buffer' | 'cashFlow';
    /** Passed the threshold. */
    met: boolean;
    /** Traffic-light status: clear (green) / close (yellow) / gap (red). */
    status: ConditionStatus;
    /** Current value for this condition (base currency, or per-month for cashFlow). */
    value: number;
    /** Threshold the value is measured against. */
    target: number;
    /** Progress toward target, 0–1 (capped at 1 for display bars). */
    progress: number;
    /** How far short of the target, ≥ 0 (0 when met). */
    shortfall: number;
}

interface ReadinessInputs {
    /** Outstanding personal-loan / 信貸 balance. */
    debtBalance: number;
    /** User has refinanced remaining debt to a low rate (qualitative pass for ①). */
    refinancedLowRate: boolean;
    /** Cash + easily-liquidated assets available today. */
    liquidFunds: number;
    /** Financial assets (cash + investments, excluding the home) that exist today. */
    financialAssets: number;
    /** Cash consumed at purchase: down payment + buying costs (+ furnishing). */
    cashNeededAtPurchase: number;
    /** Real monthly income. */
    monthlyIncome: number;
    /** Real monthly living expenses (excluding the new housing cost). */
    monthlyExpenses: number;
    /** Projected monthly housing cost after buying (mortgage + ownership). */
    monthlyHousingCost: number;
    /** Thresholds (defaults follow the 2,500–3,000萬 advisory framework). */
    targets?: Partial<ReadinessTargets>;
}

export interface ReadinessTargets {
    /** ② lower bound for liquid funds. Default 1,000萬. */
    liquidFundsMin: number;
    /** ③ lower bound for post-purchase financial-asset buffer. Default 400萬. */
    bufferMin: number;
    /** ④ lower bound for monthly surplus after housing. Default 3萬. */
    monthlyCashFlowMin: number;
}

export const DEFAULT_TARGETS: ReadinessTargets = {
    liquidFundsMin: 1000 * WAN,
    bufferMin: 400 * WAN,
    monthlyCashFlowMin: 3 * WAN,
};

interface Readiness {
    conditions: ReadinessCondition[];
    /** Overall 0–100 score (average of the four capped progresses). */
    score: number;
    /** How many of the four conditions are met. */
    metCount: number;
    /** All four met → "可安心進場". */
    allClear: boolean;
    /** Post-purchase financial buffer (financialAssets − cashNeededAtPurchase). */
    postPurchaseBuffer: number;
    /** Monthly surplus after housing (income − expenses − housing). */
    monthlySurplus: number;
    /** The single biggest gap (largest shortfall), or null when all clear. */
    biggestGap: ReadinessCondition | null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function statusFor(progress: number, met: boolean): ConditionStatus {
    if (met) return 'clear';
    return progress >= 0.7 ? 'close' : 'gap';
}

export function evaluateReadiness(inputs: ReadinessInputs): Readiness {
    const t: ReadinessTargets = { ...DEFAULT_TARGETS, ...(inputs.targets ?? {}) };

    // ① Debt cleared or refinanced.
    const debtMet = inputs.debtBalance <= 0 || inputs.refinancedLowRate;
    const debtProgress = inputs.debtBalance <= 0 ? 1 : inputs.refinancedLowRate ? 0.7 : 0.3;
    const debt: ReadinessCondition = {
        key: 'debt',
        met: debtMet,
        status: inputs.debtBalance <= 0 ? 'clear' : inputs.refinancedLowRate ? 'close' : 'gap',
        value: inputs.debtBalance,
        target: 0,
        progress: debtProgress,
        shortfall: Math.max(0, inputs.debtBalance),
    };

    // ② Liquid funds.
    const liquidProgress = clamp01(inputs.liquidFunds / t.liquidFundsMin);
    const liquidMet = inputs.liquidFunds >= t.liquidFundsMin;
    const liquidFunds: ReadinessCondition = {
        key: 'liquidFunds',
        met: liquidMet,
        status: statusFor(liquidProgress, liquidMet),
        value: inputs.liquidFunds,
        target: t.liquidFundsMin,
        progress: liquidProgress,
        shortfall: Math.max(0, t.liquidFundsMin - inputs.liquidFunds),
    };

    // ③ Post-purchase buffer.
    const postPurchaseBuffer = inputs.financialAssets - inputs.cashNeededAtPurchase;
    const bufferProgress = clamp01(postPurchaseBuffer / t.bufferMin);
    const bufferMet = postPurchaseBuffer >= t.bufferMin;
    const buffer: ReadinessCondition = {
        key: 'buffer',
        met: bufferMet,
        status: statusFor(bufferProgress, bufferMet),
        value: postPurchaseBuffer,
        target: t.bufferMin,
        progress: bufferProgress,
        shortfall: Math.max(0, t.bufferMin - postPurchaseBuffer),
    };

    // ④ Monthly surplus after housing.
    const monthlySurplus = inputs.monthlyIncome - inputs.monthlyExpenses - inputs.monthlyHousingCost;
    const cashFlowProgress = clamp01(monthlySurplus / t.monthlyCashFlowMin);
    const cashFlowMet = monthlySurplus >= t.monthlyCashFlowMin;
    const cashFlow: ReadinessCondition = {
        key: 'cashFlow',
        met: cashFlowMet,
        status: statusFor(cashFlowProgress, cashFlowMet),
        value: monthlySurplus,
        target: t.monthlyCashFlowMin,
        progress: cashFlowProgress,
        shortfall: Math.max(0, t.monthlyCashFlowMin - monthlySurplus),
    };

    const conditions = [debt, liquidFunds, buffer, cashFlow];
    const metCount = conditions.filter((c) => c.met).length;
    const score = Math.round(
        (conditions.reduce((s, c) => s + c.progress, 0) / conditions.length) * 100,
    );

    const unmet = conditions.filter((c) => !c.met);
    const biggestGap = unmet.length
        ? unmet.reduce((worst, c) => (c.progress < worst.progress ? c : worst))
        : null;

    return {
        conditions,
        score,
        metCount,
        allClear: metCount === conditions.length,
        postPurchaseBuffer,
        monthlySurplus,
        biggestGap,
    };
}
