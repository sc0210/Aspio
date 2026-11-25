'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowTrendingUpIcon,
  BanknotesIcon,
  ChartBarIcon,
  CalendarIcon,
  ChevronDownIcon,
  ArrowPathIcon,
  ScaleIcon
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { direction, type Direction } from '@/components/dashboard/direction';
import { areRatesLive, formatCurrency, getUnconvertedCurrencies } from '@/utils/formatters';
import { lastSessionWeekday } from '@/utils/marketStatus';
import type { PortfolioHolding } from '@/shared/types';
import { useSidebar } from '@/contexts/SidebarContext';

interface PortfolioStatsProps {
  portfolio: {
    totalValue: number;
    totalCost: number;
    totalGainLoss: number;
    gainLossPercentage: number;
    currency: string;
    lastUpdated: Date;
    todayGainLoss?: number;
    todayGainLossPercentage?: number;
    /** For the day-change label: "today" only when it is today's session. */
    holdings?: PortfolioHolding[];
  };
  isValueVisible: boolean;
  apiStatus?: 'connected' | 'disconnected' | 'loading';
  onTodayChangeClick?: () => void;
  onViewTrendClick?: () => void;
  isLoading?: boolean;
  riskMetrics?: {
    sharpeRatio?: number;
    beta?: number;
    cagr?: number;
    maxDrawdown?: number;
    annualizedVolatility?: number;
    hhi?: number;
    hhiLabel?: string;
    alpha?: number;
    benchmarkSymbol?: string;
  };
  dividendIncome?: {
    projectedAnnual: number | null;
    yieldOnCost: number | null;
    yieldOnValue: number | null;
    currency: string;
  };
  realizedPnl?: {
    realizedGainLoss: number;
    realizedCount: number;
    currency: string;
  };
}

const formatPercentage = (value: number | string) => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '0.00%';
  const shown = asShown(numValue, 2); // no "+0.00%" / "-0.00%" beside a flat figure
  return `${shown > 0 ? '+' : ''}${shown.toFixed(2)}%`;
};

// CSS-based Tooltip component (replaces framer-motion version)
function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative w-full">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
      >
        {children}
      </div>
      <div
        className={cn(
          "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg pointer-events-none transition-all duration-150",
          // Cap width so long metric descriptions wrap instead of spilling off-screen on mobile
          "w-max max-w-[min(90vw,16rem)] whitespace-normal break-words text-center",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        )}
      >
        {content}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
      </div>
    </div>
  );
}

/**
 * Why a total might not be trustworthy right now, or null when it is.
 *
 * Two separate causes, both invisible before: rates that have not arrived yet
 * (the bootstrap table is up to 8% out), and a currency nothing could price,
 * which `toTWD` passes through unconverted — a pound counted as a dollar.
 */
function useConversionNote(t: (key: string, opts?: Record<string, unknown>) => string): string | null {
  const unconverted = getUnconvertedCurrencies();
  if (unconverted.length > 0) {
    return t('portfolio:stats.unconvertedCurrencies', {
      currencies: unconverted.join(', '),
      defaultValue: 'Excludes live rates for {{currencies}}',
    });
  }
  if (!areRatesLive()) {
    return t('portfolio:stats.ratesNotLive', {
      defaultValue: 'Using approximate exchange rates',
    });
  }
  return null;
}


/**
 * A money figure rounded as it's displayed, so its colour and sign match what the
 * reader sees: halves go away from zero, as the currency formatter does, and
 * `|| 0` drops −0 (and NaN). Otherwise +0.4 reads as a green "+NT$0".
 */
function asShown(value: number, digits = 0): number {
  const scale = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale || 0;
}

/** Picks the gain, loss or flat (grey, no sign) variant for a direction. */
const toneOf = (d: Direction) => (up: string, down: string, flat: string) =>
  d === 'up' ? up : d === 'down' ? down : flat;

/** A percentage line takes its own sign as shown (2 dp), not its money figure's. */
const pctTone = (pct: number) => toneOf(direction(asShown(pct, 2)));

export function PortfolioStats({ portfolio, isValueVisible, apiStatus: _apiStatus = 'connected', onTodayChangeClick, onViewTrendClick, isLoading = false, riskMetrics, dividendIncome, realizedPnl }: PortfolioStatsProps) {
  // Get sidebar state to determine if we should show compact numbers
  const { sidebarCollapsed: _sidebarCollapsed } = useSidebar();
  const { t, i18n } = useTranslation(['portfolio']);
  const todayFiguresId = useId();
  // On a Saturday the move shown is Friday's: say so instead of "today".
  const lastSessionDay = lastSessionWeekday(portfolio.holdings ?? [], i18n?.language || 'en');
  const conversionNote = useConversionNote(t);

  const hasRiskMetrics = riskMetrics && (typeof riskMetrics.sharpeRatio === 'number' || typeof riskMetrics.beta === 'number');
  const hasCagr = typeof riskMetrics?.cagr === 'number';
  const hasDrawdown = typeof riskMetrics?.maxDrawdown === 'number';
  const hasVolatility = typeof riskMetrics?.annualizedVolatility === 'number';
  const hasAlpha = typeof riskMetrics?.alpha === 'number';
  const hasDividendIncome = typeof dividendIncome?.projectedAnnual === 'number' && dividendIncome.projectedAnnual > 0;
  const hasRealizedPnl = typeof realizedPnl?.realizedCount === 'number' && realizedPnl.realizedCount > 0;
  /**
   * Three of these figures answer the question you land on this page with —
   * what am I worth, what has it made, what did it do today. The other six
   * answer questions you ask occasionally: Sharpe, beta, drawdown,
   * volatility, alpha, dividend yield, realised P&L. The annual (time-weighted)
   * return rides in the gain card: next to "+NT$75,000 · 3.9% ROI" it says
   * whether that is good, which the gain alone cannot.
   *
   * All nine used to share a carousel showing four at a time, which hid them
   * by position rather than by importance: which ones you could not see
   * depended on your window width and which arrow you had last pressed, and
   * nothing on screen said what was off to the right. The three that are read
   * every visit are a plain grid now, and the rest sit behind a labelled
   * disclosure — the treatment the dashboard's forecast and heatmaps got.
   */
  const hasAnalysis =
    hasRiskMetrics || hasDrawdown || hasVolatility || hasAlpha || hasDividendIncome || hasRealizedPnl;

  const todayChange = portfolio.todayGainLoss ?? 0;
  const todayShown = asShown(todayChange);
  const todayDir = direction(todayShown);
  const tone = toneOf(todayDir);
  const totalShown = asShown(portfolio.totalGainLoss);
  const totalDir = direction(totalShown);
  const totalTone = toneOf(totalDir);
  const realizedShown = asShown(realizedPnl?.realizedGainLoss ?? 0);
  const realizedDir = direction(realizedShown);
  const realizedTone = toneOf(realizedDir);
  const todayChangePercent = portfolio.todayGainLossPercentage ?? 0;


  return (
    <div className="space-y-3 relative">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm z-20 rounded-xl flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <ArrowPathIcon className="w-8 h-8 text-primary-700 dark:text-primary-400 animate-spin" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Updating...</span>
          </div>
        </div>
      )}


      {/* The three that are read every visit. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Card 1: Total Value */}
            <div>
              <Tooltip content={t('portfolio:stats.totalValueTooltip')}>
                <div className="w-full relative overflow-hidden bg-gradient-to-br from-primary-50 via-white to-primary-50/30 dark:from-primary-900/10 dark:via-gray-800/50 dark:to-primary-900/5 rounded-xl p-4 border border-primary-200/50 dark:border-primary-800/30 shadow-sm hover:shadow-md transition-all duration-300 group cursor-help min-h-[110px]">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-primary-500/10 dark:bg-primary-500/15 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500"></div>
                  <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                    <div className="flex-shrink-0 p-2.5 bg-primary-100 dark:bg-primary-900/30 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300">
                      <BanknotesIcon className="w-6 h-6 text-primary-700 dark:text-primary-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs md:text-sm font-semibold text-primary-700 dark:text-primary-300 mb-1 uppercase tracking-wider">{t('portfolio:stats.totalValue')}</p>
                      <p className="text-xl sm:text-2xl md:text-2xl font-bold text-gray-900 dark:text-white">
                        {isValueVisible
                          ? formatCurrency(portfolio.totalValue, portfolio.currency, { precision: 0 })
                          : '•••••••'
                        }
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                        {t('portfolio:stats.cost')}: {isValueVisible
                          ? formatCurrency(portfolio.totalCost, portfolio.currency, { precision: 0 })
                          : '•••••••'
                        }
                      </p>
                      {/* A total is a sum across currencies, and until the rates
                          arrive it is summed with the bootstrap table — up to 8%
                          out on a euro position. Saying so is the difference
                          between an approximate figure and a wrong one. */}
                      {isValueVisible && conversionNote && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                          {conversionNote}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </Tooltip>
            </div>

            {/* Card 2: Total Gain/Loss */}
            <div>
              <Tooltip content={t('portfolio:stats.totalGainTooltip')}>
                <div className={cn(
                  "w-full relative overflow-hidden rounded-xl p-4 border shadow-sm hover:shadow-md transition-all duration-300 group min-h-[110px]",
                  totalTone('bg-gradient-to-br from-rise-50 via-white to-rise-50/30 dark:from-rise-900/10 dark:via-gray-800/50 dark:to-rise-900/5 border-rise-200/50 dark:border-rise-800/30', 'bg-gradient-to-br from-fall-50 via-white to-fall-50/30 dark:from-fall-900/10 dark:via-gray-800/50 dark:to-fall-900/5 border-fall-200/50 dark:border-fall-800/30', 'bg-gradient-to-br from-gray-50 via-white to-gray-50/30 dark:from-gray-800/40 dark:via-gray-800/50 dark:to-gray-800/20 border-gray-200 dark:border-gray-700')
                )}>
                  <div className={cn(
                    "absolute top-0 right-0 w-20 h-20 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500",
                    totalTone('bg-rise-500/10 dark:bg-rise-500/15', 'bg-fall-500/10 dark:bg-fall-500/15', 'bg-gray-500/10 dark:bg-gray-500/15')
                  )}></div>
                  <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                    <div className={cn(
                      'flex-shrink-0 p-2.5 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300',
                      totalTone('bg-rise-100 dark:bg-rise-900/30', 'bg-fall-100 dark:bg-fall-900/30', 'bg-gray-100 dark:bg-gray-700/40')
                    )}>
                      <ChartBarIcon className={cn(
                        'w-6 h-6',
                        totalTone('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                      )} />
                    </div>
                    <div className="flex-1">
                      <p className={cn(
                        'text-xs md:text-sm font-semibold mb-1 uppercase tracking-wider',
                        totalTone('text-rise-700 dark:text-rise-300', 'text-fall-700 dark:text-fall-300', 'text-gray-600 dark:text-gray-300')
                      )}>{ t('portfolio:stats.totalGain')}</p>
                      <div className="flex items-center gap-2">
                        <p className={cn(
                          'text-xl sm:text-2xl md:text-2xl font-bold',
                          totalTone('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                        )}>
                          {isValueVisible
                            ? `${totalDir === 'up' ? '+' : ''}${formatCurrency(totalShown, portfolio.currency, { precision: 0 })}`
                            : '•••••••'
                          }
                        </p>
                      </div>
                      <p className={cn(
                        'text-xs mt-0.5 font-semibold',
                        pctTone(portfolio.gainLossPercentage)('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                      )}>
                        {isValueVisible
                          ? `${formatPercentage(portfolio.gainLossPercentage)} ${t('portfolio:stats.roi')}`
                          : '•••%'
                        }
                      </p>
                      {hasCagr && (
                        <p className="text-xs mt-0.5 text-gray-600 dark:text-gray-300 tabular-nums">
                          {t('portfolio:stats.annualReturnInline', {
                            value: isValueVisible
                              ? `${asShown(riskMetrics!.cagr!, 1) > 0 ? '+' : ''}${asShown(riskMetrics!.cagr!, 1).toFixed(1)}%`
                              : '•••%',
                            defaultValue: 'Annual return {{value}} · time-weighted',
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </Tooltip>
            </div>

            {/* Card 3: Today's Performance */}
            <div>
              <Tooltip content={t('portfolio:stats.todayChangeTooltip')}>
                <div
                  className={cn(
                    "w-full relative overflow-hidden rounded-xl p-4 border shadow-sm transition-all duration-300 group min-h-[110px]",
                    onTodayChangeClick ? "cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]" : "cursor-help hover:shadow-md",
                    tone('bg-gradient-to-br from-rise-50 via-white to-rise-50/30 dark:from-rise-900/10 dark:via-gray-800/50 dark:to-rise-900/5 border-rise-200/50 dark:border-rise-800/30', 'bg-gradient-to-br from-fall-50 via-white to-fall-50/30 dark:from-fall-900/10 dark:via-gray-800/50 dark:to-fall-900/5 border-fall-200/50 dark:border-fall-800/30', 'bg-gradient-to-br from-gray-50 via-white to-gray-50/30 dark:from-gray-800/40 dark:via-gray-800/50 dark:to-gray-800/20 border-gray-200 dark:border-gray-700')
                  )}>
                  {/* The whole card opens the daily chart. A sibling button over the
                      card, not the card itself, so the Trend button is not nested
                      inside another button; it sits above this one (z-10). */}
                  {onTodayChangeClick && (
                    <button
                      type="button"
                      onClick={onTodayChangeClick}
                      aria-label={t('portfolio:stats.viewDailyTooltip')}
                      aria-describedby={todayFiguresId}
                      className="absolute inset-0 z-[5] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    />
                  )}
                  {/* View Trend quick link */}
                  {onViewTrendClick && (
                    <button
                      type="button"
                      onClick={onViewTrendClick}
                      className={cn(
                        'absolute top-2.5 right-2.5 z-10 flex items-center gap-1 px-2 py-1 rounded-lg text-xs sm:text-xs font-semibold',
                        // Always visible: hover-only, touch and keyboard users never found it.
                        'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        'backdrop-blur-sm shadow-sm border',
                        tone('bg-rise-100/80 dark:bg-rise-900/40 text-rise-700 dark:text-rise-300 border-rise-200/60 dark:border-rise-700/40 hover:bg-rise-200/80 dark:hover:bg-rise-800/50', 'bg-fall-100/80 dark:bg-fall-900/40 text-fall-700 dark:text-fall-300 border-fall-200/60 dark:border-fall-700/40 hover:bg-fall-200/80 dark:hover:bg-fall-800/50', 'bg-gray-100/80 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 border-gray-200/60 dark:border-gray-700/40 hover:bg-gray-200/80 dark:hover:bg-gray-700/50')
                      )}
                      title={t('portfolio:stats.viewTrendTooltip')}
                    >
                      <ArrowTrendingUpIcon className="w-3 h-3" />
                      <span>{t('portfolio:stats.trend')}</span>
                    </button>
                  )}
                  <div className={cn(
                    "absolute top-0 right-0 w-20 h-20 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500",
                    tone('bg-rise-500/10 dark:bg-rise-500/15', 'bg-fall-500/10 dark:bg-fall-500/15', 'bg-gray-500/10 dark:bg-gray-500/15')
                  )}></div>
                  <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                    <div className={cn(
                      'flex-shrink-0 p-2.5 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300',
                      tone('bg-rise-100 dark:bg-rise-900/30', 'bg-fall-100 dark:bg-fall-900/30', 'bg-gray-100 dark:bg-gray-700/40')
                    )}>
                      <CalendarIcon className={cn(
                        'w-6 h-6',
                        tone('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                      )} />
                    </div>
                    <div id={todayFiguresId} className="flex-1 min-w-0">
                      {/* Only the label line clears the always-visible Trend pill (top-right). */}
                      <p className={cn(
                        "text-xs md:text-sm font-semibold mb-1 uppercase tracking-wider",
                        onViewTrendClick && 'pr-16',
                        tone('text-rise-700 dark:text-rise-300', 'text-fall-700 dark:text-fall-300', 'text-gray-600 dark:text-gray-300')
                      )}>{lastSessionDay
                        ? t('portfolio:stats.lastSessionChange', { day: lastSessionDay, defaultValue: 'Change · {{day}}' })
                        : t('portfolio:stats.todayChange')}</p>
                      <div className="flex items-center gap-2 transition-all duration-200">
                        <p className={cn(
                          'text-xl sm:text-2xl md:text-2xl font-bold tabular-nums',
                          tone('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                        )}>
                          {isValueVisible
                            ? `${todayDir === 'up' ? '+' : ''}${formatCurrency(todayShown, portfolio.currency, { precision: 0 })}`
                            : '•••••••'
                          }
                        </p>
                      </div>
                      <p className={cn(
                        'text-xs mt-0.5 font-semibold',
                        pctTone(todayChangePercent)('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                      )}>
                        {isValueVisible
                          ? `${formatPercentage(todayChangePercent)}`
                          : '•••%'
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </Tooltip>
            </div>

      </div>

      {/* ========== ANALYSIS ==========
          Questions you ask occasionally rather than on landing. Closed by
          default; <details> keeps the toggle keyboard-accessible with no
          state of ours, and everything inside still mounts when it opens. */}
      {hasAnalysis && (
        <details className="group">
          <summary className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:border-primary-300 dark:hover:border-primary-600 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t('portfolio:stats.analysisTitle')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {t('portfolio:stats.analysisSubtitle')}
              </p>
            </div>
            <ChevronDownIcon className="w-5 h-5 flex-shrink-0 text-gray-500 dark:text-gray-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
            {/* Card 4: Risk Metrics (Sharpe Ratio + Beta) */}
            {hasRiskMetrics && (
              <div>
                <Tooltip content={t('portfolio:stats.riskTooltip')}>
                  <div className="w-full relative overflow-hidden bg-gradient-to-br from-violet-50 via-white to-violet-50/30 dark:from-violet-900/10 dark:via-gray-800/50 dark:to-violet-900/5 rounded-xl p-4 border border-violet-200/50 dark:border-violet-800/30 shadow-sm hover:shadow-md transition-all duration-300 group cursor-help min-h-[110px]">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-violet-500/10 dark:bg-violet-500/15 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500"></div>
                    <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                      <div className="flex-shrink-0 p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300">
                        <ScaleIcon className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs md:text-sm font-semibold text-violet-700 dark:text-violet-300 mb-1 uppercase tracking-wider">{t('portfolio:stats.riskMetricsLabel')}</p>
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('portfolio:riskMetrics.sharpe')}</p>
                            {typeof riskMetrics?.sharpeRatio === 'number' ? (
                              <>
                                <p className={cn(
                                  'text-lg font-bold tabular-nums',
                                  riskMetrics.sharpeRatio > 1
                                    ? 'text-success-700 dark:text-success-400'
                                    : riskMetrics.sharpeRatio > 0
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-error-700 dark:text-error-400'
                                )}>
                                  {riskMetrics.sharpeRatio.toFixed(2)}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {riskMetrics.sharpeRatio > 2 ? t('portfolio:riskMetrics.sharpeExcellent') : riskMetrics.sharpeRatio > 1 ? t('portfolio:riskMetrics.sharpeGood') : riskMetrics.sharpeRatio > 0 ? t('portfolio:riskMetrics.sharpeFair') : t('portfolio:riskMetrics.sharpePoor')}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-lg font-bold text-gray-500 dark:text-gray-400">N/A</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{t('portfolio:riskMetrics.needData')}</p>
                              </>
                            )}
                          </div>
                          <div className="w-px h-10 bg-gray-200 dark:bg-gray-600" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('portfolio:riskMetrics.beta')}</p>
                            {typeof riskMetrics?.beta === 'number' ? (
                              <>
                                <p className={cn(
                                  'text-lg font-bold tabular-nums',
                                  riskMetrics.beta < 0.8
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : riskMetrics.beta <= 1.2
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-error-700 dark:text-error-400'
                                )}>
                                  {riskMetrics.beta.toFixed(2)}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {riskMetrics.beta < 0.5 ? t('portfolio:riskMetrics.betaDefensive') : riskMetrics.beta < 0.8 ? t('portfolio:riskMetrics.betaLowVol') : riskMetrics.beta <= 1.2 ? t('portfolio:riskMetrics.betaMarket') : t('portfolio:riskMetrics.betaHighVol')}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-lg font-bold text-gray-500 dark:text-gray-400">N/A</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{t('portfolio:riskMetrics.noSpyData')}</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </div>
            )}

            {/* Card 6: Drawdown + Volatility */}
            {(hasDrawdown || hasVolatility) && (
              <div>
                <Tooltip content={t('portfolio:stats.drawdownTooltip')}>
                  <div className="w-full relative overflow-hidden bg-gradient-to-br from-rose-50 via-white to-rose-50/30 dark:from-rose-900/10 dark:via-gray-800/50 dark:to-rose-900/5 rounded-xl p-4 border border-rose-200/50 dark:border-rose-800/30 shadow-sm hover:shadow-md transition-all duration-300 group cursor-help min-h-[110px]">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-error-500/10 dark:bg-error-500/15 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500" />
                    <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                      <div className="flex-shrink-0 p-2.5 bg-error-100 dark:bg-error-900/30 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300">
                        <ChartBarIcon className="w-6 h-6 text-error-700 dark:text-error-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs md:text-sm font-semibold text-error-700 dark:text-error-300 mb-1 uppercase tracking-wider">{t('portfolio:stats.drawdownLabel')}</p>
                        <div className="flex items-center gap-3">
                          {hasDrawdown && (
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('portfolio:stats.maxDrawdown')}</p>
                              <p className="text-lg font-bold tabular-nums text-error-700 dark:text-error-400">
                                {isValueVisible ? `${riskMetrics!.maxDrawdown!.toFixed(1)}%` : '•••%'}
                              </p>
                            </div>
                          )}
                          {hasDrawdown && hasVolatility && (
                            <div className="w-px h-10 bg-gray-200 dark:bg-gray-600" />
                          )}
                          {hasVolatility && (
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('portfolio:stats.volatility')}</p>
                              <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">
                                {isValueVisible ? `${riskMetrics!.annualizedVolatility!.toFixed(1)}%` : '•••%'}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </div>
            )}

            {/* Card 8: Dividend Income */}
            {hasDividendIncome && (
              <div>
                <Tooltip content={t('portfolio:stats.dividendTooltip')}>
                  <div className="w-full relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-indigo-50/30 dark:from-indigo-900/10 dark:via-gray-800/50 dark:to-indigo-900/5 rounded-xl p-4 border border-indigo-200/50 dark:border-indigo-800/30 shadow-sm hover:shadow-md transition-all duration-300 group cursor-help min-h-[110px]">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500" />
                    <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                      <div className="flex-shrink-0 p-2.5 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300">
                        <BanknotesIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs md:text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-1 uppercase tracking-wider">{t('portfolio:stats.dividendLabel')}</p>
                        <p className="text-xl sm:text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                          {isValueVisible
                            ? formatCurrency(dividendIncome!.projectedAnnual!, dividendIncome!.currency, { precision: 0 })
                            : '•••••••'
                          }
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {typeof dividendIncome?.yieldOnCost === 'number' && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {t('portfolio:stats.yieldOnCost')}: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{dividendIncome.yieldOnCost.toFixed(2)}%</span>
                            </p>
                          )}
                          {typeof dividendIncome?.yieldOnValue === 'number' && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {t('portfolio:stats.yieldOnValue')}: <span className="font-semibold text-success-700 dark:text-success-400">{dividendIncome.yieldOnValue.toFixed(2)}%</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </div>
            )}

            {/* Card 9: Realized P&L (from completed sells) */}
            {hasRealizedPnl && (
              <div>
                <Tooltip content={t('portfolio:stats.realizedTooltip', { count: realizedPnl!.realizedCount })}>
                  <div className={cn(
                    "w-full relative overflow-hidden rounded-xl p-4 border shadow-sm hover:shadow-md transition-all duration-300 group cursor-help min-h-[110px]",
                    realizedTone('bg-gradient-to-br from-rise-50 via-white to-rise-50/30 dark:from-rise-900/10 dark:via-gray-800/50 dark:to-rise-900/5 border-rise-200/50 dark:border-rise-800/30', 'bg-gradient-to-br from-fall-50 via-white to-fall-50/30 dark:from-fall-900/10 dark:via-gray-800/50 dark:to-fall-900/5 border-fall-200/50 dark:border-fall-800/30', 'bg-gradient-to-br from-gray-50 via-white to-gray-50/30 dark:from-gray-800/40 dark:via-gray-800/50 dark:to-gray-800/20 border-gray-200 dark:border-gray-700')
                  )}>
                    <div className={cn(
                      "absolute top-0 right-0 w-20 h-20 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500",
                      realizedTone('bg-rise-500/10 dark:bg-rise-500/15', 'bg-fall-500/10 dark:bg-fall-500/15', 'bg-gray-500/10 dark:bg-gray-500/15')
                    )} />
                    <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                      <div className={cn(
                        "flex-shrink-0 p-2.5 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300",
                        realizedTone('bg-rise-100 dark:bg-rise-900/30', 'bg-fall-100 dark:bg-fall-900/30', 'bg-gray-100 dark:bg-gray-700/40')
                      )}>
                        <ArrowTrendingUpIcon className={cn(
                          "w-6 h-6",
                          realizedTone('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                        )} />
                      </div>
                      <div className="flex-1">
                        <p className={cn(
                          "text-xs md:text-sm font-semibold mb-1 uppercase tracking-wider",
                          realizedTone('text-rise-700 dark:text-rise-300', 'text-fall-700 dark:text-fall-300', 'text-gray-600 dark:text-gray-300')
                        )}>{t('portfolio:stats.realizedLabel')}</p>
                        <p className={cn(
                          "text-xl sm:text-2xl font-bold tabular-nums",
                          realizedTone('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                        )}>
                          {isValueVisible
                            ? `${realizedDir === 'up' ? '+' : ''}${formatCurrency(realizedShown, realizedPnl!.currency, { precision: 0 })}`
                            : '•••••••'
                          }
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {t('portfolio:stats.sellCount', { count: realizedPnl!.realizedCount })}
                        </p>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </div>
            )}

            {/* Card 7: Alpha vs benchmark */}
            {hasAlpha && (
              <div>
                <Tooltip content={t('portfolio:stats.alphaTooltip', { benchmark: riskMetrics?.benchmarkSymbol ?? 'SPY' })}>
                  <div className="w-full relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-sky-50/30 dark:from-sky-900/10 dark:via-gray-800/50 dark:to-sky-900/5 rounded-xl p-4 border border-sky-200/50 dark:border-sky-800/30 shadow-sm hover:shadow-md transition-all duration-300 group cursor-help min-h-[110px]">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-sky-500/10 dark:bg-sky-500/15 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500" />
                    <div className="relative flex items-center gap-2 sm:gap-2.5 md:gap-3">
                      <div className="flex-shrink-0 p-2.5 bg-sky-100 dark:bg-sky-900/30 rounded-lg shadow-sm group-hover:scale-110 transition-transform duration-300">
                        <ScaleIcon className="w-6 h-6 text-sky-700 dark:text-sky-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs md:text-sm font-semibold text-sky-700 dark:text-sky-300 mb-1 uppercase tracking-wider">
                          {t('portfolio:stats.alphaLabel', { benchmark: riskMetrics?.benchmarkSymbol ?? 'SPY' })}
                        </p>
                        <p className={cn(
                          'text-xl sm:text-2xl font-bold tabular-nums',
                          toneOf(direction(asShown(riskMetrics!.alpha!, 2)))('text-rise-700 dark:text-rise-400', 'text-fall-700 dark:text-fall-400', 'text-gray-500 dark:text-gray-400')
                        )}>
                          {isValueVisible
                            ? `${asShown(riskMetrics!.alpha!, 2) > 0 ? '+' : ''}${asShown(riskMetrics!.alpha!, 2).toFixed(2)}%`
                            : '•••%'
                          }
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {riskMetrics!.alpha! >= 0
                            ? t('portfolio:stats.outperforming')
                            : t('portfolio:stats.underperforming')}
                        </p>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
