import type { PortfolioHolding } from '@/shared/types';
import { toTWD } from '@/utils/formatters';

/**
 * Today's move of the Portfolio wallet, in TWD, and as a percentage of where it
 * stood at the previous close.
 *
 * The percentage used to divide the summed change by today's total value. That
 * was wrong twice: the base was the value after the move, not before it; and in
 * the all-wallets view the change summed Emergency-wallet holdings too while the
 * total held the Portfolio wallet only. Here both sides cover the same holdings
 * (Portfolio wallet, with a previous close), and the base is their value at it.
 */
export function todayChange(holdings: PortfolioHolding[]): { gain: number; percentage: number; counted: number } {
  const moved = holdings.filter(
    (h) => (!h.walletType || h.walletType === 'portfolio')
      // A stale price's last move is days old, not today's (the backend's priceStale).
      && !h.priceStale
      && h.dayChange != null
      && h.previousClose != null && h.previousClose > 0,
  );
  const gain = moved.reduce((sum, h) => sum + toTWD(h.dayChange ?? 0, h.currency || 'TWD'), 0);
  const base = moved.reduce((sum, h) => sum + toTWD((h.previousClose ?? 0) * h.quantity, h.currency || 'TWD'), 0);
  return { gain, percentage: base > 0 ? (gain / base) * 100 : 0, counted: moved.length };
}
