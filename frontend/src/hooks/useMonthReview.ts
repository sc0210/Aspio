'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppMode } from './useAppMode';
import { useWalletTrends } from './useWalletTrends';
import {
    reportsService,
    type GoalsReport,
    type MonthlyTrend,
    type SpendingReport,
} from '@/services/reportsService';
import { demoReviewForMonth, demoReviewTrends } from '@/data/demoReview';
import { demoGoalsReport } from '@/data/demoReports';
import {
    buildMonthContext,
    buildMonthReview,
    dayStringOf,
    monthKeyOf,
    monthPrecedesSeries,
    monthRange,
    shiftMonth,
    wealthMoves,
    READ,
    type MonthContext,
    type MonthReview,
    type WealthMove,
} from '@/lib/review';

/**
 * Everything the month review renders, for one month.
 *
 * Two spending reports are fetched, not one: the report's own
 * `comparisonPeriod` gives the previous month's totals but not its categories,
 * and the categories are where a month's story actually is — "you spent
 * NT$4,000 more" says much less than "on eating out". They share a key shape,
 * so stepping back a month re-reads the fetch the previous view already made
 * rather than issuing a new one. A month still running is compared with the
 * whole of the month before, as it accumulates — the card names the month it is
 * measured against, so a part-month figure is not read as a full one.
 *
 * Both count every row: the wallet balances on the same page move on loans,
 * transfers and investment purchases, so leaving those out of the flows left the
 * two cards unable to explain each other.
 *
 * Balances come from the wallet-trend series instead of the portfolio report:
 * that report values *today's* holdings at historical prices, which answers
 * "what did the market do to what I hold now", not "what was I worth at the
 * end of March". The daily snapshots answer the second question, which is the
 * one a review of a past month is asking.
 */
interface MonthReviewData {
    review: MonthReview;
    /** The month among the twelve around it. */
    context: MonthContext;
    portfolio: WealthMove | undefined;
    /** The Life wallet over the month, from the same series as the rest. */
    life: WealthMove | undefined;
    /** The Emergency fund over the month. */
    emergency: WealthMove | undefined;
    netWorth: WealthMove | undefined;
    goals: GoalsReport | undefined;
    isLoading: boolean;
    /**
     * The daily balances are still arriving. They are a separate, slower fetch
     * than the month's own figures, and a card that renders "no balances
     * recorded" while they are in flight states something false for a second.
     */
    balancesLoading: boolean;
    /**
     * The month is older than the year of balances this page fetches — so
     * there is nothing to show, but not because the account has nothing. The
     * trend endpoint takes fixed presets and `1y` is the longest.
     */
    balancesOutOfRange: boolean;
    /** The balances fetch failed. Also not the same fact as "none recorded". */
    balancesError: boolean;
    /** Same rule as the balances, for the goals snapshot. */
    goalsLoading: boolean;
    /** The goals report failed. Not the same fact as "no goals set". */
    goalsError: boolean;
    /** The twelve-month series is still arriving. */
    contextLoading: boolean;
    /** It failed. Not the same fact as an account with no history. */
    contextError: boolean;
    /** The month's own figures failed to load — the page has nothing to say. */
    isError: boolean;
}

const STALE_TIME = 5 * 60 * 1000;

/**
 * React Query treats `undefined` from a queryFn as a programming error and
 * fails the query, so "the endpoint answered with nothing" has to be spelled
 * `null` — otherwise an empty body puts the page in its error state ("this
 * month wouldn't load") when the honest answer is its empty one.
 */
const orNull = <T,>(response: { data?: T }): T | null => response.data ?? null;

export function useMonthReview(monthKey: string): MonthReviewData {
    const { isDemo, isAuthenticated, user } = useAppMode();
    const enabled = isDemo || isAuthenticated;
    const identity = isDemo ? 'demo' : user?.id ?? 'anonymous';

    // todayKey is recomputed every render on purpose. MonthPicker now reads
    // `range.today` instead of its own `new Date()`, so whatever clock this range was
    // built from is the one the nav controls believe: memoized on monthKey alone, a tab
    // left open across midnight would keep yesterday's `to`, `days` and `today`, and
    // "Next month" would stay disabled into a month that had already begun. It is a
    // string, so the memo still only re-runs on the day the day actually changes.
    const todayKey = dayStringOf(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- todayKey is the trigger
    const range = useMemo(() => monthRange(monthKey), [monthKey, todayKey]);
    // The whole month before, deliberately, even while this one is 16 days old.
    // Asked for by the user (2026-09-16) after a same-days comparison shipped:
    // a running month is read as it accumulates against a finished one. So early
    // in a month every change reads as a large fall, and the card names the
    // month being compared against rather than hiding that. Do not quietly
    // switch this back to a same-days window.
    const previousKey = useMemo(() => shiftMonth(monthKey, -1), [monthKey]);

    const current = useQuery({
        // Demo keys carry the month: each month has its own demo report (the
        // current and previous months hand-written, older ones derived from the
        // trend strip, the rest empty). Every month used to share one fixture.
        //
        // range.to is in the key, not just range.key: a running month's window ends
        // today, and the range now moves when the day does. Keying on the month alone
        // would serve yesterday's totalExpenses against today's larger range.days, so
        // perDay — the daily burn rate on the card — would read low, and the "Day N,
        // still running" caption above it would describe a window the figures are not
        // from. It changes once a day at most.
        queryKey: [
            'review-spending',
            identity,
            range.key,
            ...(isDemo ? [] : [range.to]),
        ],
        queryFn: (): Promise<SpendingReport | null> =>
            isDemo
                ? Promise.resolve(demoReviewForMonth(range.key))
                : reportsService
                      .getSpendingReport({ dateFrom: range.from, dateTo: range.to })
                      .then(orNull),
        enabled: enabled && range.days > 0,
        staleTime: STALE_TIME,
        retry: false,
    });

    const previous = useQuery({
        queryKey: ['review-spending', identity, previousKey],
        queryFn: (): Promise<SpendingReport | null> => {
            if (isDemo) return Promise.resolve(demoReviewForMonth(previousKey));
            const window = monthRange(previousKey);
            return reportsService
                .getSpendingReport({ dateFrom: window.from, dateTo: window.to })
                .then(orNull);
        },
        enabled: enabled && range.days > 0,
        staleTime: STALE_TIME,
        retry: false,
    });

    const goals = useQuery({
        queryKey: ['review-goals', identity],
        queryFn: (): Promise<GoalsReport | null> =>
            isDemo
                ? Promise.resolve(demoGoalsReport)
                : reportsService.getGoalsReport({}).then(orNull),
        enabled,
        staleTime: STALE_TIME,
        retry: false,
    });

    /**
     * Twelve months of totals, for placing the month among its neighbours.
     *
     * The window is anchored to *today*, not to the month being reviewed, so
     * stepping between months re-reads one cached fetch instead of issuing a
     * new one per month. A month outside it is reported as such rather than
     * placed against a window that does not contain it.
     */
    // Keyed on todayKey rather than [] so the window does not stay anchored to the day
    // the tab was opened — the same rot fixed for `range` above.
    const contextWindow = useMemo(() => {
        const today = new Date();
        const first = monthRange(shiftMonth(monthKeyOf(today), -11));
        return { from: first.from, to: dayStringOf(today) };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- todayKey is the trigger
    }, [todayKey]);

    const context = useQuery({
        // ...and the key carries the window's end for the same reason as above.
        queryKey: ['review-context', identity, contextWindow.to],
        queryFn: (): Promise<MonthlyTrend[] | null> =>
            isDemo
                ? Promise.resolve(demoReviewTrends.monthlyTrends)
                : reportsService
                      .getMonthlyTrends({ dateFrom: contextWindow.from, dateTo: contextWindow.to })
                      .then(orNull),
        enabled,
        staleTime: STALE_TIME,
        retry: false,
    });

    // One year of daily balances, sliced to the month here. The series is
    // shared with anything else asking for the same period, so this is not a
    // fetch of its own once the dashboard has been open.
    const trends = useWalletTrends('1y');

    const review = useMemo(
        () => buildMonthReview(range, current.data ?? undefined, previous.data ?? undefined),
        [range, current.data, previous.data],
    );

    const monthContext = useMemo(
        () => buildMonthContext(context.data, range),
        [context.data, range],
    );

    // One pass over the year for every balance the card reads, not a
    // copy-sort-filter of ~365 points per row.
    const { portfolio, life, emergency, netWorth } = useMemo(
        () =>
            wealthMoves(trends.data, range, {
                portfolio: READ.portfolio,
                life: READ.life,
                emergency: READ.emergency,
                netWorth: READ.netWorth,
            }),
        [trends.data, range],
    );

    // A month that ended before the series begins was never fetched, which is
    // a different fact from an account with no snapshots — and the difference
    // is the whole content of the card in that state.
    const balancesOutOfRange = useMemo(
        () => monthPrecedesSeries(trends.data, range),
        [trends.data, range],
    );

    return {
        review,
        context: monthContext,
        portfolio,
        life,
        emergency,
        netWorth,
        goals: goals.data ?? undefined,
        isLoading: current.isLoading || previous.isLoading,
        balancesLoading: trends.isLoading,
        balancesOutOfRange,
        balancesError: trends.isError,
        goalsLoading: goals.isLoading,
        goalsError: goals.isError,
        contextLoading: context.isLoading,
        contextError: context.isError,
        isError: current.isError,
    };
}
