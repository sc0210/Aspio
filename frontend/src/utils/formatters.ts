import { format as dateFormat } from 'date-fns';
import { CURRENCIES, DEFAULT_CURRENCY } from './constants';
import i18n from '@/lib/i18n';

// The active UI language drives how compact numbers abbreviate: Traditional
// Chinese uses 萬/億, English uses K/M/B. Falls back to the app default (zh-TW)
// on the server so SSR matches the initial client language.
function getActiveUiLang(): 'zh' | 'en' {
  let lng: string | undefined;
  try { lng = i18n?.language; } catch { /* i18n not ready */ }
  if (!lng && typeof window !== 'undefined') {
    lng = localStorage.getItem('aspiro-language') || localStorage.getItem('language') || undefined;
  }
  return (lng || 'zh-TW').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

// TWD's zh-TW currency symbol is a bare "$", indistinguishable from USD. Force
// its unambiguous "NT$" symbol everywhere (matches the Settings currency picker)
// while leaving the localized number/notation — including 萬/億 — untouched.
const TWD_SYMBOL = 'NT$';

// Resolve the currency symbol the way the non-compact path renders it, so a
// compact value keeps the same symbol as its full form.
function currencySymbolFor(currency: string): string {
  if (currency === 'TWD') return TWD_SYMBOL;
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value
      ?? CURRENCIES.find(c => c.code === currency)?.symbol
      ?? currency;
  } catch {
    return CURRENCIES.find(c => c.code === currency)?.symbol ?? currency;
  }
}

// Format with Intl, then swap TWD's ambiguous "$" for "NT$" — formatToParts keeps
// the symbol's position/spacing and the localized 萬/億 notation intact.
function formatWithSymbolFix(
  formatter: Intl.NumberFormat,
  amount: number,
  currency: string,
): string {
  if (currency !== 'TWD') return formatter.format(amount);
  return formatter
    .formatToParts(amount)
    .map(p => (p.type === 'currency' ? TWD_SYMBOL : p.value))
    .join('');
}

// Compact signed change: +1.2K / -45K / +1.3M — used in calendar heatmaps
export function formatCompactChange(change: number): string {
  const abs = Math.abs(change);
  const sign = change >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000)    return `${sign}${(abs / 1_000).toFixed(0)}K`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

// Returns today's date as "YYYY-MM-DD" in the user's LOCAL timezone.
// Unlike new Date().toISOString().split('T')[0] which uses UTC and can be
// off by one day for users in negative-UTC-offset timezones (e.g. UTC-8 at 11pm
// returns tomorrow's date in UTC).
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The value a <input type="date"> wants for a row's date. A bare "YYYY-MM-DD"
// (what the API sends) is that day as written; anything else is read as a local
// instant. toISOString() is the trap here: a demo row dated local midnight in
// Taipei is the previous day in UTC, so the form loaded it a day early.
export function toDateInputValue(date: string | Date): string {
  if (typeof date === 'string') {
    const day = date.match(/^(\d{4}-\d{2}-\d{2})(?:$|T00:00:00(?:\.0+)?Z?$)/);
    if (day) return day[1];
    return localDateString(new Date(date));
  }
  return localDateString(date);
}

// True when a row's date falls on a calendar day from range.start to range.end,
// both inclusive, the way the server compares date_from/date_to. A bare
// "YYYY-MM-DD" is that day as written: new Date() would read it as UTC midnight,
// which in Taipei is 08:00, so a row dated today sat "after now" until morning.
export function isDayInRange(date: string | Date, range: { start: Date; end: Date }): boolean {
  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : localDateString(typeof date === 'string' ? new Date(date) : date);
  return day >= localDateString(range.start) && day <= localDateString(range.end);
}

// Currency formatting with Taiwan-first approach
export function formatCurrency(amount: number, currency: string = DEFAULT_CURRENCY, options: {
  showSymbol?: boolean;
  precision?: number;
  compact?: boolean;
  locale?: string;
} = {}): string {
  // Handle invalid input values
  if (amount === null || amount === undefined || isNaN(amount) || !isFinite(amount)) {
    amount = 0;
  }

  const {
    showSymbol = true,
    precision = 2, // Always show 2 decimal places for stock prices
    compact = false,
    locale = currency === 'TWD' ? 'zh-TW' : 'en-US',
  } = options;

  const currencyInfo = CURRENCIES.find(c => c.code === currency);
  const symbol = currencyInfo?.symbol || currency;
  const isCrypto = currencyInfo?.isCrypto || false;

  // Handle cryptocurrency formatting
  if (isCrypto) {
    const cryptoPrecision = precision !== undefined ? precision : 6;
    const formattedAmount = Math.abs(amount).toLocaleString(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: cryptoPrecision,
    });
    const sign = amount < 0 ? '-' : '';

    if (compact && Math.abs(amount) >= 1000) {
      const compactAmount = Math.abs(amount) >= 1000000
        ? `${(Math.abs(amount) / 1000000).toFixed(1)}M`
        : `${(Math.abs(amount) / 1000).toFixed(1)}K`;
      return showSymbol ? `${sign}${symbol} ${compactAmount}` : `${sign}${compactAmount}`;
    }

    return showSymbol ? `${sign}${symbol} ${formattedAmount}` : `${sign}${formattedAmount}`;
  }

  try {
    if (compact && Math.abs(amount) >= 1000) {
      // English UI: abbreviate as K/M/B while keeping the currency's display
      // symbol (e.g. "$2.5M"), instead of the zh-TW 萬/億 notation.
      if (getActiveUiLang() === 'en') {
        const sign = amount < 0 ? '-' : '';
        const num = new Intl.NumberFormat('en-US', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(Math.abs(amount));
        return showSymbol ? `${sign}${currencySymbolFor(currency)}${num}` : `${sign}${num}`;
      }
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        notation: 'compact',
        // Both bounds, or the result depends on the JS engine: with only a maximum,
        // V8 in Node 22 printed "NT$15.0萬" and Node 26 prints "NT$15萬", so a
        // server-rendered page could disagree with the browser that hydrates it.
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return formatWithSymbolFix(formatter, amount, currency);
    }

    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });

    return formatWithSymbolFix(formatter, amount, currency);
  } catch (_error) {
    // Fallback to manual formatting for invalid currency codes
    const formattedAmount = Math.abs(amount).toLocaleString(locale, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    const sign = amount < 0 ? '-' : '';

    return showSymbol ? `${sign}${symbol} ${formattedAmount}` : `${sign}${formattedAmount}`;
  }
}

/**
 * Rates for folding foreign amounts into one TWD figure, used by every summed
 * total in the app — the heatmaps, day totals, expense breakdown, cash flow.
 *
 * These were a fixed table, and a fixed table drifts: against live rates it was
 * 8% out on EUR and 6% on SGD, so any total containing a euro position was
 * wrong by that much. The table is now only the value used before the first
 * fetch lands; `setExchangeRates` replaces it with what the server reports.
 *
 * `toTWD` stays synchronous deliberately. It is called 21 times across ten
 * files, inside `useMemo` bodies and reduce loops, and making it async would
 * mean rewriting all of them to thread a promise through arithmetic.
 *
 * Client-only by construction: the provider that fills this runs in the
 * browser, so the module-level state cannot bleed between server requests. No
 * conversion happens during server rendering — every call site is a client
 * component or a helper reached from one.
 */
/**
 * Every currency the server prices, so none can fall through.
 *
 * `toTWD` ends in `?? 1`, so a code missing from this map converts at parity —
 * a GBP holding summed as though one pound were one dollar, understating it
 * ~97%. GBP was absent from the original table and the endpoint has always
 * returned it, so the gap only showed before the first fetch resolved. That is
 * the same "report parity for a rate you do not have" bug this change set
 * removed from the backend, and it must not exist on this side either.
 *
 * Keep this in step with the currency list in
 * `portfolio/routers/market_data.py::get_exchange_rates`.
 */
const BOOTSTRAP_TO_TWD: Readonly<Record<string, number>> = {
  TWD: 1, USD: 31.5, EUR: 34.0, JPY: 0.21, GBP: 40.0, HKD: 4.05, SGD: 23.5, CNY: 4.4,
  // A dollar stablecoin, and crypto holdings are priced in it. Without an entry it
  // fell through unconverted, which is how a mixed-currency sum starts.
  USDT: 31.5,
};

let _toTwd: Record<string, number> = { ...BOOTSTRAP_TO_TWD };
let _ratesAreLive = false;

/**
 * Replace the bootstrap table with rates from the server.
 *
 * Only codes actually present are taken: a currency the server could not price
 * keeps its bootstrap value rather than vanishing, because a total that
 * silently drops a holding is worse than one that is slightly stale.
 */
export function setExchangeRates(rates: Record<string, number>): void {
  const usable = Object.entries(rates).filter(
    ([, rate]) => typeof rate === 'number' && Number.isFinite(rate) && rate > 0,
  );
  if (usable.length === 0) return;

  _toTwd = { ...BOOTSTRAP_TO_TWD, ...Object.fromEntries(usable) };
  // The rate feed prices currencies, not stablecoins, so USDT would otherwise keep
  // its bootstrap figure while USD moved. One dollar of Tether is one US dollar.
  if (_toTwd.USD && !Object.prototype.hasOwnProperty.call(rates, 'USDT')) {
    _toTwd.USDT = _toTwd.USD;
  }
  _ratesAreLive = true;
}

/** Whether totals are being converted with fetched rates rather than the bootstrap table. */
export function areRatesLive(): boolean {
  return _ratesAreLive;
}

/**
 * Currencies `toTWD` has been asked for and could not price.
 *
 * It has to keep returning a number — it is called inside reduce loops that sum
 * money, and throwing would take out the whole total for one bad row. So the
 * unpriced amount passes through unconverted, which is a wrong contribution to
 * the sum, and the code is recorded here instead of the fallback being
 * invisible.
 *
 * This is what turned a missing GBP entry into a pound counted as a dollar with
 * nothing anywhere saying so. The number is still slightly wrong; the
 * difference is that a caller can now find out and say so.
 */
const _unconverted = new Set<string>();

/** Codes that fell through to 1:1 since the last reset. */
export function getUnconvertedCurrencies(): string[] {
  return [..._unconverted].sort();
}

/** Test seam: forget any fetched rates. */
export function __resetExchangeRates(): void {
  _toTwd = { ...BOOTSTRAP_TO_TWD };
  _ratesAreLive = false;
  _unconverted.clear();
}

export function toTWD(amount: number, currency: string): number {
  const code = currency?.toUpperCase();
  const rate = _toTwd[code];

  if (rate === undefined) {
    // Not `?? 1` silently. See `_unconverted`.
    if (code) _unconverted.add(code);
    return amount;
  }

  return amount * rate;
}

// Taiwan-specific currency formatting
export function formatTWD(amount: number, options: {
  showSymbol?: boolean;
  precision?: number;
  compact?: boolean;
} = {}): string {
  const { showSymbol = true, precision = 0, compact = false } = options;

  return formatCurrency(amount, 'TWD', {
    showSymbol,
    precision,
    compact,
    locale: 'zh-TW',
  });
}

/**
 * TWD in compact form — "NT$1.2M" rather than "NT$1,234,567".
 *
 * Seventeen files had written `const fmt = (v) => formatTWD(v, { compact: true })`
 * at the top, byte-identical, and one more had spelled the same thing `fmtAxis`.
 * That is not a decision anyone repeated seventeen times; it is what happens
 * when the shared helper stops one call short of what callers actually want.
 */
export function formatTWDCompact(amount: number): string {
  return formatTWD(amount, { compact: true });
}
// Date formatting
export function formatDate(date: Date | string, formatStr: string = 'MMM d, yyyy'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateFormat(dateObj, formatStr);
}
