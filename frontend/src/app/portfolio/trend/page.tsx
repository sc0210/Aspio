'use client';

import { useState, useMemo, useCallback, useTransition, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeftIcon,
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
    ArrowsPointingOutIcon,
    ArrowsPointingInIcon,
    ArrowDownTrayIcon,
    ArrowPathIcon,
    MagnifyingGlassIcon,
    FunnelIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    ChevronUpDownIcon,
    CalendarDaysIcon,
    ChartBarSquareIcon,
} from '@heroicons/react/24/outline';
import dynamic from 'next/dynamic';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_BUTTON } from '@/components/layout/topBarStyles';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
// Type-only imports — no runtime cost
import type { AssetTrendDataPoint, BenchmarkSeries } from '@/components/portfolio/AssetTrendChart';
// AssetTrendChart and PortfolioCalendarHeatmap both import recharts — lazy-load
// them so recharts is not pulled into the initial page bundle.
const AssetTrendChart = dynamic(
  () => import('@/components/portfolio/AssetTrendChart').then(m => ({ default: m.AssetTrendChart })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl h-96" role="status" aria-label="Loading chart" /> }
);
const PortfolioCalendarHeatmap = dynamic(
  () => import('@/components/portfolio/PortfolioCalendarHeatmap').then(m => ({ default: m.PortfolioCalendarHeatmap })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl h-64" role="status" aria-label="Loading heatmap" /> }
);
import { DateRangePicker, DateRange } from '@/components/portfolio/DateRangePicker';
import { portfolioService } from '@/services/portfolioService';
import { aggregateHoldingsBySymbol } from '@/utils/portfolio-aggregation';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useAppMode } from '@/hooks/useAppMode';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { dailyPerformanceKey, DAILY_PERFORMANCE_DAYS_MAX } from '@/lib/queryKeys';
import { usePortfolioSnapshot } from '@/hooks/portfolio/usePortfolioSnapshot';
import { allTimeReturnPercent, filterTrendByPreset, type TrendPreset } from '@/lib/portfolio/trendRange';

// ─── Types ───────────────────────────────────────────────────────────────────

type DateRangePreset = TrendPreset;

type SortKey =
    | 'symbol'
    | 'name'
    | 'quantity'
    | 'avgCost'
    | 'startValue'
    | 'endValue'
    | 'periodChange'
    | 'periodChangePct'
    | 'weight';

interface HoldingRow {
    symbol: string;
    name: string;
    type: string;
    quantity: number;
    avgCost: number;
    currency: string;
    currentPrice: number;
    currentValue: number;
    startValue: number | null;
    endValue: number | null;
    periodChange: number | null;
    periodChangePct: number | null;
    isPartialPeriod: boolean; // true when asset wasn't held since the period start
    weight: number;
    totalCost: number;
    lotCount: number;
    sparkline: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRESET_LABELS: Record<string | number, string> = {
    7: '7D',
    30: '30D',
    90: '90D',
    365: '1Y',
    ytd: 'YTD',
    '3y': '3Y',
    '5y': '5Y',
    max: 'MAX',
};

// ─── Skeleton components (matching PortfolioSkeleton animate-pulse style) ────

function ChartSkeleton() {
    return (
        <div className="h-full flex flex-col gap-4 px-2 pt-2 pb-4 animate-pulse">
            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
                {[80, 72, 96, 64].map((w, i) => (
                    <div key={i} className="bg-gray-100 dark:bg-gray-800 rounded-xl p-4">
                        <div className={`h-3 bg-gray-200 dark:bg-gray-700 rounded mb-2 w-${w < 80 ? '16' : '20'}`} />
                        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                    </div>
                ))}
            </div>
            {/* Chart area */}
            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        </div>
    );
}

function TableRowsSkeleton({ rows = 6 }: { rows?: number }) {
    return (
        <div className="animate-pulse divide-y divide-gray-100 dark:divide-gray-700/50">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                    {/* Symbol + badge */}
                    <div className="w-28 flex-shrink-0">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-2" />
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-10" />
                    </div>
                    {/* Name */}
                    <div className="flex-1 min-w-0">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-36" />
                    </div>
                    {/* Numeric cols */}
                    {[48, 56, 72, 72, 60, 52, 60].map((w, j) => (
                        <div key={j} className="flex-shrink-0" style={{ width: `${w + 16}px` }}>
                            <div
                                className="h-4 bg-gray-200 dark:bg-gray-700 rounded ml-auto"
                                style={{ width: `${w}px` }}
                            />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

// ─── Holdings Table ───────────────────────────────────────────────────────────

interface HoldingsTableProps {
    rows: HoldingRow[];
    currency: string;
    isValueVisible: boolean;
    isLoading: boolean;
}

function SortIcon({
    active,
    dir,
}: {
    active: boolean;
    dir: 'asc' | 'desc';
}) {
    if (!active) return <ChevronUpDownIcon className="w-3.5 h-3.5 opacity-40" />;
    return dir === 'asc' ? (
        <ChevronUpIcon className="w-3.5 h-3.5 text-primary-500" />
    ) : (
        <ChevronDownIcon className="w-3.5 h-3.5 text-primary-500" />
    );
}

function HoldingsTable({ rows, currency, isValueVisible, isLoading }: HoldingsTableProps) {
    const { t } = useTranslation(['portfolio']);
    const [sortKey, setSortKey] = useState<SortKey>('weight');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>('all');

    const handleSort = useCallback(
        (key: SortKey) => {
            if (sortKey === key) {
                setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            } else {
                setSortKey(key);
                setSortDir('desc');
            }
        },
        [sortKey],
    );

    // Unique asset types for filter — exclude 'cash' (has its own fixed section)
    const assetTypes = useMemo(
        () => ['all', ...Array.from(new Set(rows.filter((r) => r.type !== 'cash').map((r) => r.type)))],
        [rows],
    );

    const filtered = useMemo(() => {
        let result = rows;
        if (typeFilter !== 'all') result = result.filter((r) => r.type === typeFilter);
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
            );
        }
        // Always split: investments on top (sorted), cash pinned to bottom
        const investments = [...result.filter((r) => r.type !== 'cash')].sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            const va = a[sortKey] ?? -Infinity;
            const vb = b[sortKey] ?? -Infinity;
            if (typeof va === 'string' && typeof vb === 'string') return mul * va.localeCompare(vb);
            return mul * ((va as number) - (vb as number));
        });
        const cash = [...result.filter((r) => r.type === 'cash')].sort(
            (a, b) => b.currentValue - a.currentValue,
        );
        return { investments, cash };
    }, [rows, sortKey, sortDir, search, typeFilter]);

    const totalFiltered = filtered.investments.length + filtered.cash.length;

    // Render helper (not a component) for a sortable header cell. Called as
    // {col({...})} rather than <Col/> so it doesn't create a new component type
    // each render (react-hooks/static-components).
    const col = ({
        label,
        sortK,
        className,
        right,
    }: {
        label: string;
        sortK: SortKey;
        className?: string;
        right?: boolean;
    }) => (
        <th
            className={cn(
                'px-4 py-3.5 text-xs font-bold uppercase tracking-wide cursor-pointer select-none',
                'hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors',
                right ? 'text-right' : 'text-left',
                className,
            )}
            onClick={() => handleSort(sortK)}
        >
            <span className="inline-flex items-center gap-1.5">
                {label}
                <SortIcon active={sortKey === sortK} dir={sortDir} />
            </span>
        </th>
    );

    if (isLoading) {
        return (
            <div className="flex flex-col min-h-[400px]">
                {/* Dimmed toolbar placeholder */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 animate-pulse">
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-48" />
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-52" />
                    <div className="ml-auto h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                </div>
                {/* Header row placeholder */}
                <div className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 animate-pulse">
                    {[100, 160, 60, 72, 88, 80, 72, 64, 72].map((w, i) => (
                        <div
                            key={i}
                            className="h-3 bg-gray-300 dark:bg-gray-600 rounded flex-shrink-0"
                            style={{ width: `${w}px` }}
                        />
                    ))}
                </div>
                <TableRowsSkeleton rows={6} />
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="flex items-center justify-center py-16">
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('portfolio:holdings.noHoldingsInWallet')}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-[400px]">
            {/* Table toolbar */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                {/* Search */}
                <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('portfolio:trend.searchPlaceholder', 'Search symbol / name…')}
                        aria-label={t('portfolio:trend.searchPlaceholder', 'Search symbol / name…')}
                        className={cn(
                            'pl-8 pr-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600',
                            'bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent',
                            'w-48',
                        )}
                    />
                </div>
                {/* Type filter */}
                <div className="flex items-center gap-1.5">
                    <FunnelIcon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    <div className="flex gap-1">
                        {assetTypes.map((t) => (
                            <button
                                key={t}
                                onClick={() => setTypeFilter(t)}
                                className={cn(
                                    'px-2.5 py-1 text-[11px] font-semibold rounded-lg capitalize transition-all',
                                    typeFilter === t
                                        ? 'bg-primary-700 text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600',
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                    {totalFiltered} holding{totalFiltered !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Scrollable table */}
            <div className="relative flex-shrink-0 pb-6">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                        <tr>
                            {col({ label: 'Symbol', sortK: 'symbol', className: 'min-w-[100px]' })}
                            {col({ label: 'Name', sortK: 'name', className: 'min-w-[180px]' })}
                            {col({ label: 'Qty', sortK: 'quantity', right: true })}
                            {col({ label: 'Avg Cost', sortK: 'avgCost', right: true })}
                            {col({ label: 'Period Start', sortK: 'startValue', right: true })}
                            {col({ label: 'Period End', sortK: 'endValue', right: true })}
                            {col({ label: 'Change', sortK: 'periodChange', right: true })}
                            {col({ label: 'Change %', sortK: 'periodChangePct', right: true })}
                            {col({ label: 'Weight', sortK: 'weight', right: true })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {filtered.investments.map((row, idx) => {
                            const isPositive = (row.periodChangePct ?? 0) >= 0;
                            // hasData: either a $ change or a % change is available
                            const hasData = row.periodChange !== null || row.periodChangePct !== null;
                            return (
                                <tr
                                    key={`${row.symbol}__${row.name}`}
                                    className={cn(
                                        'transition-colors',
                                        idx % 2 === 0
                                            ? 'bg-white dark:bg-gray-900'
                                            : 'bg-gray-50/50 dark:bg-gray-800/30',
                                        'hover:bg-primary-50/40 dark:hover:bg-primary-900/10',
                                    )}
                                >
                                    {/* Symbol */}
                                    <td className="px-4 py-3.5">
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-sm font-mono font-bold text-gray-900 dark:text-gray-100">
                                                {row.symbol}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs uppercase font-semibold px-1.5 py-0.5 rounded bg-blue-100/80 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                                    {row.type}
                                                </span>
                                                {row.lotCount > 1 && (
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                                        {row.lotCount} lots
                                                    </span>
                                                )}
                                                {row.isPartialPeriod && (
                                                    <span
                                                        title="Purchased after the period start — stats reflect time held, not the full period"
                                                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100/80 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 cursor-help"
                                                    >
                                                        partial
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    {/* Name */}
                                    <td className="px-4 py-3.5 max-w-[200px]">
                                        <span className="text-gray-800 dark:text-gray-200 truncate block text-sm font-medium">
                                            {row.name}
                                        </span>
                                    </td>
                                    {/* Qty */}
                                    <td className="px-4 py-3.5 text-right">
                                        <span className="text-gray-700 dark:text-gray-300 tabular-nums text-sm">
                                            {row.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                        </span>
                                    </td>
                                    {/* Avg Cost */}
                                    <td className="px-4 py-3.5 text-right">
                                        <span className="text-gray-700 dark:text-gray-300 tabular-nums text-sm">
                                            {isValueVisible ? formatCurrency(row.avgCost, row.currency) : '•••'}
                                        </span>
                                    </td>
                                    {/* Period Start Value */}
                                    <td className="px-4 py-3.5 text-right">
                                        {row.isPartialPeriod ? (
                                            <span
                                                title="Not held at period start"
                                                className="text-gray-500 dark:text-gray-500 text-xs italic"
                                            >
                                                n/a
                                            </span>
                                        ) : (
                                            <span className="text-gray-600 dark:text-gray-400 tabular-nums text-sm">
                                                {isValueVisible
                                                    ? row.startValue !== null
                                                        ? formatCurrency(row.startValue, currency)
                                                        : '—'
                                                    : '•••'}
                                            </span>
                                        )}
                                    </td>
                                    {/* Period End Value */}
                                    <td className="px-4 py-3.5 text-right">
                                        <span className="font-semibold text-gray-900 dark:text-white tabular-nums text-sm">
                                            {isValueVisible
                                                ? row.endValue !== null
                                                    ? formatCurrency(row.endValue, currency)
                                                    : formatCurrency(row.currentValue, currency)
                                                : '•••'}
                                        </span>
                                    </td>
                                    {/* Change $ */}
                                    <td className="px-4 py-3.5 text-right">
                                        {hasData ? (
                                            <span
                                                className={cn(
                                                    'font-semibold tabular-nums text-sm',
                                                    isPositive
                                                        ? 'text-success-700 dark:text-success-400'
                                                        : 'text-error-700 dark:text-error-400',
                                                )}
                                            >
                                                {isValueVisible
                                                    ? `${isPositive ? '+' : ''}${formatCurrency(row.periodChange!, currency)}`
                                                    : '•••'}
                                            </span>
                                        ) : (
                                            <span className="text-gray-500 dark:text-gray-500 text-sm">—</span>
                                        )}
                                    </td>
                                    {/* Change % */}
                                    <td className="px-4 py-3.5 text-right">
                                        {row.periodChangePct !== null ? (
                                            <span
                                                title={row.isPartialPeriod ? 'Based on cost basis (partial period)' : undefined}
                                                className={cn(
                                                    'inline-flex items-center gap-1 font-bold tabular-nums text-xs px-2.5 py-1 rounded-full',
                                                    isPositive
                                                        ? 'bg-success-100/80 dark:bg-success-900/30 text-success-700 dark:text-success-400'
                                                        : 'bg-error-100/80 dark:bg-error-900/30 text-error-700 dark:text-error-400',
                                                )}
                                            >
                                                {isPositive ? (
                                                    <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
                                                ) : (
                                                    <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
                                                )}
                                                {isPositive ? '+' : ''}
                                                {row.periodChangePct.toFixed(2)}%
                                                {row.isPartialPeriod && <span className="opacity-60 font-normal">*</span>}
                                            </span>
                                        ) : (
                                            <span className="text-gray-500 dark:text-gray-500 text-sm">—</span>
                                        )}
                                    </td>
                                    {/* Weight */}
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="flex flex-col items-end gap-1.5">
                                            <span className="text-sm text-gray-700 dark:text-gray-300 tabular-nums font-semibold">
                                                {row.weight.toFixed(1)}%
                                            </span>
                                            <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600"
                                                    style={{ width: `${Math.min(row.weight, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>

                    {/* ── Cash section ── */}
                    {filtered.cash.length > 0 && (
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                            {/* Section divider row */}
                            <tr className="bg-gray-100/60 dark:bg-gray-800/60">
                                <td colSpan={9} className="px-4 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                            Cash &amp; Equivalents
                                        </span>
                                        <span className="text-[10px] text-gray-500 dark:text-gray-500">
                                            — no market P&amp;L
                                        </span>
                                        <span className="ml-auto text-[10px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                            {isValueVisible
                                                ? formatCurrency(
                                                    filtered.cash.reduce((s, r) => s + r.currentValue, 0),
                                                    currency,
                                                )
                                                : '•••'}
                                        </span>
                                    </div>
                                </td>
                            </tr>
                            {filtered.cash.map((row) => (
                                <tr
                                    key={`${row.symbol}__${row.name}`}
                                    className="bg-gray-50/30 dark:bg-gray-800/20 hover:bg-gray-100/50 dark:hover:bg-gray-800/40 transition-colors"
                                >
                                    {/* Symbol */}
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-sm font-mono font-bold text-gray-600 dark:text-gray-400">
                                                {row.symbol}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-200/80 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400">
                                                    cash
                                                </span>
                                                {row.lotCount > 1 && (
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                                        {row.lotCount} lots
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    {/* Name */}
                                    <td className="px-4 py-3 max-w-[200px]">
                                        <span className="text-gray-600 dark:text-gray-400 truncate block text-sm">
                                            {row.name}
                                        </span>
                                    </td>
                                    {/* Qty (balance) */}
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-gray-500 dark:text-gray-400 tabular-nums text-sm">
                                            {row.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </span>
                                    </td>
                                    {/* Avg Cost — always $1 for cash, not meaningful */}
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-gray-500 dark:text-gray-500 text-sm">—</span>
                                    </td>
                                    {/* Period Start Balance */}
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-gray-500 dark:text-gray-400 tabular-nums text-sm">
                                            {isValueVisible
                                                ? row.startValue !== null
                                                    ? formatCurrency(row.startValue, currency)
                                                    : '—'
                                                : '•••'}
                                        </span>
                                    </td>
                                    {/* Period End Balance */}
                                    <td className="px-4 py-3 text-right">
                                        <span className="font-semibold text-gray-700 dark:text-gray-300 tabular-nums text-sm">
                                            {isValueVisible ? formatCurrency(row.currentValue, currency) : '•••'}
                                        </span>
                                    </td>
                                    {/* Change — cash doesn't generate market P&L */}
                                    <td className="px-4 py-3 text-right" colSpan={2}>
                                        <span className="text-gray-500 dark:text-gray-500 text-xs italic">no market P&amp;L</span>
                                    </td>
                                    {/* Weight */}
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex flex-col items-end gap-1.5">
                                            <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums font-medium">
                                                {row.weight.toFixed(1)}%
                                            </span>
                                            <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gray-400 dark:bg-gray-500"
                                                    style={{ width: `${Math.min(row.weight, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    )}
                </table>
                </div>
                {/* Right-edge fade hint — visible on mobile when table overflows horizontally */}
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white dark:from-gray-900 to-transparent sm:hidden" />
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrendPage() {
    const { isDemo, isAuthenticated, user } = useAppMode();
    const { isValueVisible, toggleValueVisibility } = usePrivacy();
    const queryClient = useQueryClient();
    const { t } = useTranslation(['portfolio']);
    const searchParams = useSearchParams();

    const [preset, setPreset] = useState<DateRangePreset>(365);
    const [customRange, setCustomRange] = useState<DateRange>({ startDate: null, endDate: null });
    const [activeView, setActiveView] = useState<'chart' | 'calendar'>(
        searchParams.get('view') === 'calendar' ? 'calendar' : 'chart'
    );
    const [isChartExpanded, setIsChartExpanded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isPeriodPending, startPeriodTransition] = useTransition();
    const [selectedBenchmark, setSelectedBenchmark] = useState<string | null>(null);
    const [customBenchmarkInput, setCustomBenchmarkInput] = useState('');
    const PRESET_BENCHMARKS = [null, 'SPY', 'QQQ', '0050.TW'] as const;
    const isCustomBenchmark = selectedBenchmark !== null && !(PRESET_BENCHMARKS as readonly (string | null)[]).includes(selectedBenchmark);

    // ─── Price refresh ────────────────────────────────────────────────────────────

    const handleRefreshPrices = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        // Demo mode has no backend session — skip the price endpoint (it 401s) and
        // just re-read local fixtures so the charts still reflect session changes.
        if (isDemo) {
            try {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
                    queryClient.invalidateQueries({ queryKey: ['portfolio-analytics'] }),
                    queryClient.invalidateQueries({ queryKey: ['portfolio-daily-performance'] }),
                ]);
                toast.success(t('portfolio:toast.demoRefreshed', 'Demo data refreshed'), { id: 'refresh-prices' });
            } finally {
                setIsRefreshing(false);
            }
            return;
        }
        toast.loading(t('portfolio:toast.pricesUpdating'), { id: 'refresh-prices' });
        try {
            const result = await portfolioService.refreshPortfolioPrices(true);
            if (result.success) {
                // invalidateQueries marks queries stale and auto-refetches active ones.
                // No separate refetchQueries call needed — that would cause a double-fetch.
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
                    queryClient.invalidateQueries({ queryKey: ['portfolio-analytics'] }),
                    queryClient.invalidateQueries({ queryKey: ['portfolio-daily-performance'] }),
                ]);
                const stats = result.data;
                if (stats && stats.updated > 0) {
                    toast.success(t('portfolio:toast.pricesUpdated', { count: stats.updated }), { id: 'refresh-prices' });
                } else {
                    toast.success(t('portfolio:toast.pricesCurrent'), { id: 'refresh-prices' });
                }
            } else {
                toast.error(t('portfolio:toast.pricesFailed'), { id: 'refresh-prices' });
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
                toast.error(t('portfolio:toast.tooManyRequests'), { id: 'refresh-prices' });
            } else {
                toast.error(t('portfolio:toast.pricesFailed'), { id: 'refresh-prices' });
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [isRefreshing, isDemo, queryClient, t]);

    // ─── Fetch data ─────────────────────────────────────────────────────────────

    const [hasDataGaps, setHasDataGaps] = useState(false);
    const [gapSymbols, setGapSymbols] = useState<string[]>([]);
    const [hasNoHistoricalData, setHasNoHistoricalData] = useState(false);
    // True when backend explicitly signals the feature is temporarily unavailable (503).
    // Suppresses auto-sync and shows a "check back soon" message instead of the fetch button.
    const [isFeatureTemporarilyDisabled, setIsFeatureTemporarilyDisabled] = useState(false);
    const [isSyncingHistory, setIsSyncingHistory] = useState(false);
    const autoSyncFiredRef = useRef(false);

    const handleSyncHistorical = useCallback(async () => {
        if (isSyncingHistory) return;
        setIsSyncingHistory(true);
        toast.loading('Fetching price history…', { id: 'sync-history' });
        try {
            const result = await portfolioService.syncHistoricalPrices(365);
            if (result.success) {
                toast.success('Price history updated', { id: 'sync-history' });
                await queryClient.invalidateQueries({ queryKey: ['portfolio-daily-performance'] });
                setHasDataGaps(false);
                setGapSymbols([]);
                setHasNoHistoricalData(false);
                autoSyncFiredRef.current = false;
            } else {
                toast.error('Failed to sync price history', { id: 'sync-history' });
            }
        } catch {
            toast.error('Failed to sync price history', { id: 'sync-history' });
        } finally {
            setIsSyncingHistory(false);
        }
    }, [isSyncingHistory, queryClient]);

    // Auto-sync once when gaps or zero historical data are detected on first load.
    // Do NOT auto-sync when the feature is explicitly disabled on the backend (503).
    useEffect(() => {
        const shouldSync = (hasDataGaps || hasNoHistoricalData) && !isFeatureTemporarilyDisabled && isAuthenticated && !autoSyncFiredRef.current && !isSyncingHistory;
        if (shouldSync) {
            autoSyncFiredRef.current = true;
            handleSyncHistorical();
        }
    }, [hasDataGaps, hasNoHistoricalData, isFeatureTemporarilyDisabled, isAuthenticated, isSyncingHistory, handleSyncHistorical]);

    const { data: trendData = [], isLoading: isLoadingTrend, isFetching: isFetchingTrend } = useQuery({
        queryKey: dailyPerformanceKey(user?.email, DAILY_PERFORMANCE_DAYS_MAX),
        queryFn: async () => {
            // Demo mode still fetches: the backend serves generated demo daily data
            // for unauthenticated requests (matches the main portfolio page), so the
            // calendar/chart populate and re-sync when the Refresh button invalidates
            // this query. Returning [] here previously left the calendar permanently blank.
            const res = await portfolioService.getDailyPerformance(DAILY_PERFORMANCE_DAYS_MAX);
            const msg: string = (res as { message?: string })?.message ?? '';
            // Detect gap sentinel in message: "Retrieved N days|gaps:SYM1,SYM2"
            const gapMatch = msg.match(/\|gaps:([^|]+)/);
            const isTemporarilyUnavailable =
                !res.success && /temporarily unavailable|coming soon/i.test(msg);

            if (isTemporarilyUnavailable) {
                setIsFeatureTemporarilyDisabled(true);
                setHasDataGaps(false);
                setGapSymbols([]);
                setHasNoHistoricalData(false);
            } else if (gapMatch) {
                setIsFeatureTemporarilyDisabled(false);
                setHasDataGaps(true);
                setGapSymbols(gapMatch[1].split(','));
                setHasNoHistoricalData(false);
            } else if (!res.success || (res.data ?? []).length === 0) {
                // Backend returned empty — no holdings or no historical prices yet
                setIsFeatureTemporarilyDisabled(false);
                setHasDataGaps(false);
                setGapSymbols([]);
                setHasNoHistoricalData(true);
            } else {
                setIsFeatureTemporarilyDisabled(false);
                setHasDataGaps(false);
                setGapSymbols([]);
                setHasNoHistoricalData(false);
            }
            return res.success ? res.data : [];
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: true,
    });

    // Shared with each holding's page, so moving between them reads one cache entry.
    const { data: portfolioData, isLoading: isLoadingPortfolio, isFetching: isFetchingPortfolio } = usePortfolioSnapshot();

    // ─── Filtered trend slice ────────────────────────────────────────────────────

    const filteredTrend = useMemo(
        () => filterTrendByPreset(trendData as AssetTrendDataPoint[], preset, customRange),
        [trendData, preset, customRange],
    );

    // "all-time" under Period Return reads the whole series, not the period slice.
    const allTimeReturnPct = useMemo(
        () => allTimeReturnPercent(trendData as AssetTrendDataPoint[]),
        [trendData],
    );

    // ─── Benchmark data ──────────────────────────────────────────────────────────

    const benchmarkDays = useMemo(() => {
        if (typeof preset === 'number') return preset;
        if (preset === 'ytd') return Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000);
        if (preset === '3y') return 365 * 3;
        if (preset === '5y') return 365 * 5;
        if (preset === 'max') return 365 * 5;
        if (preset === 'custom' && customRange.startDate && customRange.endDate) {
            return Math.ceil((customRange.endDate.getTime() - customRange.startDate.getTime()) / 86400000);
        }
        return 365;
    }, [preset, customRange]);

    const { data: rawBenchmarkData, isError: isBenchmarkError, error: benchmarkError } = useQuery({
        queryKey: ['benchmark', selectedBenchmark, benchmarkDays],
        queryFn: async () => {
            if (!selectedBenchmark) return null;
            return portfolioService.getBenchmarkData(selectedBenchmark, benchmarkDays);
        },
        enabled: !!selectedBenchmark,
        staleTime: 60 * 60 * 1000,
        gcTime: 2 * 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
        throwOnError: false,
    });

    useEffect(() => {
        if (!isBenchmarkError || !benchmarkError) return;
        toast.error(`Benchmark "${selectedBenchmark}": ${(benchmarkError as Error).message}`, { id: 'benchmark-error' });
        setSelectedBenchmark(null);
        setCustomBenchmarkInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBenchmarkError, benchmarkError]);

    // Re-normalize benchmark to the filtered period's start date
    const benchmark = useMemo<BenchmarkSeries | null>(() => {
        if (!rawBenchmarkData || !rawBenchmarkData.points.length) return null;
        if (!filteredTrend.length) return rawBenchmarkData as BenchmarkSeries;

        const periodStart = filteredTrend[0].date;
        const periodEnd = filteredTrend[filteredTrend.length - 1].date;

        const filtered = rawBenchmarkData.points.filter(p => p.date >= periodStart && p.date <= periodEnd);
        if (filtered.length === 0) return null;

        const baseClose = filtered[0].close;
        const renormalized = filtered.map(p => ({
            ...p,
            returnPct: ((p.close - baseClose) / baseClose) * 100,
        }));

        return { ...rawBenchmarkData, points: renormalized };
    }, [rawBenchmarkData, filteredTrend]);

    // Create a stable key for chart re-rendering when period changes
    const chartKey = useMemo(() => {
        if (preset === 'custom' && customRange.startDate && customRange.endDate) {
            return `custom-${customRange.startDate.getTime()}-${customRange.endDate.getTime()}`;
        }
        return `preset-${preset}`;
    }, [preset, customRange]);

    // ─── Holdings table data ─────────────────────────────────────────────────────

    const holdingRows = useMemo<HoldingRow[]>(() => {
        if (!portfolioData?.holdings || portfolioData.holdings.length === 0) return [];
        if (filteredTrend.length === 0) return [];

        const currency = portfolioData.currency || 'TWD';

        // Derive per-holding period changes from topHoldings arrays in the trend data
        // topHoldings entry: { symbol, change, value } — change is daily P&L, value is holding value that day

        // Map: symbol → { startValue, endValue, cumulativeChange }
        const firstPoint = filteredTrend[0];
        const lastPoint = filteredTrend[filteredTrend.length - 1];

        const startHoldings: Record<string, number> = {};
        const endHoldings: Record<string, number> = {};

        (firstPoint.topHoldings || []).forEach((h) => {
            startHoldings[h.symbol] = h.value;
        });
        (lastPoint.topHoldings || []).forEach((h) => {
            endHoldings[h.symbol] = h.value;
        });

        // Accumulate daily P&L changes per symbol across the full period.
        // This is more reliable than snapshot-diff (ev - sv) because:
        //  • it naturally handles assets bought mid-period (accumulation starts on purchase day)
        //  • it isn't affected by stale/missing snapshot values on boundary dates
        const cumulativeChange: Record<string, number> = {};
        for (const point of filteredTrend) {
            for (const h of point.topHoldings || []) {
                cumulativeChange[h.symbol] = (cumulativeChange[h.symbol] ?? 0) + h.change;
            }
        }

        const totalValue = portfolioData.totalValue || 1;

        // First pass: aggregate by symbol+walletType (groups individual lots)
        const aggregated = aggregateHoldingsBySymbol(portfolioData.holdings);

        // First pass → HoldingRow
        const firstPassRows: HoldingRow[] = aggregated.map((h) => {
            const sv = startHoldings[h.symbol];
            const ev = endHoldings[h.symbol];
            const cumChange = cumulativeChange[h.symbol]; // sum of daily P&L — undefined if no daily data at all

            const startValue = sv !== undefined ? sv : null;
            const endValue = ev !== undefined ? ev : null;

            // An asset is "partial" if it has no snapshot at the period start —
            // meaning it was purchased after the period began.
            const isPartialPeriod =
                sv === undefined && (cumChange !== undefined || ev !== undefined);

            // Prefer cumulativeChange (sum of daily P&L) as the canonical period change.
            // Fall back to snapshot diff only when daily data is fully absent.
            let periodChange: number | null;
            if (cumChange !== undefined) {
                periodChange = cumChange;
            } else if (startValue !== null && endValue !== null) {
                periodChange = endValue - startValue;
            } else {
                periodChange = null;
            }

            // % change: only meaningful when the asset was held for the full period
            // (i.e. a period-start snapshot exists as the reference point).
            // For partial-period holdings there is no valid baseline, so we leave it null.
            let periodChangePct: number | null = null;
            if (periodChange !== null && startValue !== null && startValue > 0) {
                periodChangePct = (periodChange / startValue) * 100;
            }

            return {
                symbol: h.symbol,
                name: h.name,
                type: h.type,
                quantity: h.quantity,
                avgCost: h.averageCost,
                currency: h.currency || currency,
                currentPrice: h.currentPrice,
                currentValue: h.totalValue,
                startValue,
                endValue,
                periodChange,
                periodChangePct,
                isPartialPeriod,
                weight: totalValue > 0 ? (h.totalValue / totalValue) * 100 : 0,
                totalCost: h.totalCost ?? h.quantity * h.averageCost,
                lotCount: (h.metadata?.lotCount as number) ?? 1,
                sparkline: h.sparklineData ?? [],
            };
        });

        // Second pass: merge rows that share the same symbol+name
        // (handles same-named cash accounts spread across multiple wallet types)
        const nameMap = new Map<string, HoldingRow>();
        for (const row of firstPassRows) {
            const key = `${row.symbol}__${row.name}`;
            const existing = nameMap.get(key);
            if (!existing) {
                nameMap.set(key, { ...row });
            } else {
                const combinedQty = existing.quantity + row.quantity;
                const combinedCost = existing.totalCost + row.totalCost;
                const combinedValue = existing.currentValue + row.currentValue;
                const combinedStart =
                    existing.startValue !== null || row.startValue !== null
                        ? (existing.startValue ?? 0) + (row.startValue ?? 0)
                        : null;
                const combinedEnd =
                    existing.endValue !== null || row.endValue !== null
                        ? (existing.endValue ?? 0) + (row.endValue ?? 0)
                        : null;
                const pChange = combinedStart !== null && combinedEnd !== null ? combinedEnd - combinedStart : null;
                const pChangePct =
                    combinedStart !== null && pChange !== null && combinedStart > 0
                        ? (pChange / combinedStart) * 100
                        : null;
                nameMap.set(key, {
                    ...existing,
                    quantity: combinedQty,
                    avgCost: combinedQty > 0 ? combinedCost / combinedQty : 0,
                    totalCost: combinedCost,
                    currentValue: combinedValue,
                    startValue: combinedStart,
                    endValue: combinedEnd,
                    periodChange: pChange,
                    periodChangePct: pChangePct,
                    // partial if either constituent row is partial
                    isPartialPeriod: existing.isPartialPeriod || row.isPartialPeriod,
                    weight: totalValue > 0 ? (combinedValue / totalValue) * 100 : 0,
                    lotCount: existing.lotCount + row.lotCount,
                });
            }
        }

        return Array.from(nameMap.values());
    }, [portfolioData, filteredTrend]);

    // ─── CSV export ──────────────────────────────────────────────────────────────

    const handleExport = useCallback(() => {
        if (holdingRows.length === 0) {
            toast.error(t('portfolio:toast.noDataToExport'), { id: 'export-trend' });
            return;
        }
        const headers = [
            'Symbol',
            'Name',
            'Type',
            'Quantity',
            'Avg Cost',
            'Period Start Value',
            'Period End Value',
            'Period Change',
            'Period Change %',
            'Weight %',
        ];
        const rows = holdingRows.map((r) => [
            r.symbol,
            `"${r.name}"`,
            r.type,
            r.quantity,
            r.avgCost.toFixed(2),
            r.startValue?.toFixed(2) ?? '',
            r.endValue?.toFixed(2) ?? '',
            r.periodChange?.toFixed(2) ?? '',
            r.periodChangePct?.toFixed(2) ?? '',
            r.weight.toFixed(2),
        ]);
        const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const label =
            typeof preset === 'number'
                ? `${preset}d`
                : preset === 'custom'
                    ? `custom`
                    : preset;
        a.download = `holdings-trend-${label}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(t('portfolio:toast.csvExported'), { id: 'export-trend' });
    }, [holdingRows, preset, t]);

    // ─── Period summary stats ────────────────────────────────────────────────────

    const periodStats = useMemo(() => {
        if (filteredTrend.length < 2) return null;
        const first = filteredTrend[0];
        const last = filteredTrend[filteredTrend.length - 1];
        const startDate = new Date(first.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const endDate = new Date(last.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        const startValue = first.value;
        const endValue = last.value;
        // Total movement of total asset value — matches the chart line. Includes
        // any cash the user deposited during the period.
        const change = endValue - startValue;

        // Capital added (deposits / buys) during the period. The first point's
        // capital is already baked into startValue, so we only count what came
        // after it. Prefer the backend cumulative costBasis delta; fall back to
        // summing per-day capitalAdded.
        const startCost = Number(first.costBasis) || 0;
        const endCost = Number(last.costBasis) || 0;
        let capitalAdded = (startCost > 0 && endCost >= startCost)
            ? endCost - startCost
            : filteredTrend.slice(1).reduce((sum, p) => sum + (Number(p.capitalAdded) || 0), 0);
        if (!Number.isFinite(capitalAdded) || capitalAdded < 0) capitalAdded = 0;

        // True investment performance = value change minus the new capital that
        // was poured in. This is what the return % should reflect — not the
        // deposits themselves.
        const gain = change - capitalAdded;

        // Simple Dietz return: weight contributions at half the period. This keeps
        // the percentage meaningful even when the portfolio started near $0 and
        // grew via deposits (a raw gain/startValue would explode toward infinity).
        const base = startValue + capitalAdded / 2;
        const changePct = base > 1 ? (gain / base) * 100 : null;

        return { startDate, endDate, startValue, endValue, change, capitalAdded, gain, changePct };
    }, [filteredTrend]);

    const currency = portfolioData?.currency || 'TWD';
    // Color/sign reflect investment performance (gain), not raw value movement.
    const isPositivePeriod = (periodStats?.gain ?? 0) >= 0;
    const isPositiveChange = (periodStats?.change ?? 0) >= 0;

    // ─── Render ──────────────────────────────────────────────────────────────────

    return (
        <ErrorBoundary>
        <DashboardLayout topBarActions={
            <div className="flex items-center gap-2">
                {isAuthenticated && (
                    <button
                        onClick={handleRefreshPrices}
                        disabled={isRefreshing}
                        className={TOP_BAR_BUTTON}
                        title="Refresh prices and update trend data"
                    >
                        <ArrowPathIcon className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                        {isRefreshing ? 'Updating' : 'Prices'}
                    </button>
                )}
                <button
                    onClick={handleExport}
                    className={TOP_BAR_BUTTON}
                    title="Export holdings table to CSV"
                >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                    Export
                </button>
                <Link
                    href="/portfolio"
                    className={TOP_BAR_BUTTON}
                >
                    <ArrowLeftIcon className="w-4 h-4" />
                    Back
                </Link>
            </div>
        }>
            <div className="flex flex-col h-full min-h-screen bg-gray-50 dark:bg-gray-950">

                {/* ── Top Bar ── */}
                <header className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
                    {/* Row 1: Back + Title + Action buttons — mobile only */}
                    <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                            <Link
                                href="/portfolio"
                                className="p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                                aria-label="Back to Portfolio"
                            >
                                <ArrowLeftIcon className="w-5 h-5" />
                            </Link>
                            <div className="min-w-0">
                                <h1 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                                    {t('common:navigation.trend')}
                                </h1>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            {isAuthenticated && (
                                <button
                                    onClick={handleRefreshPrices}
                                    disabled={isRefreshing}
                                    className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[36px]"
                                    title="Refresh prices and update trend data"
                                    aria-label={isRefreshing ? 'Updating prices' : 'Refresh prices'}
                                >
                                    <ArrowPathIcon className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                                </button>
                            )}
                            <button
                                onClick={handleExport}
                                className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors min-h-[36px]"
                                title="Export holdings table to CSV"
                                aria-label="Export to CSV"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Row 2: Period selector — scrollable on mobile */}
                    <div className="flex items-center gap-2 px-3 sm:px-6 pb-2.5 overflow-x-auto scrollbar-hide">
                        {/* Standard presets */}
                        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-0.5 border border-gray-200 dark:border-gray-700 flex-shrink-0">
                            {([7, 30, 90, 365] as const).map((d) => (
                                <button
                                    key={d}
                                    onClick={() => startPeriodTransition(() => setPreset(d))}
                                    className={cn(
                                        'px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all min-w-[34px] whitespace-nowrap',
                                        preset === d
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
                                    )}
                                >
                                    {PRESET_LABELS[d]}
                                </button>
                            ))}
                        </div>
                        {/* Extended presets */}
                        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-0.5 border border-gray-200 dark:border-gray-700 flex-shrink-0">
                            {(['ytd', '3y', '5y', 'max'] as const).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => startPeriodTransition(() => setPreset(p))}
                                    className={cn(
                                        'px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all uppercase min-w-[34px] whitespace-nowrap',
                                        preset === p
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
                                    )}
                                >
                                    {PRESET_LABELS[p]}
                                </button>
                            ))}
                        </div>
                        {/* Custom range */}
                        <div className="flex-shrink-0">
                            <DateRangePicker
                                value={customRange}
                                onChange={(r) => {
                                    startPeriodTransition(() => {
                                        setCustomRange(r);
                                        if (r.startDate && r.endDate) setPreset('custom');
                                    });
                                }}
                                minDate={
                                    (trendData as AssetTrendDataPoint[]).length > 0
                                        ? new Date((trendData as AssetTrendDataPoint[])[0].date)
                                        : undefined
                                }
                            />
                        </div>
                    </div>
                </header>

                {/* ── Data gap warning banner ── */}
                {hasDataGaps && isAuthenticated && (
                    <div className="flex-shrink-0 flex items-center gap-3 px-4 sm:px-6 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/50 text-xs text-amber-800 dark:text-amber-300">
                        <span className="font-semibold">⚠ Incomplete history</span>
                        <span className="text-amber-700 dark:text-amber-400">
                            {isSyncingHistory
                                ? `Fetching missing price data for ${gapSymbols.join(', ')}…`
                                : `Missing price data for ${gapSymbols.join(', ')}.`}
                        </span>
                        <button
                            onClick={handleSyncHistorical}
                            disabled={isSyncingHistory}
                            className="ml-auto px-2.5 py-1 rounded-md bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 font-semibold transition-colors disabled:opacity-50"
                        >
                            {isSyncingHistory ? 'Syncing…' : 'Sync now'}
                        </button>
                    </div>
                )}

                {/* ── Period summary strip ── */}
                {periodStats && (
                    <div className="flex-shrink-0 flex items-center gap-x-4 gap-y-1 px-3 sm:px-6 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs flex-wrap sm:flex-nowrap sm:overflow-x-auto scrollbar-hide">
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap flex-shrink-0">
                            <span className="font-semibold text-gray-700 dark:text-gray-300">{periodStats.startDate}</span>
                            {' → '}
                            <span className="font-semibold text-gray-700 dark:text-gray-300">{periodStats.endDate}</span>
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap flex-shrink-0 hidden sm:inline">
                            {t('trend.stripStart', 'Start')}:&nbsp;
                            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                                {isValueVisible ? formatCurrency(periodStats.startValue, currency) : '•••'}
                            </span>
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap flex-shrink-0 hidden sm:inline">
                            {t('trend.stripEnd', 'End')}:&nbsp;
                            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                                {isValueVisible ? formatCurrency(periodStats.endValue, currency) : '•••'}
                            </span>
                        </span>
                        {/* Total value movement (includes deposits) */}
                        <span
                            className={cn(
                                'font-bold tabular-nums whitespace-nowrap flex-shrink-0',
                                isPositiveChange ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400',
                            )}
                            title="Total change in asset value over the period (includes deposits/withdrawals)"
                        >
                            {isPositiveChange ? '+' : ''}
                            {isValueVisible ? formatCurrency(periodStats.change, currency) : '•••'}
                        </span>
                        {/* Capital-adjusted investment return (excludes deposits) */}
                        <span
                            className={cn(
                                'font-bold tabular-nums whitespace-nowrap flex-shrink-0',
                                isPositivePeriod ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400',
                            )}
                            title={
                                periodStats.capitalAdded > 0
                                    ? `Return excludes ${isValueVisible ? formatCurrency(periodStats.capitalAdded, currency) : 'deposits'} of net contributions (Simple Dietz method)`
                                    : 'Investment return over the period'
                            }
                        >
                            {t('trend.summaryReturn', 'Return')}:&nbsp;
                            {periodStats.changePct === null
                                ? '—'
                                : `${periodStats.changePct >= 0 ? '+' : ''}${periodStats.changePct.toFixed(2)}%`}
                        </span>
                        <button
                            onClick={toggleValueVisibility}
                            className="ml-auto text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap"
                        >
                            {isValueVisible ? t('trend.stripHide', 'Hide') : t('trend.stripShow', 'Show')}
                        </button>
                    </div>
                )}

                {/* ── Refetch banner (background refresh, non-blocking) ── */}
                {(isFetchingTrend || isFetchingPortfolio) && !isLoadingTrend && !isLoadingPortfolio && (
                    <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-100 dark:border-primary-800/30">
                        <div className="w-3 h-3 rounded-full border-2 border-primary-400 border-t-transparent animate-spin flex-shrink-0" />
                        <span className="text-[11px] text-primary-700 dark:text-primary-400 font-medium">
                            Refreshing data…
                        </span>
                    </div>
                )}

                {/* ── Main content: chart + table ── */}
                <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">

                    {/* ── Chart / Calendar panel ── */}
                    <div
                        className={cn(
                            'flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 transition-all duration-300',
                            activeView === 'calendar'
                                ? 'min-h-[400px]'
                                : isChartExpanded
                                    ? 'h-[75vh]'
                                    : 'h-[52vh] min-h-[360px] sm:h-[58vh] sm:min-h-[440px]',
                        )}
                    >
                        {/* Panel header */}
                        <div className="flex items-center justify-between px-3 sm:px-6 pt-3 pb-2 gap-2">
                            {/* View toggle */}
                            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200 dark:border-gray-700 flex-shrink-0">
                                <button
                                    onClick={() => setActiveView('chart')}
                                    className={cn(
                                        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                                        activeView === 'chart'
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
                                    )}
                                >
                                    <ChartBarSquareIcon className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Chart</span>
                                </button>
                                <button
                                    onClick={() => setActiveView('calendar')}
                                    className={cn(
                                        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                                        activeView === 'calendar'
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
                                    )}
                                >
                                    <CalendarDaysIcon className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Calendar</span>
                                </button>
                            </div>

                            {/* Chart-only controls */}
                            {activeView === 'chart' && (
                                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
                                    {/* Benchmark selector */}
                                    <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200 dark:border-gray-700 flex-shrink-0">
                                        {PRESET_BENCHMARKS.map((b) => (
                                            <button
                                                key={b ?? 'none'}
                                                onClick={() => { setSelectedBenchmark(b); setCustomBenchmarkInput(''); }}
                                                className={cn(
                                                    'px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px] font-semibold rounded-md transition-all whitespace-nowrap',
                                                    selectedBenchmark === b && !isCustomBenchmark
                                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
                                                )}
                                            >
                                                {b ?? 'None'}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Custom symbol input — hidden on mobile to save space */}
                                    <div className={cn(
                                        'hidden sm:flex items-center gap-1 rounded-lg border px-1.5 py-0.5 transition-all flex-shrink-0',
                                        isCustomBenchmark
                                            ? 'bg-white dark:bg-gray-700 border-primary-400 dark:border-primary-500 shadow-sm'
                                            : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                    )}>
                                        <input
                                            type="text"
                                            value={customBenchmarkInput}
                                            onChange={e => setCustomBenchmarkInput(e.target.value.toUpperCase())}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && customBenchmarkInput.trim()) {
                                                    setSelectedBenchmark(customBenchmarkInput.trim());
                                                }
                                            }}
                                            onBlur={() => {
                                                if (customBenchmarkInput.trim()) setSelectedBenchmark(customBenchmarkInput.trim());
                                            }}
                                            placeholder={t('portfolio:trend.customPlaceholder', 'Custom…')}
                                            aria-label={t('portfolio:trend.customPlaceholder', 'Custom…')}
                                            className="w-16 text-[11px] font-semibold bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                                        />
                                        {isCustomBenchmark && (
                                            <button
                                                onClick={() => { setSelectedBenchmark(null); setCustomBenchmarkInput(''); }}
                                                className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 leading-none"
                                                title="Clear custom benchmark"
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setIsChartExpanded((p) => !p)}
                                        className="p-1.5 rounded-lg text-gray-600 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0 min-w-[32px] min-h-[32px] flex items-center justify-center"
                                        aria-label={isChartExpanded ? 'Collapse chart' : 'Expand chart'}
                                    >
                                        {isChartExpanded ? (
                                            <ArrowsPointingInIcon className="w-4 h-4" />
                                        ) : (
                                            <ArrowsPointingOutIcon className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Panel body */}
                        {activeView === 'calendar' ? (
                            isLoadingTrend || isPeriodPending ? (
                                <div className="px-4 py-6 animate-pulse space-y-4">
                                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                                        {[0, 1, 2].map((i) => (
                                            <div key={i} className="space-y-2">
                                                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                                                <div className="grid grid-cols-7 gap-1">
                                                    {Array.from({ length: 35 }).map((_, j) => (
                                                        <div key={j} className="aspect-square rounded bg-gray-100 dark:bg-gray-800" />
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                                    <PortfolioCalendarHeatmap
                                        data={filteredTrend}
                                        currency={currency}
                                        isValueVisible={isValueVisible}
                                    />
                                </div>
                            )
                        ) : (
                            /* Chart body */
                            <div className="px-2 sm:px-4 pb-4 h-[calc(100%-52px)] flex flex-col">
                                {isLoadingTrend || isPeriodPending ? (
                                    <ChartSkeleton />
                                ) : filteredTrend.length > 0 ? (
                                    <AssetTrendChart
                                        key={chartKey}
                                        data={filteredTrend}
                                        currency={currency}
                                        isValueVisible={isValueVisible}
                                        benchmark={benchmark}
                                        allTimeReturnPercent={allTimeReturnPct}
                                        className="flex-1 min-h-0"
                                    />
                                ) : (
                                    <div className="h-full flex items-center justify-center">
                                        <div className="text-center space-y-3 px-6">
                                            <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                                                <svg className="w-7 h-7 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
                                                </svg>
                                            </div>
                                            {isFeatureTemporarilyDisabled ? (
                                                <>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        Historical chart coming soon
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        Portfolio trend data is temporarily unavailable. Please check back soon.
                                                    </p>
                                                </>
                                            ) : hasNoHistoricalData ? (
                                                <>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        {isSyncingHistory ? 'Fetching price history…' : 'No historical price data found'}
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        {isSyncingHistory
                                                            ? 'This may take a moment. The chart will update automatically.'
                                                            : 'Fetch historical prices to see your portfolio trend.'}
                                                    </p>
                                                    {!isSyncingHistory && (
                                                        <button
                                                            onClick={handleSyncHistorical}
                                                            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary-700 rounded-lg hover:bg-primary-800 transition-colors"
                                                        >
                                                            <ArrowPathIcon className="w-4 h-4" />
                                                            Fetch Historical Data
                                                        </button>
                                                    )}
                                                    {isSyncingHistory && (
                                                        <div className="flex items-center justify-center gap-2 text-xs text-primary-700 dark:text-primary-400">
                                                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                                            <span>Syncing…</span>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No trend data for this period</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Try a different period or add holdings.</p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Holdings table panel ── */}
                    <div className="flex flex-col flex-shrink-0 bg-white dark:bg-gray-900">
                        {/* Table header */}
                        <div className="flex-shrink-0 flex items-center gap-3 px-4 sm:px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.5 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875C18 11.496 18.504 12 19.125 12M16.875 12C16.254 12 15.75 12.504 15.75 13.125m0 0c0 .621-.504 1.125-1.125 1.125H9.375a1.125 1.125 0 01-1.125-1.125m6.75 0a1.125 1.125 0 010 0" />
                                </svg>
                                {t('trend.holdingsInPeriod', 'Holdings in Period')}
                            </h2>
                            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                {preset === 'custom' && customRange.startDate && customRange.endDate
                                    ? `${customRange.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – ${customRange.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                                    : t('trend.showingPeriod', { period: PRESET_LABELS[preset] ?? preset, defaultValue: 'Showing {{period}} performance' })}
                            </span>
                        </div>

                        <HoldingsTable
                            key={chartKey}
                            rows={holdingRows}
                            currency={currency}
                            isValueVisible={isValueVisible}
                            isLoading={isLoadingPortfolio || isPeriodPending}
                        />
                    </div>
                </div>
            </div>
        </DashboardLayout>
        </ErrorBoundary>
    );
}
