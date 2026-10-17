import {
    buildMonthContext,
    buildMonthReview,
    defaultReviewMonth,
    delta,
    monthKeyOf,
    monthLabel,
    monthRange,
    shiftMonth,
    verdictFor,
    wealthMove,
    wealthMoves,
    READ,
    type SpendingLike,
} from '@/lib/review';

// Fixed clocks, always local: a UTC-based date string would slide a day either
// side of midnight in Taipei and the month arithmetic is exactly what is under
// test here.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe('monthRange', () => {
    it('spans a finished month end to end', () => {
        const r = monthRange('2026-03', at(2026, 5, 10));
        expect(r).toMatchObject({ from: '2026-03-01', to: '2026-03-31', days: 31, partial: false });
    });

    it('handles February, leap year included', () => {
        expect(monthRange('2026-02', at(2026, 5, 1)).to).toBe('2026-02-28');
        expect(monthRange('2024-02', at(2026, 5, 1)).to).toBe('2024-02-29');
    });

    it('stops a running month at today rather than its last day', () => {
        const r = monthRange('2026-09', at(2026, 9, 10));
        expect(r).toMatchObject({ from: '2026-09-01', to: '2026-09-10', days: 10, partial: true });
        // The clock the range was measured against, carried so that anything rendering
        // it reads the same one instead of calling new Date() for itself.
        expect(r.today).toBe('2026-09-10');
    });

    it('reports no days for a month that has not started', () => {
        // Asking the API for a future window is harmless; dividing by its
        // length is not — a daily average over 31 days that have not happened
        // reads as a month of no spending.
        expect(monthRange('2026-12', at(2026, 9, 10)).days).toBe(0);
    });

    it('builds date strings in local time, not UTC', () => {
        // Midnight on the 1st in Taipei is the previous day in UTC, so an
        // toISOString()-based range would open on 2026-02-28.
        expect(monthRange('2026-03', at(2026, 3, 15)).from).toBe('2026-03-01');
    });
});

describe('month arithmetic', () => {
    it('steps across year boundaries', () => {
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
        expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    });

    it('steps from a 31-day month without skipping the shorter neighbour', () => {
        expect(shiftMonth('2026-03', -1)).toBe('2026-02');
        expect(shiftMonth('2026-01', 1)).toBe('2026-02');
    });


    it('names the month in the reader language', () => {
        expect(monthLabel('2026-09', 'en')).toContain('September');
        expect(monthLabel('2026-09', 'zh-TW')).toContain('9');
    });

    it('opens on last month for the first days of a new one', () => {
        // On the 2nd, "this month" is a near-empty page; the month that just
        // ended is what a reader opening a review means.
        expect(defaultReviewMonth(at(2026, 9, 2))).toBe('2026-08');
        expect(defaultReviewMonth(at(2026, 9, 4))).toBe('2026-09');
        expect(defaultReviewMonth(at(2026, 1, 1))).toBe('2025-12');
    });

    it('keys a date to its own month', () => {
        expect(monthKeyOf(at(2026, 9, 30))).toBe('2026-09');
    });
});

describe('delta', () => {
    it('reports amount and percentage against a positive base', () => {
        expect(delta(120, 100)).toEqual({ amount: 20, percent: 20 });
    });

    it('reports the amount alone when there is no base to divide by', () => {
        // A category that is new this month has no percentage — but the money
        // is real and dropping it would hide the month's biggest change.
        expect(delta(500, 0)).toEqual({ amount: 500, percent: undefined });
    });

    it('reports the amount alone against a negative base', () => {
        expect(delta(100, -50).percent).toBeUndefined();
    });
});

describe('verdictFor', () => {
    it('calls a month that ate into savings over', () => {
        expect(verdictFor(-1, 50)).toBe('over');
    });

    it('grades on the savings rate above that', () => {
        expect(verdictFor(1_000, 5)).toBe('tight');
        expect(verdictFor(10_000, 20)).toBe('steady');
        expect(verdictFor(40_000, 45)).toBe('strong');
    });

    it('stays neutral when there is no income to take a rate of', () => {
        expect(verdictFor(0, undefined)).toBe('steady');
    });
});

const spending = (income: number, categories: Array<[string, number]>): SpendingLike => ({
    totalIncome: income,
    totalExpenses: categories.reduce((sum, [, amount]) => sum + amount, 0),
    categoryBreakdown: categories.map(([category, amount]) => ({
        category,
        amount,
        transactionCount: 1,
    })),
});

describe('buildMonthReview', () => {
    const range = monthRange('2026-08', at(2026, 9, 15));

    it('reduces a month to net, rate and per-day spend', () => {
        const review = buildMonthReview(range, spending(80_000, [['Rent', 20_000], ['Food', 11_000]]), undefined);

        expect(review.net).toBe(49_000);
        expect(review.savingsRate).toBeCloseTo(61.25, 2);
        expect(review.perDay).toBeCloseTo(31_000 / 31, 6);
        expect(review.verdict).toBe('strong');
    });

    it('divides by days elapsed, not the calendar month', () => {
        // Four days into a month, a daily average taken over 30 days reads
        // seven times too low and the page would call an expensive month cheap.
        const partial = monthRange('2026-09', at(2026, 9, 4));
        const review = buildMonthReview(partial, spending(0, [['Food', 4_000]]), undefined);
        expect(review.perDay).toBe(1_000);
    });

    it('leaves the savings rate unanswerable when nothing came in', () => {
        const review = buildMonthReview(range, spending(0, [['Food', 4_000]]), undefined);
        expect(review.savingsRate).toBeUndefined();
        expect(review.verdict).toBe('over');
    });

    it('keeps a category that stopped, which is often the real story', () => {
        const review = buildMonthReview(
            range,
            spending(80_000, [['Food', 10_000]]),
            spending(80_000, [['Food', 9_000], ['Travel', 30_000]]),
        );

        const travel = review.categories.find((line) => line.category === 'Travel');
        expect(travel).toMatchObject({ amount: 0, previous: 30_000, change: -30_000 });
        // Sorted by what was spent, so a category with no spend sorts last.
        expect(review.categories[0].category).toBe('Food');
    });

    it('names the biggest mover by size of change, not size of spend', () => {
        const review = buildMonthReview(
            range,
            spending(80_000, [['Rent', 20_000], ['Food', 12_000]]),
            spending(80_000, [['Rent', 20_000], ['Food', 6_000]]),
        );

        expect(review.biggestMover?.category).toBe('Food');
        expect(review.biggestMover?.change).toBe(6_000);
    });

    it('ignores drift too small to be worth a sentence', () => {
        const review = buildMonthReview(
            range,
            spending(80_000, [['Rent', 20_000], ['Food', 10_040]]),
            spending(80_000, [['Rent', 20_000], ['Food', 10_000]]),
        );

        expect(review.biggestMover).toBeUndefined();
    });

    it('says when there is no previous month rather than showing a full-size gain', () => {
        const review = buildMonthReview(range, spending(80_000, [['Food', 10_000]]), undefined);
        expect(review.hasPrevious).toBe(false);
        expect(review.expensesChange.percent).toBeUndefined();
    });

    it('marks a month with nothing in it as empty, not as zeroes', () => {
        expect(buildMonthReview(range, undefined, undefined).isEmpty).toBe(true);
        expect(buildMonthReview(range, spending(0, [['Food', 1]]), undefined).isEmpty).toBe(false);
    });

    it('coerces figures that arrive as strings', () => {
        // Money crosses the API as a string often enough in this codebase to
        // be worth not trusting the declared type.
        const loose = { totalIncome: '80000', totalExpenses: '10000' } as unknown as SpendingLike;
        expect(buildMonthReview(range, loose, undefined).net).toBe(70_000);
    });
});

describe('wealthMove', () => {
    const range = monthRange('2026-08', at(2026, 9, 15));
    const point = (date: string, portfolioWallet: number) => ({ date, portfolioWallet });

    it('opens on the balance from before the month, so the 1st counts', () => {
        const move = wealthMove(
            [point('2026-07-31', 100), point('2026-08-01', 150), point('2026-08-31', 200)],
            range,
            READ.portfolio,
        );

        expect(move).toMatchObject({ open: 100, close: 200, change: 100, openedInside: false });
        expect(move?.percent).toBeCloseTo(100, 6);
    });

    it('falls back to the first day inside the month, and says so', () => {
        const move = wealthMove([point('2026-08-05', 150), point('2026-08-31', 200)], range, READ.portfolio);
        expect(move).toMatchObject({ open: 150, openedInside: true, openedOn: '2026-08-05' });
    });

    it('ignores points outside the month at both ends', () => {
        const move = wealthMove(
            [point('2026-07-01', 10), point('2026-08-10', 150), point('2026-09-20', 900)],
            range,
            READ.portfolio,
        );
        expect(move?.close).toBe(150);
    });

    it('reports nothing when the month has no balances at all', () => {
        expect(wealthMove([point('2026-07-01', 10)], range, READ.portfolio)).toBeUndefined();
        expect(wealthMove([], range, READ.portfolio)).toBeUndefined();
        expect(wealthMove(undefined, range, READ.portfolio)).toBeUndefined();
    });

    it('reads net worth as assets minus debt, never assets alone', () => {
        // Borrowing raises assets and debt together; a levered month that took
        // on a loan has barely moved, and reading totalAsset would call it a win.
        const move = wealthMove(
            [
                { date: '2026-07-31', totalAsset: 1_000_000, debtBalance: 0 },
                { date: '2026-08-31', totalAsset: 2_000_000, debtBalance: 1_000_000 },
            ],
            range,
            READ.netWorth,
        );

        expect(move?.change).toBe(0);
    });

    it('sorts a series that arrives out of order', () => {
        const move = wealthMove(
            [point('2026-08-31', 200), point('2026-08-01', 150), point('2026-07-31', 100)],
            range,
            READ.portfolio,
        );
        expect(move).toMatchObject({ open: 100, close: 200 });
    });

    it('reads the Life wallet on its own, apart from portfolio and net worth', () => {
        // A month that invested its saving: Life falls while Portfolio rises by
        // the same amount. Reading the wrong field would hide exactly that.
        const points = [
            { date: '2026-07-31', lifeWallet: 500_000, portfolioWallet: 1_000_000 },
            { date: '2026-08-31', lifeWallet: 300_000, portfolioWallet: 1_200_000 },
        ];

        expect(wealthMove(points, range, READ.life)).toMatchObject({ open: 500_000, close: 300_000, change: -200_000 });
        expect(wealthMove(points, range, READ.portfolio)?.change).toBe(200_000);
    });

    it('skips a point that does not carry the balance, rather than reading it as zero', () => {
        // Read as NT$0, the missing opening would turn the whole balance into
        // the month's "rise".
        const move = wealthMove(
            [{ date: '2026-07-31' }, { date: '2026-08-31', lifeWallet: 1_000 }],
            range,
            READ.life,
        );
        expect(move).toMatchObject({ open: 1_000, close: 1_000, change: 0, openedInside: true, openedOn: '2026-08-31' });
    });

    it('reads the Emergency fund off its own field', () => {
        const move = wealthMove(
            [
                { date: '2026-07-31', lifeWallet: 400_000, emergencyWallet: 100_000 },
                { date: '2026-08-31', lifeWallet: 300_000, emergencyWallet: 200_000 },
            ],
            range,
            READ.emergency,
        );
        expect(move).toMatchObject({ open: 100_000, close: 200_000, change: 100_000 });
    });

    it('reads every balance off one pass and agrees with reading each alone', () => {
        const points = [
            { date: '2026-07-31', lifeWallet: 500, portfolioWallet: 1_000, emergencyWallet: 50, totalAsset: 1_550, debtBalance: 0 },
            { date: '2026-08-15', lifeWallet: 400, portfolioWallet: 1_100, emergencyWallet: 60, totalAsset: 1_560, debtBalance: 0 },
            { date: '2026-08-31', lifeWallet: 300, portfolioWallet: 1_300, emergencyWallet: 80, totalAsset: 1_680, debtBalance: 100 },
        ];
        const all = wealthMoves(points, range, READ);

        for (const key of Object.keys(READ) as Array<keyof typeof READ>) {
            expect(all[key]).toEqual(wealthMove(points, range, READ[key]));
        }
        expect(all.netWorth).toMatchObject({ open: 1_550, close: 1_580 });
    });
});

describe('income by category', () => {
    const range = monthRange('2026-08', at(2026, 9, 15));
    const month = (income: Array<[string, number]>) => ({
        totalIncome: income.reduce((sum, [, amount]) => sum + amount, 0),
        totalExpenses: 10_000,
        incomeBreakdown: income.map(([category, amount]) => ({ category, amount, transactionCount: 1 })),
    });

    it('lines income up this month beside last, as shares of income', () => {
        const review = buildMonthReview(
            range,
            month([['Salary', 60_000], ['Bonus', 20_000]]),
            month([['Salary', 60_000], ['Freelance', 10_000]]),
        );

        expect(review.incomeCategories.map((line) => line.category)).toEqual(['Salary', 'Bonus', 'Freelance']);
        expect(review.incomeCategories[1]).toMatchObject({ amount: 20_000, previous: 0, share: 25 });
        // Freelance stopped: kept, at zero, because its absence is part of the month.
        expect(review.incomeCategories[2]).toMatchObject({ amount: 0, previous: 10_000, change: -10_000 });
    });

    it('names the income category that moved most, apart from spending', () => {
        const review = buildMonthReview(
            range,
            month([['Salary', 60_000], ['Bonus', 20_000]]),
            month([['Salary', 60_000], ['Bonus', 2_000]]),
        );

        expect(review.biggestIncomeMover).toMatchObject({ category: 'Bonus', change: 18_000 });
    });

    it('is empty, not an error, for a report without an income breakdown', () => {
        const review = buildMonthReview(range, { totalIncome: 5_000, totalExpenses: 1_000 }, undefined);
        expect(review.incomeCategories).toEqual([]);
        expect(review.biggestIncomeMover).toBeUndefined();
    });
});

describe('buildMonthContext', () => {
    // Twelve months ending September 2026, so the window runs Oct 2025 → Sep 2026.
    const NOW = at(2026, 9, 10);
    const trend = (month: string, income: number, expenses: number) => ({
        month,
        income,
        expenses,
        net: income - expenses,
    });

    const year = [
        trend('2025-10', 80_000, 30_000),
        trend('2025-11', 80_000, 28_000),
        trend('2025-12', 80_000, 60_000),
        trend('2026-01', 80_000, 25_000),
        trend('2026-02', 80_000, 26_000),
        trend('2026-03', 80_000, 24_000),
        trend('2026-04', 80_000, 27_000),
        trend('2026-05', 80_000, 31_000),
        trend('2026-06', 80_000, 29_000),
        trend('2026-07', 80_000, 26_000),
        trend('2026-08', 80_000, 20_000),
        trend('2026-09', 30_000, 9_000),
    ];

    it('lays out twelve months, oldest first, ending on the current one', () => {
        const context = buildMonthContext(year, monthRange('2026-08', NOW), NOW);

        expect(context.months).toHaveLength(12);
        expect(context.months[0].key).toBe('2025-10');
        expect(context.months[11].key).toBe('2026-09');
    });

    it('ranks the month by what it kept, best first', () => {
        // August kept 60,000 — more than any other complete month.
        const context = buildMonthContext(year, monthRange('2026-08', NOW), NOW);

        expect(context.selected?.net).toBe(60_000);
        expect(context.rank).toBe(1);
        expect(context.of).toBe(11);
    });

    it('places a middling month correctly', () => {
        const context = buildMonthContext(year, monthRange('2025-12', NOW), NOW);
        expect(context.rank).toBe(11); // the worst of the eleven complete months
    });

    it('measures the month against the mean of the complete ones', () => {
        const context = buildMonthContext(year, monthRange('2026-08', NOW), NOW);

        // The running month is excluded from the mean; ten days of income would
        // drag it down and make every finished month look good.
        // The eleven complete months keep 554,000 between them.
        expect(context.averageNet).toBeCloseTo(554_000 / 11, 1);
        expect(context.vsAverage).toBeCloseTo(60_000 - 554_000 / 11, 1);
    });

    it('refuses to rank a month that is still running', () => {
        const context = buildMonthContext(year, monthRange('2026-09', NOW), NOW);

        expect(context.selected?.partial).toBe(true);
        expect(context.rank).toBeUndefined();
        expect(context.vsAverage).toBeUndefined();
    });

    it('fills a month with no transactions as a gap, not as a zero-saving month', () => {
        const sparse = year.filter((point) => point.month !== '2026-05');
        const context = buildMonthContext(sparse, monthRange('2026-08', NOW), NOW);

        const may = context.months.find((month) => month.key === '2026-05');
        expect(may).toMatchObject({ empty: true, net: 0 });
        // An account that had no May cannot be said to have saved nothing in it.
        expect(context.of).toBe(10);
    });

    it('says when the month is older than the window rather than placing it anyway', () => {
        const context = buildMonthContext(year, monthRange('2024-03', NOW), NOW);

        expect(context.outOfWindow).toBe(true);
        expect(context.rank).toBeUndefined();
    });

    it('survives a series that never arrived', () => {
        const context = buildMonthContext(undefined, monthRange('2026-08', NOW), NOW);

        expect(context.months).toHaveLength(12);
        expect(context.of).toBe(0);
        expect(context.rank).toBeUndefined();
    });
});
