import { toTWD } from '@/utils/formatters';
import type { Transaction } from '@/shared/types';

/** The key TransactionList groups rows under — keep the two in step. */
export function transactionDayKey(date: Transaction['date']): string {
  return new Date(date).toDateString();
}

/**
 * A day header's signed total: income minus expense, in TWD. Rows typed
 * `transfer` are neutral; transfer *legs* (an expense leg and an income leg)
 * are counted like any row, so a whole transfer nets to zero within its day —
 * the same way the page totals treat them.
 */
export function sumDayNet(rows: Transaction[]): number {
  return rows.reduce((sum, t) => {
    if (t.type === 'transfer') return sum;
    const twd = toTWD(t.amount, t.currency);
    return sum + (t.type === 'income' ? twd : t.type === 'expense' ? -twd : 0);
  }, 0);
}

/**
 * Which days on this page might have rows on another page, and so need their
 * total fetched. Sorted by date, only the first and last day can straddle a page
 * break, so this is at most two days.
 *
 * Under any other sort a day's rows can be anywhere, so every day on the page is
 * suspect, but fetching each one sent ~40 parallel stats requests (five queries
 * apiece) per page view. Those headers stay page-only until a single day-grouped
 * stats call exists.
 */
export function daysNeedingFullTotal(
  pageRows: Transaction[],
  totalPages: number,
  sortedByDate: boolean,
): Transaction['date'][] {
  if (!sortedByDate || totalPages <= 1 || pageRows.length === 0) return [];
  const first = pageRows[0].date;
  const last = pageRows[pageRows.length - 1].date;
  return transactionDayKey(first) === transactionDayKey(last) ? [first] : [first, last];
}
