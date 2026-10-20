'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/utils/cn';
import { formatCurrency, formatCompactChange } from '@/utils/formatters';
import type { AssetTrendDataPoint } from './AssetTrendChart';
import { buildMonthBlocks } from './calendarGrid';

interface Props {
    data: AssetTrendDataPoint[];
    currency: string;
    isValueVisible: boolean;
}

// Said in the cell's own tooltip: the US session ends after midnight in Taipei, so
// the newest day keeps moving until its close is published.
const PROVISIONAL_NOTE = 'not final — the market has not closed for this day yet';

// Markets trade Mon–Fri only, so the calendar shows five day columns + a weekly sum.
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function cellColorClass(change: number | null, maxAbs: number, invertColors: boolean): string {
    if (change === null) return 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-600';
    if (change === 0) return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';

    const ratio = maxAbs > 0 ? Math.min(Math.abs(change) / maxAbs, 1) : 0;
    const isGain = change > 0;
    // Taiwan convention: green = loss, red = gain
    const showGreen = invertColors ? !isGain : isGain;

    if (showGreen) {
        if (ratio > 0.66) return 'bg-emerald-500 text-white dark:bg-emerald-600';
        if (ratio > 0.33) return 'bg-emerald-200 text-emerald-900 dark:bg-emerald-700/70 dark:text-emerald-100';
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    } else {
        if (ratio > 0.66) return 'bg-red-500 text-white dark:bg-red-600';
        if (ratio > 0.33) return 'bg-red-200 text-red-900 dark:bg-red-700/70 dark:text-red-100';
        return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    }
}


export function PortfolioCalendarHeatmap({ data, isValueVisible }: Props) {
    const [invertColors, setInvertColors] = useState(() => {
        try { return localStorage.getItem('cal-tw-mode') === 'true'; } catch { return false; }
    });
    const blocks = useMemo(() => buildMonthBlocks(data), [data]);

    const maxAbs = useMemo(() => {
        let m = 0;
        for (const pt of data) {
            if (pt.change !== undefined) m = Math.max(m, Math.abs(pt.change));
        }
        return m;
    }, [data]);

    if (blocks.length === 0) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-gray-500 dark:text-gray-500">
                No data available for this period.
            </div>
        );
    }

    return (
        <div className="px-4 sm:px-6 py-4 space-y-6">
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Daily P&L</span>
                <div className="flex items-center gap-1">
                    {invertColors ? (
                        <>
                            <span className="w-4 h-4 rounded bg-red-500 inline-block" title="Strong gain" />
                            <span className="w-4 h-4 rounded bg-red-200 inline-block" />
                            <span className="w-4 h-4 rounded bg-red-100 inline-block" />
                            <span className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700 inline-block mx-0.5" />
                            <span className="w-4 h-4 rounded bg-emerald-100 inline-block" />
                            <span className="w-4 h-4 rounded bg-emerald-200 inline-block" />
                            <span className="w-4 h-4 rounded bg-emerald-500 inline-block" title="Strong loss" />
                        </>
                    ) : (
                        <>
                            <span className="w-4 h-4 rounded bg-red-500 inline-block" title="Strong loss" />
                            <span className="w-4 h-4 rounded bg-red-200 inline-block" />
                            <span className="w-4 h-4 rounded bg-red-100 inline-block" />
                            <span className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700 inline-block mx-0.5" />
                            <span className="w-4 h-4 rounded bg-emerald-100 inline-block" />
                            <span className="w-4 h-4 rounded bg-emerald-200 inline-block" />
                            <span className="w-4 h-4 rounded bg-emerald-500 inline-block" title="Strong gain" />
                        </>
                    )}
                </div>
                <span>{invertColors ? 'Gain → Loss' : 'Loss → Gain'}</span>

                {/* Color convention toggle */}
                <button
                    onClick={() => setInvertColors((v) => {
                        const next = !v;
                        try { localStorage.setItem('cal-tw-mode', String(next)); } catch {}
                        return next;
                    })}
                    className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors',
                        invertColors
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-300'
                            : 'bg-gray-100 border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
                    )}
                    title={invertColors ? 'Switch to Western convention (green = gain)' : 'Switch to Taiwan convention (green = loss)'}
                >
                    <span className={cn('w-2 h-2 rounded-full inline-block', invertColors ? 'bg-emerald-500' : 'bg-gray-400')} />
                    {invertColors ? '🇹🇼 TW mode' : 'TW mode'}
                </button>

                <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-500">
                    Max daily: {isValueVisible ? formatCurrency(maxAbs) : '•••'}
                </span>
            </div>

            {/* Month grids */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {blocks.map((block) => {
                    const monthSum = block.days.reduce((s, cell) => cell?.change != null ? s + cell.change : s, 0);
                    const hasMonthData = block.days.some((cell) => cell?.change != null);
                    const isMonthPositive = monthSum >= 0;
                    return (
                    <div key={`${block.year}-${block.month}`} className="min-w-0">
                        <div className="flex items-baseline gap-2 mb-2">
                            <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                                {block.label}
                            </h3>
                            {hasMonthData && (
                                <span className={cn(
                                    'text-xs font-bold tabular-nums',
                                    (invertColors ? !isMonthPositive : isMonthPositive)
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-red-700 dark:text-red-400',
                                )}>
                                    {isValueVisible ? formatCompactChange(monthSum) : '•••'}
                                </span>
                            )}
                        </div>
                        {/* Weekday headers (Mon–Fri) + weekly sum header */}
                        <div className="grid grid-cols-6 gap-px mb-px">
                            {WEEKDAY_LABELS.map((d) => (
                                <div
                                    key={d}
                                    className="text-center text-xs font-semibold text-gray-500 dark:text-gray-500 py-0.5 uppercase"
                                >
                                    {d}
                                </div>
                            ))}
                            <div className="text-center text-[11px] font-semibold text-gray-500 dark:text-gray-500 py-0.5">
                                Σ wk
                            </div>
                        </div>
                        {/* Week rows: 5 weekday cells + 1 weekly sum block */}
                        {Array.from({ length: block.days.length / 5 }, (_, wi) => {
                            const week = block.days.slice(wi * 5, wi * 5 + 5);
                            const weekSum = week.reduce((s, cell) => cell?.change != null ? s + cell.change : s, 0);
                            const hasWeekData = week.some((cell) => cell?.change != null);
                            const isWeekPositive = weekSum >= 0;
                            const showGreen = invertColors ? !isWeekPositive : isWeekPositive;
                            return (
                                <div key={wi} className="grid grid-cols-6 gap-px mb-px">
                                    {/* Day cells (Mon–Fri) */}
                                    {week.map((cell, i) => {
                                        if (!cell) {
                                            return <div key={`empty-${wi}-${i}`} className="aspect-square" />;
                                        }
                                        const isToday = cell.dateStr === new Date().toISOString().slice(0, 10);
                                        return (
                                            <div
                                                key={cell.dateStr}
                                                title={
                                                    cell.change !== null
                                                        ? `${cell.dateStr}: ${cell.change >= 0 ? '+' : ''}${formatCurrency(cell.change)}${cell.changePercent !== null ? ` (${cell.changePercent >= 0 ? '+' : ''}${cell.changePercent.toFixed(2)}%)` : ''}${cell.provisional ? ` — ${PROVISIONAL_NOTE}` : ''}`
                                                        : cell.dateStr
                                                }
                                                className={cn(
                                                    'aspect-square rounded-sm flex flex-col items-center justify-center transition-opacity',
                                                    cellColorClass(cell.change, maxAbs, invertColors),
                                                    isToday && 'ring-2 ring-primary-500 ring-offset-1',
                                                    cell.provisional && 'border border-dashed border-gray-400 dark:border-gray-500',
                                                )}
                                            >
                                                <span className="text-[10px] leading-none font-semibold opacity-70 mb-0.5">
                                                    {cell.date.getDate()}
                                                </span>
                                                {cell.change !== null ? (
                                                    <span className="text-[10px] sm:text-[11px] leading-none font-bold tabular-nums">
                                                        {isValueVisible ? formatCompactChange(cell.change) : '•'}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] leading-none opacity-0">—</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {/* Weekly sum block (6th column) — no fill, colored text only */}
                                    <div
                                        title={hasWeekData ? `Week total: ${weekSum >= 0 ? '+' : ''}${formatCurrency(weekSum)}` : undefined}
                                        className="aspect-square flex flex-col items-center justify-center gap-0.5"
                                    >
                                        {hasWeekData && (
                                            <span className={cn(
                                                'text-[10px] leading-none font-bold tabular-nums text-center px-0.5',
                                                showGreen ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300',
                                            )}>
                                                {isValueVisible ? formatCompactChange(weekSum) : '•••'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    );
                })}
            </div>
        </div>
    );
}
