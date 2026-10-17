'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppMode } from './useAppMode';
import { useTransactions } from './useTransactions';
import { loanService } from '@/services/loanService';
import { demoLoans } from '@/data/demoData';
import { toTWD } from '@/utils/formatters';
import { EXPENSE_GROUPS, getExpenseGroupKey, isEarnedIncome, isWalletTransfer, type ExpenseGroupKey } from '@/utils/expenseGroups';

/**
 * Builds a realistic monthly expense model from the user's real transactions,
 * grouped into the same four buckets shown on the Transactions page
 * (Food / Transport / Housing / Other), plus a Debt-interest row modelled from the
 * loans whose repayments are not already recorded as transactions. Amounts are TWD-converted and averaged over the number of
 * months that actually contain spending (up to a 3-month window) so the figures
 * match what the user sees elsewhere.
 */

// Averaging window, in complete months. Three tracks recent reality more closely
// than six — a raise, a move or a changed commute shows up in a quarter rather
// than being diluted for half a year. The UI label reads the actual span from
// `monthsAveraged`, so it follows this constant rather than restating it.
const WINDOW_MONTHS = 3;

interface ExpenseCategory {
    key: ExpenseGroupKey | 'debtInterest';
    /** English fallback label (card localises via i18n). */
    name: string;
    icon: string;
    monthlyAvg: number;
    /** Recurring monthly cost → checked by default. */
    isRoutine: boolean;
}

interface ExpenseBreakdown {
    categories: ExpenseCategory[];
    totalMonthlyExpense: number;
    /** Average monthly income over the same window (TWD), independent of the
     *  dashboard's selected period. 0 when there are no income transactions. */
    avgMonthlyIncome: number;
    /** Number of months the window spans, used as the averaging divisor. */
    monthsAveraged: number;
    hasData: boolean;
    isLoading: boolean;
}

interface TxLite {
    amount: number | string;
    currency?: string;
    category?: string | null;
    type?: string;
    transaction_date?: string;
    date?: string;
    transferGroupId?: string | null;
    loanId?: string | null;
}

export function useExpenseBreakdown(): ExpenseBreakdown {
    const { isDemo, session } = useAppMode();
    const enabled = !!session?.user || isDemo;
    const userKey = session?.user?.email || (isDemo ? 'demo' : 'anon');

    // From the start of the month WINDOW_MONTHS ago through today. Aggregation below
    // excludes the current (incomplete) month, so this still captures up to
    // WINDOW_MONTHS complete months regardless of the day of the month.
    const dateRange = useMemo(() => {
        const now = new Date();
        return { start: new Date(now.getFullYear(), now.getMonth() - WINDOW_MONTHS, 1), end: now };
    }, []);
    const { transactions: rawTx, isLoading: loadingTx } = useTransactions({ dateRange, fetchAll: true });

    // Loans → monthly debt interest (current balance × APR ÷ 12).
    // Demo mode uses the fixture list — never hit the real API (avoids a 401).
    const { data: loansResp, isLoading: loadingLoans } = useQuery({
        queryKey: ['loans-list', userKey],
        queryFn: () => loanService.getLoans(),
        enabled: enabled && !isDemo,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
    });

    return useMemo(() => {
        const txs = (rawTx ?? []) as unknown as TxLite[];

        // Aggregate expense buckets and total income (TWD) over COMPLETE months only —
        // the current, still-incomplete month is excluded so a not-yet-recorded salary
        // (e.g. on the 1st of the month) doesn't drag income and the averages down. The
        // divisor is the span of complete months that actually contain data.
        const totals: Record<ExpenseGroupKey, number> = { food: 0, transport: 0, housing: 0, other: 0 };
        // Loans whose repayments are already among the expense rows above, so the
        // modelled interest below does not charge for them a second time.
        const loansPaidFromTransactions = new Set<string>();
        let incomeTotal = 0;
        const now = new Date();
        const currentMonthIdx = now.getFullYear() * 12 + now.getMonth();
        let earliestIdx = Infinity;
        let latestIdx = -Infinity;
        // Only a month that contributed a figure widens the divisor — an
        // investment-only month measures no spending and would dilute the average.
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
            if (monthIdx >= currentMonthIdx) continue; // skip the incomplete current month
            // Wallet transfers are the user's own money changing pocket — neither
            // spending nor income, whichever leg this row is.
            if (isWalletTransfer(t)) continue;
            const twd = toTWD(Number(t.amount) || 0, t.currency || 'TWD');
            if (twd <= 0) continue;
            if (t?.type === 'income') {
                // Only recurring EARNED income counts toward the monthly average.
                // Excludes investment income (dividends / sale proceeds) AND loan
                // proceeds, wallet transfers and refunds — e.g. a one-off 1.16M
                // "Loan Receipt" is borrowed money, not salary, and would massively
                // inflate the figure when averaged over the window.
                if (isEarnedIncome(t.category)) {
                    incomeTotal += twd;
                    widenSpan(monthIdx);
                }
                continue;
            }
            if (t?.type !== 'expense') continue;
            const key = getExpenseGroupKey(t.category);
            if (!key) continue; // investment purchases are saving, not spending
            totals[key] += twd;
            widenSpan(monthIdx);
            if (t.loanId) loansPaidFromTransactions.add(t.loanId);
        }

        // Divisor: number of complete months spanned by the data (capped to the window).
        const monthsAveraged = earliestIdx <= latestIdx
            ? Math.min(WINDOW_MONTHS, latestIdx - earliestIdx + 1)
            : 1;

        const avgMonthlyIncome = Math.round(incomeTotal / monthsAveraged);

        const categories: ExpenseCategory[] = EXPENSE_GROUPS
            .filter(g => totals[g.key] > 0)
            .map(g => ({
                key: g.key,
                name: g.label,
                icon: g.icon,
                monthlyAvg: Math.round(totals[g.key] / monthsAveraged),
                isRoutine: true,
            }))
            .sort((a, b) => b.monthlyAvg - a.monthlyAvg);

        // Monthly interest cost across ACTIVE loans only (paused/paid-off loans are
        // not a current cash outflow) — and only for loans the user does NOT already
        // record repayments for.
        //
        // A recorded repayment is a real expense row and lands in a bucket above,
        // interest and all. Modelling this loan's interest on top charged the user
        // twice for the same money: ~16k/mo of the author's own 信貸 interest was in
        // the "other" bucket AND in this row. Rows link to their loan via `loanId`
        // (the Link-to-Loan selector on the transaction form).
        const loans = (isDemo ? demoLoans : (loansResp?.data ?? [])) as Array<{ id?: string; current_balance?: number; interest_rate?: number; currency?: string; status?: string }>;
        const monthlyDebtInterest = Math.round(
            loans.reduce((sum, l) => {
                if (l.status !== 'active') return sum;
                if (l.id && loansPaidFromTransactions.has(l.id)) return sum;
                const bal = Number(l.current_balance) || 0;
                const apr = Number(l.interest_rate) || 0;
                if (bal <= 0 || apr <= 0) return sum;
                return sum + toTWD((bal * (apr / 100)) / 12, l.currency || 'TWD');
            }, 0),
        );
        if (monthlyDebtInterest > 0) {
            categories.push({ key: 'debtInterest', name: 'Debt interest', icon: '🏦', monthlyAvg: monthlyDebtInterest, isRoutine: true });
        }

        const totalMonthlyExpense = categories.reduce((s, c) => s + c.monthlyAvg, 0);

        return {
            categories,
            totalMonthlyExpense,
            avgMonthlyIncome,
            monthsAveraged,
            hasData: categories.length > 0,
            isLoading: loadingTx || loadingLoans,
        };
    }, [rawTx, loansResp, loadingTx, loadingLoans, isDemo]);
}
