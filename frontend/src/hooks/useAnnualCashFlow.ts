'use client';

import { useMemo } from 'react';
import { useTransactions } from './useTransactions';
import { toTWD } from '@/utils/formatters';
import { getExpenseGroupKey, isEarnedIncome, isWalletTransfer } from '@/utils/expenseGroups';

/**
 * Trailing 12-month average of monthly EARNED income and real living expenses,
 * from the user's own transactions — a stable basis for the housing-readiness
 * cash-flow gauge that smooths seasonal spikes (bonuses, annual insurance, tax,
 * travel) far better than a single current-month figure.
 *
 * Uses the same classifiers as the dashboard's expense breakdown
 * (`isWalletTransfer`, `isEarnedIncome`, `getExpenseGroupKey`), so it excludes both
 * legs of a wallet transfer, investment income (dividends/sale proceeds), loan
 * proceeds, and investment purchases (which are saving, not spending).
 * Demo-aware via `useTransactions`.
 */

const WINDOW_MONTHS = 12;

interface TxLite {
    transaction_date?: string;
    date?: string;
    amount?: number | string;
    currency?: string;
    type?: string;
    category?: string;
    transferGroupId?: string | null;
}

interface AnnualCashFlow {
    /** Average monthly earned income over the trailing window (TWD). */
    avgMonthlyIncome: number;
    /** Average monthly living expense over the trailing window (TWD). */
    avgMonthlyExpense: number;
    /** Complete months the average spans (≤ 12) — the divisor used. */
    monthsAveraged: number;
    /** True once at least one complete month contributed income or spending. */
    hasData: boolean;
    isLoading: boolean;
}

export function useAnnualCashFlow(): AnnualCashFlow {
    // Start of the month WINDOW_MONTHS ago through today; the incomplete current
    // month is excluded during aggregation below.
    const dateRange = useMemo(() => {
        const now = new Date();
        return { start: new Date(now.getFullYear(), now.getMonth() - WINDOW_MONTHS, 1), end: now };
    }, []);
    const { transactions: rawTx, isLoading } = useTransactions({ dateRange, fetchAll: true });

    return useMemo(() => {
        const txs = (rawTx ?? []) as unknown as TxLite[];

        let incomeTotal = 0;
        let expenseTotal = 0;
        const now = new Date();
        const currentMonthIdx = now.getFullYear() * 12 + now.getMonth();
        let earliestIdx = Infinity;
        let latestIdx = -Infinity;
        // The divisor spans only the months that actually contributed a figure. A month
        // holding nothing but a holding purchase or a one-off inflow measured neither
        // income nor spending, and counting it diluted both averages — three months of
        // 20k spending plus one older investment-only month read as 15k/mo.
        const widenSpan = (m: number) => {
            if (m < earliestIdx) earliestIdx = m;
            if (m > latestIdx) latestIdx = m;
        };

        for (const t of txs) {
            const d = t.transaction_date || t.date;
            if (!d) continue;
            const dt = new Date(d);
            if (!Number.isFinite(dt.getTime())) continue;
            const monthIdx = dt.getFullYear() * 12 + dt.getMonth();
            if (monthIdx >= currentMonthIdx) continue; // skip incomplete current month
            // Both legs of a wallet transfer, before anything else: the expense leg
            // is not spending and the income leg is not earnings, so a Life →
            // Emergency top-up must not count as either (nor widen the divisor).
            if (isWalletTransfer(t)) continue;
            const twd = toTWD(Number(t.amount) || 0, t.currency || 'TWD');
            if (twd <= 0) continue;

            if (t?.type === 'income') {
                if (isEarnedIncome(t.category)) {
                    incomeTotal += twd;
                    widenSpan(monthIdx);
                }
                continue;
            }
            if (t?.type !== 'expense') continue;
            // Null group ⇒ investment purchase (saving, not spending) — excluded.
            if (getExpenseGroupKey(t.category)) {
                expenseTotal += twd;
                widenSpan(monthIdx);
            }
        }

        const monthsAveraged = earliestIdx <= latestIdx
            ? Math.min(WINDOW_MONTHS, latestIdx - earliestIdx + 1)
            : 1;

        return {
            avgMonthlyIncome: Math.round(incomeTotal / monthsAveraged),
            avgMonthlyExpense: Math.round(expenseTotal / monthsAveraged),
            monthsAveraged,
            hasData: earliestIdx <= latestIdx,
            isLoading,
        };
    }, [rawTx, isLoading]);
}
