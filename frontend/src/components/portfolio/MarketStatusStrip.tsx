'use client';

import { useTranslation } from 'react-i18next';
import type { PortfolioHolding } from '@/shared/types';
import { cn } from '@/utils/cn';
import { fxInUse, marketSummaries } from '@/utils/marketStatus';

/**
 * One line above the holdings saying what the numbers stand on: which markets
 * are trading and, for the closed ones, which session their prices are from;
 * and the exchange rates the TWD figures use, live or estimated. Without it a
 * Saturday page showed Friday's move as "today" and never said a rate was a
 * fallback.
 */
export function MarketStatusStrip({ holdings, className }: { holdings: PortfolioHolding[]; className?: string }) {
  const { t, i18n } = useTranslation(['portfolio']);
  const markets = marketSummaries(holdings);
  const fx = fxInUse(holdings);
  if (markets.length === 0 && fx.length === 0) return null;

  const weekday = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(i18n?.language || 'en', { weekday: 'short', month: 'numeric', day: 'numeric' });

  return (
    <ul
      aria-label={t('portfolio:marketStatus.label', 'Markets and exchange rates')}
      className={cn('flex flex-wrap items-center gap-2 text-xs', className)}
    >
      {markets.map((m) => (
        <li
          key={m.market}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1 text-gray-700 dark:text-gray-300"
        >
          {/* Shape and words, not colour alone: a filled dot is open, a ring closed. */}
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 rounded-full',
              m.state === 'open' ? 'bg-prosperity-600' : 'border border-gray-400 dark:border-gray-500'
            )}
          />
          <span className="font-semibold">{m.market}</span>
          <span>
            {m.state === 'open'
              ? t('portfolio:marketStatus.open', 'Open')
              : m.lastSession
                ? t('portfolio:marketStatus.closedSince', { day: weekday(m.lastSession), defaultValue: 'Closed · last close {{day}}' })
                : t('portfolio:marketStatus.closed', 'Closed')}
          </span>
        </li>
      ))}
      {fx.map((r) => (
        <li
          key={r.currency}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 tabular-nums',
            r.live
              ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
          )}
        >
          <span className="font-semibold">{r.currency}/TWD</span>
          <span>{r.rate.toFixed(r.rate >= 10 ? 2 : 4)}</span>
          <span>· {r.live ? t('portfolio:marketStatus.fxLive', 'live') : t('portfolio:marketStatus.fxEstimate', 'estimate')}</span>
        </li>
      ))}
    </ul>
  );
}
