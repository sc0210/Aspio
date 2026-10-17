/**
 * Badge colours, staleness and formatting for one holding row.
 *
 * `HoldingsList` and `HoldingsListMobile` each carried their own copy of all
 * six of these, and three had already drifted apart:
 *
 *   - `getCurrencyColor` upper-cased the code on desktop and not on mobile, so
 *     a lowercase currency matched nothing there and fell through to the
 *     default colour. Upper-casing is kept.
 *   - `getTypeColor` painted a cash holding grey on desktop and emerald on
 *     mobile. Emerald is kept: it is the colour the cash section already uses
 *     for its own header, so the badge now agrees with the block it sits in.
 *   - `getMarketBadge` differed only by a comment.
 *
 * None of that was a decision anyone made; it is what two copies do. One copy
 * now, imported by both.
 */

export const isPriceStale = (lastUpdated: Date | string | undefined): boolean => {
  if (!lastUpdated) return true;
  const updateTime = new Date(lastUpdated).getTime();
  const now = Date.now();
  const fourHoursMs = 4 * 60 * 60 * 1000;
  return (now - updateTime) > fourHoursMs;
};

export const formatTimeAgo = (date: Date | string | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string => {
  if (!date) return t('common:time.unknown');
  const now = Date.now();
  const updateTime = new Date(date).getTime();
  const diffMs = now - updateTime;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days > 0) return t('common:time.daysAgo', { count: days });
  if (hours > 0) return t('common:time.hoursAgo', { count: hours });
  if (minutes > 0) return t('common:time.minutesAgo', { count: minutes });
  return t('common:time.justNow');
};

export const getTypeColor = (type: string) => {
  switch (type.toLowerCase()) {
    case 'stock': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
    case 'etf': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
    case 'crypto': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300';
    case 'bond': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300';
    case 'cash': return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300';
    case 'lending': return 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300';
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
  }
};

export const getCurrencyColor = (currency: string) => {
  switch (currency.toUpperCase()) {
    case 'TWD':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    case 'USD':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    case 'EUR':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
    case 'JPY':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    case 'GBP':
      return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300';
    case 'SGD':
      return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300';
    case 'CNY':
      return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
    case 'HKD':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
  }
};

export const getMarketBadge = (market?: string, type?: string, currency?: string) => {
  // For crypto, always show crypto badge
  if (type?.toLowerCase() === 'crypto' || type?.toLowerCase() === 'cryptocurrency') {
    return {
      label: 'CRYPTO',
      color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
      icon: '₿'
    };
  }

  // Use currency to determine flag if market is not set
  const marketOrCurrency = market || (currency === 'TWD' ? 'TW' : currency === 'USD' ? 'US' : undefined);

  switch (marketOrCurrency?.toUpperCase()) {
    case 'TW':
      return {
        label: 'TW',
        color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
        icon: '🇹🇼'
      };
    case 'US':
      return {
        label: 'US',
        color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        icon: '🇺🇸'
      };
    default:
      return null;
  }
};

/**
 * Structural on purpose: `Holding` lives in `HoldingsList`, which imports this
 * module, and naming it here would close the loop. The one field is all the
 * check needs.
 */
export const isCashHolding = (holding: { type: string }) => holding.type.toLowerCase() === 'cash';

export const getWalletTypeBadge = (walletType: string | undefined, t: (key: string) => string) => {
  switch (walletType) {
    case 'life':
      return {
        icon: '💳',
        label: t('portfolio:walletTypes.life'),
        color: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
      };
    case 'portfolio':
      return {
        icon: '📈',
        label: t('portfolio:walletTypes.portfolio'),
        color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
      };
    case 'emergency':
      return {
        icon: '🚨',
        label: t('portfolio:walletTypes.emergency'),
        color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
      };
    default:
      return null;
  }
};


/**
 * Identity of one holding row: the security AND the wallet it sits in.
 *
 * The same symbol can be held in both the Portfolio and Emergency wallets, and
 * they are separate rows with separate lots. Keying anything by symbol alone
 * merges them — the lot-count badge did that until recently, and bulk-edit
 * selection still did: ticking a Portfolio lot also ticked the Emergency lot of
 * the same symbol, and counted two.
 *
 * The `|| 'portfolio'` default matches the lot-count map and the holdings split,
 * both of which already treat a missing walletType as portfolio.
 */
export const holdingKey = (holding: { symbol: string; walletType?: string }) =>
  `${holding.symbol}|${holding.walletType || 'portfolio'}`;
