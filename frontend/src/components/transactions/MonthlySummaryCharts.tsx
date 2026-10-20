'use client';

/**
 * MonthlySummaryCharts
 *
 * Recharts-powered chart components for the monthly summary page.
 * Extracted into a separate module so they can be lazy-loaded via
 * next/dynamic, keeping recharts out of the monthly-summary initial bundle.
 */

import {
    Bar,
    Line,
    ComposedChart,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Rectangle,
} from 'recharts';
import type { BarProps } from 'recharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { chartTooltipStyle } from '@/lib/charts/tooltipStyle';
import { useIsDark } from '@/contexts/ThemeContext';

interface ChartDataPoint {
    month: string;
    Housing: number;
    Eat: number;
    Investment: number;
    Transfer: number;
    Debt: number;
    Others: number;
    Total: number;
    Income: number;
}

interface PieDataPoint {
    name: string;
    value: number;
    color: string;
}

interface YearlyTotals {
    housing: number;
    eat: number;
    investment: number;
    transfer: number;
    debt: number;
    others: number;
    total: number;
}

interface MonthlySummaryChartsProps {
    chartData: ChartDataPoint[];
    pieData: PieDataPoint[];
    yearlyTotals: YearlyTotals;
    showBarChart: boolean;
    showLineChart: boolean;
    onBarToggle: () => void;
    onLineToggle: () => void;
    chartTitle: string;
    chartSubtitle: string;
    categoryBreakdownTitle: string;
    categoryBreakdownSubtitle: string;
}

const PIE_CATEGORIES = [
    { name: 'Housing', key: 'housing' as const, color: '#3b82f6' },
    { name: 'Eat', key: 'eat' as const, color: '#f59e0b' },
    { name: 'Invest', key: 'investment' as const, color: '#10b981' },
    // Money that only changed pocket: its own slice, not spending hidden in Others.
    { name: 'Transfer', key: 'transfer' as const, color: '#64748b' },
    // Servicing debt is not discretionary, so it gets its own slice rather than
    // inflating Others.
    { name: 'Debt', key: 'debt' as const, color: '#be123c' },
    { name: 'Others', key: 'others' as const, color: '#8b5cf6' },
];

/** The expense stack, bottom to top. */
const STACK = [
    { key: 'Housing', fill: '#3b82f6' },
    { key: 'Eat', fill: '#f59e0b' },
    { key: 'Transfer', fill: '#64748b' },
    { key: 'Debt', fill: '#be123c' },
    { key: 'Others', fill: '#8b5cf6' },
    { key: 'Investment', fill: '#10b981' },
] as const;

const TOP_RADIUS = 4;

/** The highest series with a value in this month's stack — the one that carries the rounded top. */
export function topmostStackKey(row: Record<string, unknown> | undefined): string | undefined {
    if (!row) return undefined;
    for (let i = STACK.length - 1; i >= 0; i--) {
        if ((Number(row[STACK[i].key]) || 0) > 0) return STACK[i].key;
    }
    return undefined;
}

/**
 * Rounds a segment's top corners only when it is the top of its month's stack.
 * A fixed radius on one series (it used to be Investment) left every month
 * without that series square-topped.
 */
export function topRoundedShape(key: string) {
    const Shape = (props: unknown) => {
        const p = props as BarProps & { payload?: Record<string, unknown> };
        const isTop = topmostStackKey(p.payload) === key;
        return <Rectangle {...(p as object)} radius={isTop ? [TOP_RADIUS, TOP_RADIUS, 0, 0] : 0} />;
    };
    Shape.displayName = `TopRounded(${key})`;
    return Shape;
}

/** Built once: a shape made during render would remount every bar on every render. */
const SHAPES: Record<string, ReturnType<typeof topRoundedShape>> = Object.fromEntries(
    STACK.map(({ key }) => [key, topRoundedShape(key)]),
);

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ');
}

export function MonthlySummaryCharts({
    chartData,
    pieData,
    yearlyTotals,
    showBarChart,
    showLineChart,
    onBarToggle,
    onLineToggle,
    chartTitle,
    chartSubtitle,
    categoryBreakdownTitle,
    categoryBreakdownSubtitle,
}: MonthlySummaryChartsProps) {
    const { isValueVisible } = usePrivacy();
    const isDark = useIsDark();
    const { t } = useTranslation(['transactions']);

    // Chart-facing series/category names come from English dataKeys — translate
    // them for tooltips, the pie's category grid, and aria labels.
    const catLabel: Record<string, string> = {
        Housing: t('transactions:monthlySummaryPage.housing', 'Housing'),
        Eat: t('transactions:monthlySummaryPage.eat', 'Eat'),
        Invest: t('transactions:monthlySummaryPage.invest', 'Invest'),
        Investment: t('transactions:monthlySummaryPage.invest', 'Invest'),
        Transfer: t('transactions:monthlySummaryPage.transfer', 'Transfer'),
        Debt: t('transactions:monthlySummaryPage.debt', 'Debt'),
        Others: t('transactions:monthlySummaryPage.others', 'Others'),
        Income: t('transactions:monthlySummaryPage.income', 'Income'),
        Total: t('transactions:monthlySummaryPage.totalExpLabel', 'Total Exp'),
        'Total Exp': t('transactions:monthlySummaryPage.totalExpLabel', 'Total Exp'),
    };
    const tLabel = (name: string) => catLabel[name] ?? name;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-fade-in-up animation-delay-100">
            {/* Composed Bar/Line Chart — 2/3 width on desktop */}
            <Card padding="none" radius="xl" clip className="lg:col-span-2 relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-500 to-prosperity-500" />
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-800">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <span>📊</span>
                                {chartTitle}
                            </h2>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{chartSubtitle}</p>
                        </div>
                        <div className="flex gap-2 bg-gray-100 dark:bg-gray-700/50 rounded-xl p-1.5 shadow-inner">
                            <button
                                onClick={onBarToggle}
                                aria-pressed={showBarChart}
                                className={cn(
                                    'px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                    showBarChart
                                        ? 'bg-primary-700 text-white shadow-md scale-105'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600'
                                )}
                            >
                                <span className="text-base">📊</span>
                                {t('transactions:monthlySummaryPage.bar', 'Bar')}
                            </button>
                            <button
                                onClick={onLineToggle}
                                aria-pressed={showLineChart}
                                className={cn(
                                    'px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                    showLineChart
                                        ? 'bg-primary-700 text-white shadow-md scale-105'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600'
                                )}
                            >
                                <span className="text-base">📈</span>
                                {t('transactions:monthlySummaryPage.line', 'Line')}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="p-4">
                    {/* Legend */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs">
                        {[
                            { color: '#3b82f6', label: t('transactions:monthlySummaryPage.housing', 'Housing') },
                            { color: '#f59e0b', label: t('transactions:monthlySummaryPage.eat', 'Eat') },
                            { color: '#64748b', label: t('transactions:monthlySummaryPage.transfer', 'Transfer') },
                            { color: '#be123c', label: t('transactions:monthlySummaryPage.debt', 'Debt') },
                            { color: '#8b5cf6', label: t('transactions:monthlySummaryPage.others', 'Others') },
                            { color: '#10b981', label: t('transactions:monthlySummaryPage.invest', 'Invest') },
                            { color: '#22c55e', label: t('transactions:monthlySummaryPage.income', 'Income') },
                            { color: '#ef4444', label: t('transactions:monthlySummaryPage.totalExpLabel', 'Total Exp') },
                        ].map(({ color, label }) => (
                            <div key={label} className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                                <span className="text-gray-600 dark:text-gray-400 font-medium">{label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="h-64" role="img" aria-label={`${chartTitle}. ${chartSubtitle}`}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 30, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    {[
                                        { id: 'housingGradient', color: '#3b82f6' },
                                        { id: 'eatGradient', color: '#f59e0b' },
                                        { id: 'investmentGradient', color: '#10b981' },
                                        { id: 'othersGradient', color: '#8b5cf6' },
                                    ].map(({ id, color }) => (
                                        <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                                            <stop offset="95%" stopColor={color} stopOpacity={0.05} />
                                        </linearGradient>
                                    ))}
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" className="opacity-30" stroke="#e5e7eb" />
                                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                                <YAxis
                                    tick={{ fontSize: 11 }}
                                    stroke="#9ca3af"
                                    tickFormatter={(value) => {
                                        const v = value as number;
                                        return Math.abs(v) >= 1_000_000
                                            ? `NT$${(v / 1_000_000).toFixed(1)}M`
                                            : `NT$${(v / 1000).toFixed(0)}K`;
                                    }}
                                />
                                <Tooltip
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 backdrop-blur-sm">
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 font-medium">{label}</p>
                                                    <div className="space-y-2">
                                                        {payload.filter(entry => (entry.value as number) > 0).map((entry, index) => (
                                                            <div key={index} className="flex items-center justify-between gap-4">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color || entry.stroke }} />
                                                                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{tLabel(String(entry.name))}</span>
                                                                </div>
                                                                <span className="text-sm font-bold" style={{ color: entry.color || entry.stroke }}>
                                                                    {isValueVisible ? formatTWD(entry.value as number) : '•••••'}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                {showBarChart && STACK.map(({ key, fill }) => (
                                    <Bar key={key} dataKey={key} stackId="a" fill={fill} isAnimationActive={false}
                                        shape={SHAPES[key]} />
                                ))}
                                {showLineChart && (
                                    <Line type="monotone" dataKey="Income" stroke="#22c55e" strokeWidth={3}
                                        dot={{ r: 4, fill: '#22c55e' }} activeDot={{ r: 6, fill: '#22c55e', stroke: '#fff', strokeWidth: 3 }}
                                        name="Income" isAnimationActive={false} />
                                )}
                                {showLineChart && (
                                    <Line type="monotone" dataKey="Total" stroke="#ef4444" strokeWidth={3} strokeDasharray="6 4"
                                        dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 6, fill: '#ef4444', stroke: '#fff', strokeWidth: 3 }}
                                        name="Total Exp" isAnimationActive={false} />
                                )}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </Card>

            {/* Pie chart — category breakdown */}
            <Card padding="none" radius="xl" className="relative flex flex-col">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-500 to-prosperity-500" />
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-800">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <span>📊</span>
                        {categoryBreakdownTitle}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{categoryBreakdownSubtitle}</p>
                </div>
                <div className="flex-1 flex flex-col justify-center p-4">
                    {pieData.length > 0 ? (
                        <div
                            className="h-48 flex justify-center mb-4"
                            role="img"
                            aria-label={`${categoryBreakdownTitle}: ${pieData.map(d => `${tLabel(d.name)} ${yearlyTotals.total > 0 ? Math.round((d.value / yearlyTotals.total) * 100) : 0}%`).join(', ')}`}
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={70}
                                        paddingAngle={2}
                                        dataKey="value"
                                        isAnimationActive={false}
                                    >
                                        {pieData.map((d) => (
                                            <Cell key={d.name} fill={d.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: number | string, name) => [isValueVisible ? formatTWD(Number(value)) : '•••••', tLabel(String(name))]}
                                        {...chartTooltipStyle(isDark)}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400 mb-4">
                            {t('transactions:monthlySummaryPage.noDataAvailable', 'No data available')}
                        </div>
                    )}
                    {/* Category totals */}
                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                        {PIE_CATEGORIES.map(c => (
                            <div key={c.key}>
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                                    <span className="font-medium text-gray-600 dark:text-gray-400">{tLabel(c.name)}</span>
                                </div>
                                <div className="font-bold text-gray-900 dark:text-white">
                                    {isValueVisible ? formatTWD(yearlyTotals[c.key]) : '•••••'}
                                </div>
                                <div className="text-gray-500 dark:text-gray-400">
                                    {yearlyTotals.total > 0 ? ((yearlyTotals[c.key] / yearlyTotals.total) * 100).toFixed(1) : 0}%
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        </div>
    );
}
