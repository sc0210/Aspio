import {
    calcAffordability,
    projectAffordability,
    proportionateTargets,
    yearsToAfford,
    type AffordabilityInputs,
} from '@/lib/housing/affordability';
import { calcMortgage } from '@/lib/housing/mortgage';
import { DEFAULT_TARGETS, evaluateReadiness, WAN } from '@/lib/housing/readiness';

/** A mid-career household: comfortable, cash-constrained rather than income-constrained. */
const BASE: AffordabilityInputs = {
    financialAssets: 1200 * WAN,
    liquidFunds: 1200 * WAN,
    monthlyIncome: 20 * WAN,
    monthlyExpenses: 8 * WAN,
    downPaymentPct: 30,
    buyingCostPct: 3,
    ownershipCostPctPerYear: 1,
    mortgageRatePct: 2.1,
    mortgageTermYears: 30,
};

describe('calcAffordability', () => {
    it('returns a positive ceiling for a household with assets and surplus', () => {
        const r = calcAffordability(BASE);
        expect(r.maxPrice).toBeGreaterThan(0);
        expect(Number.isFinite(r.maxPrice)).toBe(true);
    });

    it('is a true inverse of conditions 3 and 4 under the same thresholds', () => {
        // Buying at exactly the ceiling must not put the scorecard into a gap
        // state — graded against the SAME proportionate targets the ceiling used.
        const r = calcAffordability(BASE);
        const readiness = evaluateReadiness({
            debtBalance: 0,
            refinancedLowRate: false,
            liquidFunds: BASE.liquidFunds,
            financialAssets: BASE.financialAssets,
            cashNeededAtPurchase: r.upfrontCash,
            monthlyIncome: BASE.monthlyIncome,
            monthlyExpenses: BASE.monthlyExpenses,
            monthlyHousingCost: r.monthlyHousingCost,
            targets: proportionateTargets(BASE.monthlyIncome, BASE.monthlyExpenses),
        });
        const buffer = readiness.conditions.find((c) => c.key === 'buffer')!;
        const cashFlow = readiness.conditions.find((c) => c.key === 'cashFlow')!;
        expect(buffer.met).toBe(true);
        expect(cashFlow.met).toBe(true);
    });

    it('scales its thresholds to the household, not to a 2,500萬 home', () => {
        // The deliberate divergence from the scorecard: a junior is asked for six
        // months of THEIR expenses, not a flat 400萬.
        const t = proportionateTargets(4.5 * WAN, 3.5 * WAN);
        expect(t.bufferMin).toBe(21 * WAN);
        expect(t.monthlyCashFlowMin).toBeCloseTo(0.45 * WAN, 0);
        expect(t.bufferMin).toBeLessThan(DEFAULT_TARGETS.bufferMin);
    });

    it('a price just above the ceiling breaks one of those conditions', () => {
        const r = calcAffordability(BASE);
        const over = r.maxPrice * 1.05;
        const upfrontRate = (BASE.downPaymentPct + BASE.buyingCostPct) / 100;
        const readiness = evaluateReadiness({
            debtBalance: 0,
            refinancedLowRate: false,
            liquidFunds: BASE.liquidFunds,
            financialAssets: BASE.financialAssets,
            cashNeededAtPurchase: over * upfrontRate,
            monthlyIncome: BASE.monthlyIncome,
            monthlyExpenses: BASE.monthlyExpenses,
            monthlyHousingCost: r.monthlyHousingCost * 1.05,
        });
        expect(readiness.allClear).toBe(false);
    });

    it('monthly housing cost at the ceiling matches an independently computed mortgage', () => {
        const r = calcAffordability(BASE);
        const principal = r.maxPrice * (1 - BASE.downPaymentPct / 100);
        const { monthlyPayment } = calcMortgage({
            principal,
            annualRatePct: BASE.mortgageRatePct,
            termYears: BASE.mortgageTermYears,
        });
        const ownership = (r.maxPrice * BASE.ownershipCostPctPerYear) / 100 / 12;
        expect(r.monthlyHousingCost).toBeCloseTo(monthlyPayment + ownership, 0);
    });

    it('reports cashFlow as binding when income is the limit', () => {
        const r = calcAffordability({
            ...BASE,
            financialAssets: 5000 * WAN, // plenty of cash
            liquidFunds: 5000 * WAN,
            monthlyIncome: 6 * WAN, // but little left each month
            monthlyExpenses: 2 * WAN,
        });
        expect(r.binding).toBe('cashFlow');
    });

    it('reports cash as binding when the buffer requirement is the limit', () => {
        const r = calcAffordability({
            ...BASE,
            financialAssets: 700 * WAN,
            liquidFunds: 700 * WAN,
            monthlyIncome: 60 * WAN, // income is not the problem
            monthlyExpenses: 5 * WAN,
        });
        expect(r.binding).toBe('cash');
    });

    it('cannot spend more cash at closing than is actually liquid', () => {
        // Assets are large but mostly illiquid, so the liquid limit must bite.
        const r = calcAffordability({
            ...BASE,
            financialAssets: 5000 * WAN,
            liquidFunds: 100 * WAN,
            monthlyIncome: 60 * WAN,
            monthlyExpenses: 5 * WAN,
        });
        expect(r.binding).toBe('liquid');
        expect(r.upfrontCash).toBeLessThanOrEqual(100 * WAN + 1);
    });
});

describe('early-career case — the one this feature exists for', () => {
    const JUNIOR: AffordabilityInputs = {
        ...BASE,
        financialAssets: 30 * WAN,
        liquidFunds: 30 * WAN,
        monthlyIncome: 4.5 * WAN,
        monthlyExpenses: 3.5 * WAN,
    };

    it('gives a real, non-zero number instead of a dead end', () => {
        // Under the scorecard's absolute targets this was 0萬 today AND at every
        // horizon out to 10 years, however well they saved. That is the whole
        // reason for proportionate targets: the feature exists for this user.
        const r = calcAffordability(JUNIOR);
        expect(r.maxPrice).toBeGreaterThan(0);
        expect(Number.isNaN(r.maxPrice)).toBe(false);
    });

    it('the ceiling rises year over year on savings alone', () => {
        const p = projectAffordability(JUNIOR);
        expect(p.canGrow).toBe(true);
        const prices = p.milestones.map((m) => m.maxPrice);
        for (let i = 1; i < prices.length; i++) {
            expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
        }
        expect(prices[prices.length - 1]).toBeGreaterThan(prices[0]);
    });

    it('raises lift it further still, but are opt-in', () => {
        const flat = projectAffordability(JUNIOR);
        const withRaises = projectAffordability(JUNIOR, { annualIncomeGrowthPct: 4 });
        const last = (p: ReturnType<typeof projectAffordability>) =>
            p.milestones[p.milestones.length - 1].maxPrice;
        expect(last(withRaises)).toBeGreaterThan(last(flat));
    });

    it('tells the user each unit saved unlocks ~3x its value in price', () => {
        const p = projectAffordability(JUNIOR);
        // 30% down + 3% costs ⇒ 1 / 0.33 ≈ 3.03
        expect(p.priceUnlockedPerSaved).toBeCloseTo(3.03, 1);
    });

    it('does not fake growth when there is no surplus', () => {
        const p = projectAffordability({ ...JUNIOR, monthlyExpenses: 5 * WAN });
        expect(p.canGrow).toBe(false);
        expect(p.monthlySavings).toBeLessThan(0);
    });
});

describe('return on financial assets', () => {
    // Cash-bound: income comfortably clears the monthly test, so the ceiling
    // tracks the size of the pot — which is exactly where the return rate bites.
    const CASH_BOUND: AffordabilityInputs = {
        ...BASE,
        financialAssets: 300 * WAN,
        liquidFunds: 300 * WAN,
    };

    // Pinned to a 3-year horizon deliberately. Far enough out the pot has grown,
    // but not so far that it clears the cash-flow wall — past that point every
    // return rate converges on the same capped number and the comparison is
    // vacuous rather than wrong.
    const HORIZON = { horizonsYears: [3] };

    it('a higher return compounds into a higher future ceiling', () => {
        const at = (pct: number) =>
            projectAffordability(CASH_BOUND, { ...HORIZON, annualReturnPct: pct }).milestones[0];
        expect(calcAffordability(CASH_BOUND).binding).toBe('cash');
        expect(at(0).maxPrice).toBeLessThan(at(6).maxPrice);
        expect(at(6).maxPrice).toBeLessThan(at(12).maxPrice);
        // still under the wall, so the comparison above is meaningful
        expect(at(12).maxPrice).toBeLessThan(calcAffordability(CASH_BOUND).cashFlowCeiling);
    });

    it('leaves today\'s ceiling untouched — that uses assets already held', () => {
        const a = projectAffordability(CASH_BOUND, { annualReturnPct: 0 }).today.maxPrice;
        const b = projectAffordability(CASH_BOUND, { annualReturnPct: 12 }).today.maxPrice;
        expect(a).toBe(b);
    });

    it('0% still grows the pot from contributions alone', () => {
        const p = projectAffordability(CASH_BOUND, { annualReturnPct: 0, horizonsYears: [1, 3] });
        expect(p.milestones[1].maxPrice).toBeGreaterThan(p.milestones[0].maxPrice);
    });
});

describe('yearsToAfford', () => {
    it('returns 0 when the target is already affordable', () => {
        expect(yearsToAfford(BASE, 100 * WAN)).toBe(0);
    });

    it('returns a finite horizon when saving is the lever that closes the gap', () => {
        // Cash-bound: income comfortably services a bigger loan, the down payment
        // is what's missing — so time and savings genuinely do get them there.
        const cashBound: AffordabilityInputs = {
            ...BASE,
            financialAssets: 300 * WAN,
            liquidFunds: 300 * WAN,
        };
        const c = calcAffordability(cashBound);
        expect(c.binding).toBe('cash');

        const target = c.maxPrice * 1.5; // out of reach today...
        expect(target).toBeLessThan(c.cashFlowCeiling); // ...but under the wall

        const y = yearsToAfford(cashBound, target);
        expect(y).not.toBeNull();
        expect(y!).toBeGreaterThan(0);
    });

    it('returns null for a target above the cash-flow wall, however long you save', () => {
        // Saving cannot buy past what the monthly budget services, so this must
        // report "never" rather than an encouraging but false horizon.
        const ceiling = calcAffordability(BASE).cashFlowCeiling;
        expect(yearsToAfford(BASE, ceiling * 1.2)).toBeNull();
    });

    it('returns null when the target is out of reach within the horizon', () => {
        const y = yearsToAfford(
            { ...BASE, financialAssets: 10 * WAN, liquidFunds: 10 * WAN, monthlyIncome: 4 * WAN, monthlyExpenses: 3.9 * WAN },
            100000 * WAN,
        );
        expect(y).toBeNull();
    });

    it('terminates instead of looping when nothing can ever accumulate', () => {
        const y = yearsToAfford(
            { ...BASE, financialAssets: 0, liquidFunds: 0, monthlyIncome: 3 * WAN, monthlyExpenses: 3 * WAN },
            1000 * WAN,
            { annualReturnPct: 0 },
        );
        expect(y).toBeNull();
    });
});
