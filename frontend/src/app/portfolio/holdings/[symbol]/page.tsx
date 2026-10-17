'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeftIcon,
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
    ArrowPathIcon,
    ChartBarSquareIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import dynamic from 'next/dynamic';
import { AssetPriceChart } from '@/components/portfolio/AssetPriceChart';
import type { ChartPoint } from '@/components/portfolio/AssetPriceChart';

// Candlestick view is opt-in (Price is the default), so lazy-load it — its
// Recharts ComposedChart/Bar/Line code only ships once the user picks "Candles".
const AssetCandlestickChart = dynamic(
    () => import('@/components/portfolio/AssetCandlestickChart').then(m => ({ default: m.AssetCandlestickChart })),
    { ssr: false, loading: () => <div className="h-72 bg-gray-50 dark:bg-gray-700/30 rounded-lg animate-pulse" /> },
);
import { portfolioService } from '@/services/portfolioService';
import { getDemoHistoricalPrices, withDemoPurchaseLots } from '@/data/demoData';
import { apiClient } from '@/lib/api-client';
import { aggregateHoldingsBySymbol } from '@/utils/portfolio-aggregation';
import type { PortfolioHolding } from '@/shared/types';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useAppMode } from '@/hooks/useAppMode';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatAssetTypeLabel } from '@/utils/holdingLabels';
import { Card } from '@/components/ui/Card';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { usePortfolioSnapshot } from '@/hooks/portfolio/usePortfolioSnapshot';
import { HoldingLotCards } from '@/components/portfolio/HoldingLotCards';

/** The account's reporting currency. */
const BASE_CURRENCY = 'TWD';

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';
type ViewMode = 'price' | 'return' | 'candle';

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
    { label: '5D',  value: '5D'  },
    { label: '1M',  value: '1M'  },
    { label: '6M',  value: '6M'  },
    { label: 'YTD', value: 'YTD' },
    { label: '1Y',  value: '1Y'  },
    { label: '5Y',  value: '5Y'  },
    { label: 'MAX', value: 'MAX' },
];

/** Convert a period label to number of days for the API */
function getPeriodDays(period: Period): number {
    const today = new Date();
    switch (period) {
        case '5D':  return 7;      // 5 trading days + buffer for weekends
        case '1M':  return 35;
        case '6M':  return 185;
        case 'YTD': {
            const startOfYear = new Date(today.getFullYear(), 0, 1);
            return Math.max(Math.ceil((today.getTime() - startOfYear.getTime()) / 86_400_000) + 1, 7);
        }
        case '1Y':  return 365;
        case '5Y':  return 1825;
        case 'MAX': return 3650;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDisplayDate(dateStr: string, period: Period): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (period === '5D') {
        return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (period === '1M' || period === '6M' || period === 'YTD') {
        return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    // 1Y, 5Y, MAX — less dense labels
    return dateObj.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
}

function getAssetTypeBadge(type: string): string {
    const map: Record<string, string> = {
        stock: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        etf: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        crypto: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        cryptocurrency: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        bond: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
        mutual_fund: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
        reit: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
        cash: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    };
    return map[type?.toLowerCase()] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssetDetailPage() {
    const { t } = useTranslation(['portfolio']);
    const params = useParams();
    const rawSymbol = params?.symbol as string;
    const symbol = rawSymbol ? decodeURIComponent(rawSymbol).toUpperCase() : '';

    const { isDemo } = useAppMode();
    const { isValueVisible } = usePrivacy();
    const queryClient = useQueryClient();
    const router = useRouter();

    const [period, setPeriod] = useState<Period>('1M');
    const [viewMode, setViewMode] = useState<ViewMode>('price');
    // Brush (draggable time window) is shown by default so panning is discoverable;
    // the "Zoom" button still lets users hide it.
    const [brushEnabled, setBrushEnabled] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const autoSyncAttempted = useRef(false);
    const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Portfolio data ────────────────────────────────────────────────────────
    // Shared with the trend page (usePortfolioSnapshot), so moving between them
    // reads one cache entry.
    const { data: snapshot, isLoading: portfolioLoading } = usePortfolioSnapshot();
    // Demo holdings are a single undated lot each; split them into dated lots so
    // the buy-point markers actually render. Done here, not in the shared query,
    // so the trend page keeps the fixture as it is.
    const portfolio = useMemo(() => {
        if (!snapshot || !isDemo || !Array.isArray(snapshot.holdings)) return snapshot;
        return {
            ...snapshot,
            holdings: snapshot.holdings.flatMap(h => (h.purchaseDate ? [h] : withDemoPurchaseLots(h))),
        };
    }, [snapshot, isDemo]);

    // ── Historical price data ─────────────────────────────────────────────────
    // The backend has no per-symbol demo price history, so demo mode generates a
    // deterministic client-side series (final close pinned to the holding's price).
    const { data: rawPrices = [], isLoading: pricesLoading, isFetching } = useQuery({
        queryKey: ['asset-history', symbol, period, isDemo ? 'demo' : 'live'],
        queryFn: () => isDemo
            ? Promise.resolve(getDemoHistoricalPrices(symbol, getPeriodDays(period)))
            : portfolioService.getHistoricalPrices(symbol, getPeriodDays(period)),
        staleTime: 60 * 60 * 1000,
        enabled: !!symbol,
    });


    // ── Holding stats (aggregated) ────────────────────────────────────────────
    const holding = useMemo(() => {
        if (!portfolio?.holdings) return null;
        const aggregated = aggregateHoldingsBySymbol(portfolio.holdings);
        return aggregated.find((h: PortfolioHolding) => h.symbol?.toUpperCase() === symbol) ?? null;
    }, [portfolio, symbol]);

    const lots = useMemo(() => {
        if (!portfolio?.holdings) return [];
        // The API returns holdings ordered by total_value desc — right for the
        // portfolio list, but it scrambles a per-symbol lot history into
        // largest-position-first. Order by purchase date instead, matching what
        // HoldingDetailModal already does: newest first, with an id tiebreak so
        // same-day lots keep a stable order across renders. filter() has already
        // produced a new array, so sorting in place cannot mutate the query cache.
        return portfolio.holdings
            .filter((h: PortfolioHolding) => h.symbol?.toUpperCase() === symbol)
            .sort((a: PortfolioHolding, b: PortfolioHolding) => {
                if (!a.purchaseDate) return 1;
                if (!b.purchaseDate) return -1;
                const byDate =
                    new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime();
                return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
            });
    }, [portfolio, symbol]);

    // ── Sibling navigation ────────────────────────────────────────────────────
    // Build an ordered list of unique tradable symbols from the portfolio
    const tradableSymbols = useMemo(() => {
        if (!portfolio?.holdings) return [];
        const NON_TRADABLE = new Set(['SAVINGS', 'TWD-SAVINGS', 'CPF-OA', 'ANNUAL-BUDGET',
            'CRYPTO', 'CASH', 'EMERGENCY-FUND', 'BUDGET']);
        const seen = new Set<string>();
        const symbols: string[] = [];
        for (const h of portfolio.holdings) {
            const sym: string = h.symbol?.toUpperCase() ?? '';
            if (
                !seen.has(sym) &&
                !NON_TRADABLE.has(sym) &&
                !sym.startsWith('CASH-') &&
                !sym.endsWith('-SAVINGS') &&
                !sym.endsWith('-BUDGET') &&
                h.type !== 'cash'
            ) {
                seen.add(sym);
                symbols.push(sym);
            }
        }
        return symbols;
    }, [portfolio]);

    const currentIndex = tradableSymbols.indexOf(symbol);
    const prevSymbol = currentIndex > 0 ? tradableSymbols[currentIndex - 1] : null;
    const nextSymbol = currentIndex < tradableSymbols.length - 1 ? tradableSymbols[currentIndex + 1] : null;

    // Keyboard ←/→ navigation
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'ArrowLeft' && prevSymbol) {
                router.push(`/portfolio/holdings/${encodeURIComponent(prevSymbol)}`);
            } else if (e.key === 'ArrowRight' && nextSymbol) {
                router.push(`/portfolio/holdings/${encodeURIComponent(nextSymbol)}`);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [prevSymbol, nextSymbol, router]);

    // Touch swipe navigation (mobile)
    const touchStartX = useCallback((e: React.TouchEvent) => {
        (e.currentTarget as HTMLElement).dataset.touchStartX = String(e.touches[0].clientX);
        (e.currentTarget as HTMLElement).dataset.touchStartY = String(e.touches[0].clientY);
    }, []);
    const touchEndNav = useCallback((e: React.TouchEvent) => {
        const el = e.currentTarget as HTMLElement;
        const startX = Number(el.dataset.touchStartX ?? 0);
        const startY = Number(el.dataset.touchStartY ?? 0);
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // too short or mostly vertical
        if (dx < 0 && nextSymbol) router.push(`/portfolio/holdings/${encodeURIComponent(nextSymbol)}`);
        if (dx > 0 && prevSymbol) router.push(`/portfolio/holdings/${encodeURIComponent(prevSymbol)}`);
    }, [prevSymbol, nextSymbol, router]);

    // Prefetch sibling history on button hover — debounced to avoid firing on fast mouse sweeps
    const prefetchSymbol = useCallback((sym: string | null) => {
        if (!sym) return;
        if (isDemo) return; // demo series is generated on-mount; nothing to prefetch
        if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = setTimeout(() => {
            queryClient.prefetchQuery({
                queryKey: ['asset-history', sym, period, 'live'],
                queryFn: () => portfolioService.getHistoricalPrices(sym, getPeriodDays(period)),
                staleTime: 60 * 60 * 1000,
            });
        }, 300);
    }, [queryClient, period, isDemo]);

    // Guard against non-finite avg cost (e.g. a degenerate lot producing Infinity/NaN).
    // A non-finite value here would poison the chart's shared Y-axis domain.
    const avgCost = Number.isFinite(holding?.averageCost) ? Number(holding!.averageCost) : 0;
    const currency = holding?.currency ?? 'USD';
    // The account's own currency, for the second line under a foreign value.
    const { rateFor } = useExchangeRates(BASE_CURRENCY);
    const baseRate = currency.toUpperCase() === BASE_CURRENCY ? undefined : rateFor(currency);

    // ── Purchases grouped by day (for buy-point markers on the chart) ─────────
    // purchaseDate is a timestamptz; some rows were written as local (Taipei)
    // midnight rather than UTC midnight, so a raw UTC slice can land a day off
    // from the historical price series' plain-date keys. Purchases also don't
    // always fall on a trading day (weekends/holidays). To absorb both cases,
    // each lot snaps to the nearest available price-series date within a small
    // window instead of requiring an exact string match.
    const purchasesByDate = useMemo(() => {
        const raw = new Map<string, { qty: number; cost: number; count: number }>();
        for (const lot of lots) {
            if (!lot.purchaseDate) continue;
            const key = lot.purchaseDate.slice(0, 10);
            const entry = raw.get(key) ?? { qty: 0, cost: 0, count: 0 };
            entry.qty += Number(lot.quantity) || 0;
            entry.cost += Number(lot.totalCost) || 0;
            entry.count += 1;
            raw.set(key, entry);
        }
        if (raw.size === 0 || rawPrices.length === 0) return raw;

        // Parse a plain "YYYY-MM-DD" string as a UTC day-number, avoiding the
        // local-timezone shifts that plague native Date parsing of date-only strings.
        const toDayNumber = (d: string) => {
            const [y, m, day] = d.split('-').map(Number);
            return Date.UTC(y, m - 1, day) / 86_400_000;
        };
        const priceDays = rawPrices.map(p => toDayNumber(p.date));
        const SNAP_WINDOW_DAYS = 4;

        const snapped = new Map<string, { qty: number; cost: number; count: number }>();
        for (const [key, entry] of raw) {
            const target = toDayNumber(key);
            let bestDate = rawPrices[0].date;
            let bestDiff = Infinity;
            for (let i = 0; i < priceDays.length; i++) {
                const diff = Math.abs(priceDays[i] - target);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestDate = rawPrices[i].date;
                    if (diff === 0) break;
                }
            }
            if (bestDiff > SNAP_WINDOW_DAYS) continue; // purchase falls outside the loaded period
            const merged = snapped.get(bestDate) ?? { qty: 0, cost: 0, count: 0 };
            merged.qty += entry.qty;
            merged.cost += entry.cost;
            merged.count += entry.count;
            snapped.set(bestDate, merged);
        }
        return snapped;
    }, [lots, rawPrices]);

    // ── Chart data ────────────────────────────────────────────────────────────
    const chartData: ChartPoint[] = useMemo(() => {
        return rawPrices.map((p, i) => {
            const close = Number(p.close);
            const prev = Number(i > 0 ? rawPrices[i - 1].close : p.close);
            const change = close - prev;
            const changePercent = prev > 0 ? (change / prev) * 100 : 0;
            const returnAmount = avgCost > 0 ? close - avgCost : 0;
            const returnPercent = avgCost > 0 ? (returnAmount / avgCost) * 100 : 0;
            const purchase = purchasesByDate.get(p.date);
            return {
                date: p.date,
                displayDate: formatDisplayDate(p.date, period),
                price: close,
                costBasis: avgCost,
                returnAmount,
                returnPercent,
                change,
                changePercent,
                open: p.open,
                high: p.high,
                low: p.low,
                volume: p.volume,
                purchaseQty: purchase?.qty,
                purchaseCost: purchase?.cost,
                purchaseLotCount: purchase?.count,
            };
        });
    }, [rawPrices, period, avgCost, purchasesByDate]);

    const buyPointCount = useMemo(
        () => chartData.reduce((n, d) => n + ((d.purchaseQty ?? 0) > 0 ? 1 : 0), 0),
        [chartData],
    );

    // ── Period stats ──────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        if (chartData.length < 2) return null;
        const first = chartData[0];
        const last = chartData[chartData.length - 1];
        const periodChange = last.price - first.price;
        const periodChangePct = first.price > 0 ? (periodChange / first.price) * 100 : 0;
        let peakPrice = -Infinity;
        let troughPrice = Infinity;
        chartData.forEach(p => {
            if (p.price > peakPrice) peakPrice = p.price;
            if (p.price < troughPrice) troughPrice = p.price;
        });
        return {
            currentPrice: last.price,
            periodChange,
            periodChangePct,
            returnAmount: last.returnAmount,
            returnPercent: last.returnPercent,
            peakPrice,
            troughPrice,
            maxDrawdown: peakPrice > 0 ? ((troughPrice - peakPrice) / peakPrice) * 100 : 0,
        };
    }, [chartData]);

    const isPositiveReturn = (stats?.returnAmount ?? holding?.gainLoss ?? 0) >= 0;
    const isPositivePeriod = (stats?.periodChange ?? 0) >= 0;
    const isLoading = portfolioLoading || pricesLoading;

    // ── Sync handler ──────────────────────────────────────────────────────────
    const handleSync = useCallback(async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        const days = getPeriodDays(period);
        const market = (holding?.market ?? 'US') as string;
        // A cold TW sync waits on FinLab's whole-market fetch, which the backend
        // allows up to ~150s (FINLAB_FETCH_TIMEOUT_SECONDS) before falling back
        // to Yahoo — so warn the user and give the request enough headroom.
        const isTW = market.toUpperCase() === 'TW';
        const toastId = toast.loading(
            isTW
                ? `Fetching ${period} history for ${symbol}… first sync can take up to a minute`
                : `Fetching ${period} history for ${symbol}…`,
        );
        try {
            // Fetch only this symbol (fast) instead of syncing the entire portfolio.
            // Timeout must exceed the backend's FinLab wait (~150s) so a cold TW
            // fetch can complete instead of aborting client-side at the 30s default.
            await apiClient.post(
                `/portfolio/historical-prices/fetch?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}&days=${days}&force_refresh=false`,
                undefined,
                { timeout: 160_000 },
            );
            await queryClient.invalidateQueries({ queryKey: ['asset-history', symbol] });
            toast.success(t('portfolio:holdingDetail.syncDone'), { id: toastId });
        } catch {
            toast.error(t('portfolio:holdingDetail.syncFailed'), { id: toastId });
        } finally {
            setIsSyncing(false);
        }
    }, [isSyncing, period, symbol, holding, queryClient]);

    // Auto-sync on first visit when there's no historical data (once per symbol).
    useEffect(() => {
        autoSyncAttempted.current = false;
    }, [symbol]);

    useEffect(() => {
        if (
            !isDemo &&
            !pricesLoading && !isFetching &&
            rawPrices.length === 0 && symbol &&
            !isSyncing && !autoSyncAttempted.current
        ) {
            autoSyncAttempted.current = true;
            handleSync();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pricesLoading, isFetching, symbol]);

    // Cleanup debounced prefetch timer on unmount
    useEffect(() => {
        return () => { if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current); };
    }, []);

    return (
        <ErrorBoundary>
        <DashboardLayout>
            <div
                className="min-h-screen bg-gray-50 dark:bg-gray-900"
                onTouchStart={touchStartX}
                onTouchEnd={touchEndNav}
            >
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

                    {/* ── Back + sibling navigation ────────────────────────── */}
                    <div className="flex items-center justify-between">
                        <Link
                            href="/portfolio"
                            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                            <ArrowLeftIcon className="w-4 h-4" />
                            {t('portfolio:holdingDetail.backToPortfolio')}
                        </Link>

                        {/* Prev / Next asset buttons */}
                        {tradableSymbols.length > 1 && (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => prevSymbol && router.push(`/portfolio/holdings/${encodeURIComponent(prevSymbol)}`)}
                                    onMouseEnter={() => prefetchSymbol(prevSymbol)}
                                    disabled={!prevSymbol}
                                    title={prevSymbol ? `Previous: ${prevSymbol}` : undefined}
                                    aria-label={prevSymbol ? `Previous asset: ${prevSymbol}` : 'No previous asset'}
                                    className={cn(
                                        'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                                        prevSymbol
                                            ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                                            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                    )}
                                >
                                    <ChevronLeftIcon className="w-3.5 h-3.5" />
                                    {prevSymbol ?? '—'}
                                </button>

                                <span className="text-xs text-gray-400 dark:text-gray-500 px-1 tabular-nums">
                                    {currentIndex + 1} / {tradableSymbols.length}
                                </span>

                                <button
                                    onClick={() => nextSymbol && router.push(`/portfolio/holdings/${encodeURIComponent(nextSymbol)}`)}
                                    onMouseEnter={() => prefetchSymbol(nextSymbol)}
                                    disabled={!nextSymbol}
                                    title={nextSymbol ? `Next: ${nextSymbol}` : undefined}
                                    aria-label={nextSymbol ? `Next asset: ${nextSymbol}` : 'No next asset'}
                                    className={cn(
                                        'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                                        nextSymbol
                                            ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                                            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                    )}
                                >
                                    {nextSymbol ?? '—'}
                                    <ChevronRightIcon className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Header ───────────────────────────────────────────── */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div>
                            {isLoading ? (
                                <div className="space-y-2">
                                    <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                    <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h1 className="md:hidden text-lg sm:text-xl font-bold text-gray-900 dark:text-white">{symbol}</h1>
                                        {holding && (
                                            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', getAssetTypeBadge(holding.type))}>
                                                {formatAssetTypeLabel(holding.type, t)}
                                            </span>
                                        )}
                                        {holding && (
                                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                                {holding.exchange}
                                            </span>
                                        )}
                                    </div>
                                    {holding
                                        ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{holding.name}</p>
                                        : <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">{t('portfolio:holdingDetail.notInPortfolio')}</p>
                                    }
                                </>
                            )}
                        </div>

                        {/* Period + sync */}
                        <div className="flex items-center gap-2 self-start w-full sm:w-auto">
                            <div className="flex items-center flex-1 sm:flex-none overflow-x-auto scrollbar-hide bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
                                {PERIOD_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setPeriod(opt.value)}
                                        aria-pressed={period === opt.value}
                                        className={cn(
                                            'flex-1 sm:flex-none px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                                            period === opt.value
                                                ? 'bg-primary-600 text-white shadow-sm'
                                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={handleSync}
                                disabled={isSyncing || isFetching}
                                className="shrink-0 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
                                title={t('portfolio:holdingDetail.syncPrices')}
                                aria-label={t('portfolio:holdingDetail.syncPrices')}
                            >
                                <ArrowPathIcon className={cn('w-4 h-4', (isSyncing || isFetching) && 'animate-spin')} />
                            </button>
                        </div>
                    </div>

                    {/* ── Summary stat cards ────────────────────────────────── */}
                    {(holding || stats) && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {/* Current price */}
                            <div className="bg-gray-50/80 dark:bg-gray-800/60 rounded-xl p-3 border border-gray-200 dark:border-gray-700/50">
                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t('portfolio:holdingDetail.currentPrice')}</p>
                                <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                                    {isValueVisible ? formatCurrency(holding?.currentPrice ?? stats?.currentPrice ?? 0, currency) : '•••••'}
                                </p>
                            </div>

                            {/* Qty */}
                            <div className="bg-gray-50/80 dark:bg-gray-800/60 rounded-xl p-3 border border-gray-200 dark:border-gray-700/50">
                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t('portfolio:fields.quantity')}</p>
                                <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                                    {isValueVisible
                                        ? ((holding?.quantity ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 8 })
                                        : '•••••'}
                                </p>
                            </div>

                            {/* Total Return */}
                            <div className={cn(
                                'rounded-xl p-3 border',
                                isPositiveReturn
                                    ? 'bg-success-50/80 dark:bg-success-900/20 border-success-200 dark:border-success-800/50'
                                    : 'bg-error-50/80 dark:bg-error-900/20 border-error-200 dark:border-error-800/50'
                            )}>
                                <div className="flex items-center gap-1.5 mb-1">
                                    {isPositiveReturn
                                        ? <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-success-600 dark:text-success-400" />
                                        : <ArrowTrendingDownIcon className="w-3.5 h-3.5 text-error-600 dark:text-error-400" />}
                                    <p className={cn('text-xs font-bold uppercase tracking-wider',
                                        isPositiveReturn ? 'text-success-700 dark:text-success-300' : 'text-error-700 dark:text-error-300'
                                    )}>{t('portfolio:holdingDetail.totalReturn')}</p>
                                </div>
                                <p className={cn('text-lg sm:text-xl font-bold tabular-nums',
                                    isPositiveReturn ? 'text-success-900 dark:text-success-100' : 'text-error-900 dark:text-error-100'
                                )}>
                                    {isValueVisible
                                        ? `${isPositiveReturn ? '+' : ''}${(holding?.gainLossPercentage ?? stats?.returnPercent ?? 0).toFixed(2)}%`
                                        : '•••%'}
                                </p>
                                <p className={cn('text-xs font-medium tabular-nums mt-0.5',
                                    isPositiveReturn ? 'text-success-700 dark:text-success-300' : 'text-error-700 dark:text-error-300'
                                )}>
                                    {isValueVisible
                                        ? `${isPositiveReturn ? '+' : ''}${formatCurrency(holding?.gainLoss ?? stats?.returnAmount ?? 0, currency)}`
                                        : '•••'}
                                </p>
                            </div>

                            {/* Period change */}
                            <div className="bg-gray-50/80 dark:bg-gray-800/60 rounded-xl p-3 border border-gray-200 dark:border-gray-700/50">
                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                    {t('portfolio:holdingDetail.periodChange', { period, defaultValue: '{{period}} Change' })}
                                </p>
                                {stats ? (
                                    <>
                                        <p className={cn('text-lg sm:text-xl font-bold tabular-nums',
                                            isPositivePeriod ? 'text-success-700 dark:text-success-300' : 'text-error-700 dark:text-error-300'
                                        )}>
                                            {isValueVisible ? `${isPositivePeriod ? '+' : ''}${stats.periodChangePct.toFixed(2)}%` : '•••%'}
                                        </p>
                                        <p className={cn('text-xs font-medium tabular-nums mt-0.5',
                                            isPositivePeriod ? 'text-success-700 dark:text-success-300' : 'text-error-700 dark:text-error-300'
                                        )}>
                                            {isValueVisible ? `${isPositivePeriod ? '+' : ''}${formatCurrency(stats.periodChange, currency)}` : '•••'}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-lg font-bold text-gray-400 dark:text-gray-500">—</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Chart container ───────────────────────────────────── */}
                    <Card padding="sm" radius="xl" shadow="none" className="sm:p-6">

                        {/* Chart controls */}
                        <div className="flex items-center gap-2 mb-4 flex-wrap">
                            {/* View mode */}
                            <div role="group" aria-label={t('portfolio:holdingDetail.chartViewMode')} className="flex bg-gray-100 dark:bg-gray-800/50 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700/50">
                                {([['price', t('portfolio:holdingDetail.modePrice', 'Price')], ['return', t('portfolio:holdingDetail.modeReturn', 'Return %')], ['candle', t('portfolio:holdingDetail.modeCandles', 'Candles')]] as const).map(([mode, label]) => (
                                    <button
                                        key={mode}
                                        onClick={() => setViewMode(mode)}
                                        aria-pressed={viewMode === mode}
                                        className={cn(
                                            'px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                                            viewMode === mode
                                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Zoom toggle */}
                            <button
                                onClick={() => setBrushEnabled(p => !p)}
                                aria-pressed={brushEnabled}
                                className={cn(
                                    'ml-1 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-200 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                                    brushEnabled
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700'
                                        : 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border-gray-200 dark:border-gray-700'
                                )}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                {t('portfolio:holdingDetail.zoom')}
                            </button>

                            {/* Legend — candle mode renders its own complete in-chart legend
                                (Up/Down candles + MA5/MA10/MA20 + Avg Cost), so skip the
                                header legend there to avoid a mislabeled, duplicate "Price". */}
                            {viewMode !== 'candle' && (
                                <div className="flex items-center gap-3 ml-auto text-xs">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-1.5 rounded-full bg-primary-500" />
                                        <span className="text-gray-500 dark:text-gray-400 font-medium">{t('portfolio:holdings.price')}</span>
                                    </div>
                                    {viewMode === 'price' && avgCost > 0 && (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-3 h-1.5 rounded-full bg-blue-400 dark:bg-blue-500" style={{ opacity: 0.6 }} />
                                            <span className="text-gray-500 dark:text-gray-400 font-medium">{t('portfolio:holdingDetail.avgCost')}</span>
                                        </div>
                                    )}
                                    {buyPointCount > 0 && (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-white dark:border-gray-800" />
                                            <span className="text-gray-500 dark:text-gray-400 font-medium">
                                                Buy{buyPointCount !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Chart body */}
                        {isLoading ? (
                            <div className="h-72 bg-gray-50 dark:bg-gray-700/30 rounded-lg animate-pulse" />
                        ) : chartData.length === 0 ? (
                            <div className="h-72 flex flex-col items-center justify-center">
                                <div className="text-center max-w-sm">
                                    <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                        <ChartBarSquareIcon className="w-8 h-8 text-gray-400 dark:text-gray-600" />
                                    </div>
                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('portfolio:holdingDetail.noHistory')}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                                        {period !== '5D' && period !== '1M'
                                            ? `Only 30D data is loaded by default. Sync to fetch ${period} history.`
                                            : 'No data available. Try syncing historical prices.'}
                                    </p>
                                    <button
                                        onClick={handleSync}
                                        disabled={isSyncing}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        <ArrowPathIcon className={cn('w-4 h-4', isSyncing && 'animate-spin')} />
                                        {isSyncing ? 'Syncing…' : 'Sync Historical Data'}
                                    </button>
                                </div>
                            </div>
                        ) : viewMode === 'candle' ? (
                            <AssetCandlestickChart
                                chartData={chartData}
                                avgCost={avgCost}
                                currency={currency}
                                isValueVisible={isValueVisible}
                            />
                        ) : (
                            <AssetPriceChart
                                chartData={chartData}
                                viewMode={viewMode}
                                brushEnabled={brushEnabled}
                                symbol={symbol}
                                avgCost={avgCost}
                                currency={currency}
                                isValueVisible={isValueVisible}
                                isPositiveReturn={isPositiveReturn}
                            />
                        )}
                    </Card>

                    {/* ── Lots table ────────────────────────────────────────── */}
                    {lots.length > 0 && (
                        <Card padding="none" radius="xl" shadow="none" clip>
                            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {t('portfolio:holdingDetail.purchaseLots')}
                                    <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                                        {t('portfolio:holdingDetail.lotCount', { count: lots.length, defaultValue: '{{count}} lots' })}
                                    </span>
                                </h2>
                            </div>
                            {/* Phones: one card per lot — six columns do not fit 390px */}
                            <HoldingLotCards lots={lots} holding={holding} currency={currency} isValueVisible={isValueVisible} />
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-700/30">
                                            {(['date', 'qty', 'costPerShare', 'totalCost', 'currentValue', 'gainLoss'] as const).map(h => (
                                                <th key={h} className={cn(
                                                    'px-4 sm:px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider',
                                                    h === 'date' ? 'text-left' : 'text-right'
                                                )}>{t(`portfolio:holdingDetail.col.${h}`)}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                        {lots.map((lot: PortfolioHolding, idx: number) => {
                                            const lotGain = lot.gainLoss ?? (lot.totalValue - lot.totalCost);
                                            const lotGainPct = lot.gainLossPercentage;
                                            const isLotUp = lotGain >= 0;
                                            return (
                                                <tr key={lot.id ?? idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                                    <td className="px-4 sm:px-6 py-3 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                                        {lot.purchaseDate
                                                            ? new Date(lot.purchaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                                                            : '—'}
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                                                        {isValueVisible ? (lot.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '•••••'}
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                                                        {isValueVisible ? formatCurrency(lot.averageCost, currency) : '•••••'}
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                                                        {isValueVisible ? formatCurrency(lot.totalCost, currency) : '•••••'}
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                                                        {isValueVisible ? formatCurrency(lot.totalValue, currency) : '•••••'}
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 text-sm text-right whitespace-nowrap">
                                                        {isValueVisible ? (
                                                            <div>
                                                                <span className={cn('font-medium', isLotUp ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400')}>
                                                                    {isLotUp ? '+' : ''}{formatCurrency(lotGain, currency)}
                                                                </span>
                                                                {lotGainPct != null && (
                                                                    <span className={cn('block text-xs', isLotUp ? 'text-success-500 dark:text-success-400' : 'text-error-500 dark:text-error-400')}>
                                                                        {isLotUp ? '+' : ''}{lotGainPct.toFixed(2)}%
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : '•••••'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    {lots.length > 1 && holding && (
                                        <tfoot>
                                            <tr className="bg-gray-50 dark:bg-gray-700/30 font-medium">
                                                <td className="px-4 sm:px-6 py-3 text-xs text-gray-500 dark:text-gray-400 uppercase">{t('portfolio:holdingDetail.total')}</td>
                                                <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white">
                                                    {isValueVisible ? ((holding.quantity ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '•••••'}
                                                </td>
                                                <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                                                    {isValueVisible ? formatCurrency(holding.averageCost, currency) : '•••••'}
                                                </td>
                                                <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white">
                                                    {isValueVisible ? formatCurrency(holding.totalCost, currency) : '•••••'}
                                                </td>
                                                <td className="px-4 sm:px-6 py-3 text-sm text-right text-gray-900 dark:text-white">
                                                    {isValueVisible ? (
                                                        <>
                                                            <div>{formatCurrency(holding.totalValue, currency)}</div>
                                                            {baseRate !== undefined && (
                                                                // Same rule as the holdings list: absent when the
                                                                // pair cannot be priced, never a guess.
                                                                <div className="text-xs font-normal text-gray-400 dark:text-gray-500 tabular-nums">
                                                                    ≈ {formatCurrency(holding.totalValue * baseRate, BASE_CURRENCY)}
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : '•••••'}
                                                </td>
                                                <td className="px-4 sm:px-6 py-3 text-sm text-right">
                                                    {isValueVisible ? (
                                                        <div>
                                                            {/* The holding's own sign, as on the phone's Total card */}
                                                            <span className={cn('font-medium', (holding.gainLoss ?? 0) >= 0 ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400')}>
                                                                {(holding.gainLoss ?? 0) >= 0 ? '+' : ''}{formatCurrency(holding.gainLoss, currency)}
                                                            </span>
                                                            <span className={cn('block text-xs', (holding.gainLoss ?? 0) >= 0 ? 'text-success-500' : 'text-error-500')}>
                                                                {(holding.gainLoss ?? 0) >= 0 ? '+' : ''}{(holding.gainLossPercentage ?? 0).toFixed(2)}%
                                                            </span>
                                                        </div>
                                                    ) : '•••••'}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </Card>
                    )}

                </div>
            </div>
        </DashboardLayout>
        </ErrorBoundary>
    );
}
