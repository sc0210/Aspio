import type { Transaction } from '@/shared/types';
import { toTWD } from '@/utils/formatters';

interface RankedTransaction {
  tx: Transaction;
  /** Amount normalised to TWD, used for ranking across currencies. */
  twd: number;
}

/**
 * Returns the `limit` largest transactions of a given type, ranked by amount
 * normalised to TWD (descending). Drives the "Top N expenses / income" lists in
 * the transactions Filter & Analysis panel. The caller is expected to pass an
 * already-filtered list (period, category, etc.), so this only handles ranking.
 */
export function topTransactionsByAmount(
  transactions: Transaction[],
  type: 'expense' | 'income',
  limit = 5,
): RankedTransaction[] {
  return transactions
    .filter((t) => t.type === type)
    .map((t) => ({ tx: t, twd: toTWD(Number(t.amount), t.currency) }))
    .sort((a, b) => b.twd - a.twd)
    .slice(0, limit);
}
