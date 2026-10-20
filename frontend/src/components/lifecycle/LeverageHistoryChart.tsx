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
import type { LeverageHistoryPoint } from '@/lib/lifecycle';

interface LeverageHistoryChartLabels {
    actual: string;
    target: string;
    ceiling: string;
    noDebt: string;
    debt: string;
    exposure: string;
}

interface Props {
    data: LeverageHistoryPoint[];
    colors: { actual: string; target: string };
    targetLeverage: number;
    maxLeverage: number;
    labels: LeverageHistoryChartLabels;
    formatMoney: (v: number) => string;
}

interface Row {
    date: string;
    label: string;
    leverage: number | null;
    debt: number;
    exposure: number;
}

const shortDate = (iso: string) => iso.slice(5).replace('-', '/');

/**
 * Realised leverage over the window, against the same two reference lines the
 * glidepath uses — so the two charts on this page can be read as one story.
 *
 * The Y axis is a ratio, not currency, so it is never masked by privacy mode:
 * "1.4×" reveals nothing about how much money you have. The amounts behind it
 * do, which is why they live in the tooltip, where the privacy setting applies.
 *
 * One plotted series, deliberately. Debt and exposure move on a currency scale
 * thousands of times larger, and putting either on a second axis would let the
 * chart imply any correlation you like by choosing where the two scales cross.
 */
export function LeverageHistoryChart({
    data,
    colors,
    targetLeverage,
    maxLeverage,
    labels,
    formatMoney,
}: Props) {
    const rows: Row[] = useMemo(
        () =>
            data.map((p) => ({
                date: p.date,
                label: shortDate(p.date),
                leverage: p.leverage === null ? null : Number(p.leverage.toFixed(3)),
                debt: p.investmentDebt,
                exposure: p.stockExposure,
            })),
        [data],
    );

    /**
     * Fit the axis to the data, not to the reference lines.
     *
     * Anchoring the top at the ceiling reads well only when the position is
     * near it. At 0.46× against a 2× ceiling it squashes the entire series into
     * the bottom fifth of the plot and the movement — the one thing this chart
     * exists to show — becomes invisible. A reference line that falls outside
     * the fitted range simply is not drawn, and its absence carries the same
     * message the wasted space did: you are nowhere near it.
     *
     * MIN_SPAN is the other half of that trade. Fitting tightly to a series that
     * moved 0.02 would magnify noise into a dramatic slope, so the axis never
     * covers less than a fifth of a turn of leverage.
     */
    const domain = useMemo(() => {
        const values = rows.map((r) => r.leverage).filter((v): v is number => v !== null);
        if (values.length === 0) return { lo: 0, hi: Math.max(1, maxLeverage) };

        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        const pad = Math.max(0.05, (dataMax - dataMin) * 0.35);

        let lo = Math.max(0, dataMin - pad);
        let hi = dataMax + pad;

        const MIN_SPAN = 0.2;
        const shortfall = MIN_SPAN - (hi - lo);
        if (shortfall > 0) {
            lo = Math.max(0, lo - shortfall / 2);
            hi = lo + MIN_SPAN;
        }
        return { lo: Number(lo.toFixed(2)), hi: Number(hi.toFixed(2)) };
    }, [rows, maxLeverage]);

    const yTicks = useMemo(() => {
        const span = domain.hi - domain.lo;
        const step = span <= 0.5 ? 0.05 : span <= 1.5 ? 0.25 : span <= 3 ? 0.5 : 1;
        const ticks: number[] = [];
        for (let v = Math.ceil(domain.lo / step) * step; v <= domain.hi + 1e-9; v += step) {
            ticks.push(Number(v.toFixed(2)));
        }
        return ticks;
    }, [domain]);

    /** A reference line off the fitted axis would only render as a stray edge label. */
    const inRange = (y: number) => y >= domain.lo && y <= domain.hi;

    // A daily series over a year is ~250 points; labelling them all is a smear.
    // Six evenly spaced dates, with the most recent one always present.
    const xTicks = useMemo(() => {
        if (rows.length === 0) return [];
        const stride = Math.max(1, Math.ceil(rows.length / 6));
        const ticks = rows.filter((_, i) => i % stride === 0).map((r) => r.label);
        const last = rows[rows.length - 1].label;
        if (ticks[ticks.length - 1] !== last) ticks.push(last);
        return ticks;
    }, [rows]);

    return (
        <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700 opacity-50" vertical={false} />
                    <XAxis
                        dataKey="label"
                        tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }}
                        className="text-gray-500 dark:text-gray-400"
                        tickLine={false}
                        ticks={xTicks}
                        interval={0}
                        minTickGap={0}
                    />
                    <YAxis
                        tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }}
                        className="text-gray-500 dark:text-gray-400"
                        tickLine={false}
                        tickFormatter={(v) => `${v}×`}
                        width={44}
                        tickMargin={4}
                        domain={[domain.lo, domain.hi]}
                        ticks={yTicks}
                        allowDataOverflow
                        allowDecimals
                    />

                    {/* 1× — the moment borrowing ends. */}
                    {inRange(1) && (
                        <ReferenceLine
                            y={1}
                            stroke="currentColor"
                            className="text-gray-500 dark:text-gray-500"
                            strokeDasharray="4 4"
                            label={{ value: labels.noDebt, position: 'insideBottomRight', fontSize: 10, fill: 'currentColor' }}
                        />
                    )}
                    {/* Where the strategy asks you to be today. */}
                    {inRange(targetLeverage) && (
                        <ReferenceLine
                            y={Number(targetLeverage.toFixed(2))}
                            stroke={colors.target}
                            strokeDasharray="5 4"
                            label={{ value: labels.target, position: 'insideTopLeft', fontSize: 10, fill: colors.target }}
                        />
                    )}
                    {/* The hard ceiling. */}
                    {inRange(maxLeverage) && (
                        <ReferenceLine
                            y={maxLeverage}
                            stroke="#ef4444"
                            strokeDasharray="4 4"
                            label={{ value: labels.ceiling, position: 'insideTopRight', fontSize: 10, fill: '#ef4444' }}
                        />
                    )}

                    <Tooltip
                        cursor={{ stroke: colors.actual, strokeWidth: 1.5, strokeDasharray: '5 5' }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload as Row;
                            return (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-3 min-w-[190px]">
                                    <p className="text-xs font-bold text-gray-900 dark:text-white mb-2 pb-1.5 border-b border-gray-100 dark:border-gray-700">
                                        {d.date}
                                    </p>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="flex items-center gap-1.5" style={{ color: colors.actual }}>
                                                <span className="w-2 h-2 rounded-full" style={{ background: colors.actual }} />
                                                {labels.actual}
                                            </span>
                                            <span className="text-gray-900 dark:text-white font-bold tabular-nums">
                                                {d.leverage === null ? '—' : `${d.leverage.toFixed(2)}×`}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="text-gray-500 dark:text-gray-400">{labels.exposure}</span>
                                            <span className="text-gray-700 dark:text-gray-200 tabular-nums">{formatMoney(d.exposure)}</span>
                                        </div>
                                        <div className="flex justify-between gap-3 text-xs">
                                            <span className="text-gray-500 dark:text-gray-400">{labels.debt}</span>
                                            <span className="text-gray-700 dark:text-gray-200 tabular-nums">{formatMoney(d.debt)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }}
                    />

                    <Line
                        type="monotone"
                        dataKey="leverage"
                        stroke={colors.actual}
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls={false}
                        activeDot={{ r: 4, fill: colors.actual, stroke: 'white', strokeWidth: 2 }}
                        name={labels.actual}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
