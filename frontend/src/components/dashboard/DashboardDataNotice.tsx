'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAppMode } from '@/hooks/useAppMode';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { invalidateDashboardData, isRefreshableQueryKey } from '@/hooks/useDataSynchronization';
import { portfolioService } from '@/services/portfolioService';
import { hasPortfolioDataIssues, portfolioDataIssues } from '@/utils/portfolioDataIssues';

const DISMISS_KEY = 'aspiro-dashboard-data-notice-dismissed';
const MAX_SYMBOLS = 4;

function listSymbols(symbols: string[]): string {
  const shown = symbols.slice(0, MAX_SYMBOLS).join(', ');
  return symbols.length > MAX_SYMBOLS ? `${shown} +${symbols.length - MAX_SYMBOLS}` : shown;
}

/**
 * A figure the page is showing nothing for: a financial query (not the bell or
 * feature flags) that failed with no earlier data to fall back on. A failed
 * background refetch still shows its last good data, so it does not count.
 */
const isMissingFigure = (q: Query) =>
  q.state.status === 'error' && q.state.data === undefined && isRefreshableQueryKey(q.queryKey);

/** How many figures failed to load, kept live off the query cache. */
function useFailedQueryCount(): number {
  const cache = useQueryClient().getQueryCache();
  const subscribe = useCallback((onChange: () => void) => cache.subscribe(onChange), [cache]);
  return useSyncExternalStore(
    subscribe,
    () => cache.findAll({ type: 'active', predicate: isMissingFigure }).length,
    () => 0,
  );
}

function readDismissed(): string | null {
  try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
}

/**
 * Says so when the home page is not showing everything it should: a section
 * that failed to load, prices that stopped updating, holdings without a day
 * change, or currencies with no rate. Silent when all is well, and in demo mode.
 */
export function DashboardDataNotice({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation('dashboard');
  const { isDemo } = useAppMode();
  const queryClient = useQueryClient();
  const failedCount = useFailedQueryCount();
  const { holdings, isLoading } = usePortfolio();
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  // Observes the rates query (the root loader fetches it) so a rate that arrives
  // after first paint re-evaluates the currency check.
  const { data: fx } = useExchangeRates('TWD', { enabled: false });
  const issues = useMemo(() => portfolioDataIssues(holdings, new Date(), fx?.rates), [holdings, fx]);

  // A dismissal holds only for the problems it was given; a new one shows again.
  const signature = [
    failedCount,
    issues.staleSymbols.join(','),
    issues.noDayChangeSymbols.join(','),
    issues.unconvertedCurrencies.join(','),
  ].join('|');

  if (isDemo || isLoading) return null;
  if (failedCount === 0 && !hasPortfolioDataIssues(issues)) return null;
  if (dismissed === signature) return null;

  const retry = () => {
    void queryClient.refetchQueries({ type: 'active', predicate: isMissingFigure });
  };

  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      const result = await portfolioService.refreshPortfolioPrices(true);
      if (!result.success) throw new Error(result.message);
      invalidateDashboardData(queryClient);
    } catch {
      toast.error(t('dataNotice.refreshFailed', "Prices couldn't be refreshed. Try again later."));
    } finally {
      setRefreshing(false);
    }
  };

  const dismiss = () => {
    setDismissed(signature);
    try { sessionStorage.setItem(DISMISS_KEY, signature); } catch { /* private mode */ }
  };

  const oldest = issues.oldestSession
    ? new Date(`${issues.oldestSession}T12:00:00`).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })
    : '';

  const buttonClass =
    'shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60 transition-colors';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{t('dataNotice.title', 'Some of your figures may be incomplete')}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('dataNotice.dismiss', 'Dismiss')}
          className="shrink-0 -mt-0.5 rounded px-1 text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          ×
        </button>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {failedCount > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('dataNotice.failed', { count: failedCount, defaultValue: "{{count}} section(s) couldn't load." })}</span>
            <button type="button" onClick={retry} className={buttonClass}>
              {t('dataNotice.retry', 'Retry')}
            </button>
          </li>
        )}
        {issues.staleSymbols.length > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('dataNotice.stale', {
                symbols: listSymbols(issues.staleSymbols),
                date: oldest,
                defaultValue: 'Prices for {{symbols}} are from {{date}}; they have not updated since.',
              })}
            </span>
            <button type="button" onClick={refreshPrices} disabled={refreshing} className={buttonClass}>
              {refreshing ? t('dataNotice.refreshing', 'Refreshing…') : t('dataNotice.refreshPrices', 'Refresh prices')}
            </button>
          </li>
        )}
        {issues.noDayChangeSymbols.length > 0 && (
          <li>
            {t('dataNotice.noDayChange', {
              symbols: listSymbols(issues.noDayChangeSymbols),
              defaultValue: "No previous close for {{symbols}}, so they are left out of today's change.",
            })}
          </li>
        )}
        {issues.unconvertedCurrencies.length > 0 && (
          <li>
            {t('dataNotice.unconverted', {
              currencies: issues.unconvertedCurrencies.join(', '),
              defaultValue: 'No exchange rate for {{currencies}}; those amounts are not converted to TWD.',
            })}
          </li>
        )}
      </ul>
    </div>
  );
}
