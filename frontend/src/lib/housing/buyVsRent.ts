/**
 * Buy-vs-Rent projection — pure, unit-testable.
 *
 * Compares two paths for the SAME household budget over a holding period:
 *
 *  • BUY  — sinks `downPayment + buyingCosts` into a home at t=0, then each
 *           month pays the mortgage + ownership costs. The home appreciates.
 *  • RENT — keeps that same up-front capital invested, and each month pays rent
 *           (which grows over time).
 *
 * Fair-comparison rule: whoever has the LOWER monthly housing outflow invests
 * the difference at the expected investment return. So the buyer's "side pot"
 * grows once the (fixed) mortgage falls below ever-rising rent, and the renter's
 * pot is seeded with the down payment they never spent.
 *
 * Net worth is measured on a liquidation basis — the home line already subtracts
 * selling costs — so the crossover point is an honest "if I cashed out today".
 */

import { calcMortgage } from './mortgage';

export interface BuyVsRentInputs {
    /** Purchase price of the home. */
    housePrice: number;
    /** Down-payment share of the price, in percent (e.g. 30). */
    downPaymentPct: number;
    /** Mortgage annual interest rate, in percent (e.g. 2.1). */
    mortgageRatePct: number;
    /** Mortgage term in years (e.g. 30). */
    mortgageTermYears: number;
    /** One-time purchase costs (契稅/代書/仲介 etc.) as a % of price (e.g. 3). */
    buyingCostPct: number;
    /** Cost to sell later (仲介費 etc.) as a % of the home's value (e.g. 4). */
    sellingCostPct: number;
    /** Annual recurring ownership cost (地價稅/房屋稅/管理費/維護) as % of price (e.g. 1). */
    ownershipCostPctPerYear: number;
    /** Expected annual home appreciation, in percent (e.g. 2). */
    appreciationPct: number;

    /** Current monthly rent for a comparable home. */
    monthlyRent: number;
    /** Annual rent growth, in percent (e.g. 2). */
    rentGrowthPct: number;

    /** Expected annual return on invested cash, in percent (e.g. 6). */
    investmentReturnPct: number;
    /** How long the household plans to stay, in years (e.g. 10). */
    holdingYears: number;
}

export interface ProjectionPoint {
    /** Months from today (0 = now). */
    month: number;
    /** Whole years from today, for axis labels. */
    year: number;
    /** Buyer net worth on a liquidation basis: home equity (net of selling cost) + side pot. */
    buyNetWorth: number;
    /** Renter net worth: invested pot only. */
    rentNetWorth: number;
    /** Current market value of the home. */
    homeValue: number;
    /** Outstanding mortgage balance. */
    mortgageBalance: number;
    /** Buyer's monthly housing outflow (mortgage + ownership). */
    buyMonthlyCost: number;
    /** Renter's monthly housing outflow (rent). */
    rentMonthlyCost: number;
}

interface BuyVsRentResult {
    /** Monthly series (month 0 = today), length = holdingYears * 12 + 1. */
    points: ProjectionPoint[];
    /** Same data sampled once per year (0..holdingYears) for cleaner charts. */
    yearlyPoints: ProjectionPoint[];
    /** Level monthly mortgage payment. */
    monthlyPayment: number;
    /** Cash needed at closing: down payment + buying costs. */
    upfrontCash: number;
    /** Down-payment amount alone. */
    downPayment: number;
    /** First month where buyer net worth ≥ renter net worth, or null within horizon. */
    breakEvenMonth: number | null;
    /** breakEvenMonth expressed in whole years (rounded up), or null. */
    breakEvenYear: number | null;
    /** Total mortgage interest paid over the holding period. */
    interestPaidOverHold: number;
    /** Total rent paid over the holding period. */
    rentPaidOverHold: number;
    /** Buyer net worth at the end of the holding period. */
    finalBuyNetWorth: number;
    /** Renter net worth at the end of the holding period. */
    finalRentNetWorth: number;
    /** finalBuyNetWorth − finalRentNetWorth (positive ⇒ buying wins). */
    finalAdvantage: number;
}

/** The part of the inputs that decides what a given price costs to buy. */
export interface LoanTerms {
    downPaymentPct: number;
    buyingCostPct: number;
    ownershipCostPctPerYear: number;
    mortgageRatePct: number;
    mortgageTermYears: number;
}

/** Pulls the borrowing terms out of a full set of inputs, so the affordability
 *  ceiling can be priced on the same mortgage the simulator is showing. */
export function loanTermsOf(inputs: LoanTerms): LoanTerms {
    return {
        downPaymentPct: inputs.downPaymentPct,
        buyingCostPct: inputs.buyingCostPct,
        ownershipCostPctPerYear: inputs.ownershipCostPctPerYear,
        mortgageRatePct: inputs.mortgageRatePct,
        mortgageTermYears: inputs.mortgageTermYears,
    };
}

/** Sensible starting assumptions (2,500萬 home, TW market). Single source of truth. */
export const DEFAULT_BUY_VS_RENT: BuyVsRentInputs = {
    housePrice: 2500 * 10_000,
    downPaymentPct: 30,
    mortgageRatePct: 2.1,
    mortgageTermYears: 30,
    buyingCostPct: 3,
    sellingCostPct: 4,
    ownershipCostPctPerYear: 1,
    appreciationPct: 2,
    monthlyRent: 45_000,
    rentGrowthPct: 2,
    investmentReturnPct: 6,
    holdingYears: 20,
};

export function projectBuyVsRent(inputs: BuyVsRentInputs): BuyVsRentResult {
    const {
        housePrice,
        downPaymentPct,
        mortgageRatePct,
        mortgageTermYears,
        buyingCostPct,
        sellingCostPct,
        ownershipCostPctPerYear,
        appreciationPct,
        monthlyRent,
        rentGrowthPct,
        investmentReturnPct,
        holdingYears,
    } = inputs;

    const downPayment = housePrice * (downPaymentPct / 100);
    const buyingCosts = housePrice * (buyingCostPct / 100);
    const upfrontCash = downPayment + buyingCosts;
    const principal = Math.max(0, housePrice - downPayment);

    const mortgage = calcMortgage({
        principal,
        annualRatePct: mortgageRatePct,
        termYears: mortgageTermYears,
    });
    const monthlyPayment = mortgage.monthlyPayment;

    const horizonMonths = Math.max(1, Math.round(holdingYears * 12));
    const rInvMonthly = investmentReturnPct / 100 / 12;
    const appreciationMonthly = Math.pow(1 + appreciationPct / 100, 1 / 12);
    const rentGrowthMonthly = Math.pow(1 + rentGrowthPct / 100, 1 / 12);
    const sellFactor = 1 - sellingCostPct / 100;

    // Buyer starts having spent all up-front cash on the home → side pot 0.
    // Renter keeps that up-front cash invested from day one.
    let buyerPot = 0;
    let renterPot = upfrontCash;

    let homeValue = housePrice;
    let rent = monthlyRent;
    // Monthly ownership cost derived from an annual % of the (current) home value.
    const ownershipMonthlyRate = ownershipCostPctPerYear / 100 / 12;

    let interestPaidOverHold = 0;
    let rentPaidOverHold = 0;

    const points: ProjectionPoint[] = [];

    for (let m = 0; m <= horizonMonths; m++) {
        const mortgageBalance = m === 0 ? principal : (mortgage.schedule[Math.min(m, mortgage.schedule.length) - 1]?.balance ?? 0);
        const ownershipMonthly = homeValue * ownershipMonthlyRate;
        const buyMonthlyCost = (m <= mortgage.months ? monthlyPayment : 0) + ownershipMonthly;
        const rentMonthlyCost = rent;

        const homeEquityNet = homeValue * sellFactor - mortgageBalance;
        const buyNetWorth = homeEquityNet + buyerPot;
        const rentNetWorth = renterPot;

        points.push({
            month: m,
            year: m / 12,
            buyNetWorth,
            rentNetWorth,
            homeValue,
            mortgageBalance,
            buyMonthlyCost,
            rentMonthlyCost,
        });

        if (m === horizonMonths) break;

        // ---- advance one month ----
        // Whoever spends less on housing invests the difference.
        const diff = buyMonthlyCost - rentMonthlyCost;
        let buyerContribution = 0;
        let renterContribution = 0;
        if (diff > 0) renterContribution = diff;   // renter has spare cash
        else buyerContribution = -diff;             // buyer has spare cash

        buyerPot = buyerPot * (1 + rInvMonthly) + buyerContribution;
        renterPot = renterPot * (1 + rInvMonthly) + renterContribution;

        // Track cumulative interest & rent actually paid this month.
        if (m < mortgage.months) interestPaidOverHold += mortgage.schedule[m]?.interest ?? 0;
        rentPaidOverHold += rent;

        homeValue *= appreciationMonthly;
        rent *= rentGrowthMonthly;
    }

    // Break-even: first month buyer ≥ renter (ignore month 0 tie at start).
    let breakEvenMonth: number | null = null;
    for (let i = 1; i < points.length; i++) {
        if (points[i].buyNetWorth >= points[i].rentNetWorth) {
            breakEvenMonth = points[i].month;
            break;
        }
    }

    const yearlyPoints = points.filter((p) => p.month % 12 === 0);
    const last = points[points.length - 1];

    return {
        points,
        yearlyPoints,
        monthlyPayment,
        upfrontCash,
        downPayment,
        breakEvenMonth,
        breakEvenYear: breakEvenMonth === null ? null : Math.ceil(breakEvenMonth / 12),
        interestPaidOverHold,
        rentPaidOverHold,
        finalBuyNetWorth: last.buyNetWorth,
        finalRentNetWorth: last.rentNetWorth,
        finalAdvantage: last.buyNetWorth - last.rentNetWorth,
    };
}
