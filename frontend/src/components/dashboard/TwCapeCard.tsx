'use client';

import { useTranslation } from 'react-i18next';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { QueryErrorCard } from '@/components/ui/QueryErrorCard';
import { useTwCape, type CapeBand, type TwCape } from '@/hooks/useTwCape';
import { useAppMode } from '@/hooks/useAppMode';

const BAND_LABEL: Record<CapeBand, string> = { cheap: 'Cheap', fair: 'Fair', expensive: 'Expensive' };

const BAND_STYLE: Record<CapeBand, string> = {
  cheap: 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300',
  fair: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  expensive: 'bg-warning-100 dark:bg-warning-900/40 text-warning-800 dark:text-warning-300',
};

function monthLabel(isoMonth: string, language: string): string {
  const [y, m] = isoMonth.split('-').map(Number);
  return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }).format(new Date(y, m - 1, 1));
}

function CapeBody({ cape }: { cape: TwCape }) {
  const { t, i18n } = useTranslation(['dashboard']);
  const language = i18n.language || 'en';
  // The band's edges exactly as the server applied them, so the dashed lines
  // and the badge cannot disagree.
  const since = monthLabel(cape.since.slice(0, 7), language);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 md:gap-6 items-center">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tabular-nums" aria-label={`CAPE ${cape.cape.toFixed(1)}`}>
            {cape.cape.toFixed(1)}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BAND_STYLE[cape.band]}`}>
            {t(`dashboard:twCape.band.${cape.band}`, { defaultValue: BAND_LABEL[cape.band] })}
          </span>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('dashboard:twCape.percentile', {
            pct: Math.round(cape.percentile),
            since,
            defaultValue: 'Higher than {{pct}}% of months since {{since}}',
          })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          {t('dashboard:twCape.range', {
            low: cape.low.toFixed(1),
            high: cape.high.toFixed(1),
            pe: cape.marketPe.toFixed(1),
            defaultValue: 'Range {{low}}–{{high}} · market P/E {{pe}}',
          })}
        </p>
      </div>

      <div className="h-24 sm:h-28 min-w-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={cape.history} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="twCapeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
            <ReferenceLine y={cape.expensiveAbove} stroke="#d97706" strokeDasharray="3 3" strokeOpacity={0.7} />
            <ReferenceLine y={cape.cheapAtOrBelow} stroke="#16a34a" strokeDasharray="3 3" strokeOpacity={0.7} />
            <Tooltip
              formatter={(value: number) => [value.toFixed(1), 'CAPE']}
              labelFormatter={(_, payload) => {
                const month = payload?.[0]?.payload?.month as string | undefined;
                return month ? monthLabel(month, language) : '';
              }}
              contentStyle={{ fontSize: 12 }}
            />
            <Area type="monotone" dataKey="cape" stroke="#6366f1" strokeWidth={2} fill="url(#twCapeFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * The Taiwan market's Shiller P/E (CAPE) and where it sits in its own history.
 *
 * Read against Taiwan's own past rather than a fixed number: its ten-year
 * earnings average lags how fast its largest companies' profits grew, so
 * US-style cut-offs ("above 30 is expensive") would say expensive every month.
 */
export function TwCapeCard() {
  const { t } = useTranslation(['dashboard']);
  const { isDemo } = useAppMode();
  const { data, isLoading, isError, refetch } = useTwCape();

  // Demo mode runs without a backend, so the market card is not part of it
  // (useTwCape does not fetch there either).
  if (isDemo) return null;

  if (isError && !data) {
    return <QueryErrorCard onRetry={() => refetch()} title={t('dashboard:twCape.title', { defaultValue: 'Taiwan market valuation' })} />;
  }

  return (
    <Card padding="none" radius="xl" shadow="none" className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
            {t('dashboard:twCape.title', { defaultValue: 'Taiwan market valuation' })}
            <span
              className="text-gray-400 dark:text-gray-400"
              title={t('dashboard:twCape.hint', {
                defaultValue:
                  "Shiller CAPE: the TAIEX over ten years of inflation-adjusted earnings. Judged against Taiwan's own history — fast-growing earnings keep it above US-style thresholds.",
              })}
            >
              <InformationCircleIcon className="w-4 h-4" aria-hidden="true" />
            </span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {data && data.available
              ? t('dashboard:twCape.asOf', { date: data.asOf, defaultValue: 'Shiller CAPE · TAIEX · as of {{date}}' })
              : t('dashboard:twCape.subtitle', { defaultValue: 'Shiller CAPE · TAIEX' })}
          </p>
        </div>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
          {t('dashboard:twCape.source', { defaultValue: 'TWSE · DGBAS' })}
        </span>
      </div>

      {isLoading ? (
        <div className="h-24 sm:h-28 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg" data-testid="tw-cape-loading" />
      ) : data && data.available ? (
        <CapeBody cape={data} />
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('dashboard:twCape.collecting', {
            defaultValue: 'Collecting market history — the first daily update backfills it from 2005.',
          })}
        </p>
      )}
    </Card>
  );
}
