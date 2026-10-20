'use client';

import { useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import type { ProjectionPoint } from '@/lib/housing';


interface BuyVsRentChartLabels {
    buy: string;
    rent: string;
    yearAxis: string;
    breakEven: string;
    yearWord: string;
}

interface Props {
    /** Yearly-sampled projection points (month % 12 === 0). */
    data: ProjectionPoint[];
    colors: { buy: string; rent: string };
    breakEvenYear: number | null;
    isValueVisible: boolean;
    labels: BuyVsRentChartLabels;
}

/**
 * Clean round Y-axis — snaps domain + ticks to 1/2/2.5/5 × 10ⁿ so labels read
 * "$1,500萬" not "$1,487萬". Mirrors the dashboard's niceAxis.
 */
function niceAxis(min: number, max: number, count = 4): { domain: [number, number]; ticks: number[] } {
    if (!(max > min)) return { domain: [0, Math.max(1, max)], ticks: [] };
    const pad = (max - min) * 0.08;
    let lo = min - pad;
    let hi = max + pad;
    const rawStep = (hi - lo) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / magnitude;
    const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;
    lo = Math.min(0, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v));
    return { domain: [Math.round(lo), Math.round(hi)], ticks };
}

interface Row {
    year: number;
    buy: number;
    rent: number;
}

export function BuyVsRentChart({ data, colors, breakEvenYear, isValueVisible, labels }: Props) {
    const rows: Row[] = useMemo(
        () => data.map((p) => ({ year: Math.round(p.year), buy: p.buyNetWorth, rent: p.rentNetWorth })),
        [data],
    );

    const yAxis = useMemo(() => {
        const vals = rows.flatMap((r) => [r.buy, r.rent]);
        if (!vals.length) return { domain: [0, 1] as [number, number], ticks: [] as number[] };
        return niceAxis(Math.min(...vals), Math.max(...vals), 4);
    }, [rows]);

    return (
        <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700 opacity-50" vertical={false} />
                    <XAxis
                        dataKey="year"
                        tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }}
                        className="text-gray-500 dark:text-gray-400"
                        tickLine={false}
                        tickFormatter={(v) => `${v}`}
                        interval="preserveStartEnd"
                    />
                    <YAxis
                        tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }}
                        className="text-gray-500 dark:text-gray-400"
                        tickLine={false}
                        tickFormatter={(v) => (isValueVisible ? formatTWDCompact(v) : '•••')}
                        // 64 clipped the "NT" off a tick: this chart projects 20
                        // years of compounding, so its ticks run to "NT$8000萬"
                        // and beyond — the widest labels in the app. Matches the
                        // budget WalletNetWorthCard reserves for the same
                        // formatter at the same font size.
                        width={84}
                        tickMargin={4}
                        domain={yAxis.domain}
                        ticks={yAxis.ticks}
                    />
                    <ReferenceLine y={0} stroke="currentColor" className="text-gray-300 dark:text-gray-600" />
                    {breakEvenYear !== null && (
                        <ReferenceLine
                            x={breakEvenYear}
                            stroke="currentColor"
                            className="text-gray-500 dark:text-gray-500"
                            strokeDasharray="4 4"
                            label={{
                                value: `${labels.breakEven} · ${labels.yearWord}${breakEvenYear}`,
                                position: 'insideTopLeft',
                                fontSize: 10,
                                fill: 'currentColor',
                            }}
                        />
                    )}
                    <Tooltip
                        cursor={{ stroke: colors.buy, strokeWidth: 1.5, strokeDasharray: '5 5' }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload as Row;
                            const diff = d.buy - d.rent;
                            return (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-3 min-w-[190px]">
                                    <p className="text-xs font-bold text-gray-900 dark:text-white mb-2 pb-1.5 border-b border-gray-100 dark:border-gray-700">
                                        {labels.yearAxis} {d.year}
                                    </p>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="flex items-center gap-1.5" style={{ color: colors.buy }}>
                                                <span className="w-2 h-2 rounded-full" style={{ background: colors.buy }} />
                                                {labels.buy}
                                            </span>
                                            <span className="text-gray-900 dark:text-white font-bold tabular-nums">{isValueVisible ? formatTWD(d.buy) : '•••'}</span>
                                        </div>
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="flex items-center gap-1.5" style={{ color: colors.rent }}>
                                                <span className="w-2 h-2 rounded-full" style={{ background: colors.rent }} />
                                                {labels.rent}
                                            </span>
                                            <span className="text-gray-900 dark:text-white font-bold tabular-nums">{isValueVisible ? formatTWD(d.rent) : '•••'}</span>
                                        </div>
                                        <div className="flex justify-between gap-3 text-xs pt-1.5 border-t border-gray-100 dark:border-gray-700">
                                            <span className="text-gray-500 dark:text-gray-400">Δ</span>
                                            <span className={`font-semibold tabular-nums ${diff >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500'}`}>
                                                {diff >= 0 ? '+' : '−'}{isValueVisible ? formatTWDCompact(Math.abs(diff)) : '•••'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Line type="monotone" dataKey="buy" stroke={colors.buy} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: colors.buy, stroke: 'white', strokeWidth: 2 }} name={labels.buy} />
                    <Line type="monotone" dataKey="rent" stroke={colors.rent} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: colors.rent, stroke: 'white', strokeWidth: 2 }} name={labels.rent} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
