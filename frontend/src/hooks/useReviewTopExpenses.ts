'use client';

import { useQuery } from '@tanstack/react-query';
import { useAppMode } from './useAppMode';
import { QUERY_KEYS } from './useDataSynchronization';
import { transactionService } from '@/services/transactionService';
import { localDateString } from '@/utils/formatters';
import { demoReviewTopExpensesForMonth } from '@/data/demoReview';
import type { MonthRange } from '@/lib/review';

/** One expense row as the review card shows it. */
export interface ReviewExpense {
    id: string;
    description: string;
    category: string;
    /** Positive, in the row's own currency. */
    amount: number;
    currency: string;
    /** YYYY-MM-DD. */
    date: string;
}

const STALE_TIME = 5 * 60 * 1000;

/**
 * The month's five biggest single expenses. The server takes the 20 largest by
 * raw amount and re-ranks those by TWD value — exact unless 20+ rows in a
 * high-numbered currency (JPY, KRW) crowd out a bigger TWD one.
 *
 * Transfers are excluded: moving money between your own wallets is not
 * spending, and a transfer leg would otherwise top most months. Buying a
 * holding is kept — the totals on this page count it, and the list has to sit
 * inside them.
 */
export function useReviewTopExpenses(range: MonthRange) {
    const { isDemo, isAuthenticated, user } = useAppMode();
    const identity = isDemo ? 'demo' : user?.id ?? 'anonymous';

    return useQuery({
        queryKey: [QUERY_KEYS.REVIEW_TOP_EXPENSES, identity, range.key, range.to],
        queryFn: async (): Promise<ReviewExpense[]> => {
            if (isDemo) return demoReviewTopExpensesForMonth(range);
            const [y, m, d] = range.from.split('-').map(Number);
            const [y2, m2, d2] = range.to.split('-').map(Number);
            const res = await transactionService.getPageStats({
                type: 'expense',
                excludeTransfers: true,
                dateRange: { start: new Date(y, m - 1, d), end: new Date(y2, m2 - 1, d2) },
            });
            if (!res.success || !res.data) throw new Error(res.message || 'top expenses unavailable');
            return res.data.topExpenses.map((t) => ({
                id: t.id,
                description: t.description,
                category: t.category,
                amount: Math.abs(Number(t.amount) || 0),
                currency: t.currency,
                // A Date here is a local calendar day; toISOString would shift it to UTC.
                date: typeof t.date === 'string' ? t.date.slice(0, 10) : localDateString(t.date),
            }));
        },
        enabled: (isDemo || isAuthenticated) && range.days > 0,
        staleTime: STALE_TIME,
        retry: false,
    });
}
