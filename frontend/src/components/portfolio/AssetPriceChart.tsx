'use client';

/**
 * AssetPriceChart
 *
 * Recharts-only component for the asset detail page (portfolio/holdings/[symbol]).
 * Extracted into its own module so it can be lazy-loaded via next/dynamic, keeping
 * recharts (~386 KB) out of the page's initial bundle.
 */

import { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Brush,
    ReferenceLine,
    ReferenceDot,
} from 'recharts';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';

export interface ChartPoint {
    date: string;
    displayDate: string;
    price: number;
    costBasis: number;
    returnAmount: number;
    returnPercent: number;
    change: number;
    changePercent: number;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    /** Purchases recorded on this date (from the holding's lots), if any */
    purchaseQty?: number;
    purchaseCost?: number;
    purchaseLotCount?: number;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: ChartPoint }>;
    currency: string;
    isValueVisible: boolean;
    avgCost: number;
}

function CustomTooltip({ active, payload, currency, isValueVisible, avgCost }: CustomTooltipProps) {
    if (!active || !payload?.length) return null;
    const d: ChartPoint = payload[0].payload;
    const isUp = d.change >= 0;
    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg p-4 min-w-[220px] backdrop-blur-sm bg-opacity-95 dark:bg-opacity-95">
            <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <time className="text-sm font-bold text-gray-900 dark:text-white">{d.date}</time>
            </div>
            <div className="space-y-2">
                <div className="flex justify-between items-center gap-4">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Price</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                        {isValueVisible ? formatCurrency(d.price, currency) : '•••••'}
                    </span>
                </div>
                {d.high != null && d.low != null && (
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">H / L</span>
                        <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">
                            {isValueVisible ? `${formatCurrency(d.high!, currency)} / ${formatCurrency(d.low!, currency)}` : '•••'}
                        </span>
                    </div>
                )}
                <div className="flex justify-between items-center gap-4">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Day Change</span>
                    <span className={cn(
                        'text-xs font-bold tabular-nums',
                        isUp ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'
                    )}>
                        {isValueVisible ? `${isUp ? '+' : ''}${formatCurrency(d.change, currency)} (${d.changePercent.toFixed(2)}%)` : '•••'}
                    </span>
                </div>
                {avgCost > 0 && (
                    <div className="flex justify-between items-center gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">vs Avg Cost</span>
                        <span className={cn(
                            'text-xs font-bold tabular-nums',
                            d.returnAmount >= 0 ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'
                        )}>
                            {isValueVisible
                                ? `${d.returnAmount >= 0 ? '+' : ''}${formatCurrency(d.returnAmount, currency)} (${d.returnPercent.toFixed(2)}%)`
                                : '•••'}
                        </span>
                    </div>
                )}
                {d.volume != null && (
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Volume</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{d.volume.toLocaleString()}</span>
                    </div>
                )}
                {(d.purchaseQty ?? 0) > 0 && (
                    <div className="flex justify-between items-center gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                            Bought
                        </span>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                            {isValueVisible
                                ? `${d.purchaseQty!.toLocaleString(undefined, { maximumFractionDigits: 8 })} @ ${formatCurrency((d.purchaseCost ?? 0) / d.purchaseQty!, currency)}`
                                : '•••••'}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

interface AssetPriceChartProps {
    chartData: ChartPoint[];
    viewMode: 'price' | 'return';
    brushEnabled: boolean;
    symbol: string;
    avgCost: number;
    currency: string;
    isValueVisible: boolean;
    isPositiveReturn: boolean;
}

export function AssetPriceChart({
    chartData,
    viewMode,
    brushEnabled,
    symbol,
    avgCost,
    currency,
    isValueVisible,
    isPositiveReturn,
}: AssetPriceChartProps) {
    // Only plot the Avg Cost reference line when it's a real, finite number.
    // `avgCost > 0` alone lets +Infinity through, and a single non-finite value
    // poisons Recharts' shared Y-axis domain (collapsing ticks + hiding the line).
    const showCostBasis = viewMode === 'price' && Number.isFinite(avgCost) && avgCost > 0;

    // Buy markers: any day a purchase lot was recorded, pinpointed on the line —
    // mirrors the buy-dot pattern on the portfolio performance chart (AssetTrendChart).
    const buyPoints = useMemo(
        () => chartData.filter(d => (d.purchaseQty ?? 0) > 0),
        [chartData],
    );

    // Compute an explicit numeric Y-domain from the finite data instead of
    // relying on domain={['auto','auto']}, which can resolve to an empty/NaN
    // range here and blank the whole chart.
    const yDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
        const values: number[] = [];
        for (const d of chartData) {
            const v = viewMode === 'return' ? d.returnPercent : d.price;
            if (Number.isFinite(v)) values.push(v);
        }
        if (showCostBasis) values.push(avgCost);
        if (values.length === 0) return ['auto', 'auto'];
        let min = Math.min(...values);
        let max = Math.max(...values);
        if (min === max) {
            const pad = Math.abs(min) * 0.05 || 1;
            min -= pad;
            max += pad;
        } else {
            const pad = (max - min) * 0.08;
            min -= pad;
            max += pad;
        }
        // For return %, keep the zero baseline in view.
        if (viewMode === 'return') {
            min = Math.min(min, 0);
            max = Math.max(max, 0);
        }
        return [min, max];
    }, [chartData, viewMode, avgCost, showCostBasis]);

    return (
        <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: brushEnabled ? 60 : 35 }}
                >
                    <defs>
                        <linearGradient id={`priceGradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="rgb(99, 102, 241)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="rgb(99, 102, 241)" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="costGradientAsset" x1="0" y1="0" x2="0" y2="1">
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
                        dataKey="displayDate"
                        tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 500 }}
                        className="text-gray-600 dark:text-gray-400"
                        angle={-45}
                        textAnchor="end"
                        height={50}
                        interval={
                            typeof window !== 'undefined' && window.innerWidth < 640
                                ? Math.max(Math.floor(chartData.length / 5), 1)
                                : 'preserveStartEnd'
                        }
                        tickMargin={10}
                    />
                    <YAxis
                        tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 500 }}
                        className="text-gray-600 dark:text-gray-400"
                        width={75}
                        tickMargin={8}
                        tickFormatter={(v) => {
                            if (!isValueVisible) return '•••';
                            if (viewMode === 'return') return `${v.toFixed(1)}%`;
                            return formatCurrency(v, currency, { compact: true, showSymbol: false });
                        }}
                        domain={yDomain}
                        allowDataOverflow={false}
                    />
                    <Tooltip
                        content={
                            <CustomTooltip
                                currency={currency}
                                isValueVisible={isValueVisible}
                                avgCost={avgCost}
                            />
                        }
                        cursor={{ stroke: 'rgb(99, 102, 241)', strokeWidth: 1.5, strokeDasharray: '5 5' }}
                        animationDuration={200}
                        wrapperStyle={{ outline: 'none' }}
                    />

                    {/* Areas must be DIRECT children of AreaChart — Recharts discovers
                        chart series via React.Children and does NOT recurse into a
                        Fragment. Wrapping these in <>…</> made every <Area> invisible
                        to Recharts (no line rendered). Keep them flat. */}
                    {showCostBasis && (
                        <Area
                            type="monotone"
                            dataKey="costBasis"
                            stroke="rgb(96, 165, 250)"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            fill="url(#costGradientAsset)"
                            fillOpacity={1}
                            dot={false}
                            activeDot={false}
                            name="Avg Cost"
                            isAnimationActive={false}
                        />
                    )}
                    {viewMode === 'price' && (
                        <Area
                            type="monotone"
                            dataKey="price"
                            stroke="rgb(99, 102, 241)"
                            strokeWidth={2.5}
                            fill={`url(#priceGradient-${symbol})`}
                            fillOpacity={1}
                            dot={false}
                            activeDot={{ r: 5, fill: 'rgb(99, 102, 241)', stroke: 'white', strokeWidth: 2 }}
                            name="Price"
                            isAnimationActive={false}
                        />
                    )}
                    {viewMode === 'return' && (
                        <Area
                            type="monotone"
                            dataKey="returnPercent"
                            stroke={isPositiveReturn ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'}
                            strokeWidth={2.5}
                            fill={isPositiveReturn ? 'url(#returnGradientPositive)' : 'url(#returnGradientNegative)'}
                            fillOpacity={1}
                            dot={false}
                            activeDot={{ r: 5, fill: isPositiveReturn ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)', stroke: 'white', strokeWidth: 2 }}
                            name="Return %"
                            isAnimationActive={false}
                        />
                    )}

                    {viewMode === 'return' && (
                        <ReferenceLine y={0} stroke="rgb(156,163,175)" strokeDasharray="4 4" strokeOpacity={0.6} />
                    )}

                    {/* Buy markers — pinpoint each date a purchase lot was recorded */}
                    {buyPoints.map((d, idx) => (
                        <ReferenceDot
                            key={`buy-${d.date}-${idx}`}
                            x={d.displayDate}
                            y={viewMode === 'return' ? d.returnPercent : d.price}
                            r={4}
                            fill="rgb(59, 130, 246)"
                            stroke="white"
                            strokeWidth={2}
                            isFront={true}
                        />
                    ))}

                    {brushEnabled && (
                        <Brush
                            dataKey="displayDate"
                            height={28}
                            travellerWidth={8}
                            stroke="rgb(99, 102, 241)"
                            fill="rgb(239, 246, 255)"
                            className="dark:fill-gray-800"
                            tickFormatter={(v) => String(v)}
                        />
                    )}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
