import {
    debtBalanceAt,
    investmentDebtAt,
    buildLeverageHistory,
    summarizeLeverageHistory,
    evaluatePosition,
    type LifecycleLoan,
    type WalletDayBalances,
} from '@/lib/lifecycle';
import { calcAmortization } from '@/lib/finance/amortization';

const NOW = new Date(2026, 7, 26); // 2026-08-26, local midnight

/** ISO day, `monthsAgo` before NOW. */
const dayBefore = (monthsAgo: number): string => {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - monthsAgo, NOW.getDate());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const SCHEDULE = calcAmortization({ principal: 3_000_000, annualRatePct: 2.5, termYears: 7 });

/** A 3M loan taken 24 months ago, paid exactly on schedule since. */
const onSchedule = (overrides: Partial<LifecycleLoan> = {}): LifecycleLoan => ({
    id: 'loan-1',
    name: '信貸 A',
    principalAmount: 3_000_000,
    currentBalance: SCHEDULE.schedule[23].balance,
    annualRatePct: 2.5,
    monthlyPayment: SCHEDULE.monthlyPayment,
    startDate: dayBefore(24),
    termMonths: 84,
    ...overrides,
});

describe('debtBalanceAt', () => {
    it('is exactly today\'s balance at today — the series cannot disagree with the headline', () => {
        const loan = onSchedule({ currentBalance: 2_137_000 });
        expect(debtBalanceAt(loan, NOW, NOW)).toBe(2_137_000);
    });

    it('reproduces the schedule when the loan has been paid on time', () => {
        // Walking 6 months back from month 24 must land on month 18's balance.
        expect(debtBalanceAt(onSchedule(), new Date(2026, 1, 26), NOW))
            .toBeCloseTo(SCHEDULE.schedule[17].balance, 2);
    });

    it('owes nothing before the money was borrowed', () => {
        const loan = onSchedule({ startDate: dayBefore(6) });
        expect(debtBalanceAt(loan, new Date(2025, 7, 26), NOW)).toBe(0);
    });

    it('shows more debt in the past than today, never less', () => {
        const loan = onSchedule();
        const past = debtBalanceAt(loan, new Date(2026, 1, 26), NOW);
        expect(past).toBeGreaterThan(loan.currentBalance);
    });

    it('holds revolving credit flat rather than inventing a schedule for it', () => {
        const revolving = onSchedule({ termMonths: null, currentBalance: 400_000 });
        expect(debtBalanceAt(revolving, new Date(2026, 1, 26), NOW)).toBe(400_000);
    });

    it('never reconstructs more debt than was originally borrowed', () => {
        // Balance barely moved but the schedule says two years of principal went
        // out: an early-repayment history would otherwise back-walk past the
        // original principal.
        const stalled = onSchedule({ currentBalance: 2_950_000 });
        expect(debtBalanceAt(stalled, new Date(2024, 9, 26), NOW))
            .toBeLessThanOrEqual(stalled.principalAmount);
    });

    it('reuses one schedule per loan across the window', () => {
        const loan = onSchedule();
        const schedules = new Map();
        for (let d = 1; d <= 20; d += 1) {
            debtBalanceAt(loan, new Date(2026, 1, d), NOW, schedules);
        }
        expect(schedules.size).toBe(1);
    });
});

describe('investmentDebtAt', () => {
    it('reports nothing for a cleared loan rather than inventing debt for it', () => {
        // Walking a schedule back from a zero balance posts a month of
        // principal onto every past day, so a loan settled two years ago would
        // show ~3 months of phantom debt across a 90-day window — and a
        // "you deleveraged" story built entirely out of it. Where the window
        // really does straddle a payoff, the measured breakdown has the answer.
        const repaid = onSchedule({ id: 'loan-2', currentBalance: 0 });
        expect(investmentDebtAt([repaid], new Date(2026, 1, 26), NOW)).toBe(0);
        expect(investmentDebtAt([repaid], NOW, NOW)).toBe(0);
    });

    it('sums across loans', () => {
        const a = onSchedule();
        const b = onSchedule({ id: 'loan-2', termMonths: null, currentBalance: 500_000 });
        const asOf = new Date(2026, 1, 26);
        expect(investmentDebtAt([a, b], asOf, NOW))
            .toBeCloseTo(debtBalanceAt(a, asOf, NOW) + debtBalanceAt(b, asOf, NOW), 6);
    });
});

const wallets = (rows: Array<[string, number, number, number]>): WalletDayBalances[] =>
    rows.map(([date, portfolioWallet, lifeWallet, emergencyWallet]) => ({
        date, portfolioWallet, lifeWallet, emergencyWallet,
    }));

describe('buildLeverageHistory', () => {
    it('agrees with evaluatePosition on the same day', () => {
        const loan = onSchedule({ termMonths: null, currentBalance: 1_000_000 });
        const rows = buildLeverageHistory({
            points: wallets([['2026-08-26', 4_000_000, 500_000, 300_000]]),
            loans: [loan],
            now: NOW,
        });

        const direct = evaluatePosition({
            stockExposure: 4_000_000,
            cashAssets: 800_000,
            investmentDebt: 1_000_000,
        });
        expect(rows[0].leverage).toBeCloseTo(direct.leverage, 10);
        expect(rows[0].netFinancialAssets).toBeCloseTo(direct.netFinancialAssets, 10);
    });

    it('reports no ratio for a day the position was underwater', () => {
        const loan = onSchedule({ termMonths: null, currentBalance: 5_000_000 });
        const rows = buildLeverageHistory({
            points: wallets([['2026-08-26', 1_000_000, 100_000, 0]]),
            loans: [loan],
            now: NOW,
        });
        expect(rows[0].leverage).toBeNull();
    });

    it('deleverages on a rising market even though nothing was repaid', () => {
        // The whole gain lands on equity while the debt stays put, so the ratio
        // falls without a single payment. This is the relationship that makes
        // the chart worth having: a falling line is not by itself progress, and
        // reading it as progress is the mistake a single day's number invites.
        const loan = onSchedule({ termMonths: null, currentBalance: 1_000_000 });
        const rows = buildLeverageHistory({
            points: wallets([
                ['2026-08-24', 4_000_000, 500_000, 300_000],
                ['2026-08-25', 4_400_000, 500_000, 300_000],
            ]),
            loans: [loan],
            now: NOW,
        });
        expect(rows[0].investmentDebt).toBe(rows[1].investmentDebt);
        expect(rows[1].leverage!).toBeLessThan(rows[0].leverage!);
    });
});

describe('summarizeLeverageHistory', () => {
    const loan = onSchedule({ termMonths: null, currentBalance: 1_000_000 });
    const rows = buildLeverageHistory({
        points: wallets([
            ['2026-08-20', 4_000_000, 500_000, 300_000],
            ['2026-08-21', 5_200_000, 500_000, 300_000],
            ['2026-08-22', 3_600_000, 500_000, 300_000],
        ]),
        loans: [loan],
        now: NOW,
    });

    it('reads the direction of travel from the ends, not from the extremes', () => {
        // Exposure went 4.0M → 5.2M → 3.6M on flat debt, so the window closes
        // *more* levered than it opened even though the middle day was the
        // least levered of the three. Ends, not extremes.
        const s = summarizeLeverageHistory(rows, 2);
        expect(s.start).toBeCloseTo(rows[0].leverage!, 10);
        expect(s.end).toBeCloseTo(rows[2].leverage!, 10);
        expect(s.change).toBeCloseTo(rows[2].leverage! - rows[0].leverage!, 10);
        expect(s.change!).toBeGreaterThan(0);
    });

    it('finds the peak and trough with their dates', () => {
        // The worst day is the one with the smallest portfolio, not the largest.
        const s = summarizeLeverageHistory(rows, 2);
        expect(s.peak?.date).toBe('2026-08-22');
        expect(s.trough?.date).toBe('2026-08-21');
    });

    it('counts days over the ceiling', () => {
        expect(summarizeLeverageHistory(rows, 1.05).daysOverCeiling).toBe(2);
        expect(summarizeLeverageHistory(rows, 2).daysOverCeiling).toBe(0);
    });

    it('counts underwater days separately from measured ones', () => {
        const drowned = buildLeverageHistory({
            points: wallets([
                ['2026-08-20', 4_000_000, 500_000, 300_000],
                ['2026-08-21', 100_000, 0, 0],
            ]),
            loans: [loan],
            now: NOW,
        });
        const s = summarizeLeverageHistory(drowned, 2);
        expect(s.daysUnderwater).toBe(1);
        expect(s.end).toBeCloseTo(drowned[0].leverage!, 10); // last *measured* day
    });

    it('reports debt at both ends, so a falling ratio can be told from a rising market', () => {
        const s = summarizeLeverageHistory(rows, 2);
        expect(s.debtStart).toBe(1_000_000);
        expect(s.debtEnd).toBe(1_000_000);
    });

    it('is empty-safe', () => {
        const s = summarizeLeverageHistory([], 2);
        expect(s).toMatchObject({ start: null, end: null, change: null, peak: null, trough: null });
    });
});

describe('buildLeverageHistory · today', () => {
    const loan = onSchedule({ termMonths: null, currentBalance: 1_000_000 });
    const today = { stockExposure: 9_000_000, cashAssets: 1_000_000, investmentDebt: 1_000_000 };
    const todayIso = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

    it('replaces the final point when the series already reaches today', () => {
        // The headline and the last point of the chart sit on the same screen.
        // A trend endpoint that rounds differently, or lags, would put two
        // different numbers for the same day in front of the reader.
        const rows = buildLeverageHistory({
            points: wallets([
                ['2026-08-25', 4_000_000, 500_000, 300_000],
                [todayIso, 4_000_000, 500_000, 300_000],
            ]),
            loans: [loan],
            today,
            now: NOW,
        });

        expect(rows).toHaveLength(2);
        expect(rows[1].date).toBe(todayIso);
        expect(rows[1].stockExposure).toBe(9_000_000);
    });

    it('appends today when the series stops short of it', () => {
        const rows = buildLeverageHistory({
            points: wallets([['2026-08-24', 4_000_000, 500_000, 300_000]]),
            loans: [loan],
            today,
            now: NOW,
        });

        expect(rows).toHaveLength(2);
        expect(rows[1].date).toBe(todayIso);
        expect(rows[1].leverage).toBeCloseTo(9_000_000 / 9_000_000, 10);
    });

    it('is unchanged when no live position is supplied', () => {
        const points = wallets([['2026-08-24', 4_000_000, 500_000, 300_000]]);
        expect(buildLeverageHistory({ points, loans: [loan], now: NOW })).toHaveLength(1);
    });
});

describe('measured debt', () => {
    const A = onSchedule({ id: 'loan-a', termMonths: null, currentBalance: 1_000_000 });
    const B = onSchedule({ id: 'loan-b', termMonths: null, currentBalance: 500_000 });

    /** Wallet days carrying the per-loan balances the endpoint records. */
    const withDebt = (rows: Array<[string, Record<string, number>]>): WalletDayBalances[] =>
        rows.map(([date, debtByLoan]) => ({
            date, portfolioWallet: 4_000_000, lifeWallet: 500_000, emergencyWallet: 300_000, debtByLoan,
        }));

    it('sums only the loans marked as investment debt', () => {
        // The endpoint reports every loan the user has; the strategy counts the
        // subset they picked, so a mortgage in the same payload must not land in
        // the leverage ratio.
        const rows = buildLeverageHistory({
            points: withDebt([['2026-08-20', { 'loan-a': 900_000, mortgage: 8_000_000 }]]),
            loans: [A],
            now: NOW,
        });
        expect(rows[0].investmentDebt).toBe(900_000);
    });

    it('prefers what was recorded over what the schedule predicts', () => {
        // An overpayment the contract knows nothing about: the measured figure
        // is 400K, the schedule would say ~1M. The chart must show what happened.
        const rows = buildLeverageHistory({
            points: withDebt([['2026-08-20', { 'loan-a': 400_000 }]]),
            loans: [A],
            now: NOW,
        });
        expect(rows[0].investmentDebt).toBe(400_000);
    });

    it('handles a loan that was borrowed and cleared inside the window', () => {
        const rows = buildLeverageHistory({
            points: withDebt([
                ['2026-08-18', {}],                    // before it was taken on
                ['2026-08-19', { 'loan-b': 500_000 }], // borrowed
                ['2026-08-20', {}],                    // cleared
            ]),
            loans: [B],
            now: NOW,
        });
        expect(rows.map((r) => r.investmentDebt)).toEqual([0, 500_000, 0]);

        // Both ends read zero, so the two-endpoint test would call this window
        // debt-free and suppress the leverage narration for the one window in
        // which the user was actually levered.
        expect(summarizeLeverageHistory(rows, 2).everBorrowed).toBe(true);
    });

    it('falls back to the schedule when the payload predates the field', () => {
        const rows = buildLeverageHistory({
            points: wallets([['2026-08-20', 4_000_000, 500_000, 300_000]]),
            loans: [A],
            now: NOW,
        });
        expect(rows[0].investmentDebt).toBe(1_000_000); // revolving: held flat
    });

    it('tells "no debt reported" apart from "no debt"', () => {
        // An empty object is an answer; a missing key is not.
        const reported = buildLeverageHistory({
            points: withDebt([['2026-08-20', {}]]),
            loans: [A],
            now: NOW,
        });
        expect(reported[0].investmentDebt).toBe(0);
        expect(summarizeLeverageHistory(reported, 2).everBorrowed).toBe(false);
    });
});

describe('summarizeLeverageHistory · underwater ends', () => {
    it('reads debt from the same days the leverage change is read from', () => {
        // Day 3 is underwater, so `end` is day 2's ratio. Taking debt off the
        // raw last row would pair day 2's leverage with day 3's repayment and
        // narrate a fall that the measured change never saw.
        const loan = onSchedule({ termMonths: null, currentBalance: 0 });
        const rows = buildLeverageHistory({
            points: [
                { date: '2026-08-20', portfolioWallet: 4_000_000, lifeWallet: 500_000, emergencyWallet: 0, debtByLoan: { 'loan-1': 1_000_000 } },
                { date: '2026-08-21', portfolioWallet: 4_000_000, lifeWallet: 500_000, emergencyWallet: 0, debtByLoan: { 'loan-1': 1_000_000 } },
                { date: '2026-08-22', portfolioWallet: 100_000, lifeWallet: 0, emergencyWallet: 0, debtByLoan: { 'loan-1': 9_000_000 } },
            ],
            loans: [loan],
            now: NOW,
        });

        const s = summarizeLeverageHistory(rows, 2);
        expect(s.daysUnderwater).toBe(1);
        expect(s.debtEnd).toBe(1_000_000); // day 2, not day 3's 9M
    });
});
