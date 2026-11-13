import type { PortfolioHolding } from '@/shared/types';
import { getUnconvertedCurrencies } from '@/utils/formatters';
import { sessionMarket, todayIn } from '@/utils/marketStatus';

export interface PortfolioDataIssues {
  /** Priced holdings whose price is two or more sessions old. */
  staleSymbols: string[];
  /** The oldest trading day (YYYY-MM-DD) among the stale prices. */
  oldestSession?: string;
  /** Priced holdings with no previous close, so no day change. */
  noDayChangeSymbols: string[];
  /** Currencies held that the page has no rate for and shows unconverted. */
  unconvertedCurrencies: string[];
}

/** Weekdays after `from` up to and including `to` (both YYYY-MM-DD). */
function weekdaysBetween(from: string, to: string): number {
  const day = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  let count = 0;
  while (day < end) {
    day.setUTCDate(day.getUTCDate() + 1);
    const wd = day.getUTCDay();
    if (wd !== 0 && wd !== 6) count += 1;
  }
  return count;
}

/** Holdings whose price comes from a market feed (not cash, not hand-priced). */
function isFeedPriced(h: PortfolioHolding): boolean {
  return (!h.walletType || h.walletType === 'portfolio')
    && h.type !== 'cash'
    && !h.manuallyPriced
    && (h.marketState === 'open' || h.marketState === 'closed')
    && (h.quantity ?? 0) > 0;
}

/**
 * What on the home page cannot be trusted as shown.
 *
 * A price is stale once two whole sessions have passed it by. One is normal: a
 * Friday close read on Monday morning, or this evening's close not yet fetched.
 * The backend's `priceStale` counts the market's real sessions, so a holiday
 * week is not staleness; weekdays stand in only where it is absent (demo data).
 */
export function portfolioDataIssues(holdings: PortfolioHolding[], now: Date = new Date()): PortfolioDataIssues {
  const priced = holdings.filter(isFeedPriced);

  const stale = priced.filter((h) => h.priceStale ?? (
    !!h.priceSession && weekdaysBetween(h.priceSession, todayIn(sessionMarket(h.market), now)) >= 2
  ));
  const staleSymbols = [...new Set(stale.map((h) => h.symbol))].sort();
  const oldestSession = stale.map((h) => h.priceSession!).sort()[0];

  const noDayChangeSymbols = [
    ...new Set(priced.filter((h) => h.previousClose == null || h.previousClose <= 0).map((h) => h.symbol)),
  ].sort();

  const held = new Set(holdings.map((h) => (h.currency || 'TWD').toUpperCase()));
  const unconvertedCurrencies = getUnconvertedCurrencies().filter((c) => held.has(c));

  return { staleSymbols, oldestSession, noDayChangeSymbols, unconvertedCurrencies };
}

export function hasPortfolioDataIssues(issues: PortfolioDataIssues): boolean {
  return issues.staleSymbols.length > 0
    || issues.noDayChangeSymbols.length > 0
    || issues.unconvertedCurrencies.length > 0;
}
