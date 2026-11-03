import type { PortfolioHolding } from '@/shared/types';
import { areRatesLive, getUnconvertedCurrencies, localDateString, toTWD } from '@/utils/formatters';

const SESSION_ALIASES: Record<string, string> = {
  NYSE: 'US', NASDAQ: 'US', AMEX: 'US', TWSE: 'TW', TPEX: 'TW', TWO: 'TW',
};

/** The session a holding's market label trades on, as the backend groups it. */
export function sessionMarket(market?: string): string {
  const key = (market || '').toUpperCase();
  return SESSION_ALIASES[key] ?? key;
}

const MARKET_ZONES: Record<string, string> = { TW: 'Asia/Taipei', 'TW-INDEX': 'Asia/Taipei', US: 'America/New_York' };

/** Today's date (YYYY-MM-DD) in a market's own zone; the viewer's for unmodelled ones. */
function todayIn(market: string, now: Date): string {
  const zone = MARKET_ZONES[market];
  return zone ? new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now) : localDateString(now);
}

export interface MarketSummary {
  market: string;
  state: 'open' | 'closed';
  /** Latest trading day (YYYY-MM-DD) any of its prices belongs to. */
  lastSession?: string;
}

/** One line per market the holdings trade on: open now, or closed since when. */
export function marketSummaries(holdings: PortfolioHolding[]): MarketSummary[] {
  const byMarket = new Map<string, MarketSummary>();
  for (const h of holdings) {
    if (h.marketState !== 'open' && h.marketState !== 'closed') continue; // manual, unknown
    const market = sessionMarket(h.market);
    const current = byMarket.get(market) ?? { market, state: 'closed' as const };
    if (h.marketState === 'open') current.state = 'open';
    if (h.priceSession && (!current.lastSession || h.priceSession > current.lastSession)) {
      current.lastSession = h.priceSession;
    }
    byMarket.set(market, current);
  }
  return [...byMarket.values()].sort((a, b) => a.market.localeCompare(b.market));
}

export interface FxInUse {
  currency: string;
  /** TWD per unit, as the page converts it right now. */
  rate: number;
  live: boolean;
}

/** The rates the page's TWD figures are using, and whether each is live. */
export function fxInUse(holdings: PortfolioHolding[]): FxInUse[] {
  const unconverted = new Set(getUnconvertedCurrencies());
  const live = areRatesLive();
  const currencies = [...new Set(holdings.map((h) => (h.currency || 'TWD').toUpperCase()))]
    .filter((c) => c !== 'TWD')
    .sort();
  return currencies.map((currency) => ({
    currency,
    rate: toTWD(1, currency),
    live: live && !unconverted.has(currency),
  }));
}

/**
 * Whether the day change can be called "today": yes while a market it covers is
 * trading or when its prices are from today's session; otherwise it is the last
 * session's move (on a Saturday, Friday's), and it says so. Returns the weekday
 * of that session in the viewer's language, or null for "today".
 */
export function lastSessionWeekday(holdings: PortfolioHolding[], locale: string, now: Date = new Date()): string | null {
  const counted = holdings.filter(
    (h) => (!h.walletType || h.walletType === 'portfolio') && h.previousClose != null && h.previousClose > 0,
  );
  if (counted.length === 0 || counted.some((h) => h.marketState === 'open')) return null;
  const sessions = counted.map((h) => h.priceSession).filter((d): d is string => Boolean(d));
  if (sessions.length === 0) return null;
  // A session date is in its market's zone, so "is it today" is asked there too:
  // a Friday New York session is not "today" for a viewer who is already in Saturday.
  if (counted.some((h) => h.priceSession && h.priceSession >= todayIn(sessionMarket(h.market), now))) return null;
  const latest = sessions.reduce((a, b) => (b > a ? b : a));
  return new Date(`${latest}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' });
}
