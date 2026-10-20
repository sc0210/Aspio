'use client';

import { useMemo, useState, useEffect, useId, useRef, memo, useCallback } from 'react';
import {
    ComposedChart,
    Area,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceDot,
    Brush,
    ResponsiveContainer,
} from 'recharts';
import {
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
    BanknotesIcon,
    ChartBarSquareIcon,
    InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import { getLocaleByLanguage } from '@/lib/i18n';

/**
 * Hover/tap/focus explanation for a summary card.
 *
 * These cards carry the sentence that says why their number differs from the
 * page's live headline — that explanation IS the fix, so it cannot be a native
 * `title`: those never fire on touch, are unreachable by keyboard on a plain
 * div, and go unannounced by most screen readers. A focusable button with a
 * real tooltip reaches all three.
 */
function InfoHint({ label, text }: { label: string; text: string }) {
    // Hover, focus and tap open the hint independently. A single `open` boolean
    // toggled by onClick would close it on the very interactions this exists
    // for: browsers fire mouseenter→click on a tap and focus→click on Enter, so
    // the click inverts the `true` hover/focus just set and the hint vanishes.
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [pinned, setPinned] = useState(false);
    const open = hovered || focused || pinned;
    const tooltipId = useId();
    const containerRef = useRef<HTMLSpanElement>(null);

    // Dismissing a tap cannot rest on mouseleave: mobile browsers synthesise the
    // mouse events inconsistently and many never fire it on the previously
    // tapped element, which would strand the hint open with no way to close it.
    // An outside pointerdown is the one signal every device actually sends.
    //
    // The bubble itself counts as "outside" by design: it is pointer-events-none
    // (as in PortfolioStats and the shared CSSAnimations tooltip), so a tap on it
    // hit-tests through to whatever sits behind and dismisses. That is deliberate
    // — making it interactive would have an absolutely-positioned overlay swallow
    // taps on the card it covers for as long as it is open, and there is nothing
    // in the bubble to interact with.
    useEffect(() => {
        if (!open) return;
        const closeOnOutside = (e: Event) => {
            if (!containerRef.current?.contains(e.target as Node)) {
                setHovered(false);
                setFocused(false);
                setPinned(false);
            }
        };
        document.addEventListener('pointerdown', closeOnOutside);
        return () => document.removeEventListener('pointerdown', closeOnOutside);
    }, [open]);

    return (
        <span className="relative inline-flex" ref={containerRef}>
            <button
                type="button"
                aria-label={label}
                aria-expanded={open}
                // aria-label alone announces only "About <card>" — the sentence
                // itself has to be wired up, or a screen-reader user still never
                // hears it and this is no better than the `title` it replaced.
                aria-describedby={open ? tooltipId : undefined}
                // A tap synthesises mouseenter + click, so it opens the hint and
                // leaves it open. Keyboard: focus opens, blur closes, and Enter's
                // click only moves `pinned`, which `focused` already holds true.
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => { setHovered(false); setPinned(false); }}
                onClick={() => setPinned(p => !p)}
                onFocus={() => setFocused(true)}
                onBlur={() => { setFocused(false); setPinned(false); }}
                className="text-gray-500 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
                <InformationCircleIcon className="w-3.5 h-3.5" />
            </button>
            {open && (
                <span
                    role="tooltip"
                    id={tooltipId}
                    className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg pointer-events-none w-max max-w-[min(80vw,15rem)] whitespace-normal break-words text-left normal-case tracking-normal"
                >
                    {text}
                </span>
            )}
        </span>
    );
}

export interface AssetTrendDataPoint {
    date: string;
    /** True while the day is priced from a live quote rather than a published
     *  close — the US session ends after midnight in Taipei, so the most recent
     *  day keeps moving until its close lands. */
    provisional?: boolean;
    value: number;
    costBasis?: number;
    change: number;
    changePercent: number;
    capitalAdded?: number;
    purchases?: Array<{
        symbol: string;
        name: string;
        cost: number;
    }>;
    topHoldings?: Array<{
        symbol: string;
        change: number;
        value: number;
    }>;
    returnAmount?: number;
    returnPercent?: number;
    periodReturnPct?: number;
    benchmarkReturnPct?: number;
    fullDate?: Date;
    fullDateStr?: string;
    _sellAmount?: number;
}

interface PortfolioOverviewStats {
    totalValue: number;
    totalCost: number;
    totalGainLoss: number;
    gainLossPercentage: number;
}

export interface BenchmarkDataPoint {
    date: string;
    close: number;
    returnPct: number;
}

export interface BenchmarkSeries {
    symbol: string;
    name: string;
    color: string;
    points: BenchmarkDataPoint[];
}

interface AssetTrendChartProps {
    data: AssetTrendDataPoint[];
    currency?: string;
    isValueVisible?: boolean;
    className?: string;
    /**
     * Page-level portfolio stats. Only the "(tradable assets)" legend caption
     * reads this — the summary cards deliberately do NOT fall back to it (see
     * the comment above `displayCurrentValue`), so passing it will not make
     * them match a page headline. No caller passes it today.
     */
    portfolioStats?: PortfolioOverviewStats;
    /** Benchmark comparison series (normalized % return from period start) */
    benchmark?: BenchmarkSeries | null;
    /** Hide the summary stats cards above the chart (useful when parent already shows them) */
    showSummary?: boolean;
    /**
     * All-time return % over the caller's FULL series. `data` is usually a
     * period slice, and without backend cost basis the chart rebuilds cost from
     * the slice's first value — so the "all-time" line would just repeat the
     * period return. When omitted, falls back to the slice's own figure.
     */
    allTimeReturnPercent?: number | null;
    /** Hide the view-mode toggle and brush controls (for dashboard widget use) */
    showControls?: boolean;
}

type ViewMode = 'value' | 'return';

export const AssetTrendChart = memo(function AssetTrendChart({
    data,
    currency = 'TWD',
    isValueVisible = true,
    className,
    portfolioStats: externalStats,
    benchmark,
    allTimeReturnPercent: allTimeReturnPercentProp,
    showSummary = true,
    showControls = true,
}: AssetTrendChartProps) {
    const { t, i18n } = useTranslation('portfolio');
    // Dates were pinned to 'en-US', so a zh-TW reader got English month names
    // on every axis tick and hover row of an otherwise translated chart.
    const dateLocale = getLocaleByLanguage(i18n.language);
    const [viewMode, setViewMode] = useState<ViewMode>('value');

    // Auto-switch to return % mode when a benchmark is selected
    useEffect(() => {
        if (benchmark) setViewMode('return');
    }, [benchmark]);
    const [brushEnabled, setBrushEnabled] = useState(false);

    // Process data: use backend-provided costBasis or fall back to capitalAdded accumulation
    const { chartData, stats, capitalEvents } = useMemo(() => {
        if (!Array.isArray(data) || data.length === 0) {
            return { chartData: [], stats: null, capitalEvents: { buys: [] as Array<{ date: string; amount: number; index: number }>, sells: [] as Array<{ date: string; amount: number; index: number }> } };
        }

        // Check if backend provides costBasis directly
        const hasBackendCostBasis = data.some(d => d.costBasis != null && d.costBasis > 0);

        let fallbackCumulativeCost = 0;
        const buyEvents: Array<{ date: string; amount: number; index: number }> = [];
        const sellEvents: Array<{ date: string; amount: number; index: number }> = [];

        const processed = data.map((item, index) => {
            const value = Number(item.value) || 0;
            const capitalAdded = Number(item.capitalAdded) || 0;

            // Determine cost basis for this data point
            let costBasis: number;
            if (hasBackendCostBasis) {
                // Use the accurate backend-computed cumulative cost basis
                costBasis = Number(item.costBasis) || 0;
            } else {
                // Fallback: accumulate from capitalAdded (less accurate for partial date ranges)
                if (index === 0) {
                    fallbackCumulativeCost = capitalAdded > 0 ? capitalAdded : value;
                } else {
                    fallbackCumulativeCost += capitalAdded;
                }
                costBasis = fallbackCumulativeCost;
            }

            // Track capital addition events (buys)
            if (capitalAdded > 0 && index > 0) {
                buyEvents.push({ date: item.date, amount: capitalAdded, index });
            }

            // Detect sell events from cost basis decrease between consecutive days
            let sellAmount = 0;
            if (hasBackendCostBasis && index > 0) {
                const prevCostBasis = Number(data[index - 1].costBasis) || 0;
                if (prevCostBasis > 0 && costBasis < prevCostBasis && capitalAdded === 0) {
                    sellAmount = prevCostBasis - costBasis;
                    sellEvents.push({ date: item.date, amount: sellAmount, index });
                }
            }

            // Parse date
            const [year, month, day] = item.date.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day);

            const returnAmount = value - costBasis;
            const returnPercent = costBasis > 0 ? (returnAmount / costBasis) * 100 : 0;
            // Period-normalized return: % gain from first data point's value (same baseline as benchmark)
            const firstValue = Number(data[0]?.value) || value;
            const periodReturnPct = firstValue > 0 ? ((value - firstValue) / firstValue) * 100 : 0;

            return {
                ...item,
                value,
                costBasis,
                returnAmount,
                returnPercent,
                periodReturnPct,
                capitalAdded,
                _sellAmount: sellAmount,
                displayDate: dateObj.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' }),
                fullDate: dateObj,
                fullDateStr: item.date,
            };
        });

        // Calculate period stats
        const firstPoint = processed[0];
        const lastPoint = processed[processed.length - 1];
        const totalReturn = lastPoint.value - lastPoint.costBasis;
        const totalReturnPercent = lastPoint.costBasis > 0
            ? (totalReturn / lastPoint.costBasis) * 100
            : 0;
        const periodChange = lastPoint.value - firstPoint.value;
        // Net new capital contributed during the period (cumulative cost delta).
        // Without this, a portfolio grown by deposits reports a wildly inflated
        // "return" (e.g. +1976%) and a near-zero start blows the figure up.
        let periodCapitalAdded = lastPoint.costBasis - firstPoint.costBasis;
        if (!Number.isFinite(periodCapitalAdded) || periodCapitalAdded < 0) periodCapitalAdded = 0;
        // True investment gain over the period (value change minus contributions).
        const periodGain = periodChange - periodCapitalAdded;
        // Simple Dietz return: weight contributions at half the period so the
        // percentage stays meaningful even when starting from ~$0.
        const periodReturnBase = firstPoint.value + periodCapitalAdded / 2;
        const periodChangePercent = periodReturnBase > 1
            ? (periodGain / periodReturnBase) * 100
            : 0;
        const totalCapitalAdded = buyEvents.reduce((sum, e) => sum + e.amount, 0);
        const totalCapitalRemoved = sellEvents.reduce((sum, e) => sum + e.amount, 0);

        // Find peak and trough
        let peakValue = -Infinity;
        let troughValue = Infinity;
        processed.forEach(p => {
            if (p.value > peakValue) peakValue = p.value;
            if (p.value < troughValue) troughValue = p.value;
        });

        return {
            chartData: processed,
            stats: {
                currentValue: lastPoint.value,
                costBasis: lastPoint.costBasis,
                totalReturn,
                totalReturnPercent,
                periodChange,
                periodChangePercent,
                periodGain,
                totalCapitalAdded,
                totalCapitalRemoved,
                buyEventCount: buyEvents.length,
                sellEventCount: sellEvents.length,
                peakValue,
                troughValue,
                maxDrawdown: peakValue > 0 ? ((troughValue - peakValue) / peakValue) * 100 : 0,
            },
            capitalEvents: { buys: buyEvents, sells: sellEvents },
        };
    }, [data, dateLocale]);

    // Merge benchmark returnPct into chartData by date
    const mergedChartData = useMemo(() => {
        if (!benchmark?.points?.length) return chartData;
        const benchMap = new Map(benchmark.points.map(p => [p.date, p.returnPct]));
        return chartData.map(d => ({
            ...d,
            benchmarkReturnPct: benchMap.get(d.fullDateStr) ?? null,
        }));
    }, [chartData, benchmark]);

    const CustomTooltip = useCallback(({ active, payload }: { active?: boolean; payload?: Array<{ payload: AssetTrendDataPoint }> }) => {
        if (!active || !payload || !payload.length) return null;

        const d = payload[0].payload;
        const isPositive = (d.returnAmount ?? 0) >= 0;

        return (
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg p-4 min-w-[260px] max-w-[340px] backdrop-blur-sm bg-opacity-95 dark:bg-opacity-95">
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                    <time className="text-sm font-bold text-gray-900 dark:text-white" dateTime={d.fullDateStr}>
                        {d.fullDate?.toLocaleDateString(dateLocale, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                        })}
                    </time>
                </div>

                <div className="space-y-2.5">
                    {/* Portfolio Value */}
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('portfolio:trend.tooltipValueOnDate')}
                        </span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                            {isValueVisible ? formatCurrency(d.value, currency) : '•••••'}
                        </span>
                    </div>

                    {/* Cost Basis */}
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('portfolio:trend.summaryInvestedCapital')}
                        </span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                            {isValueVisible ? formatCurrency(d.costBasis ?? 0, currency) : '•••••'}
                        </span>
                    </div>

                    {/* Return */}
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {benchmark ? t('portfolio:trend.summaryPeriodReturn') : t('portfolio:trend.summaryReturn')}
                        </span>
                        <span className={cn(
                            'text-sm font-bold tabular-nums',
                            isPositive ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400'
                        )}>
                            {isValueVisible ? (
                                benchmark ? (
                                    // Period-normalized % when benchmark is active
                                    <>{(d.periodReturnPct ?? 0) >= 0 ? '+' : ''}{d.periodReturnPct?.toFixed(2)}%</>
                                ) : (
                                    <>
                                        {isPositive ? '+' : ''}{formatCurrency(d.returnAmount ?? 0, currency)}
                                        <span className="text-xs ml-1">
                                            ({isPositive ? '+' : ''}{(d.returnPercent ?? 0).toFixed(2)}%)
                                        </span>
                                    </>
                                )
                            ) : '•••••'}
                        </span>
                    </div>

                    {/* Daily Change */}
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('portfolio:trend.tooltipDayChange')}
                        </span>
                        <span className={cn(
                            'text-xs font-bold tabular-nums',
                            d.change >= 0 ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400'
                        )}>
                            {isValueVisible ? (
                                <>
                                    {d.change >= 0 ? '+' : ''}{formatCurrency(d.change, currency)}
                                    <span className="ml-1">({d.change >= 0 ? '+' : ''}{d.changePercent.toFixed(2)}%)</span>
                                </>
                            ) : '•••'}
                        </span>
                    </div>

                    {/* Capital Added (Buy) */}
                    {(d.capitalAdded ?? 0) > 0 && (
                        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex justify-between items-center gap-4">
                                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
                                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                                    {t('portfolio:trend.tooltipBought')}
                                </span>
                                <span className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                                    {isValueVisible ? `+${formatCurrency(d.capitalAdded ?? 0, currency)}` : '•••••'}
                                </span>
                            </div>
                            {/* Per-asset purchase details */}
                            {isValueVisible && d.purchases && d.purchases.length > 0 && (
                                <div className="mt-1.5 space-y-1 pl-3.5">
                                    {(d.purchases as Array<{ symbol: string; name: string; cost: number }>).map((p, idx: number) => (
                                        <div key={idx} className="flex justify-between items-center gap-3">
                                            <span className="text-[11px] text-blue-500 dark:text-blue-300 truncate max-w-[160px]" title={p.name}>
                                                {p.symbol} <span className="text-gray-500 dark:text-gray-500 font-normal">{p.name !== p.symbol ? p.name : ''}</span>
                                            </span>
                                            <span className="text-[11px] font-semibold text-blue-500 dark:text-blue-300 tabular-nums flex-shrink-0">
                                                {formatCurrency(p.cost, currency)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Capital Removed (Sell) — detected from cost basis decrease */}
                    {(d._sellAmount ?? 0) > 0 && (
                        <div className="flex justify-between items-center gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wider flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
                                {t('portfolio:trend.tooltipSold')}
                            </span>
                            <span className="text-sm font-bold text-orange-700 dark:text-orange-400 tabular-nums">
                                {isValueVisible ? `-${formatCurrency(d._sellAmount ?? 0, currency)}` : '•••••'}
                            </span>
                        </div>
                    )}

                    {/* Benchmark Return */}
                    {benchmark && d.benchmarkReturnPct != null && (
                        <div className="flex justify-between items-center gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: benchmark.color }}>
                                {benchmark.symbol}
                            </span>
                            <span className="text-sm font-bold tabular-nums" style={{ color: benchmark.color }}>
                                {d.benchmarkReturnPct >= 0 ? '+' : ''}{d.benchmarkReturnPct.toFixed(2)}%
                            </span>
                        </div>
                    )}

                    {/* Top Holdings */}
                    {d.topHoldings && d.topHoldings.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                {t('portfolio:trend.topMovers')}
                            </p>
                            <div className="space-y-1" role="list">
                                {(d.topHoldings as Array<{ symbol: string; change: number }>).slice(0, 3).map((holding, idx: number) => (
                                    <div key={idx} className="flex justify-between items-center gap-3" role="listitem">
                                        <span className="text-xs font-bold text-gray-800 dark:text-gray-200 tracking-wide">
                                            {holding.symbol}
                                        </span>
                                        <span className={cn(
                                            'text-xs font-bold tabular-nums',
                                            holding.change >= 0 ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400'
                                        )}>
                                            {isValueVisible ? `${holding.change >= 0 ? '+' : ''}${formatCurrency(holding.change, currency)}` : '•••'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }, [currency, isValueVisible, benchmark, t, dateLocale]);

    if (!chartData.length) {
        return (
            <div className={cn('flex flex-col items-center justify-center py-16 px-4', className)} role="status">
                <div className="text-center max-w-sm">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <ChartBarSquareIcon className="w-8 h-8 text-gray-500 dark:text-gray-600" />
                    </div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('portfolio:trend.noData')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('portfolio:trend.noDataHint')}
                    </p>
                </div>
            </div>
        );
    }

    // Always align summary cards with plotted trend-series values
    const displayCurrentValue = stats?.currentValue ?? externalStats?.totalValue ?? 0;
    const displayCostBasis = stats?.costBasis ?? externalStats?.totalCost ?? 0;
    const displayTotalReturn = stats?.totalReturn ?? externalStats?.totalGainLoss ?? 0;
    const displayReturnPercent = stats?.totalReturnPercent ?? externalStats?.gainLossPercentage ?? 0;
    const isPositiveReturn = displayTotalReturn >= 0;
    const allTimePercent = allTimeReturnPercentProp ?? displayReturnPercent;
    // "Period Return" reflects investment performance (gain net of contributions),
    // so its sign and $ subtitle track periodGain rather than the raw value delta.
    const isPositivePeriod = (stats?.periodGain ?? 0) >= 0;

    // Pre-compute Y domain from trough/peak to avoid Recharts function-domain edge cases
    const yDomain: [number | string, number | string] = viewMode === 'return'
        ? ['auto', 'auto']
        : stats
            ? [Math.round(stats.troughValue * 0.97), Math.round(stats.peakValue * 1.02)]
            : ['auto', 'auto'];

    return (
        <div className={cn('flex flex-col', className)}>
            {/* Summary Stats */}
            {showSummary && stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    {/* Period-end value — deliberately NOT the live total.
                        displayCurrentValue is the last plotted point so the card
                        matches the line above it; PortfolioStats shows today's
                        live figure a few inches away. Labelled to say which. */}
                    <div className="bg-gray-50/80 dark:bg-gray-800/60 rounded-xl p-3 border border-gray-200 dark:border-gray-700/50">
                        <p className="flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                            {t('portfolio:trend.summaryPeriodEndValue')}
                            <InfoHint
                                label={t('portfolio:trend.infoAbout', { label: t('portfolio:trend.summaryPeriodEndValue') })}
                                text={t('portfolio:trend.summaryPeriodEndValueTooltip')}
                            />
                        </p>
                        <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                            {isValueVisible ? formatCurrency(displayCurrentValue, currency, { precision: 0 }) : '•••••'}
                        </p>
                    </div>

                    {/* Cost Basis */}
                    <div className="bg-gray-50/80 dark:bg-gray-800/60 rounded-xl p-3 border border-gray-200 dark:border-gray-700/50">
                        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                            {t('portfolio:trend.summaryInvestedCapital')}
                        </p>
                        <p className="text-lg sm:text-xl font-bold text-gray-700 dark:text-gray-300 tabular-nums">
                            {isValueVisible ? formatCurrency(displayCostBasis, currency, { precision: 0 }) : '•••••'}
                        </p>
                    </div>

                    {/* Period Return — updates with period selector */}
                    <div className={cn(
                        'rounded-xl p-3 border',
                        isPositivePeriod
                            ? 'bg-success-50/80 dark:bg-success-900/20 border-success-200 dark:border-success-800/50'
                            : 'bg-error-50/80 dark:bg-error-900/20 border-error-200 dark:border-error-800/50'
                    )}>
                        <div className="flex items-center gap-1.5 mb-1">
                            {isPositivePeriod
                                ? <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-success-700 dark:text-success-400" />
                                : <ArrowTrendingDownIcon className="w-3.5 h-3.5 text-error-700 dark:text-error-400" />
                            }
                            <p className={cn(
                                'flex items-center gap-1 text-xs sm:text-xs font-bold uppercase tracking-wider',
                                isPositivePeriod ? 'text-success-700 dark:text-success-300' : 'text-error-700 dark:text-error-300'
                            )}>
                                {t('portfolio:trend.summaryPeriodReturn')}
                                <InfoHint
                                    label={t('portfolio:trend.infoAbout', { label: t('portfolio:trend.summaryPeriodReturn') })}
                                    text={t('portfolio:trend.summaryPeriodReturnTooltip')}
                                />
                            </p>
                        </div>
                        <p className={cn(
                            'text-lg sm:text-xl font-bold tabular-nums',
                            isPositivePeriod ? 'text-success-900 dark:text-success-100' : 'text-error-900 dark:text-error-100'
                        )}>
                            {isValueVisible ? (
                                <>{isPositivePeriod ? '+' : ''}{stats.periodChangePercent.toFixed(2)}%</>
                            ) : '•••%'}
                        </p>
                        <p className={cn(
                            'text-xs font-medium tabular-nums mt-0.5',
                            isPositivePeriod ? 'text-success-700 dark:text-success-300' : 'text-error-700 dark:text-error-300'
                        )}>
                            {isValueVisible ? `${isPositivePeriod ? '+' : ''}${formatCurrency(Math.round(stats.periodGain), currency)}` : '•••'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                            {t('portfolio:trend.summaryAllTimeValue', {
                                percent: isValueVisible ? `${allTimePercent >= 0 ? '+' : ''}${allTimePercent.toFixed(1)}%` : '•••',
                            })}
                        </p>
                    </div>

                    {/* Period Change / Capital Added */}
                    <div className="bg-blue-50/80 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-200 dark:border-blue-800/50">
                        <div className="flex items-center gap-1.5 mb-1">
                            <BanknotesIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                                {t('portfolio:trend.summaryCapitalAdded')}
                            </p>
                        </div>
                        <p className="text-lg sm:text-xl font-bold text-blue-900 dark:text-blue-100 tabular-nums">
                            {isValueVisible ? formatCurrency(Math.round(stats.totalCapitalAdded), currency) : '•••••'}
                        </p>
                        {stats.buyEventCount > 0 && (
                            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-0.5">
                                {t('portfolio:trend.summaryPurchases', { count: stats.buyEventCount })}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* View Mode Toggle */}
            {showControls && <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-4">
                <div className="flex bg-gray-100 dark:bg-gray-800/50 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700/50">
                    <button
                        onClick={() => setViewMode('value')}
                        aria-pressed={viewMode === 'value'}
                        className={cn(
                            'px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 whitespace-nowrap',
                            viewMode === 'value'
                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        )}
                    >
                        {t('portfolio:trend.modeValue')}
                    </button>
                    <button
                        onClick={() => setViewMode('return')}
                        aria-pressed={viewMode === 'return'}
                        className={cn(
                            'px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 whitespace-nowrap',
                            viewMode === 'return'
                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        )}
                    >
                        {t('portfolio:trend.modeReturnPercent')}
                    </button>
                </div>
                {/* Brush toggle */}
                <button
                    onClick={() => setBrushEnabled(prev => !prev)}
                    className={cn(
                        'ml-1 sm:ml-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-200 border whitespace-nowrap',
                        brushEnabled
                            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700'
                            : 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border-gray-200 dark:border-gray-700'
                    )}
                    aria-pressed={brushEnabled}
                    title={brushEnabled ? t('portfolio:trend.zoomDisable') : t('portfolio:trend.zoomEnable')}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t('portfolio:trend.zoom')}
                </button>
                <div className="flex items-center gap-3 ml-auto text-xs flex-wrap">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-1.5 rounded-full bg-indigo-500" />
                        <span className="text-gray-500 dark:text-gray-400 font-medium">{t('portfolio:trend.seriesMyPortfolio')}</span>
                    </div>
                    {viewMode === 'value' && (
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-1.5 rounded-full bg-blue-400 dark:bg-blue-500" style={{ opacity: 0.6 }} />
                            <span className="text-gray-500 dark:text-gray-400 font-medium">{t('portfolio:trend.costBasis')}</span>
                        </div>
                    )}
                    {benchmark && viewMode === 'return' && (
                        <div className="flex items-center gap-1.5">
                            <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke={benchmark.color} strokeWidth="2" strokeDasharray="4 2" /></svg>
                            <span className="font-medium" style={{ color: benchmark.color }}>{benchmark.symbol}</span>
                        </div>
                    )}
                    {externalStats && (
                        <span className="text-gray-500 dark:text-gray-500 text-[10px] italic">
                            {t('portfolio:trend.tradableAssets')}
                        </span>
                    )}
                </div>
            </div>}

            {/* Chart */}
            <div className="flex-1 min-h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={mergedChartData}
                        margin={{ top: 10, right: 10, left: 0, bottom: brushEnabled ? 40 : 5 }}
                    >
                        <defs>
                            <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="rgb(99, 102, 241)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="rgb(99, 102, 241)" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="rgb(96, 165, 250)" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="rgb(96, 165, 250)" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="returnGradientPositive" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="rgb(34, 197, 94)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="rgb(34, 197, 94)" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="returnGradientNegative" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="rgb(239, 68, 68)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="rgb(239, 68, 68)" stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="currentColor"
                            className="text-gray-200 dark:text-gray-700 opacity-50"
                            vertical={false}
                        />
                        <XAxis
                            dataKey="fullDateStr"
                            tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 500 }}
                            className="text-gray-600 dark:text-gray-400"
                            height={24}
                            interval={Math.max(Math.floor(chartData.length / 7), 1)}
                            tickMargin={4}
                            tickFormatter={(iso: string) => {
                                const [y, m, d] = iso.split('-').map(Number);
                                const dt = new Date(y, m - 1, d);
                                if (chartData.length <= 60) {
                                    return dt.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
                                }
                                if (chartData.length <= 365) {
                                    return dt.toLocaleDateString(dateLocale, { month: 'short' });
                                }
                                return `${dt.toLocaleDateString(dateLocale, { month: 'short' })} '${String(y).slice(-2)}`;
                            }}
                        />
                        <YAxis
                            tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 500 }}
                            className="text-gray-600 dark:text-gray-400"
                            width={75}
                            tickMargin={8}
                            tickFormatter={(value) => {
                                if (!isValueVisible) return '•••';
                                if (viewMode === 'return') {
                                    return `${value.toFixed(1)}%`;
                                }
                                return formatCurrency(value, currency, { compact: true, showSymbol: false });
                            }}
                            domain={yDomain}
                        />
                        <Tooltip
                            content={<CustomTooltip />}
                            cursor={{ stroke: 'rgb(99, 102, 241)', strokeWidth: 1.5, strokeDasharray: '5 5' }}
                            animationDuration={200}
                            wrapperStyle={{ outline: 'none' }}
                        />

                        {/* Value mode: Cost Basis */}
                        <Area
                            type="monotone"
                            dataKey={viewMode === 'value' ? 'costBasis' : 'costBasis_hidden'}
                            stroke="rgb(96, 165, 250)"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            fill="url(#costGradient)"
                            fillOpacity={viewMode === 'value' ? 1 : 0}
                            strokeOpacity={viewMode === 'value' ? 1 : 0}
                            animationDuration={500}
                            name={t('portfolio:trend.summaryInvestedCapital')}
                            dot={false}
                            activeDot={false}
                            legendType="none"
                        />
                        {/* Main portfolio value / return line */}
                        <Area
                            type="monotone"
                            dataKey={viewMode === 'value' ? 'value' : (benchmark ? 'periodReturnPct' : 'returnPercent')}
                            stroke={viewMode === 'value' ? 'rgb(99, 102, 241)' : (benchmark ? 'rgb(99, 102, 241)' : isPositiveReturn ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)')}
                            strokeWidth={2.5}
                            fill={viewMode === 'value' ? 'url(#valueGradient)' : (benchmark ? 'url(#valueGradient)' : isPositiveReturn ? 'url(#returnGradientPositive)' : 'url(#returnGradientNegative)')}
                            fillOpacity={1}
                            animationDuration={500}
                            name={t('portfolio:trend.seriesMyPortfolio')}
                            dot={false}
                            activeDot={{ r: 5, fill: 'rgb(99, 102, 241)', stroke: 'white', strokeWidth: 2 }}
                        />
                        {/* Benchmark line (return mode only) */}
                        {benchmark && viewMode === 'return' && (
                            <Line
                                type="monotone"
                                dataKey="benchmarkReturnPct"
                                stroke={benchmark.color}
                                strokeWidth={2}
                                strokeDasharray="6 3"
                                dot={false}
                                activeDot={{ r: 4, fill: benchmark.color, stroke: 'white', strokeWidth: 2 }}
                                name={benchmark.symbol}
                                connectNulls
                                animationDuration={500}
                            />
                        )}

                        {/* Buy markers (blue dots) — visible in all view modes */}
                        {capitalEvents.buys.map((event, idx) => {
                            const point = chartData[event.index];
                            if (!point) return null;
                            const yVal = viewMode === 'value'
                                ? point.value
                                : benchmark ? point.periodReturnPct : point.returnPercent;
                            return (
                                <ReferenceDot
                                    key={`buy-${idx}`}
                                    x={point.fullDateStr}
                                    y={yVal}
                                    r={4}
                                    fill="rgb(59, 130, 246)"
                                    stroke="white"
                                    strokeWidth={2}
                                    isFront={true}
                                />
                            );
                        })}

                        {/* Sell markers (orange dots) — visible in all view modes */}
                        {capitalEvents.sells.map((event, idx) => {
                            const point = chartData[event.index];
                            if (!point) return null;
                            const yVal = viewMode === 'value'
                                ? point.value
                                : benchmark ? point.periodReturnPct : point.returnPercent;
                            return (
                                <ReferenceDot
                                    key={`sell-${idx}`}
                                    x={point.fullDateStr}
                                    y={yVal}
                                    r={4}
                                    fill="rgb(249, 115, 22)"
                                    stroke="white"
                                    strokeWidth={2}
                                    isFront={true}
                                />
                            );
                        })}
                        {/* Brush / Range Zoom */}
                        {brushEnabled && (
                            <Brush
                                dataKey="fullDateStr"
                                height={28}
                                travellerWidth={8}
                                stroke="rgb(99, 102, 241)"
                                fill="rgb(239, 246, 255)"
                                className="dark:fill-gray-800"
                                tickFormatter={(value) => String(value)}
                            />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Capital Events Legend */}
            {(capitalEvents.buys.length > 0 || capitalEvents.sells.length > 0) && (
                <div className="mt-3 flex items-center gap-4 text-xs">
                    {capitalEvents.buys.length > 0 && (
                        <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                            <span className="font-medium">
                                {t('portfolio:trend.legendBuys', { count: capitalEvents.buys.length })}
                            </span>
                        </div>
                    )}
                    {capitalEvents.sells.length > 0 && (
                        <div className="flex items-center gap-1.5 text-orange-700 dark:text-orange-400">
                            <div className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
                            <span className="font-medium">
                                {t('portfolio:trend.legendSells', { count: capitalEvents.sells.length })}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
