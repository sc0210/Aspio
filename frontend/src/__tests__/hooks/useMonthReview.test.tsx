/**
 * The wiring between the month a reader picked and the requests that answer it.
 *
 * The arithmetic is covered in `lib/review.test.ts` and the cards in
 * `components/review/MonthReview.test.tsx`; what is left — and what neither can
 * see — is which window gets asked for, where the answer is read out of the
 * response, and that demo mode never reaches the network at all.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '../utils/queryWrapper';
import { useMonthReview } from '@/hooks/useMonthReview';
import { reportsService } from '@/services/reportsService';
import { demoReviewMonth } from '@/data/demoReview';

let mode = { isDemo: false, isAuthenticated: true, user: { id: 'user-1' } };
jest.mock('@/hooks/useAppMode', () => ({
    useAppMode: () => mode,
    // Mirrored, not omitted: a partial mock of a module leaves every other
    // export undefined for the whole import graph, not just this file.
    useModeAwareUI: () => ({ mode: 'authenticated', isDemo: false }),
}));

let trends: { data: unknown; isLoading: boolean; isError?: boolean } = { data: [], isLoading: false };
jest.mock('@/hooks/useWalletTrends', () => ({
    useWalletTrends: () => trends,
    useWalletTrendBaseline: () => ({ data: undefined }),
}));

jest.mock('@/services/reportsService', () => ({
    reportsService: {
        getSpendingReport: jest.fn(),
        getMonthlyTrends: jest.fn(),
        getGoalsReport: jest.fn(),
    },
}));

const spendingReport = reportsService.getSpendingReport as jest.Mock;
const monthlyTrends = reportsService.getMonthlyTrends as jest.Mock;
const goalsReport = reportsService.getGoalsReport as jest.Mock;

// The API answers with a report; apiClient wraps a bare body into this
// envelope, and the hook has to read through it. Returning the report itself
// here would let a hook that forgot to would pass.
const envelope = (data: unknown) => Promise.resolve({ success: true, data });

const point = (date: string, portfolioWallet: number, lifeWallet = 0, emergencyWallet = 0) => ({
    date,
    portfolioWallet,
    lifeWallet,
    emergencyWallet,
    totalAsset: portfolioWallet + lifeWallet + emergencyWallet,
    debtBalance: 0,
});

beforeEach(() => {
    jest.clearAllMocks();
    mode = { isDemo: false, isAuthenticated: true, user: { id: 'user-1' } };
    trends = { data: [], isLoading: false, isError: false };
    spendingReport.mockImplementation(() => envelope({ totalIncome: 0, totalExpenses: 0 }));
    monthlyTrends.mockImplementation(() => envelope([]));
    goalsReport.mockImplementation(() => envelope(undefined));
});

const run = (month: string) =>
    renderHook(() => useMonthReview(month), { wrapper: createQueryWrapper() });

/** The month windows asked for. The twelve-month one is a different endpoint. */
const monthWindows = () =>
    spendingReport.mock.calls.map(([filters]: [{ dateFrom: string; dateTo: string }]) => filters);

describe('useMonthReview', () => {
    it('asks for the whole month, and for the month before it', async () => {
        const { result } = run('2026-03');
        await waitFor(() => expect(monthWindows()).toHaveLength(2));

        expect(spendingReport).toHaveBeenCalledWith({ dateFrom: '2026-03-01', dateTo: '2026-03-31' });
        // February, not "thirty days back" — and 2026 is not a leap year.
        expect(spendingReport).toHaveBeenCalledWith({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });
        expect(result.current.review.range.key).toBe('2026-03');
    });

    it('reads the report out of the response envelope', async () => {
        spendingReport.mockImplementation(({ dateFrom }: { dateFrom: string }) =>
            envelope(
                dateFrom.startsWith('2026-03')
                    ? { totalIncome: 80_000, totalExpenses: 20_000 }
                    : { totalIncome: 80_000, totalExpenses: 26_000 },
            ),
        );

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.review.income).toBe(80_000));

        expect(result.current.review.net).toBe(60_000);
        // The comparison is the point of the second fetch: spending fell 6,000.
        expect(result.current.review.expensesChange.amount).toBe(-6_000);
        expect(result.current.review.hasPrevious).toBe(true);
    });

    it('slices the balances to the month, from a year of them', async () => {
        trends = {
            data: [
                point('2026-02-28', 100_000),
                point('2026-03-01', 110_000),
                point('2026-03-31', 130_000),
                point('2026-04-30', 900_000),
            ],
            isLoading: false,
        };

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.portfolio).toBeDefined());

        // Opens on the last day of February, so the 1st of March counts, and
        // closes before April exists.
        expect(result.current.portfolio).toMatchObject({ open: 100_000, close: 130_000, change: 30_000 });
    });

    it('reads each wallet off its own field, not one reader for all', async () => {
        // A slip wiring life to READ.portfolio would pass every card test, which
        // build their moves by hand; only the hook can catch it.
        trends = {
            data: [point('2026-02-28', 100_000, 50_000, 20_000), point('2026-03-31', 130_000, 30_000, 25_000)],
            isLoading: false,
        };

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.life).toBeDefined());

        expect(result.current.portfolio).toMatchObject({ open: 100_000, close: 130_000 });
        expect(result.current.life).toMatchObject({ open: 50_000, close: 30_000, change: -20_000 });
        expect(result.current.emergency).toMatchObject({ open: 20_000, close: 25_000, change: 5_000 });
        expect(result.current.netWorth).toMatchObject({ open: 170_000, close: 185_000 });
    });

    it('reports balances as loading rather than as absent', async () => {
        trends = { data: undefined, isLoading: true };

        const { result } = run('2026-03');
        expect(result.current.balancesLoading).toBe(true);
        expect(result.current.portfolio).toBeUndefined();
    });

    it('separates a goals fetch still running from one that failed', async () => {
        let settle: (value: unknown) => void = () => {};
        goalsReport.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.goalsLoading).toBe(true));
        expect(result.current.goalsError).toBe(false);

        settle({ success: true, data: { totalGoals: 2 } });
        await waitFor(() => expect(result.current.goalsLoading).toBe(false));
        expect(result.current.goals).toMatchObject({ totalGoals: 2 });
    });

    it('reports a failed balances fetch as a failure, not as an empty one', async () => {
        trends = { data: undefined, isLoading: false, isError: true };

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.balancesError).toBe(true);
        expect(result.current.balancesOutOfRange).toBe(false);
        expect(result.current.portfolio).toBeUndefined();
    });

    it('reports a failed goals fetch as a failure, not as an empty one', async () => {
        goalsReport.mockImplementation(() => Promise.reject(new Error('boom')));

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.goalsError).toBe(true));

        // The month itself still loaded, so the page stays on its own figures.
        expect(result.current.isError).toBe(false);
        expect(result.current.goals).toBeUndefined();
    });

    it('knows a month older than the balances it fetched from one with none', async () => {
        trends = { data: [point('2026-03-01', 100), point('2026-09-01', 200)], isLoading: false };

        const older = run('2025-01');
        await waitFor(() => expect(older.result.current.balancesOutOfRange).toBe(true));
        expect(older.result.current.portfolio).toBeUndefined();

        // A month inside the series with no points is genuinely empty.
        const inside = run('2026-05');
        await waitFor(() => expect(inside.result.current.isLoading).toBe(false));
        expect(inside.result.current.balancesOutOfRange).toBe(false);
    });

    it('anchors the twelve-month window to today, not to the month on screen', async () => {
        // One fetch serves every month a reader steps through: the window does
        // not move, so stepping back re-reads the cache instead of refetching.
        const { unmount } = run('2026-03');
        await waitFor(() => expect(monthlyTrends).toHaveBeenCalled());

        const yearWindows = monthlyTrends.mock.calls.map(
            ([filters]: [{ dateFrom: string; dateTo: string }]) => filters,
        );
        expect(yearWindows).toHaveLength(1);

        const today = new Date();
        const opened = new Date(today.getFullYear(), today.getMonth() - 11, 1);
        expect(yearWindows[0].dateFrom).toBe(
            `${opened.getFullYear()}-${String(opened.getMonth() + 1).padStart(2, '0')}-01`,
        );
        unmount();
    });

    it('reports a failed twelve-month fetch as a failure, not as a new account', async () => {
        // `of: 0` means "no history"; a rejected fetch means "unknown". The card
        // says "once there is a second month on record…" for the first, which
        // would be a claim about an account that may have years of it.
        monthlyTrends.mockImplementation(() => Promise.reject(new Error('boom')));

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.contextError).toBe(true));

        expect(result.current.context.of).toBe(0);
        expect(result.current.isError).toBe(false);
    });

    it('serves demo mode from fixtures without touching the network', async () => {
        mode = { isDemo: true, isAuthenticated: false, user: undefined as never };

        // The hand-written fixtures are this month and the one before it; other
        // months get their own figures (see the next test).
        const today = new Date();
        const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const { result } = run(thisMonth);
        await waitFor(() => expect(result.current.review.income).toBe(demoReviewMonth.totalIncome));
        expect(result.current.review.expenses).toBe(demoReviewMonth.totalExpenses);

        expect(spendingReport).not.toHaveBeenCalled();
        expect(monthlyTrends).not.toHaveBeenCalled();
        expect(goalsReport).not.toHaveBeenCalled();
        // The fixtures are a month and the month before it, so the comparison
        // has something to say.
        expect(result.current.review.hasPrevious).toBe(true);
        expect(result.current.review.biggestMover?.category).toBe('Food & Dining');
        // Demo income is broken down too, so the income card is not empty.
        expect(result.current.review.incomeCategories.length).toBeGreaterThan(0);
    });

    it('gives each demo month its own figures instead of reusing this one', async () => {
        // September and October read identically in demo: every month was
        // served the same fixture.
        mode = { isDemo: true, isAuthenticated: false, user: undefined as never };
        const today = new Date();
        const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const thisMonth = keyOf(today);
        const lastMonth = keyOf(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        const nextMonth = keyOf(new Date(today.getFullYear(), today.getMonth() + 1, 1));

        const a = run(thisMonth);
        await waitFor(() => expect(a.result.current.review.expenses).toBeGreaterThan(0));
        const b = run(lastMonth);
        await waitFor(() => expect(b.result.current.review.expenses).toBeGreaterThan(0));
        expect(b.result.current.review.expenses).not.toBe(a.result.current.review.expenses);

        const c = run(nextMonth);
        await waitFor(() => expect(c.result.current.isLoading).toBe(false));
        expect(c.result.current.review.isEmpty).toBe(true);
        expect(spendingReport).not.toHaveBeenCalled();
    });

    it('treats an empty answer as an empty month, not a failed one', async () => {
        // React Query fails a query whose function resolves undefined, which
        // would put the page in "this month wouldn't load" over a body that
        // simply had nothing in it.
        spendingReport.mockImplementation(() => Promise.resolve({ success: true }));

        const { result } = run('2026-03');
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.isError).toBe(false);
        expect(result.current.review.isEmpty).toBe(true);
    });

    it('compares a month still running with the whole month before it', async () => {
        // Only Date is faked: React Query and waitFor still need real timers.
        jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick'] });
        jest.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
        try {
            run('2026-09');
            await waitFor(() => expect(spendingReport).toHaveBeenCalledTimes(2));

            expect(spendingReport).toHaveBeenCalledWith({ dateFrom: '2026-09-01', dateTo: '2026-09-14' });
            // The whole month before, not its first 14 days: the current month
            // accumulates against a finished one.
            expect(spendingReport).toHaveBeenCalledWith({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
        } finally {
            jest.useRealTimers();
        }
    });

    it('asks again when the day rolls over under an open tab', async () => {
        // The running month's window ends today, and the per-day figure on the card is
        // totalExpenses / range.days. If the window moves at midnight but the query key
        // does not, the day count grows while the totals stay yesterday's, and the burn
        // rate silently reads low under a caption describing a window the figures are
        // not from. So range.to is part of the key.
        //
        // Only Date is faked: React Query and waitFor still need real timers.
        jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick'] });
        jest.setSystemTime(new Date(2026, 8, 14, 23, 50, 0));
        try {
            const { rerender } = run('2026-09');
            await waitFor(() =>
                expect(spendingReport).toHaveBeenCalledWith({
                    dateFrom: '2026-09-01', dateTo: '2026-09-14',
                }),
            );

            jest.setSystemTime(new Date(2026, 8, 15, 0, 10, 0));
            rerender();

            await waitFor(() =>
                expect(spendingReport).toHaveBeenCalledWith({
                    dateFrom: '2026-09-01', dateTo: '2026-09-15',
                }),
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it('asks for nothing about a month that has not happened', async () => {
        const nextYear = `${new Date().getFullYear() + 1}-01`;
        const { result } = run(nextYear);

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        // The twelve-month series is still fetched — it is anchored to today —
        // but nothing is asked about the month itself.
        expect(monthWindows()).toHaveLength(0);
        expect(result.current.review.isEmpty).toBe(true);
    });
});
