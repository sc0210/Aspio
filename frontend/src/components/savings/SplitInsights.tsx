'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useIsDark } from '@/contexts/ThemeContext';
import { businessToday } from '@/lib/portfolio/businessDate';
import { formatCurrency } from '@/utils/formatters';
import type { SplitOut } from '@/shared/types';
import { accepted, byCategory, byMonth, currenciesByUse, frontedByPartner, monthLabel as formatMonth, monthOf, shiftMonth, summarize, type PartnerLabels } from './sharedSpendingStats';

// As the rest of the tab: whole dollars for TWD.
const money = (value: number, currency: string) =>
  formatCurrency(value, currency, currency === 'TWD' ? { precision: 0 } : {});

// Validated as a categorical pair (light: on white; dark: on gray-800) with the
// dataviz palette checks: lightness band, chroma, CVD and normal-vision ΔE, contrast.
const SERIES = {
  light: { mine: '#4f46e5', partner: '#d97706' },
  dark: { mine: '#6366f1', partner: '#d97706' },
};

const TREND_MONTHS = 6;

interface SplitInsightsProps {
  splits: SplitOut[];
  /** Set when the bills filter narrows to one partner, so the title says whose figures these are. */
  partnerName?: string;
  /** Built from every bill: with a partner chosen, `splits` is narrowed and would renumber same-name partners. */
  partnerLabels?: PartnerLabels;
}

/**
 * What the accepted shared bills add up to: a month's totals, where the money
 * went, and how it moved over the last six months. See `sharedSpendingStats.ts`.
 */
export default function SplitInsights({ splits, partnerName, partnerLabels }: SplitInsightsProps) {
  const { t, i18n } = useTranslation(['common', 'transactions']);
  const isDark = useIsDark();
  const colors = isDark ? SERIES.dark : SERIES.light;
  const thisMonth = monthOf(businessToday());
  const currencies = useMemo(() => currenciesByUse(splits), [splits]);
  const [month, setMonth] = useState(thisMonth);
  const [allTime, setAllTime] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const currency = picked && currencies.includes(picked) ? picked : currencies[0];

  const scope = allTime ? null : month;
  const summary = useMemo(() => (currency ? summarize(splits, currency, scope) : null), [splits, currency, scope]);
  const categories = useMemo(() => (currency ? byCategory(splits, currency, scope) : []), [splits, currency, scope]);
  const fronted = useMemo(
    () => (currency ? frontedByPartner(splits, currency, scope, partnerLabels) : []),
    [splits, currency, scope, partnerLabels],
  );
  const trend = useMemo(
    () => (currency ? byMonth(splits, currency, allTime ? thisMonth : month, TREND_MONTHS) : []),
    [splits, currency, month, allTime, thisMonth],
  );

  if (!currency || !summary) return null;

  const monthLabel = (m: string, style: 'long' | 'short' = 'long') => formatMonth(m, i18n?.language || 'en', style);
  const categoryLabel = (name: string) => t(`transactions:form.categories.${name}`, name);
  // Named after the partners behind these figures, not every bill on the list.
  const partners = new Set(accepted(splits).filter((s) => s.currency === currency).map((s) => s.partner_name));
  const partnerLabel = partnerName ?? (partners.size === 1 ? [...partners][0] : t('savings.splits.insights.partners', 'Partners'));
  const minePct = summary.total > 0 ? Math.round((summary.mine / summary.total) * 100) : 0;
  const largest = categories[0]?.total ?? 0;
  const uncategorised = t('savings.splits.insights.uncategorised', 'No category');
  const hasTrend = trend.some((r) => r.mine + r.partner > 0);

  const tiles = [
    {
      label: t('savings.splits.insights.total', 'Shared spending'),
      value: money(summary.total, currency),
      note: t('savings.splits.insights.bills', '{{count}} bills', { count: summary.count }),
    },
    {
      label: t('savings.splits.insights.mine', 'Your share'),
      value: money(summary.mine, currency),
      note: summary.total > 0 ? t('savings.splits.insights.minePct', '{{pct}}% of it', { pct: minePct }) : '',
    },
    {
      label: t('savings.splits.insights.iFronted', 'You paid up front'),
      value: money(summary.iFronted, currency),
      note: '',
    },
    {
      label: t('savings.splits.insights.partnerFronted', '{{name}} paid up front', { name: partnerLabel }),
      value: money(summary.partnerFronted, currency),
      // With more than one partner, who is behind the total.
      note: fronted.length > 1 ? fronted.map((f) => `${f.name} ${money(f.amount, currency)}`).join(' · ') : '',
    },
  ];

  const stepBtn = 'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <section aria-labelledby="split-insights-title" className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm space-y-4">
      {/* Filters in one row above the figures they scope. */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="split-insights-title" className="text-sm font-semibold text-gray-900 dark:text-white mr-auto">
          {t('savings.splits.insights.title', 'Insights')}
          {partnerName && (
            <span className="ml-1.5 font-normal text-gray-600 dark:text-gray-400">
              {t('savings.splits.insights.withPartner', 'with {{name}}', { name: partnerName })}
            </span>
          )}
        </h3>
        <div className="flex items-center" role="group" aria-label={t('savings.splits.insights.period', 'Period')}>
          <button type="button" className={stepBtn} disabled={allTime} onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label={t('savings.splits.insights.prevMonth', 'Previous month')}>
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <span className="min-w-[7.5rem] text-center text-sm font-medium text-gray-900 dark:text-white" aria-live="polite">
            {allTime ? t('savings.splits.insights.allTime', 'All time') : monthLabel(month)}
          </span>
          <button type="button" className={stepBtn} disabled={allTime || month >= thisMonth}
            onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t('savings.splits.insights.nextMonth', 'Next month')}>
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
        <button type="button" aria-pressed={allTime} onClick={() => setAllTime((v) => !v)}
          className={`min-h-[44px] px-3 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${allTime
            ? 'border-primary-600 bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
            : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'}`}>
          {t('savings.splits.insights.allTime', 'All time')}
        </button>
        {currencies.length > 1 && (
          <select value={currency} onChange={(e) => setPicked(e.target.value)}
            aria-label={t('savings.splits.insights.currency', 'Currency')}
            className="min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-2">
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* The headline figures: stat tiles, not a chart. */}
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3 min-w-0">
            <dt className="text-xs text-gray-600 dark:text-gray-400 truncate">{tile.label}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900 dark:text-white tabular-nums truncate">{tile.value}</dd>
            {tile.note && <dd className="text-xs text-gray-600 dark:text-gray-400">{tile.note}</dd>}
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Where it went: one series, so bars in one hue and no legend. */}
        <div>
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t('savings.splits.insights.byCategory', 'By category')}
          </h4>
          {categories.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('savings.splits.insights.none', 'No shared bills in this period.')}</p>
          ) : (
            <ul className="space-y-2">
              {categories.map((c) => (
                <li key={c.name ?? '—'} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-gray-900 dark:text-white">{c.name ? categoryLabel(c.name) : uncategorised}</span>
                    <span className="tabular-nums text-gray-900 dark:text-white whitespace-nowrap">
                      {money(c.total, currency)}
                      <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">
                        {t('savings.splits.insights.youPart', 'you {{amount}}', { amount: money(c.mine, currency) })}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden="true">
                    <div className="h-2 rounded-full" style={{ width: `${largest > 0 ? Math.max(2, (c.total / largest) * 100) : 0}%`, backgroundColor: colors.mine }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* How it moved: two series stacked, so a legend and a hover tooltip. */}
        <div>
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t('savings.splits.insights.trend', 'Last {{count}} months', { count: TREND_MONTHS })}
          </h4>
          <ul className="flex gap-4 text-xs text-gray-700 dark:text-gray-300 mb-2" aria-label={t('savings.splits.insights.legend', 'Legend')}>
            <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.mine }} aria-hidden="true" />{t('savings.splits.insights.you', 'You')}</li>
            <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.partner }} aria-hidden="true" />{partnerLabel}</li>
          </ul>
          {hasTrend ? (
            <div className="h-48" role="img" aria-label={t('savings.splits.insights.trendAlt', 'Shared spending per month, your part and {{name}}’s', { name: partnerLabel })}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={isDark ? '#374151' : '#e5e7eb'} />
                  <XAxis dataKey="month" tickFormatter={(m: string) => monthLabel(m, 'short')} tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis width={48} tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : String(v))} />
                  <Tooltip
                    cursor={{ fill: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { mine: number; partner: number };
                      return (
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs shadow-lg">
                          <p className="font-medium text-gray-900 dark:text-white mb-1">{monthLabel(String(label))}</p>
                          <p className="text-gray-700 dark:text-gray-300">{t('savings.splits.insights.you', 'You')}: <span className="tabular-nums">{money(row.mine, currency)}</span></p>
                          <p className="text-gray-700 dark:text-gray-300">{partnerLabel}: <span className="tabular-nums">{money(row.partner, currency)}</span></p>
                          <p className="text-gray-900 dark:text-white font-medium">{t('savings.splits.insights.total', 'Shared spending')}: <span className="tabular-nums">{money(row.mine + row.partner, currency)}</span></p>
                        </div>
                      );
                    }}
                  />
                  {/* A 2px surface gap between the stacked segments. */}
                  <Bar dataKey="mine" stackId="s" fill={colors.mine} stroke={isDark ? '#1f2937' : '#ffffff'} strokeWidth={2} isAnimationActive={false} />
                  <Bar dataKey="partner" stackId="s" fill={colors.partner} stroke={isDark ? '#1f2937' : '#ffffff'} strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('savings.splits.insights.none', 'No shared bills in this period.')}</p>
          )}
          {/* The same numbers as a table, for screen readers. */}
          <table className="sr-only">
            <caption>{t('savings.splits.insights.trend', 'Last {{count}} months', { count: TREND_MONTHS })}</caption>
            <thead><tr><th scope="col">{t('savings.splits.insights.month', 'Month')}</th><th scope="col">{t('savings.splits.insights.you', 'You')}</th><th scope="col">{partnerLabel}</th></tr></thead>
            <tbody>
              {trend.map((r) => (
                <tr key={r.month}><th scope="row">{monthLabel(r.month)}</th><td>{money(r.mine, currency)}</td><td>{money(r.partner, currency)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
