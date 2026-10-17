/**
 * "How much house can I actually afford?" — the inverse of the readiness scorecard.
 *
 * The scorecard answers "can I afford THIS house?" and, for anyone early in their
 * career, the answer is a flat no with nothing to do about it. This module asks
 * the question the other way round: given what you earn, spend and hold today,
 * what is the most expensive home that still leaves you financially calm — and
 * how does that ceiling move as you keep saving?
 *
 * It deliberately inverts the SAME conditions the scorecard grades, so the two
 * can never disagree:
 *
 *   ③ post-purchase buffer  → cash ceiling
 *   ④ monthly surplus       → cash-flow ceiling
 *
 * plus the obvious physical limit that you cannot pay more cash at closing than
 * you actually hold. The affordable price is the *lowest* of the three, and we
 * report which one binds, because that is the thing worth working on.
 *
 * Honesty over comfort: when the monthly surplus is zero or negative the ceiling
 * genuinely does not grow, and `projection` says so rather than inventing a
 * hopeful curve. Motivation here comes from real arithmetic — chiefly the
 * leverage effect in `priceUnlockedPerSaved` — not from flattering numbers.
 *
 * All amounts are base currency (TWD). Pure and unit-testable: no fetching.
 */

import { DEFAULT_TARGETS, type ReadinessTargets } from './readiness';

/** Which limit is holding the affordable price down. */
export type BindingConstraint = 'cash' | 'liquid' | 'cashFlow' | 'none';

export interface AffordabilityInputs {
    /** Financial assets today (cash + investments), excluding any property. */
    financialAssets: number;
    /** Of those, what could actually be turned into cash for a closing. */
    liquidFunds: number;
    /** Average monthly income — use a trailing average, not one month. */
    monthlyIncome: number;
    /** Average monthly living expenses, excluding future housing cost. */
    monthlyExpenses: number;

    /** Down-payment share of price, percent (e.g. 30). */
    downPaymentPct: number;
    /** One-time purchase costs as a percent of price (e.g. 3). */
    buyingCostPct: number;
    /** Recurring ownership cost as a percent of price per year (e.g. 1). */
    ownershipCostPctPerYear: number;
    /** Mortgage annual rate, percent (e.g. 2.1). */
    mortgageRatePct: number;
    /** Mortgage term, years (e.g. 30). */
    mortgageTermYears: number;

    /**
     * Threshold overrides. Defaults are PROPORTIONATE to this household
     * (see `proportionateTargets`), not the scorecard's absolute figures.
     */
    targets?: Partial<ReadinessTargets>;
}

interface ProportionateTargetOpts {
    /** Post-purchase buffer, in months of the user's own expenses. Default 6. */
    bufferMonths?: number;
    /** Required monthly surplus, as a percent of the user's own income. Default 10. */
    surplusPctOfIncome?: number;
}

/**
 * Safety thresholds scaled to the household, rather than to a 2,500–3,000萬 home.
 *
 * The scorecard's DEFAULT_TARGETS (buffer 400萬, surplus 3萬/mo) are advisory
 * figures for one specific, expensive purchase bracket. Applied to a cheaper home
 * they are not conservative, they are simply wrong: they asked a junior earning
 * 4.5萬/month for a 400萬 post-purchase buffer and a 3萬 monthly surplus — 67% of
 * their income — which pinned the affordable price at zero at every horizon, for
 * a decade, no matter how well they saved.
 *
 * Scaling the same two ideas to the person keeps the intent (six months of runway
 * after buying; don't spend every spare dollar on the house) while producing a
 * real, moving number for someone at the start of their career.
 *
 * The scorecard keeps the absolute advisory targets — this is only for the
 * "what can I afford" direction.
 */
export function proportionateTargets(
    monthlyIncome: number,
    monthlyExpenses: number,
    opts: ProportionateTargetOpts = {},
): ReadinessTargets {
    const { bufferMonths = 6, surplusPctOfIncome = 10 } = opts;
    return {
        // Not used as a price constraint here (it is an absolute gate, not a
        // function of price); carried so the shape stays a full ReadinessTargets.
        liquidFundsMin: DEFAULT_TARGETS.liquidFundsMin,
        bufferMin: Math.max(0, monthlyExpenses * bufferMonths),
        monthlyCashFlowMin: Math.max(0, (monthlyIncome * surplusPctOfIncome) / 100),
    };
}

interface AffordabilityCeiling {
    /** Highest price that satisfies every constraint. 0 when nothing is affordable. */
    maxPrice: number;
    /** Ceiling implied by keeping the post-purchase buffer (condition ③). */
    cashCeiling: number;
    /** Ceiling implied by the cash you could actually bring to closing. */
    liquidCeiling: number;
    /** Ceiling implied by keeping a healthy monthly surplus (condition ④). */
    cashFlowCeiling: number;
    /** Which constraint produced maxPrice — the lever worth pulling. */
    binding: BindingConstraint;
    /** Cash required at closing for maxPrice (down payment + buying costs). */
    upfrontCash: number;
    /** Monthly housing outflow at maxPrice (mortgage + ownership). */
    monthlyHousingCost: number;
    /** Monthly surplus left over at maxPrice. */
    monthlySurplus: number;
}

interface AffordabilityMilestone {
    /** Whole years from today. */
    year: number;
    /** Projected financial assets at that point. */
    financialAssets: number;
    /** Affordable price at that point. */
    maxPrice: number;
}

interface AffordabilityProjection {
    /** Ceiling as things stand today. */
    today: AffordabilityCeiling;
    /** Ceiling at 1 / 3 / 5 / 10 years (or the requested horizons). */
    milestones: AffordabilityMilestone[];
    /** Monthly amount left after living costs — the engine behind any growth. */
    monthlySavings: number;
    /**
     * Extra house price unlocked per 1 unit of additional savings, while the cash
     * constraint binds. With 30% down + 3% costs this is ~3.03 — i.e. every
     * NT$100k saved raises the ceiling by ~NT$303k. This is the single most
     * motivating true fact on the page.
     */
    priceUnlockedPerSaved: number;
    /**
     * False when the surplus is ≤ 0, meaning the ceiling does not rise on its own.
     * Callers should show the lever (raise income / cut spending) instead of a
     * projection that would be a lie.
     */
    canGrow: boolean;
    /**
     * True when the cash-flow limit is what pins the ceiling today.
     *
     * This matters more than it looks: the cash-flow ceiling is a function of
     * income and spending ONLY — saving harder does not move it at all. A junior
     * earner whose surplus sits below the required monthly buffer has a ceiling of
     * zero that stays zero for any amount of saving. When this is true the UI must
     * say so and point at income/spending, because a savings-only projection would
     * quietly show a flat line and read as hopeless.
     */
    cappedByCashFlow: boolean;
    /**
     * The hard ceiling that saving alone can never exceed, given today's income
     * and spending. Useful as an explicit "this is the wall" figure.
     */
    cashFlowCeiling: number;
}

/** Level-payment factor: monthly payment per 1 unit of principal. */
function paymentFactor(annualRatePct: number, termYears: number): number {
    const n = Math.max(1, Math.round(termYears * 12));
    const r = annualRatePct / 100 / 12;
    if (r === 0) return 1 / n;
    const f = Math.pow(1 + r, n);
    return (r * f) / (f - 1);
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Highest price satisfying all three constraints.
 *
 * Cash side — upfront is a fixed fraction of price, so both cash limits invert
 * directly:
 *   upfront(price) = price · (down% + buyingCost%) / 100
 *   ③ assets − upfront ≥ buffer   ⇒ price ≤ (assets − buffer) / upfrontRate
 *      liquid ≥ upfront           ⇒ price ≤ liquid / upfrontRate
 *
 * Cash-flow side — monthly housing cost is also linear in price:
 *   housing(price) = price · (1 − down%/100) · k + price · ownership%/100/12
 *   ④ income − expenses − housing ≥ min ⇒ price ≤ budget / housingRate
 */
export function calcAffordability(inputs: AffordabilityInputs): AffordabilityCeiling {
    const t: ReadinessTargets = {
        ...proportionateTargets(inputs.monthlyIncome, inputs.monthlyExpenses),
        ...(inputs.targets ?? {}),
    };

    const upfrontRate = (inputs.downPaymentPct + inputs.buyingCostPct) / 100;
    const k = paymentFactor(inputs.mortgageRatePct, inputs.mortgageTermYears);
    const housingRate =
        (1 - inputs.downPaymentPct / 100) * k + inputs.ownershipCostPctPerYear / 100 / 12;

    // ③ keep a buffer after buying
    const cashCeiling =
        upfrontRate > 0 ? nonNeg((inputs.financialAssets - t.bufferMin) / upfrontRate) : Infinity;

    // can't hand over more cash than you hold
    const liquidCeiling = upfrontRate > 0 ? nonNeg(inputs.liquidFunds / upfrontRate) : Infinity;

    // ④ keep a healthy monthly surplus
    const monthlyBudget = inputs.monthlyIncome - inputs.monthlyExpenses - t.monthlyCashFlowMin;
    const cashFlowCeiling = housingRate > 0 ? nonNeg(monthlyBudget / housingRate) : Infinity;

    const raw = Math.min(cashCeiling, liquidCeiling, cashFlowCeiling);
    const maxPrice = Number.isFinite(raw) ? Math.max(0, raw) : 0;

    // Report the tightest limit — that is the one worth working on. Ties resolve
    // to the earlier entry, ordering them by how directly the user can act.
    const candidates: Array<[BindingConstraint, number]> = [
        ['cashFlow', cashFlowCeiling],
        ['liquid', liquidCeiling],
        ['cash', cashCeiling],
    ];
    const tightest = candidates.reduce((lo, c) => (c[1] < lo[1] ? c : lo));
    const binding: BindingConstraint = Number.isFinite(tightest[1]) ? tightest[0] : 'none';

    const upfrontCash = maxPrice * upfrontRate;
    const monthlyHousingCost = maxPrice * housingRate;

    return {
        maxPrice,
        cashCeiling,
        liquidCeiling,
        cashFlowCeiling,
        binding,
        upfrontCash,
        monthlyHousingCost,
        monthlySurplus: inputs.monthlyIncome - inputs.monthlyExpenses - monthlyHousingCost,
    };
}

/**
 * How the ceiling moves as savings accumulate.
 *
 * Assets compound monthly at `annualReturnPct` while the monthly surplus is added.
 * Income and spending are held flat — this is a "if nothing else changes" line,
 * which keeps it conservative and makes any real raise a pleasant surprise rather
 * than a number the user has to live up to.
 */
export function projectAffordability(
    inputs: AffordabilityInputs,
    opts: {
        annualReturnPct?: number;
        /**
         * Assumed annual income growth, percent. Defaults to 0 — deliberately.
         *
         * Zero is the conservative, non-fabricated baseline. But note that with 0
         * the cash-flow ceiling is FIXED forever, so anyone whose surplus is below
         * the required monthly buffer projects a permanent zero. That is arithmetic,
         * not pessimism. Callers showing an early-career user should offer a modest
         * raise assumption (3–5%) as an explicit, labelled scenario, since career
         * progression — not saving — is the lever that actually moves their ceiling.
         */
        annualIncomeGrowthPct?: number;
        horizonsYears?: number[];
    } = {},
): AffordabilityProjection {
    const { annualReturnPct = 6, annualIncomeGrowthPct = 0, horizonsYears = [1, 3, 5, 10] } = opts;

    const today = calcAffordability(inputs);
    const monthlySavings = inputs.monthlyIncome - inputs.monthlyExpenses;
    const canGrow = monthlySavings > 0;

    const upfrontRate = (inputs.downPaymentPct + inputs.buyingCostPct) / 100;
    const priceUnlockedPerSaved = upfrontRate > 0 ? 1 / upfrontRate : 0;

    const r = annualReturnPct / 100 / 12;
    const milestones: AffordabilityMilestone[] = horizonsYears.map((year) => {
        const months = Math.round(year * 12);
        // Future value of current assets plus a monthly contribution annuity.
        const growth = Math.pow(1 + r, months);
        const assets = canGrow
            ? inputs.financialAssets * growth +
              (r === 0 ? monthlySavings * months : monthlySavings * ((growth - 1) / r))
            : inputs.financialAssets * growth;
        // Income compounds annually; spending is held flat so a raise shows up as
        // surplus rather than being silently eaten by lifestyle inflation.
        const income = inputs.monthlyIncome * Math.pow(1 + annualIncomeGrowthPct / 100, year);
        // Liquidity grows with the same pot; the buffer requirement is what bites.
        const at = calcAffordability({
            ...inputs,
            monthlyIncome: income,
            financialAssets: assets,
            liquidFunds: inputs.liquidFunds + Math.max(0, assets - inputs.financialAssets),
        });
        return { year, financialAssets: assets, maxPrice: at.maxPrice };
    });

    return {
        today,
        milestones,
        monthlySavings,
        priceUnlockedPerSaved,
        canGrow,
        cappedByCashFlow: today.binding === 'cashFlow',
        cashFlowCeiling: today.cashFlowCeiling,
    };
}

/**
 * Years until `targetPrice` becomes affordable, or null if not within `maxYears`.
 * Month-stepped so the answer is honest near the boundary rather than rounded to
 * a whole year that hasn't arrived yet.
 */
export function yearsToAfford(
    inputs: AffordabilityInputs,
    targetPrice: number,
    opts: { annualReturnPct?: number; maxYears?: number } = {},
): number | null {
    const { annualReturnPct = 6, maxYears = 40 } = opts;
    if (calcAffordability(inputs).maxPrice >= targetPrice) return 0;

    const monthlySavings = inputs.monthlyIncome - inputs.monthlyExpenses;
    const r = annualReturnPct / 100 / 12;
    let assets = inputs.financialAssets;
    let liquid = inputs.liquidFunds;

    // With no surplus and no return, the pot never moves — bail out rather than loop.
    if (monthlySavings <= 0 && r === 0) return null;

    for (let m = 1; m <= maxYears * 12; m++) {
        const gain = assets * r;
        assets += gain + Math.max(0, monthlySavings);
        liquid += gain + Math.max(0, monthlySavings);
        if (calcAffordability({ ...inputs, financialAssets: assets, liquidFunds: liquid }).maxPrice >= targetPrice) {
            return Math.round((m / 12) * 10) / 10;
        }
    }
    return null;
}
