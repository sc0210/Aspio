import {
    presentValueOfFutureSavings,
    freedPaymentFrom,
    computeTarget,
    phaseFor,
    evaluatePosition,
    evaluateTracking,
    evaluateStress,
    evaluateSpread,
    aggregateDebt,
    interestToDate,
    totalInterestToDate,
    monthsElapsed,
    portfolioRealizedReturnPct,
    projectGlidepath,
    type GlidepathInputs,
    type LifecycleLoan,
} from '@/lib/lifecycle';
import { monthsToPayoff, calcAmortization } from '@/lib/finance/amortization';
import {
    defaultInvestmentLoanIds,
    coerceLifecyclePreferences,
    DEFAULT_LIFECYCLE_PREFERENCES,
} from '@/hooks/useLifecyclePreferences';

const WAN = 10_000;

describe('presentValueOfFutureSavings', () => {
    it('is zero with no savings or no years left', () => {
        const base = { discountRatePct: 4, savingsGrowthPct: 2 };
        expect(presentValueOfFutureSavings({ ...base, monthlySavings: 0, yearsToRetirement: 30 })).toBe(0);
        expect(presentValueOfFutureSavings({ ...base, monthlySavings: 50_000, yearsToRetirement: 0 })).toBe(0);
    });

    it('discounts a flat stream below its undiscounted sum', () => {
        const pv = presentValueOfFutureSavings({
            monthlySavings: 50_000,
            yearsToRetirement: 30,
            discountRatePct: 4,
            savingsGrowthPct: 0,
        });
        const undiscounted = 50_000 * 30 * 12;
        expect(pv).toBeGreaterThan(0);
        expect(pv).toBeLessThan(undiscounted);
        // A 30yr flat annuity at 4% is worth roughly 58% of face value.
        expect(pv / undiscounted).toBeGreaterThan(0.5);
        expect(pv / undiscounted).toBeLessThan(0.65);
    });

    it('handles the r == g degenerate case without dividing by zero', () => {
        const pv = presentValueOfFutureSavings({
            monthlySavings: 10_000,
            yearsToRetirement: 10,
            discountRatePct: 4,
            savingsGrowthPct: 4,
        });
        expect(Number.isFinite(pv)).toBe(true);
        // C·n/(1+r) with r = 4%/12
        expect(pv).toBeCloseTo((10_000 * 120) / (1 + 0.04 / 12), 0);
    });

    it('grows with a rising savings rate and shrinks with heavier discounting', () => {
        const base = { monthlySavings: 50_000, yearsToRetirement: 25, discountRatePct: 4, savingsGrowthPct: 0 };
        expect(presentValueOfFutureSavings({ ...base, savingsGrowthPct: 3 })).toBeGreaterThan(
            presentValueOfFutureSavings(base),
        );
        expect(presentValueOfFutureSavings({ ...base, discountRatePct: 8 })).toBeLessThan(
            presentValueOfFutureSavings(base),
        );
    });
});

describe('computeTarget', () => {
    it('caps a young investor at the leverage ceiling', () => {
        // Small savings, huge future — the classic phase-1 shape.
        const t = computeTarget({
            netFinancialAssets: 100 * WAN,
            pvFutureSavings: 2000 * WAN,
            samuelsonSharePct: 67,
            maxLeverage: 2,
        });
        expect(t.lifetimeWealth).toBeCloseTo(2100 * WAN, 2);
        expect(t.targetExposure).toBeCloseTo(2100 * WAN * 0.67, 2);
        expect(t.unconstrainedLeverage).toBeGreaterThan(2);
        expect(t.targetLeverage).toBe(2);
        expect(t.cappedByMax).toBe(true);
        expect(t.allowedExposure).toBeCloseTo(200 * WAN, 2);
        expect(t.phase).toBe('accumulate');
    });

    it('falls below the ceiling once savings dominate lifetime wealth', () => {
        const t = computeTarget({
            netFinancialAssets: 2000 * WAN,
            pvFutureSavings: 500 * WAN,
            samuelsonSharePct: 67,
            maxLeverage: 2,
        });
        expect(t.cappedByMax).toBe(false);
        expect(t.targetLeverage).toBeLessThan(1);
        expect(t.phase).toBe('glide');
    });

    it('reports underwater rather than an Infinity that would poison the charts', () => {
        const t = computeTarget({
            netFinancialAssets: -50 * WAN,
            pvFutureSavings: 500 * WAN,
            samuelsonSharePct: 67,
            maxLeverage: 2,
        });
        expect(t.phase).toBe('underwater');
        expect(t.allowedExposure).toBe(0);
        expect(Number.isFinite(t.targetLeverage)).toBe(true);
    });

    it('phaseFor splits on the ceiling and on 1x', () => {
        expect(phaseFor(2.5, 2)).toBe('accumulate');
        expect(phaseFor(2, 2)).toBe('accumulate');
        expect(phaseFor(1.5, 2)).toBe('deleverage');
        expect(phaseFor(1, 2)).toBe('glide');
        expect(phaseFor(0.4, 2)).toBe('glide');
        expect(phaseFor(Infinity, 2)).toBe('underwater');
    });
});

describe('evaluatePosition', () => {
    it('nets cash against debt — held cash is negative leverage', () => {
        const p = evaluatePosition({
            stockExposure: 300 * WAN,
            cashAssets: 40 * WAN,
            investmentDebt: 100 * WAN,
        });
        // Own money = 300 + 40 − 100 = 240萬
        expect(p.netFinancialAssets).toBeCloseTo(240 * WAN, 2);
        expect(p.leverage).toBeCloseTo(300 / 240, 6);
        expect(p.isUnderwater).toBe(false);
    });

    it('is unlevered when there is no debt', () => {
        const p = evaluatePosition({ stockExposure: 200 * WAN, cashAssets: 50 * WAN, investmentDebt: 0 });
        expect(p.leverage).toBeLessThan(1);
        expect(p.borrowedShare).toBe(0);
    });

    it('excludes other debt from leverage but not from net worth', () => {
        const p = evaluatePosition({
            stockExposure: 300 * WAN,
            cashAssets: 0,
            investmentDebt: 100 * WAN,
            otherDebt: 500 * WAN,
        });
        expect(p.netFinancialAssets).toBeCloseTo(200 * WAN, 2);
        expect(p.leverage).toBeCloseTo(1.5, 6);
        expect(p.netWorth).toBeCloseTo(-300 * WAN, 2);
    });

    it('flags underwater when debt swallows everything', () => {
        const p = evaluatePosition({ stockExposure: 100 * WAN, cashAssets: 10 * WAN, investmentDebt: 200 * WAN });
        expect(p.isUnderwater).toBe(true);
        expect(p.leverage).toBe(Infinity);
    });
});

describe('evaluateTracking', () => {
    const position = evaluatePosition({
        stockExposure: 300 * WAN,
        cashAssets: 0,
        investmentDebt: 100 * WAN,
    }); // leverage 1.5

    it('treats small drift as on plan rather than churning the portfolio', () => {
        const r = evaluateTracking(position, 1.55, 310 * WAN, 2);
        expect(r.verdict).toBe('on-track');
    });

    it('calls out being under- and over-levered outside the band', () => {
        expect(evaluateTracking(position, 1.9, 380 * WAN, 2).verdict).toBe('under');
        expect(evaluateTracking(position, 1.1, 220 * WAN, 2).verdict).toBe('over');
    });

    it('breaches when actual leverage exceeds the ceiling', () => {
        const hot = evaluatePosition({ stockExposure: 300 * WAN, cashAssets: 0, investmentDebt: 160 * WAN });
        expect(hot.leverage).toBeGreaterThan(2);
        expect(evaluateTracking(hot, 2, 280 * WAN, 2).verdict).toBe('breach');
    });

    it('never suggests adding exposure beyond the ceiling', () => {
        // Target exposure of 900萬 is far above what 200萬 of own money allows.
        const r = evaluateTracking(position, 2, 900 * WAN, 2);
        expect(r.exposureGap).toBeCloseTo(200 * WAN * 2 - 300 * WAN, 2);
    });
});

describe('evaluateStress', () => {
    const base = {
        stockExposure: 300 * WAN,
        cashAssets: 0,
        investmentDebt: 100 * WAN,
        monthlyPayment: 30_000,
        monthlySavings: 40_000,
        liquidReserve: 50 * WAN,
    };

    it('wipeout drop is exactly 1 / leverage', () => {
        const s = evaluateStress(base);
        expect(s.leverage).toBeCloseTo(1.5, 6);
        expect(s.wipeoutDropPct).toBeCloseTo(100 / 1.5, 4);
    });

    it('has no wipeout point when unlevered', () => {
        const s = evaluateStress({ ...base, investmentDebt: 0, monthlyPayment: 0 });
        expect(s.wipeoutDropPct).toBeNull();
        expect(s.coverageRatio).toBeNull();
        expect(s.runwayMonths).toBeNull();
        expect(s.forcedSaleRisk).toBe(false);
    });

    it('raises leverage after a drawdown — debt does not shrink with the market', () => {
        const s = evaluateStress(base);
        const drop20 = s.scenarios.find((x) => x.dropPct === 20)!;
        expect(drop20.leverageAfter).not.toBeNull();
        expect(drop20.leverageAfter!).toBeGreaterThan(s.leverage);
        // 20% of 300萬 = 60萬 lost from 200萬 of own money → 30%.
        expect(drop20.ownMoneyLossPct).toBeCloseTo(30, 6);
    });

    it('survives every default scenario below the wipeout point', () => {
        const s = evaluateStress(base); // 1.5× → wipeout at 66.7%
        expect(s.scenarios.every((x) => !x.wipedOut)).toBe(true);
    });

    it('marks the scenario at the wipeout point as wiped out', () => {
        // At the 2× ceiling the wipeout point is exactly a 50% fall.
        const s = evaluateStress({ ...base, investmentDebt: 150 * WAN });
        expect(s.leverage).toBeCloseTo(2, 6);
        expect(s.wipeoutDropPct).toBeCloseTo(50, 6);
        expect(s.scenarios.find((x) => x.dropPct === 50)!.wipedOut).toBe(true);
        expect(s.scenarios.find((x) => x.dropPct === 50)!.leverageAfter).toBeNull();
        expect(s.scenarios.find((x) => x.dropPct === 40)!.wipedOut).toBe(false);
    });

    it('adds the payment back to reach free cash flow before debt service', () => {
        const s = evaluateStress(base);
        // Recorded savings are already net of the repayment expense.
        expect(s.preDebtSurplus).toBe(70_000);
        expect(s.coverageRatio).toBeCloseTo(70_000 / 30_000, 6);
        expect(s.coverageSeverity).toBe('safe');
    });

    it('flags forced-sale risk when the payment eats the free cash flow', () => {
        const s = evaluateStress({ ...base, monthlySavings: -25_000 });
        // Free cash flow 5,000 against a 30,000 payment.
        expect(s.coverageSeverity).toBe('danger');
        expect(s.forcedSaleRisk).toBe(true);
    });

    it('flags forced-sale risk on a thin reserve even with healthy cash flow', () => {
        const s = evaluateStress({ ...base, liquidReserve: 9 * WAN });
        expect(s.coverageSeverity).toBe('safe');
        expect(s.runwaySeverity).toBe('danger'); // 3 months
        expect(s.forcedSaleRisk).toBe(true);
    });
});

describe('spread', () => {
    const loans: LifecycleLoan[] = [
        {
            id: 'a',
            name: 'Investment loan',
            currentBalance: 100 * WAN,
            principalAmount: 100 * WAN,
            annualRatePct: 2,
            monthlyPayment: 20_000,
            startDate: '2024-01-01',
            termMonths: 60,
        },
        {
            id: 'b',
            name: 'Card',
            currentBalance: 10 * WAN,
            principalAmount: 10 * WAN,
            annualRatePct: 15,
            monthlyPayment: 5_000,
            startDate: '2024-01-01',
            termMonths: 24,
        },
    ];

    it('blends the rate by balance, not by loan count', () => {
        const d = aggregateDebt(loans);
        expect(d.balance).toBeCloseTo(110 * WAN, 2);
        expect(d.monthlyPayment).toBe(25_000);
        // (100·2 + 10·15) / 110 ≈ 3.18 — nowhere near the 8.5 a naive mean gives.
        expect(d.blendedRatePct).toBeCloseTo((100 * 2 + 10 * 15) / 110, 6);
        expect(d.loanCount).toBe(2);
    });

    it('aggregates an empty list without dividing by zero', () => {
        const d = aggregateDebt([]);
        expect(d.balance).toBe(0);
        expect(d.blendedRatePct).toBe(0);
        expect(d.maxRemainingMonths).toBe(0);
    });

    it('splits interest paid from interest still ahead', () => {
        const asOf = new Date(2026, 0, 1);
        expect(monthsElapsed(loans[0], asOf)).toBe(24);
        const i = interestToDate(loans[0], asOf);
        expect(i.paid).toBeGreaterThan(0);
        expect(i.remaining).toBeGreaterThan(0);
        expect(i.paid + i.remaining).toBeCloseTo(i.total, 6);
        // Front-loaded schedule: 24 of 60 months should be over 40% of the interest.
        expect(i.paid / i.total).toBeGreaterThan(0.4);
    });

    it('reports no interest for revolving credit with no term', () => {
        const i = interestToDate({ ...loans[0], termMonths: null });
        expect(i).toEqual({ paid: 0, remaining: 0, total: 0 });
    });

    it('counts a period only once the due day comes round', () => {
        // Same rule the backend's _months_elapsed applies. Counting calendar
        // months alone credited a payment up to a month before it was made,
        // so this page and the loans page disagreed for most of every month.
        const loan = { ...loans[0], startDate: '2024-05-19' };
        // Aug 17 — the 19th has not arrived, so the August period is not done.
        expect(monthsElapsed(loan, new Date(2026, 7, 17))).toBe(26);
        // Aug 19 — it completes.
        expect(monthsElapsed(loan, new Date(2026, 7, 19))).toBe(27);
    });

    it('clamps the due day to a short month', () => {
        // A loan that started on the 31st falls due on the 28th in February.
        // Comparing raw day numbers meant February never completed a period.
        const loan = { ...loans[0], startDate: '2024-01-31' };
        expect(monthsElapsed(loan, new Date(2026, 1, 27))).toBe(24);
        expect(monthsElapsed(loan, new Date(2026, 1, 28))).toBe(25);
    });

    it('stops quoting future interest on a repaid loan', () => {
        const asOf = new Date(2026, 0, 1);
        // Balance 0 but still `active` — minimum_payment is never zeroed on
        // repayment, which is exactly how a cleared loan reaches this code.
        const cleared = { ...loans[0], currentBalance: 0 };
        const i = interestToDate(cleared, asOf);
        expect(i.remaining).toBe(0);
        expect(i.paid).toBeGreaterThan(0);
        expect(i.total).toBe(i.paid);
        // And it must not inflate the aggregate the SpreadPanel renders.
        const still = interestToDate(loans[1], asOf);
        const sum = totalInterestToDate([cleared, loans[1]], asOf);
        expect(sum.remaining).toBeCloseTo(still.remaining, 6);
        expect(sum.paid).toBeCloseTo(i.paid + still.paid, 6);
    });

    it('is positive only when the portfolio out-earns the loan', () => {
        const good = evaluateSpread({ realizedReturnPct: 8, borrowingCostPct: 2.5, debtBalance: 100 * WAN });
        expect(good.isPositive).toBe(true);
        expect(good.spreadPct).toBeCloseTo(5.5, 6);
        expect(good.annualCarry).toBeCloseTo(100 * WAN * 0.055, 2);

        const bad = evaluateSpread({ realizedReturnPct: 1, borrowingCostPct: 2.5, debtBalance: 100 * WAN });
        expect(bad.isPositive).toBe(false);
        expect(bad.annualCarry!).toBeLessThan(0);
    });

    it('reports unknown rather than guessing when there is no return yet', () => {
        const s = evaluateSpread({ realizedReturnPct: null, borrowingCostPct: 2.5, debtBalance: 100 * WAN });
        expect(s.unknown).toBe(true);
        expect(s.spreadPct).toBeNull();
        expect(s.isPositive).toBe(false);
    });

    it('weights realized return by position size', () => {
        const r = portfolioRealizedReturnPct([
            { totalValue: 900_000, irr: 0.06 },
            { totalValue: 100_000, irr: 0.20 },
        ]);
        // Value-weighted 7.4%, not the 13% a naive average would report.
        expect(r).toBeCloseTo(7.4, 6);
    });

    it('weights by the value passed, so a mis-scaled currency would skew it', () => {
        // Guards the contract: 10,000 USD of an 8% holding must outweigh
        // 300,000 TWD of a 2% one once converted (~320k vs 300k TWD). Passing
        // raw native values would flip the answer toward 2%.
        const converted = portfolioRealizedReturnPct([
            { totalValue: 320_000, irr: 0.08 },
            { totalValue: 300_000, irr: 0.02 },
        ])!;
        const raw = portfolioRealizedReturnPct([
            { totalValue: 10_000, irr: 0.08 },
            { totalValue: 300_000, irr: 0.02 },
        ])!;
        expect(converted).toBeGreaterThan(4.9);
        expect(raw).toBeLessThan(2.3);
    });

    it('ignores holdings with no IRR, and returns null when none have one', () => {
        expect(portfolioRealizedReturnPct([
            { totalValue: 500_000, irr: 0.10 },
            { totalValue: 500_000 },
        ])).toBeCloseTo(10, 6);
        expect(portfolioRealizedReturnPct([{ totalValue: 500_000 }])).toBeNull();
        expect(portfolioRealizedReturnPct([])).toBeNull();
    });
});

describe('coerceLifecyclePreferences', () => {
    it('keeps values that are already in range', () => {
        const p = coerceLifecyclePreferences({ samuelsonSharePct: 50, maxLeverage: 1.5 });
        expect(p.samuelsonSharePct).toBe(50);
        expect(p.maxLeverage).toBe(1.5);
    });

    it('clamps out-of-range stored values instead of trusting them', () => {
        // localStorage outlives the app version and can be hand-edited; a
        // maxLeverage of 50 would silently rewrite the ceiling the page is
        // measured against.
        const p = coerceLifecyclePreferences({
            maxLeverage: 50,
            samuelsonSharePct: 5000,
            investedSharePct: -20,
            expectedReturnPct: 999,
            retirementAge: 5,
            birthYear: 1200,
        });
        expect(p.maxLeverage).toBe(2);
        expect(p.samuelsonSharePct).toBe(100);
        expect(p.investedSharePct).toBe(0);
        expect(p.expectedReturnPct).toBe(12);
        expect(p.retirementAge).toBe(45);
        expect(p.birthYear).toBe(1950);
    });

    it('falls back to defaults for missing or non-numeric values', () => {
        const p = coerceLifecyclePreferences({
            maxLeverage: NaN,
            samuelsonSharePct: 'lots' as unknown as number,
        });
        expect(p.maxLeverage).toBe(DEFAULT_LIFECYCLE_PREFERENCES.maxLeverage);
        expect(p.samuelsonSharePct).toBe(DEFAULT_LIFECYCLE_PREFERENCES.samuelsonSharePct);
        expect(p).toEqual(DEFAULT_LIFECYCLE_PREFERENCES);
    });

    it('drops non-string loan ids', () => {
        const p = coerceLifecyclePreferences({
            investmentLoanIds: ['a', 42, null, 'b'] as unknown as string[],
        });
        expect(p.investmentLoanIds).toEqual(['a', 'b']);
    });
});

describe('defaultInvestmentLoanIds', () => {
    const loans = [
        { id: 'personal', status: 'active', account_type: 'personal_loan' },
        { id: 'other', status: 'active', account_type: 'other' },
        { id: 'mortgage', status: 'active', account_type: 'mortgage' },
        { id: 'auto', status: 'active', account_type: 'auto_loan' },
        { id: 'student', status: 'active', account_type: 'student_loan' },
        { id: 'paid', status: 'paid_off', account_type: 'personal_loan' },
    ];

    it('picks personal loans so the page is useful on first visit', () => {
        expect(defaultInvestmentLoanIds(loans)).toEqual(['personal', 'other']);
    });

    it('never assumes a mortgage, car or student loan funded the portfolio', () => {
        const picked = defaultInvestmentLoanIds(loans);
        expect(picked).not.toContain('mortgage');
        expect(picked).not.toContain('auto');
        expect(picked).not.toContain('student');
    });

    it('ignores loans that are no longer active', () => {
        expect(defaultInvestmentLoanIds(loans)).not.toContain('paid');
    });

    it('returns nothing when there is nothing to guess from', () => {
        expect(defaultInvestmentLoanIds([])).toEqual([]);
    });
});

describe('monthsToPayoff', () => {
    it('is zero for a cleared balance', () => {
        expect(monthsToPayoff(0, 5, 10_000)).toBe(0);
    });

    it('matches straight-line division at zero interest', () => {
        expect(monthsToPayoff(120_000, 0, 10_000)).toBe(12);
    });

    it('agrees with the amortization schedule it inverts', () => {
        // A 100萬 / 5% / 7yr loan: solve for the payment, then ask for the term back.
        const term = 84;
        const sched = calcAmortization({ principal: 100 * WAN, annualRatePct: 5, termYears: term / 12 });
        expect(monthsToPayoff(100 * WAN, 5, sched.monthlyPayment)).toBe(term);
    });

    it('returns null when the payment never clears the balance', () => {
        // 100萬 at 5% accrues ~4,167/mo of interest.
        expect(monthsToPayoff(100 * WAN, 5, 4_000)).toBeNull();
        expect(monthsToPayoff(100 * WAN, 5, 0)).toBeNull();
    });
});

describe('presentValueOfFutureSavings — a payment that stops', () => {
    const base = {
        monthlySavings: 25_000,
        yearsToRetirement: 30,
        discountRatePct: 4,
        savingsGrowthPct: 2,
    };

    it('is worth more when a payment is due to free up', () => {
        const withFreed = presentValueOfFutureSavings({ ...base, freedPayment: 50_000, monthsUntilFreed: 84 });
        expect(withFreed).toBeGreaterThan(presentValueOfFutureSavings(base));
    });

    it('values the freed payment less the longer you wait for it', () => {
        const soon = presentValueOfFutureSavings({ ...base, freedPayment: 50_000, monthsUntilFreed: 12 });
        const later = presentValueOfFutureSavings({ ...base, freedPayment: 50_000, monthsUntilFreed: 240 });
        expect(soon).toBeGreaterThan(later);
    });

    it('ignores a payment that frees up only after retirement', () => {
        const after = presentValueOfFutureSavings({ ...base, freedPayment: 50_000, monthsUntilFreed: 360 });
        expect(after).toBeCloseTo(presentValueOfFutureSavings(base), 6);
    });

    it('ignores a loan that never pays off (null months)', () => {
        const never = presentValueOfFutureSavings({ ...base, freedPayment: 50_000, monthsUntilFreed: null });
        expect(never).toBeCloseTo(presentValueOfFutureSavings(base), 6);
    });

    it('freeing the payment now is the same as just saving it', () => {
        const freedNow = presentValueOfFutureSavings({ ...base, freedPayment: 50_000, monthsUntilFreed: 0 });
        const savedAllAlong = presentValueOfFutureSavings({ ...base, monthlySavings: 75_000 });
        expect(freedNow).toBeCloseTo(savedAllAlong, 6);
    });
});

describe('repaid loans leak no phantom obligation', () => {
    const cleared: LifecycleLoan = {
        id: 'cleared',
        name: 'Repaid but still flagged active',
        currentBalance: 0,
        principalAmount: 100 * WAN,
        annualRatePct: 5,
        monthlyPayment: 20_000, // minimum_payment is never zeroed on payoff
        startDate: '2020-01-01',
        termMonths: 60,
    };
    const live: LifecycleLoan = {
        id: 'live',
        name: 'Still owing',
        currentBalance: 100 * WAN,
        principalAmount: 100 * WAN,
        annualRatePct: 4,
        monthlyPayment: 30_000,
        startDate: '2025-01-01',
        termMonths: 84,
    };

    it('drops a cleared loan from every aggregate', () => {
        const d = aggregateDebt([cleared]);
        expect(d.balance).toBe(0);
        expect(d.monthlyPayment).toBe(0);
        expect(d.blendedRatePct).toBe(0);
        expect(d.loanCount).toBe(0);
    });

    it('keeps a cleared loan out of the blend when others still owe', () => {
        // The aggregate balance is non-zero here, so a guard on the total would
        // not fire — the filter has to be per loan.
        const d = aggregateDebt([cleared, live]);
        expect(d.balance).toBeCloseTo(100 * WAN, 2);
        expect(d.monthlyPayment).toBe(30_000);
        expect(d.blendedRatePct).toBeCloseTo(4, 6);
        expect(d.loanCount).toBe(1);
    });

    it('invents no debt service in the stress gauges', () => {
        const s = evaluateStress({
            stockExposure: 300 * WAN,
            cashAssets: 50 * WAN,
            investmentDebt: 0,
            monthlyPayment: 20_000, // phantom
            monthlySavings: 10_000,
            liquidReserve: 50 * WAN,
        });
        expect(s.coverageRatio).toBeNull();
        expect(s.runwayMonths).toBeNull();
        expect(s.forcedSaleRisk).toBe(false);
        // The payment must not be added back to free cash flow either.
        expect(s.preDebtSurplus).toBe(10_000);
    });

    it('frees no payment when nothing is owed', () => {
        expect(freedPaymentFrom(0, 5, 20_000)).toEqual({ freedPayment: 0, monthsUntilFreed: 0 });
        expect(freedPaymentFrom(100 * WAN, 5, 0)).toEqual({ freedPayment: 0, monthsUntilFreed: 0 });
    });

    it('frees the payment on a live balance, dated by the payoff', () => {
        const r = freedPaymentFrom(100 * WAN, 5, 30_000);
        expect(r.freedPayment).toBe(30_000);
        expect(r.monthsUntilFreed).toBe(monthsToPayoff(100 * WAN, 5, 30_000));
        expect(r.monthsUntilFreed).toBeGreaterThan(0);
    });

    it('adds no lifetime wealth for a payment that is already free', () => {
        const base = { monthlySavings: 30_000, yearsToRetirement: 30, discountRatePct: 4, savingsGrowthPct: 2 };
        const withCleared = presentValueOfFutureSavings({
            ...base,
            ...freedPaymentFrom(0, 5, 20_000),
        });
        expect(withCleared).toBeCloseTo(presentValueOfFutureSavings(base), 6);
    });
});

describe('projectGlidepath', () => {
    const base: GlidepathInputs = {
        currentAge: 30,
        retirementAge: 65,
        stockExposure: 300 * WAN,
        cashAssets: 50 * WAN,
        debtBalance: 150 * WAN,
        debtAnnualRatePct: 3,
        debtMonthlyPayment: 30_000,
        monthlySavings: 50_000,
        investedSharePct: 80,
        expectedReturnPct: 7,
        samuelsonSharePct: 67,
        discountRatePct: 4,
        savingsGrowthPct: 2,
        maxLeverage: 2,
    };

    it('samples one point per year from today to retirement', () => {
        const g = projectGlidepath(base);
        expect(g.points).toHaveLength(36); // year 0 through 35
        expect(g.points[0].year).toBe(0);
        expect(g.points[0].age).toBe(30);
        expect(g.points[35].age).toBe(65);
    });

    it('pays the loan off and reports when', () => {
        const g = projectGlidepath(base);
        expect(g.debtFreeYear).not.toBeNull();
        expect(g.debtFreeYear!).toBeLessThan(6); // 150萬 at 30k/mo clears inside 5 years
        expect(g.points[g.points.length - 1].debt).toBe(0);
        expect(g.interestAhead).toBeGreaterThan(0);
    });

    it('finds the crossover where leverage falls to 1x', () => {
        const g = projectGlidepath(base);
        expect(g.crossoverYear).not.toBeNull();
        expect(g.crossoverAge).toBe(base.currentAge + g.crossoverYear!);
        const at = g.points.find((p) => Math.round(p.year) === g.crossoverYear)!;
        expect(at.leverage).toBeLessThanOrEqual(1);
    });

    it('reports an already-unlevered investor as crossed over at year 0', () => {
        const g = projectGlidepath({ ...base, debtBalance: 0, debtMonthlyPayment: 0, cashAssets: 100 * WAN });
        expect(g.points[0].leverage).toBeLessThanOrEqual(1);
        expect(g.crossoverYear).toBe(0);
        expect(g.crossoverAge).toBe(base.currentAge);
    });

    it('never spikes the target upward when the loan clears', () => {
        // Regression: the loop hands the whole payment back to savings on the
        // payoff month. When the PV did not know that date in advance, lifetime
        // wealth jumped in one step and the target curve spiked — on real data
        // from 1.07x to 1.95x at the payoff age, nearly touching the ceiling and
        // advising maximum leverage at the worst possible moment.
        const g = projectGlidepath({
            ...base,
            // A payment large relative to savings, so any step would be obvious.
            monthlySavings: 25_000,
            debtMonthlyPayment: 55_000,
            debtBalance: 390 * WAN,
        });
        expect(g.debtFreeYear).not.toBeNull();

        const targets = g.points.map((p) => p.targetLeverage);
        for (let i = 1; i < targets.length; i++) {
            // Allow a hair of numerical noise, but no real upward step.
            expect(targets[i]).toBeLessThanOrEqual(targets[i - 1] + 1e-9);
        }
    });

    it('prices the freed payment in before it lands, not on the day', () => {
        const withDebt = projectGlidepath({
            ...base,
            monthlySavings: 25_000,
            debtMonthlyPayment: 55_000,
            debtBalance: 390 * WAN,
        });
        const payoffYear = Math.floor(withDebt.debtFreeYear!);
        const before = withDebt.points[payoffYear];
        const after = withDebt.points[payoffYear + 1];
        // The target either side of payoff should differ by an ordinary yearly
        // step, not by the near-doubling the old model produced.
        expect(after.targetLeverage).toBeLessThanOrEqual(before.targetLeverage + 1e-9);
    });

    it('target leverage declines as retirement approaches', () => {
        const g = projectGlidepath(base);
        expect(g.points[0].targetLeverage).toBeGreaterThan(g.points[20].targetLeverage);
        expect(g.points[20].targetLeverage).toBeGreaterThanOrEqual(g.points[35].targetLeverage);
    });

    it('never lets an under-water payment compound the balance away', () => {
        // A payment below the monthly interest would otherwise grow forever.
        const g = projectGlidepath({ ...base, debtMonthlyPayment: 100, debtBalance: 500 * WAN });
        expect(g.points.every((p) => p.debt <= 500 * WAN)).toBe(true);
        expect(g.debtFreeYear).toBeNull();
    });

    it('reports no crossover when savings never outgrow the debt', () => {
        const g = projectGlidepath({
            ...base,
            monthlySavings: 0,
            savingsGrowthPct: 0,
            debtMonthlyPayment: 100,
            debtBalance: 900 * WAN,
            stockExposure: 900 * WAN,
            cashAssets: 0,
            expectedReturnPct: 0,
        });
        expect(g.crossoverYear).toBeNull();
    });

    it('starts from the position handed to it', () => {
        const g = projectGlidepath(base);
        expect(g.points[0].exposure).toBeCloseTo(300 * WAN, 2);
        expect(g.points[0].debt).toBeCloseTo(150 * WAN, 2);
        // 300 + 50 − 150 = 200萬 own money, leverage 1.5
        expect(g.points[0].netFinancialAssets).toBeCloseTo(200 * WAN, 2);
        expect(g.points[0].leverage).toBeCloseTo(1.5, 6);
    });
});
