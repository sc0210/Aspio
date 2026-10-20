'use client';

import Link from 'next/link';
import {
  ChartBarIcon,
  ArrowTrendingUpIcon,
  EyeIcon,
  EyeSlashIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { portfolioService } from '@/services/portfolioService';
import { AssetTrendChart } from '@/components/portfolio/AssetTrendChart';
import { buildMiniCalendarCells } from '@/components/portfolio/calendarGrid';
import { dailyPerformanceKey, DAILY_PERFORMANCE_DAYS_DEFAULT } from '@/lib/queryKeys';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatCurrency, formatCompactChange } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { useMemo } from 'react';
import { Card } from '@/components/ui/Card';

const PERIOD_LABELS: Record<string, string> = {
  '7d': '7D', 'month': 'MTD', '30d': '30D', '90d': '90D',
  '6m': '6M', 'ytd': 'YTD', '1y': '1Y',
};

// Markets trade Mon–Fri only — five day columns + a weekly sum column.
const MINI_CAL_WEEKDAYS = ['M', 'T', 'W', 'T', 'F'];

function miniCellColor(change: number | null, maxAbs: number): string {
  if (change === null) return 'bg-gray-100 dark:bg-gray-700/50';
  if (change === 0)    return 'bg-gray-100 dark:bg-gray-700';
  const ratio = maxAbs > 0 ? Math.min(Math.abs(change) / maxAbs, 1) : 0;
  if (change > 0) {
    if (ratio > 0.66) return 'bg-emerald-500 text-white';
    if (ratio > 0.33) return 'bg-emerald-200 text-emerald-900 dark:bg-emerald-700/60 dark:text-emerald-100';
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
  }
  if (ratio > 0.66) return 'bg-red-500 text-white';
  if (ratio > 0.33) return 'bg-red-200 text-red-900 dark:bg-red-700/60 dark:text-red-100';
  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
}


// Said in the cell's own tooltip: the US session ends after midnight in Taipei, so
// the newest day keeps moving until its close is published.
const PROVISIONAL_NOTE = 'not final — the market has not closed for this day yet';

function MiniCalendarSection({
  data,
  currency,
  isValueVisible,
}: {
  data: Array<{ date: string; change: number; changePercent: number }>;
  currency: string;
  isValueVisible: boolean;
}) {
  const { cells, monthSum, hasData, maxAbs, isPositive, todayStr, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

    const monthData = new Map<string, { change: number; changePercent: number }>();
    for (const pt of data) {
      if (pt.date.startsWith(monthPrefix)) {
        monthData.set(pt.date.slice(0, 10), { change: pt.change, changePercent: pt.changePercent });
      }
    }

    const cells = buildMiniCalendarCells(year, month, monthData);

    const monthSum   = Array.from(monthData.values()).reduce((s, p) => s + p.change, 0);
    const hasData    = monthData.size > 0;
    const maxAbs     = monthData.size > 0 ? Math.max(...Array.from(monthData.values()).map(p => Math.abs(p.change))) : 0;
    const isPositive = monthSum >= 0;
    const todayStr   = `${monthPrefix}-${String(now.getDate()).padStart(2, '0')}`;
    const monthLabel = now.toLocaleDateString(undefined, { month: 'long' });

    return { cells, monthSum, hasData, maxAbs, isPositive, todayStr, monthLabel };
  }, [data]);

  return (
    <div className="pt-3 border-t border-gray-100 dark:border-gray-700 lg:h-full lg:pt-0 lg:pl-5 lg:border-t-0 lg:border-l">
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {monthLabel} P&L
          </span>
          {hasData && (
            <span className={cn(
              'text-xs font-bold tabular-nums',
              isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
            )}>
              {isValueVisible
                ? formatCompactChange(monthSum)
                : '•••'}
            </span>
          )}
        </div>
        <Link
          href="/portfolio/trend?view=calendar"
          className="text-[11px] font-medium text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 transition-colors"
        >
          Full calendar →
        </Link>
      </div>

      {/* Weekday headers (Mon–Fri) + weekly sum */}
      <div className="grid grid-cols-6 gap-0.5 mb-0.5">
        {MINI_CAL_WEEKDAYS.map((d, i) => (
          <div key={i} className="text-center text-[11px] font-semibold text-gray-500 dark:text-gray-500">
            {d}
          </div>
        ))}
        <div className="text-center text-[11px] font-semibold text-gray-500 dark:text-gray-500">Σ</div>
      </div>

      {/* Week rows: 5 weekday cells + 1 weekly sum (text only) */}
      <div className="space-y-0.5">
        {Array.from({ length: cells.length / 5 }, (_, wi) => {
          const week = cells.slice(wi * 5, wi * 5 + 5);
          const weekSum = week.reduce((s, cell) => cell?.change != null ? s + cell.change : s, 0);
          const hasWeekData = week.some((cell) => cell?.change != null);
          const isWeekPositive = weekSum >= 0;
          return (
            <div key={wi} className="grid grid-cols-6 gap-0.5">
              {week.map((cell, i) => {
                if (!cell) return <div key={`e-${wi}-${i}`} className="h-10" />;
                const isToday = cell.dateStr === todayStr;
                return (
                  <div
                    key={cell.dateStr}
                    title={
                      cell.change !== null
                        ? `${cell.dateStr}: ${cell.change >= 0 ? '+' : ''}${formatCurrency(cell.change, currency)}${cell.changePercent !== null ? ` (${cell.changePercent >= 0 ? '+' : ''}${cell.changePercent.toFixed(2)}%)` : ''}${cell.provisional ? ` — ${PROVISIONAL_NOTE}` : ''}`
                        : cell.dateStr
                    }
                    className={cn(
                      'h-10 rounded-sm flex flex-col items-center justify-center gap-0.5',
                      miniCellColor(cell.change, maxAbs),
                      isToday && 'ring-2 ring-primary-500 ring-offset-1',
                      // A day still being priced from live quotes: dashed, because the
                      // figure moves again when the close lands.
                      cell.provisional && 'border border-dashed border-gray-400 dark:border-gray-500',
                    )}
                  >
                    <span className="text-[10px] leading-none font-semibold opacity-70">
                      {cell.day}
                    </span>
                    {cell.change !== null && (
                      <span className="text-[10px] leading-none font-bold tabular-nums">
                        {isValueVisible ? formatCompactChange(cell.change) : '•'}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Weekly sum — no fill, colored text only */}
              <div
                title={hasWeekData ? `Week total: ${weekSum >= 0 ? '+' : ''}${formatCurrency(weekSum, currency)}` : undefined}
                className="h-10 flex items-center justify-center"
              >
                {hasWeekData && (
                  <span className={cn(
                    'text-[10px] leading-none font-bold tabular-nums text-center px-0.5',
                    isWeekPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
                  )}>
                    {isValueVisible ? formatCompactChange(weekSum) : '•••'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PortfolioHolding {
  symbol: string;
  name: string;
  value: number;
  gainLoss: number;
  gainLossPercentage: number;
}

interface Portfolio {
  totalValue: number;
  totalGainLoss: number;
  gainLossPercentage: number;
  holdings: PortfolioHolding[];
}

interface PortfolioOverviewProps {
  portfolio: Portfolio;
  dateRange?: string;
}

function MetricPill({
  label,
  value,
  subLabel,
  color,
}: {
  label: string;
  value: string;
  subLabel?: string;
  color: 'emerald' | 'rose' | 'amber' | 'violet' | 'indigo' | 'sky' | 'gray';
}) {
  const colorMap = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    rose:    'text-rose-600 dark:text-rose-400',
    amber:   'text-amber-700 dark:text-amber-400',
    violet:  'text-violet-600 dark:text-violet-400',
    indigo:  'text-indigo-600 dark:text-indigo-400',
    sky:     'text-sky-700 dark:text-sky-400',
    gray:    'text-gray-500 dark:text-gray-400',
  };
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums', colorMap[color])}>{value}</p>
      {subLabel && <p className="text-xs text-gray-500 dark:text-gray-500 truncate">{subLabel}</p>}
    </div>
  );
}

export function PortfolioOverview({ portfolio, dateRange }: PortfolioOverviewProps) {
  const { t } = useTranslation(['dashboard']);
  const { session, isDemo } = useAuthContext();
  const { isValueVisible, toggleValueVisibility } = usePrivacy();

  const holdings = portfolio?.holdings || [];
  const hasHoldings = holdings.length > 0;
  const isLoggedIn = !!session?.accessToken;

  // ── Daily performance (365d, shared with portfolio page cache) ──────────────
  const { data: allTrendData, isLoading: trendLoading } = useQuery({
    queryKey: dailyPerformanceKey(session?.user?.email, DAILY_PERFORMANCE_DAYS_DEFAULT),
    queryFn: async () => {
      try {
        const response = await portfolioService.getDailyPerformance(DAILY_PERFORMANCE_DAYS_DEFAULT);
        return response.success ? response.data : [];
      } catch {
        return [];
      }
    },
    // Demo mode also fetches: the backend serves generated demo daily data for
    // unauthenticated requests (same as the /portfolio/trend page), so the mini
    // calendar populates instead of staying blank for demo users.
    enabled: (isLoggedIn && hasHoldings) || isDemo,
    staleTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // ── Risk metrics (shared cache with portfolio page) ─────────────────────────
  const { data: riskMetrics } = useQuery({
    queryKey: ['portfolio-risk-metrics', session?.user?.email || 'demo'],
    queryFn: () => portfolioService.getRiskMetrics(),
    enabled: true,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // ── Dividend income (shared cache with portfolio page) ──────────────────────
  const { data: dividendIncome } = useQuery({
    queryKey: ['portfolio-dividend-income', session?.user?.email || 'demo'],
    queryFn: () => portfolioService.getDividendIncome('1y'),
    enabled: true,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // ── Filter trend data for selected period ───────────────────────────────────
  const cutoff = (() => {
    const now = Date.now();
    switch (dateRange) {
      case '1y':   return now - 365 * 86400000;
      case '6m':   return now - 180 * 86400000;
      case '90d':  return now - 90  * 86400000;
      case '14d':  return now - 14  * 86400000;
      case '7d':   return now - 7   * 86400000;
      case 'ytd': {
        const d = new Date();
        return new Date(d.getFullYear(), 0, 1).getTime();
      }
      case 'month': {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      }
      default: return now - 30 * 86400000;
    }
  })();
  const trendData = allTrendData?.filter((d: { date: string }) =>
    new Date(d.date).getTime() >= cutoff
  ) ?? [];
  // A single point can't form a trend line (and collapses the axis to duplicate
  // ticks, e.g. on the 1st of the month for MTD). Require at least two points.
  const hasEnoughTrend = trendData.length >= 2;
  // Distinguish "no history at all" from "history exists, just not in this window".
  const hasAnyHistory = (allTrendData?.length ?? 0) >= 2;

  // ── Derived metric display values ───────────────────────────────────────────
  const currency = 'TWD'; // matches the AssetTrendChart default

  const cagrPct   = riskMetrics?.cagrPercentage ?? null;
  const sharpe    = riskMetrics?.sharpeRatio ?? null;
  const maxDd     = riskMetrics?.maxDrawdownPercentage ?? null;
  const projIncome = dividendIncome?.projectedAnnual ?? null;
  const yoc       = dividendIncome?.yieldOnCost ?? null;

  const hasAnyMetrics = cagrPct !== null || sharpe !== null || maxDd !== null || projIncome !== null;

  return (
    <Card padding="md">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('dashboard:portfolioOverview.title', 'Investments')}
          </h3>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-2">{dateRange ? PERIOD_LABELS[dateRange] ?? dateRange : 'All'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleValueVisibility()}
            className="p-1.5 text-gray-500 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={isValueVisible ? t('dashboard:portfolioOverview.hideValues') : t('dashboard:portfolioOverview.showValues')}
          >
            {isValueVisible ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
          </button>
          <Link
            href="/portfolio/trend"
            className="text-xs text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
          >
            {t('dashboard:portfolioOverview.viewDetails')}
          </Link>
          <Link
            href="/portfolio/trend?view=calendar"
            title="Calendar view — daily P&L heatmap"
            className="p-1 rounded-lg text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <CalendarDaysIcon className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {!hasHoldings ? (
        /* ── Empty state ── */
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/20 mb-4">
            <ChartBarIcon className="w-8 h-8 text-primary-700 dark:text-primary-400" aria-hidden="true" />
          </div>
          <p className="text-base font-medium text-gray-900 dark:text-white mb-2">
            {t('dashboard:portfolioOverview.noInvestments')}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {t('dashboard:portfolioOverview.addFirst')}
          </p>
          <Link
            href="/portfolio/add"
            className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-primary-700 rounded-lg hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 transition-colors dark:focus-visible:ring-offset-gray-800"
          >
            {t('dashboard:portfolioOverview.addInvestment')}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Metrics strip ── */}
          {hasAnyMetrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 pb-3 border-b border-gray-100 dark:border-gray-700">
              {cagrPct !== null && (
                <MetricPill
                  label="CAGR"
                  value={`${cagrPct >= 0 ? '+' : ''}${cagrPct.toFixed(1)}%`}
                  subLabel="Annualised return"
                  color={cagrPct >= 0 ? 'emerald' : 'rose'}
                />
              )}
              {sharpe !== null && (
                <MetricPill
                  label="Sharpe"
                  value={sharpe.toFixed(2)}
                  subLabel={sharpe > 1 ? 'Good' : sharpe > 0 ? 'Fair' : 'Poor'}
                  color={sharpe > 1 ? 'emerald' : sharpe > 0 ? 'amber' : 'rose'}
                />
              )}
              {maxDd !== null && (
                <MetricPill
                  label="Max Drawdown"
                  value={`${maxDd.toFixed(1)}%`}
                  subLabel="Peak-to-trough"
                  color="rose"
                />
              )}
              {projIncome !== null && projIncome > 0 && (
                <MetricPill
                  label="Annual Income"
                  value={isValueVisible ? formatCurrency(projIncome, currency, { precision: 0 }) : '•••••'}
                  subLabel={yoc !== null ? `YoC ${yoc.toFixed(2)}%` : 'Projected'}
                  color="indigo"
                />
              )}
            </div>
          )}

          {/* ── Chart + P&L calendar: horizontal 2:1 split on large screens ── */}
          {(() => {
            const showCalendar = !trendLoading && !!allTrendData && allTrendData.length > 0;
            return (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-0">
                {/* Chart — 2/3 width (drops to full width when there's no calendar) */}
                <div className={cn('h-[260px]', showCalendar ? 'lg:col-span-2 lg:pr-5' : 'lg:col-span-3')}>
                  {trendLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-pulse flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
                        <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      </div>
                    </div>
                  ) : hasEnoughTrend ? (
                    <AssetTrendChart
                      data={trendData}
                      currency={currency}
                      isValueVisible={isValueVisible}
                      showSummary={false}
                      showControls={false}
                      className="h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center max-w-[16rem] mx-auto">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/20 mb-4">
                          <ArrowTrendingUpIcon className="w-8 h-8 text-primary-700 dark:text-primary-400" aria-hidden="true" />
                        </div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {hasAnyHistory
                            ? t('dashboard:portfolioOverview.notEnoughForPeriod', 'Not enough data for this range yet')
                            : t('dashboard:portfolioOverview.performanceNotAvailable', 'No trend data available yet')}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                          {hasAnyHistory
                            ? t('dashboard:portfolioOverview.tryLongerRange', 'Pick a longer period above, or view the full trend.')
                            : t('dashboard:portfolioOverview.addFirst', 'Start tracking to see your performance over time.')}
                        </p>
                        <Link
                          href="/portfolio/trend"
                          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-700 rounded-lg hover:bg-primary-800 transition-colors"
                        >
                          {t('dashboard:portfolioOverview.viewDetails', 'View Details')}
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* P&L calendar — 1/3 width */}
                {showCalendar && (
                  <div className="lg:col-span-1">
                    <MiniCalendarSection
                      data={allTrendData}
                      currency={currency}
                      isValueVisible={isValueVisible}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </Card>
  );
}
