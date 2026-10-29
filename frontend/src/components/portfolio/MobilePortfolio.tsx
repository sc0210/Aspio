'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { useQuery } from '@tanstack/react-query';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAppMode } from '@/hooks/useAppMode';
import { QUERY_KEYS } from '@/hooks/useDataSynchronization';
import { portfolioService } from '@/services/portfolioService';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD, formatTWDCompact, toTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { PortfolioHolding } from '@/shared/types';
import { Card } from '@/components/ui/Card';


// Fixed categorical order — colors follow the entity, never rank.
const SLICE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#94a3b8'];

interface Slice { label: string; value: number; color: string; pct: number }

/** Donut arc path from a fraction range (0–1), for an SVG viewBox 0 0 42 42. */
function arc(startFrac: number, endFrac: number, r = 15.9, cx = 21, cy = 21) {
    const a0 = 2 * Math.PI * startFrac - Math.PI / 2;
    const a1 = 2 * Math.PI * endFrac - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = endFrac - startFrac > 0.5 ? 1 : 0;
    return `M${x0.toFixed(3)},${y0.toFixed(3)} A${r},${r} 0 ${large} 1 ${x1.toFixed(3)},${y1.toFixed(3)}`;
}

export function MobilePortfolio() {
    const { t } = useTranslation(['portfolio', 'dashboard', 'common']);
    const { portfolio, isLoading } = usePortfolio();
    const { isValueVisible } = usePrivacy();
    const { user } = useAppMode();
    // Same query (and cache) as the desktop stats strip: the time-weighted
    // annual return since inception; null under a year of history.
    const { data: risk } = useQuery({
        queryKey: [QUERY_KEYS.PORTFOLIO_RISK_METRICS, user?.email || 'demo'],
        queryFn: async () => {
            try {
                return await portfolioService.getRiskMetrics();
            } catch {
                return null;
            }
        },
        // Called in demo mode on purpose, as the desktop strip does: the backend
        // answers /portfolio/risk-metrics with a demo payload when there is no
        // user (backend demo removal was deferred, see the demo-mode notes).
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    const annualPct = typeof risk?.cagrPercentage === 'number' ? risk.cagrPercentage : null;

    const data = (portfolio as { data?: {
        totalValue?: number; totalGainLoss?: number; totalGainLossPercentage?: number;
        todayGainLoss?: number; todayGainLossPercentage?: number; holdings?: PortfolioHolding[];
    } } | undefined)?.data;

    const model = useMemo(() => {
        const holdings = data?.holdings ?? [];
        const totalValue = data?.totalValue ?? 0;
        const totalGain = data?.totalGainLoss ?? 0;
        const totalGainPct = data?.totalGainLossPercentage ?? 0;
        const todayGain = data?.todayGainLoss ?? 0;
        const todayGainPct = data?.todayGainLossPercentage ?? 0;

        // FX-normalize each holding to TWD, then AGGREGATE BY SYMBOL so multiple
        // lots of the same ticker (e.g. two 0050 lots) collapse into one slice —
        // otherwise the donut double-counts and React sees duplicate keys.
        const bySymbol = new Map<string, number>();
        for (const h of holdings) {
            const twd = toTWD(h.totalValue || 0, h.currency || 'TWD');
            if (twd <= 0) continue;
            bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + twd);
        }
        const valued = [...bySymbol.entries()]
            .map(([symbol, twd]) => ({ symbol, twd }))
            .sort((a, b) => b.twd - a.twd);
        const sum = valued.reduce((s, x) => s + x.twd, 0) || 1;

        // Top 6 slices; everything else folds into "Other" (never a generated hue).
        const top = valued.slice(0, 6);
        const restTwd = valued.slice(6).reduce((s, x) => s + x.twd, 0);
        const slices: Slice[] = top.map((x, i) => ({
            label: x.symbol, value: x.twd, color: SLICE_COLORS[i], pct: (x.twd / sum) * 100,
        }));
        if (restTwd > 0) slices.push({ label: t('portfolio:other', 'Other'), value: restTwd, color: SLICE_COLORS[6], pct: (restTwd / sum) * 100 });

        // List individual holdings, largest first (TWD-normalized).
        const sortedHoldings = [...holdings].sort(
            (a, b) => toTWD(b.totalValue || 0, b.currency || 'TWD') - toTWD(a.totalValue || 0, a.currency || 'TWD'),
        );
        return { holdings: sortedHoldings, totalValue, totalGain, totalGainPct, todayGain, todayGainPct, slices, count: holdings.length };
    }, [data, t]);

    if (isLoading && !data) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner size="lg" /></div>
            </DashboardLayout>
        );
    }

    const totalUp = model.totalGain >= 0;
    const todayUp = model.todayGain >= 0;
    const hidden = '••••';

    // Cumulative donut offsets.
    let acc = 0;
    const arcs = model.slices.map((s) => {
        const start = acc; acc += s.pct / 100; return { s, start, end: acc };
    });

    if (model.count === 0) {
        return (
            <DashboardLayout>
                <div className="max-w-md mx-auto px-1 py-10 text-center space-y-4">
                    <h1 className="text-xl font-extrabold text-gray-900 dark:text-white">{t('portfolio:title', 'Portfolio')}</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('portfolio:noHoldingsYet', 'No holdings yet.')}</p>
                    <Link href="/portfolio/add" className="inline-flex items-center gap-1.5 rounded-xl bg-primary-700 hover:bg-primary-800 px-4 py-2.5 text-sm font-semibold text-white">
                        <PlusIcon className="w-4 h-4" /> {t('portfolio:header.addHolding', 'Add holding')}
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <div className="flex items-center justify-between pt-1">
                    <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('portfolio:title', 'Portfolio')}</h1>
                    <Link href="/portfolio/add" aria-label={t('portfolio:header.addHolding', 'Add holding')}
                        className="grid place-items-center w-11 h-11 rounded-full bg-primary-700 hover:bg-primary-800 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <PlusIcon className="w-5 h-5" />
                    </Link>
                </div>

                <BiggerScreenHint />

                {/* HERO — total value + gain, with the allocation donut */}
                <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                    <div className="flex items-center gap-4">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold tracking-wide text-gray-500 dark:text-gray-500">{t('portfolio:stats.totalValue', 'Portfolio Value')}</p>
                            <p className="mt-1.5 text-[32px] leading-none font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
                                {isValueVisible ? formatTWD(model.totalValue) : hidden}
                            </p>
                            <p className={cn('mt-2 text-sm font-bold tabular-nums', totalUp ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                                {totalUp ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(model.totalGain)) : '•••'}
                                <span className="text-gray-500 dark:text-gray-500 font-semibold ml-1">
                                    {totalUp ? '+' : '−'}{Math.abs(model.totalGainPct).toFixed(1)}%
                                </span>
                            </p>
                        </div>
                        {/* Donut */}
                        <svg viewBox="0 0 42 42" className="w-[104px] h-[104px] flex-shrink-0" aria-hidden="true">
                            <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" strokeWidth="5" className="text-gray-100 dark:text-gray-700" />
                            {arcs.map(({ s, start, end }) => (
                                <path key={s.label} d={arc(start, end)} fill="none" stroke={s.color} strokeWidth="5" strokeLinecap="butt" />
                            ))}
                            <text x="21" y="20.5" textAnchor="middle" className="fill-gray-900 dark:fill-white" style={{ fontSize: 5.5, fontWeight: 800 }}>{model.count}</text>
                            <text x="21" y="25.5" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 2.6, fontWeight: 600 }}>{t('portfolio:holdingsCountLabel', 'holdings')}</text>
                        </svg>
                    </div>

                    {/* Today's change */}
                    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-500">{t('portfolio:todayChange', "Today")}</span>
                        <span className={cn('text-sm font-bold tabular-nums', todayUp ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                            {todayUp ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(model.todayGain)) : '•••'} · {todayUp ? '+' : '−'}{Math.abs(model.todayGainPct).toFixed(2)}%
                        </span>
                    </div>
                    {annualPct !== null && (
                        <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-500">
                                {t('portfolio:stats.cagrLabel', 'Annual return')}
                                <span className="ml-1 font-normal">· {t('portfolio:stats.cagrCaption', 'Time-weighted, per year')}</span>
                            </span>
                            <span className={cn('text-sm font-bold tabular-nums', annualPct >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                                {annualPct >= 0 ? '+' : '−'}{Math.abs(annualPct).toFixed(1)}%
                            </span>
                        </div>
                    )}
                </section>

                {/* Allocation legend */}
                <Card as="section" padding="sm" shadow="none">
                    <p className="text-xs font-bold text-gray-500 dark:text-gray-500 mb-3">{t('portfolio:allocation', 'Allocation')}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        {model.slices.map((s) => (
                            <div key={s.label} className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                                <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-200 truncate">{s.label}</span>
                                <span className="ml-auto text-[12.5px] font-bold text-gray-500 dark:text-gray-400 tabular-nums">{s.pct.toFixed(0)}%</span>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Top holdings — compact rows */}
                <section>
                    <p className="px-1 mb-2.5 text-sm font-extrabold tracking-tight text-gray-900 dark:text-white">{t('portfolio:holdingsList', 'Holdings')}</p>
                    <Card padding="none" shadow="none" clip className="divide-y divide-gray-100 dark:divide-gray-700">
                        {model.holdings.slice(0, 8).map((h) => {
                            const up = (h.gainLoss || 0) >= 0;
                            return (
                                <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-white truncate">{h.symbol}</p>
                                        <p className="text-xs font-medium text-gray-500 dark:text-gray-500 truncate">{h.name || h.type}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="text-[13.5px] font-bold tabular-nums text-gray-900 dark:text-white">
                                            {isValueVisible ? formatTWDCompact(toTWD(h.totalValue || 0, h.currency || 'TWD')) : '•••'}
                                        </p>
                                        <p className={cn('text-xs font-bold tabular-nums', up ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                                            {up ? '+' : '−'}{Math.abs(h.gainLossPercentage || 0).toFixed(1)}%
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </Card>
                    {model.count > 8 && (
                        <p className="text-center mt-2 text-xs font-semibold text-gray-500 dark:text-gray-500">
                            {t('portfolio:andMore', '+{{n}} more', { n: model.count - 8 })}
                        </p>
                    )}
                </section>

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-500">
                    {t('dashboard:mobile.fullPortfolio', 'Performance charts, IRR & rebalancing')}
                    <br />
                    <span className="text-primary-700 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
