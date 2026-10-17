import {
    calcMortgage,
    projectBuyVsRent,
    evaluateReadiness,
    monthsToTarget,
    evaluateCarImpact,
    DEFAULT_CAR_IMPACT,
    WAN,
    type BuyVsRentInputs,
    type HouseTimelineContext,
} from '@/lib/housing';

describe('calcMortgage', () => {
    it('interest-free loan is a straight-line payoff', () => {
        const r = calcMortgage({ principal: 1200, annualRatePct: 0, termYears: 1 });
        expect(r.months).toBe(12);
        expect(r.monthlyPayment).toBeCloseTo(100, 6);
        expect(r.totalInterest).toBeCloseTo(0, 6);
        expect(r.schedule[r.schedule.length - 1].balance).toBeCloseTo(0, 6);
    });

    it('amortizes a 1000萬 / 2% / 30yr loan to zero with sane totals', () => {
        const r = calcMortgage({ principal: 1000 * WAN, annualRatePct: 2, termYears: 30 });
        // Known-good level payment is ≈ 36,962 TWD/mo.
        expect(r.monthlyPayment).toBeGreaterThan(36_500);
        expect(r.monthlyPayment).toBeLessThan(37_500);
        expect(r.schedule).toHaveLength(360);
        // Final balance must fully amortize.
        expect(r.schedule[359].balance).toBeCloseTo(0, 2);
        // Total interest is positive and less than principal at this low rate.
        expect(r.totalInterest).toBeGreaterThan(3_000_000);
        expect(r.totalInterest).toBeLessThan(1000 * WAN);
        expect(r.totalPaid).toBeCloseTo(1000 * WAN + r.totalInterest, 2);
    });
});

const baseBuyRent: BuyVsRentInputs = {
    housePrice: 2500 * WAN,
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

describe('projectBuyVsRent', () => {
    it('produces monthly + yearly series of the right length', () => {
        const res = projectBuyVsRent(baseBuyRent);
        expect(res.points).toHaveLength(20 * 12 + 1);
        expect(res.yearlyPoints).toHaveLength(21);
        expect(res.yearlyPoints[0].month).toBe(0);
        expect(res.yearlyPoints[20].month).toBe(240);
    });

    it('up-front cash = down payment + buying costs', () => {
        const res = projectBuyVsRent(baseBuyRent);
        expect(res.downPayment).toBeCloseTo(2500 * WAN * 0.3, 2);
        expect(res.upfrontCash).toBeCloseTo(2500 * WAN * 0.3 + 2500 * WAN * 0.03, 2);
    });

    it('renter starts ahead by roughly the transaction-cost drag', () => {
        const res = projectBuyVsRent(baseBuyRent);
        // At t=0 the buyer eats buying + selling costs, so renter leads.
        expect(res.points[0].rentNetWorth).toBeGreaterThan(res.points[0].buyNetWorth);
    });

    it('finds a break-even when appreciation & rent strongly favor buying', () => {
        const res = projectBuyVsRent({
            ...baseBuyRent,
            appreciationPct: 4,
            rentGrowthPct: 4,
            investmentReturnPct: 4,
        });
        expect(res.breakEvenMonth).not.toBeNull();
        expect(res.finalBuyNetWorth).toBeGreaterThan(res.finalRentNetWorth);
    });

    it('renting can win when appreciation is flat and returns are high', () => {
        const res = projectBuyVsRent({
            ...baseBuyRent,
            appreciationPct: 0,
            rentGrowthPct: 0,
            investmentReturnPct: 9,
            monthlyRent: 30_000,
        });
        expect(res.finalRentNetWorth).toBeGreaterThan(res.finalBuyNetWorth);
    });
});

describe('evaluateReadiness', () => {
    const ready = {
        debtBalance: 0,
        refinancedLowRate: false,
        liquidFunds: 1200 * WAN,
        financialAssets: 1400 * WAN,
        cashNeededAtPurchase: 800 * WAN,
        monthlyIncome: 200_000,
        monthlyExpenses: 90_000,
        monthlyHousingCost: 70_000,
    };

    it('flags all four conditions clear', () => {
        const r = evaluateReadiness(ready);
        expect(r.allClear).toBe(true);
        expect(r.metCount).toBe(4);
        expect(r.score).toBe(100);
        expect(r.biggestGap).toBeNull();
        // buffer = 1400萬 − 800萬 = 600萬
        expect(r.postPurchaseBuffer).toBeCloseTo(600 * WAN, 2);
        // surplus = 200k − 90k − 70k = 40k
        expect(r.monthlySurplus).toBeCloseTo(40_000, 2);
    });

    it('identifies liquid funds as the biggest gap', () => {
        const r = evaluateReadiness({ ...ready, liquidFunds: 400 * WAN });
        expect(r.allClear).toBe(false);
        expect(r.biggestGap?.key).toBe('liquidFunds');
        const liquid = r.conditions.find((c) => c.key === 'liquidFunds')!;
        expect(liquid.met).toBe(false);
        expect(liquid.shortfall).toBeCloseTo(600 * WAN, 2);
    });

    it('debt condition passes on refinance even with a balance', () => {
        const r = evaluateReadiness({ ...ready, debtBalance: 500 * WAN, refinancedLowRate: true });
        const debt = r.conditions.find((c) => c.key === 'debt')!;
        expect(debt.met).toBe(true);
        expect(debt.status).toBe('close');
    });
});

describe('evaluateCarImpact', () => {
    const ctx: HouseTimelineContext = {
        currentLiquid: 600 * WAN,
        monthlySavings: 100_000,
        liquidTarget: 1000 * WAN,
        annualReturnPct: 6,
        currentDebt: 0,
    };

    it('a car delays the house timeline and drains liquid/savings/adds debt', () => {
        const r = evaluateCarImpact(DEFAULT_CAR_IMPACT, ctx);
        // 80萬 car, 20% down = 16萬
        expect(r.downPayment).toBeCloseTo(16 * WAN, 2);
        expect(r.loanPrincipal).toBeCloseTo(64 * WAN, 2);
        expect(r.liquidAfterCar).toBeCloseTo(600 * WAN - 16 * WAN, 2);
        expect(r.debtAfterCar).toBeCloseTo(64 * WAN, 2);
        // Burden = loan payment + running cost; savings drop by exactly that.
        expect(r.monthlyBurden).toBeCloseTo(r.monthlyLoanPayment + 12_000, 2);
        expect(r.savingsAfterCar).toBeCloseTo(100_000 - r.monthlyBurden, 2);
        expect(r.savingsAfterLoan).toBeCloseTo(100_000 - 12_000, 2);
        // The house target still reachable, but later than the baseline.
        expect(r.baseline.months).not.toBeNull();
        expect(r.withCar.months).not.toBeNull();
        expect(r.withCar.months!).toBeGreaterThan(r.baseline.months!);
        expect(r.delayMonths!).toBeGreaterThan(0);
        expect(r.neverReaches).toBe(false);
    });

    it('a car depreciates below its price by the end of the loan', () => {
        const r = evaluateCarImpact(DEFAULT_CAR_IMPACT, ctx);
        expect(r.carValueAtLoanEnd).toBeLessThan(DEFAULT_CAR_IMPACT.carPrice);
        expect(r.carValueAtLoanEnd).toBeGreaterThan(0);
    });

    it('no car (zero price, zero running cost) means zero delay', () => {
        const r = evaluateCarImpact(
            { ...DEFAULT_CAR_IMPACT, carPrice: 0, monthlyRunningCost: 0 },
            ctx,
        );
        expect(r.monthlyBurden).toBeCloseTo(0, 6);
        expect(r.delayMonths).toBe(0);
    });

    it('flags never-reaches when the car makes savings permanently negative', () => {
        const r = evaluateCarImpact(
            { ...DEFAULT_CAR_IMPACT, monthlyRunningCost: 200_000 },
            ctx,
        );
        expect(r.neverReaches).toBe(true);
        expect(r.withCar.months).toBeNull();
        expect(r.delayMonths).toBeNull();
    });
});

describe('monthsToTarget', () => {
    it('returns 0 when already at target', () => {
        const r = monthsToTarget({ current: 1000 * WAN, target: 800 * WAN, monthlySavings: 50_000, annualReturnPct: 6 });
        expect(r.alreadyThere).toBe(true);
        expect(r.months).toBe(0);
    });

    it('solves a reachable target within the cap', () => {
        const r = monthsToTarget({ current: 600 * WAN, target: 1000 * WAN, monthlySavings: 100_000, annualReturnPct: 6 });
        expect(r.months).not.toBeNull();
        expect(r.months!).toBeGreaterThan(0);
        expect(r.years!).toBeGreaterThanOrEqual(3);
        expect(r.years!).toBeLessThan(6);
    });

    it('returns null when the target is unreachable within the cap', () => {
        const r = monthsToTarget({ current: 0, target: 1e12, monthlySavings: 1, annualReturnPct: 0, maxMonths: 12 });
        expect(r.months).toBeNull();
    });
});
