/**
 * English fallbacks for the `dashboard:periods.*` keys.
 *
 * One copy on purpose. Both the dashboard's flow strip and the cash-flow card
 * name the selected window beside their figures, and each carried its own map —
 * the dashboard's was English-only, so a zh-TW reader got "已儲蓄 · THIS MONTH".
 * These are only the fallbacks: a missing key degrades to a readable label
 * instead of showing the key itself.
 */
export const PERIOD_FALLBACKS: Record<string, string> = {
  '7d':    'Last 7 Days',
  '14d':   'Last 14 Days',
  'month': 'This Month',
  '30d':   'Last 30 Days',
  '90d':   'Last 90 Days',
  '6m':    'Last 6 Months',
  'ytd':   'Year to Date',
  '1y':    'Last Year',
};

/** i18n key for a period, for `t(periodLabelKey(range), PERIOD_FALLBACKS[range])`. */
export const periodLabelKey = (dateRange?: string) =>
  `dashboard:periods.${dateRange ?? 'month'}`;
