'use client';

/**
 * AssetCandlestickChart — proof-of-concept OHLC candlestick view for the asset
 * detail page. Recharts has no native candlestick, so we render a floating Bar
 * (low→high range) and draw the wick + body via a custom shape. No extra deps.
 */

import { useMemo, useState } from 'react';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import type { ChartPoint } from './AssetPriceChart';

// Taiwan / East-Asian convention: up = red, down = green (opposite of the West).
const UP = 'rgb(239, 68, 68)';   // red-500
const DOWN = 'rgb(34, 197, 94)'; // green-500

// Moving-average overlay colors (distinct from the red/green candles + blue avg-cost)
const MA = [
    { key: 'ma5' as const, period: 5, label: 'MA5', color: '#f59e0b' },   // amber
    { key: 'ma10' as const, period: 10, label: 'MA10', color: '#8b5cf6' }, // violet
    { key: 'ma20' as const, period: 20, label: 'MA20', color: '#ec4899' }, // pink
];

interface CandleShapeProps {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    // Recharts spreads each data item's fields onto the shape props.
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
}

// Custom shape for one candle. The bar's value is the [low, high] range, so
// Recharts gives us the pixel rect (x,y,width,height) spanning low→high; we
// derive open/close pixel positions from that.
function Candle({ x = 0, y = 0, width = 0, height = 0, open, high, low, close }: CandleShapeProps) {
    if (open == null || high == null || low == null || close == null) return null;

    const span = high - low;
    const ratio = span > 0 ? height / span : 0;
    const openY = y + (high - open) * ratio;
    const closeY = y + (high - close) * ratio;

    const isUp = close >= open;
    const color = isUp ? UP : DOWN;
    const cx = x + width / 2;
    const bodyX = x + width * 0.2;
    const bodyW = Math.max(width * 0.6, 1);
    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(Math.abs(closeY - openY), 1);

    return (
        <g stroke={color} fill={color}>
            {/* wick: high → low */}
            <line x1={cx} y1={y} x2={cx} y2={y + height} strokeWidth={1} />
            {/* body: open → close */}
            <rect x={bodyX} y={bodyTop} width={bodyW} height={bodyH} />
        </g>
    );
}

type CandleDatum = ChartPoint & { close: number; ma5: number | null; ma10: number | null; ma20: number | null };

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: CandleDatum }>;
    currency: string;
    isValueVisible: boolean;
}

function CandleTooltip({ active, payload, currency, isValueVisible }: CustomTooltipProps) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const isUp = (d.close ?? 0) >= (d.open ?? 0);
    const fmt = (v: number | null) => (v == null ? '—' : isValueVisible ? formatCurrency(v, currency) : '•••');
    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg p-4 min-w-[200px]">
            <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                <time className="text-sm font-bold text-gray-900 dark:text-white">{d.date}</time>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {([['Open', d.open], ['High', d.high], ['Low', d.low], ['Close', d.close]] as const).map(([label, v]) => (
                    <div key={label} className="flex justify-between gap-3">
                        <span className="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
                        <span className={cn('font-bold tabular-nums', label === 'Close' ? (isUp ? 'text-error-700 dark:text-error-400' : 'text-success-700 dark:text-success-400') : 'text-gray-900 dark:text-white')}>
                            {fmt(v)}
                        </span>
                    </div>
                ))}
            </div>
            {(d.ma5 != null || d.ma10 != null || d.ma20 != null) && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-1 text-xs">
                    {MA.map(({ key, label, color }) => d[key] != null && (
                        <div key={key} className="flex justify-between gap-3">
                            <span className="font-semibold tabular-nums" style={{ color }}>{label}</span>
                            <span className="font-bold tabular-nums text-gray-900 dark:text-white">{fmt(d[key])}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

interface AssetCandlestickChartProps {
    chartData: ChartPoint[];
    avgCost: number;
    currency: string;
    isValueVisible: boolean;
}

type MaKey = typeof MA[number]['key'];

export function AssetCandlestickChart({ chartData, avgCost, currency, isValueVisible }: AssetCandlestickChartProps) {
    const showCostBasis = Number.isFinite(avgCost) && avgCost > 0;

    // Per-MA visibility — click a legend chip to hide/show that line.
    // Empty set = all MAs visible (the default).
    const [hiddenMA, setHiddenMA] = useState<Set<MaKey>>(new Set());
    const toggleMA = (key: MaKey) =>
        setHiddenMA(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    // Build the candle rows. For long ranges, daily candles become unreadably
    // thin, so we downsample into coarser buckets (aggregating OHLC) to keep
    // ~TARGET candles on screen. MAs are then computed over the *displayed*
    // bars (e.g. MA5 = 5 buckets), matching how charting tools behave.
    // ChartPoint stores the close as `price` (no `close` field).
    const { data, bucketSize } = useMemo(() => {
        const TARGET = 70;
        const size = chartData.length > 90 ? Math.ceil(chartData.length / TARGET) : 1;

        let bars: ChartPoint[];
        if (size <= 1) {
            bars = chartData;
        } else {
            bars = [];
            for (let i = 0; i < chartData.length; i += size) {
                const chunk = chartData.slice(i, i + size);
                const first = chunk[0];
                const last = chunk[chunk.length - 1];
                let hi = -Infinity;
                let lo = Infinity;
                for (const c of chunk) {
                    const h = c.high ?? c.price;
                    const l = c.low ?? c.price;
                    if (Number.isFinite(h)) hi = Math.max(hi, h);
                    if (Number.isFinite(l)) lo = Math.min(lo, l);
                }
                bars.push({
                    ...last, // date / displayDate from the bucket's last bar
                    open: first.open ?? first.price,
                    high: Number.isFinite(hi) ? hi : last.price,
                    low: Number.isFinite(lo) ? lo : last.price,
                    price: last.price, // close = last close in the bucket
                });
            }
        }

        const closes = bars.map(d => d.price);
        const sma = (period: number, i: number): number | null => {
            if (i < period - 1) return null;
            let sum = 0;
            for (let k = i - period + 1; k <= i; k++) {
                if (!Number.isFinite(closes[k])) return null;
                sum += closes[k];
            }
            return sum / period;
        };
        const rows = bars.map((d, i) => {
            const close = d.price;
            const lo = d.low ?? close;
            const hi = d.high ?? close;
            return {
                ...d,
                close,
                _range: [lo, hi] as [number, number],
                ma5: sma(5, i),
                ma10: sma(10, i),
                ma20: sma(20, i),
            };
        });
        return { data: rows, bucketSize: size };
    }, [chartData]);

    const yDomain = useMemo<[number, number]>(() => {
        const lows: number[] = [];
        const highs: number[] = [];
        for (const d of chartData) {
            if (Number.isFinite(d.low)) lows.push(d.low as number);
            if (Number.isFinite(d.high)) highs.push(d.high as number);
        }
        if (showCostBasis) { lows.push(avgCost); highs.push(avgCost); }
        if (lows.length === 0 || highs.length === 0) return [0, 1];
        const min = Math.min(...lows);
        const max = Math.max(...highs);
        const pad = (max - min) * 0.08 || Math.abs(max) * 0.05 || 1;
        return [min - pad, max + pad];
    }, [chartData, avgCost, showCostBasis]);

    return (
        <div>
            {/* Legend — a dedicated plain-HTML strip rendered ABOVE the plot SVG.
                Keeping it outside the chart guarantees it can never overlap the
                candles / MA lines the way a Recharts <Legend> floating inside the
                plot area did. Swatches mirror the chart series exactly. */}
            <div
                role="list"
                aria-label="Chart series legend"
                className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 pb-3 mb-2 text-xs border-b border-gray-100 dark:border-gray-700/60"
            >
                <span role="listitem" className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: UP }} />
                    <span className="text-gray-600 dark:text-gray-300 font-medium">Up</span>
                </span>
                <span role="listitem" className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: DOWN }} />
                    <span className="text-gray-600 dark:text-gray-300 font-medium">Down</span>
                </span>
                {MA.map(m => {
                    const hidden = hiddenMA.has(m.key);
                    return (
                        <span key={m.key} role="listitem">
                            <button
                                type="button"
                                onClick={() => toggleMA(m.key)}
                                aria-pressed={!hidden}
                                title={hidden ? `Show ${m.label}` : `Hide ${m.label}`}
                                className={cn(
                                    'flex items-center gap-1.5 rounded px-1 -mx-1 transition-opacity cursor-pointer',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                                    hidden ? 'opacity-40' : 'hover:opacity-80'
                                )}
                            >
                                <span className="inline-block w-3.5 h-[3px] rounded-full" style={{ backgroundColor: m.color }} />
                                <span className={cn('font-medium', hidden && 'line-through')} style={{ color: m.color }}>{m.label}</span>
                            </button>
                        </span>
                    );
                })}
                {showCostBasis && (
                    <span role="listitem" className="flex items-center gap-1.5">
                        <span className="inline-block w-3.5 h-0 border-t-2 border-dashed" style={{ borderColor: 'rgb(96, 165, 250)' }} />
                        <span className="text-gray-600 dark:text-gray-300 font-medium">Avg Cost</span>
                    </span>
                )}
                {bucketSize > 1 && (
                    <span role="listitem" className="ml-auto text-gray-500 dark:text-gray-500" title="Daily bars are grouped so the chart stays readable over long ranges">
                        {bucketSize}-day bars
                    </span>
                )}
            </div>
            <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 35 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700 opacity-50" vertical={false} />
                    <XAxis
                        dataKey="displayDate"
                        tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 500 }}
                        className="text-gray-600 dark:text-gray-400"
                        angle={-45}
                        textAnchor="end"
                        height={50}
                        interval="preserveStartEnd"
                        tickMargin={10}
                    />
                    <YAxis
                        tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 500 }}
                        className="text-gray-600 dark:text-gray-400"
                        width={75}
                        tickMargin={8}
                        domain={yDomain}
                        tickFormatter={(v) => (isValueVisible ? formatCurrency(v, currency, { compact: true, showSymbol: false }) : '•••')}
                    />
                    <Tooltip
                        content={<CandleTooltip currency={currency} isValueVisible={isValueVisible} />}
                        cursor={{ fill: 'rgb(99, 102, 241)', fillOpacity: 0.06 }}
                    />
                    {showCostBasis && (
                        <ReferenceLine
                            y={avgCost}
                            stroke="rgb(96, 165, 250)"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            ifOverflow="extendDomain"
                        />
                    )}
                    <Bar
                        dataKey="_range"
                        shape={(props: object) => <Candle {...(props as CandleShapeProps)} />}
                        isAnimationActive={false}
                        tooltipType="none"
                    />
                    {MA.filter(({ key }) => !hiddenMA.has(key)).map(({ key, color }) => (
                        <Line
                            key={key}
                            type="monotone"
                            dataKey={key}
                            stroke={color}
                            strokeWidth={1.5}
                            dot={false}
                            activeDot={false}
                            connectNulls
                            isAnimationActive={false}
                        />
                    ))}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

