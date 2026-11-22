'use client';

import { useTranslation } from 'react-i18next';
import { useTwCape } from '@/hooks/useTwCape';
import { useAppMode } from '@/hooks/useAppMode';
import { BAND_LABEL, BAND_STYLE, monthLabel } from './twCape';

const ARTICLE =
  'snap-start flex-[0_0_78%] rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 min-h-[130px]';

/**
 * The Taiwan CAPE as one of the phone dashboard's swipeable highlights: the
 * value, its band and where it sits in Taiwan's own history. The desktop card
 * (TwCapeCard) adds the sparkline; this one stays text-only, so the phone
 * dashboard does not load recharts.
 *
 * Not part of demo mode (no backend there). Loading, or nothing to show yet
 * (before the first backfill), leaves the slot out rather than adding a card
 * that appears and goes in a row of glanceable numbers.
 */
export function TwCapeHighlight() {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const { isDemo } = useAppMode();
  const { data, isLoading, isError, isFetching, refetch } = useTwCape();
  const title = t('dashboard:twCape.shortTitle', { defaultValue: 'Taiwan market · CAPE' });

  // Nothing while loading: a placeholder that then disappears (before the
  // first backfill there is nothing to show) made the swipe row jump.
  if (isDemo || isLoading) return null;

  if (isError && !data) {
    // Failed is not "nothing to show": say so, with a way to try again.
    return (
      <article className={ARTICLE} role="alert">
        <p className="text-[12.5px] font-bold text-gray-500 dark:text-gray-400">{title}</p>
        <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('common:errorState.loadFailed', { defaultValue: "Couldn't load this" })}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-busy={isFetching}
          className="mt-1 disabled:opacity-50 min-h-[44px] text-xs font-bold text-primary-700 dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded touch-manipulation"
        >
          {t('common:errorState.tryAgain', { defaultValue: 'Try again' })}
        </button>
      </article>
    );
  }

  if (!data || !data.available) return null;

  const since = monthLabel(data.since.slice(0, 7), i18n.language || 'en');
  return (
    <article className={ARTICLE}>
      <p className="text-[12.5px] font-bold text-gray-500 dark:text-gray-400 truncate">{title}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[22px] font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
          {data.cape.toFixed(1)}
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BAND_STYLE[data.band]}`}>
          {t(`dashboard:twCape.band.${data.band}`, { defaultValue: BAND_LABEL[data.band] })}
        </span>
      </div>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
        {t('dashboard:twCape.percentile', {
          pct: Math.round(data.percentile),
          since,
          defaultValue: 'Higher than {{pct}}% of months since {{since}}',
        })}
      </p>
      <p className="mt-3 text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
        {t('dashboard:twCape.range', {
          low: data.low.toFixed(1),
          high: data.high.toFixed(1),
          pe: data.marketPe.toFixed(1),
          defaultValue: 'Range {{low}}–{{high}} · market P/E {{pe}}',
        })}
      </p>
    </article>
  );
}
