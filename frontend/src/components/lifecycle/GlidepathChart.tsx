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
import type { GlidepathPoint } from '@/lib/lifecycle';

interface GlidepathChartLabels {
    actual: string;
    target: string;
    ceiling: string;
    ageAxis: string;
    crossover: string;
    noDebt: string;
}

interface Props {
    data: GlidepathPoint[];
    colors: { actual: string; target: string };
    crossoverAge: number | null;
    maxLeverage: number;
    labels: GlidepathChartLabels;
}

interface Row {
    age: number;
    actual: number | null;
    target: number;
}

/**
 * Actual leverage against the target curve, over the years to retirement.
 *
 * The Y axis is a ratio, not currency, so it is never masked by privacy mode —
 * "1.4×" reveals nothing about how much money you have.
 */
export function GlidepathChart({ data, colors, crossoverAge, maxLeverage, labels }: Props) {
    const rows: Row[] = useMemo(
        () =>
            data.map((p) => ({
                age: Math.round(p.age),
                // Underwater years have no meaningful ratio — break the line
                // rather than spiking it to Infinity.
                actual: Number.isFinite(p.leverage) ? Number(p.leverage.toFixed(3)) : null,
                target: Number(p.targetLeverage.toFixed(3)),
            })),
        [data],
    );

    // Headroom above the ceiling so a breach is visible rather than clipped —
    // but capped at twice the ceiling. Recovering from underwater sends leverage
    // through a huge transient spike as net assets pass through zero, and
    // scaling to that peak would flatten every meaningful year into one line.
    const yMax = useMemo(() => {
        const peak = rows.reduce((m, r) => Math.max(m, r.actual ?? 0, r.target), 0);
        const headroom = Math.max(maxLeverage, Math.ceil(peak * 2) / 2) + 0.25;
        return Math.min(headroom, maxLeverage * 2);
    }, [rows, maxLeverage]);

    // Explicit half-step ticks. Left to itself Recharts derives them from the
    // domain and lands on "0.6× / 1.2× / 2.25×", which misses the 1× and 2×
    // reference lines that carry the meaning of the whole chart.
    const yTicks = useMemo(() => {
        const step = yMax <= 3 ? 0.5 : 1;
        const ticks: number[] = [];
        for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));
        return ticks;
    }, [yMax]);

    // A 35-year horizon is 36 yearly points; labelling every one is unreadable.
    // Land on round ages (…, 35, 40, 45) and always keep the final year.
    const xTicks = useMemo(() => {
        if (rows.length === 0) return [];
        const first = rows[0].age;
        const last = rows[rows.length - 1].age;
        const ticks = rows.map((r) => r.age).filter((a) => a === first || a % 5 === 0);
        if (ticks[ticks.length - 1] !== last) ticks.push(last);
        return ticks;
    }, [rows]);

    return (
        <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700 opacity-50" vertical={false} />
                    <XAxis
                        dataKey="age"
                        tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }}
                        className="text-gray-500 dark:text-gray-400"
                        tickLine={false}
                        ticks={xTicks}
                        interval={0}
                    />
                    <YAxis
                        tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }}
                        className="text-gray-500 dark:text-gray-400"
                        tickLine={false}
                        tickFormatter={(v) => `${v}×`}
                        width={44}
                        tickMargin={4}
                        domain={[0, Number(yMax.toFixed(2))]}
                        ticks={yTicks}
                        // Without this Recharts silently widens the domain to fit
                        // an outlier, undoing the cap above. Clipping the spike is
                        // the point.
                        allowDataOverflow
                        allowDecimals
                    />

                    {/* 1× — the moment borrowing ends. */}
                    <ReferenceLine
                        y={1}
                        stroke="currentColor"
                        className="text-gray-500 dark:text-gray-500"
                        strokeDasharray="4 4"
                        label={{ value: labels.noDebt, position: 'insideBottomRight', fontSize: 10, fill: 'currentColor' }}
                    />
                    {/* The hard ceiling. */}
                    <ReferenceLine
                        y={maxLeverage}
                        stroke="#ef4444"
                        strokeDasharray="4 4"
                        label={{ value: labels.ceiling, position: 'insideTopRight', fontSize: 10, fill: '#ef4444' }}
                    />
                    {crossoverAge !== null && (
                        <ReferenceLine
                            x={crossoverAge}
                            stroke="currentColor"
                            className="text-prosperity-700 dark:text-prosperity-500"
                            strokeDasharray="4 4"
                            label={{ value: `${labels.crossover} · ${crossoverAge}`, position: 'insideTopLeft', fontSize: 10, fill: 'currentColor' }}
                        />
                    )}

                    <Tooltip
                        cursor={{ stroke: colors.actual, strokeWidth: 1.5, strokeDasharray: '5 5' }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload as Row;
                            return (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-3 min-w-[170px]">
                                    <p className="text-xs font-bold text-gray-900 dark:text-white mb-2 pb-1.5 border-b border-gray-100 dark:border-gray-700">
                                        {labels.ageAxis} {d.age}
                                    </p>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="flex items-center gap-1.5" style={{ color: colors.actual }}>
                                                <span className="w-2 h-2 rounded-full" style={{ background: colors.actual }} />
                                                {labels.actual}
                                            </span>
                                            <span className="text-gray-900 dark:text-white font-bold tabular-nums">
                                                {d.actual === null ? '—' : `${d.actual.toFixed(2)}×`}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="flex items-center gap-1.5" style={{ color: colors.target }}>
                                                <span className="w-2 h-2 rounded-full" style={{ background: colors.target }} />
                                                {labels.target}
                                            </span>
                                            <span className="text-gray-900 dark:text-white font-bold tabular-nums">
                                                {d.target.toFixed(2)}×
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }}
                    />

                    <Line type="monotone" dataKey="actual" stroke={colors.actual} strokeWidth={2.5} dot={false} connectNulls={false} activeDot={{ r: 4, fill: colors.actual, stroke: 'white', strokeWidth: 2 }} name={labels.actual} />
                    <Line type="monotone" dataKey="target" stroke={colors.target} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, fill: colors.target, stroke: 'white', strokeWidth: 2 }} name={labels.target} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
