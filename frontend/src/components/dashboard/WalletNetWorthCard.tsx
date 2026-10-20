'use client';

import { useMemo, memo, useState, useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
} from 'recharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import type { WalletTrendDataPoint } from '@/hooks/useWalletTrends';
import { cn } from '@/utils/cn';
import { netWorthOf } from '@/lib/dashboard/periodChange';
import { Card } from '@/components/ui/Card';

interface WalletNetWorthCardProps {
    stats: {
        total_asset: number;
        total_debt?: number;
        life_wallet: number;
        portfolio_wallet: number;
        emergency_wallet: number;
        monthlyIncome: number;
        monthlyExpenses: number;
    };
    walletTrendsData: WalletTrendDataPoint[];
    netWorthChangePercent?: number;
    netWorthChangeAmount?: number;
    loading?: boolean;
    isPeriodSwitching?: boolean;
}

/**
 * Compact (萬) is for axis ticks only.
 *
 * Everywhere else the card shows a figure the rest of the page also shows, and
 * two formats for one quantity on one screen is what made these numbers read as
 * unreliable: 總資產 appeared as NT$8,659,139 in the strip and NT$865.9萬 in
 * this card's own breakdown, 淨資產 as NT$4,775,730 in the headline and
 * NT$477.6萬 in the donut beside it. A tick label has no such twin and genuinely
 * has no room.
 */

const pctBadge = (pct: number | undefined, neutral = false) => {
    if (pct === undefined) return null;
    const up = pct >= 0;
    const base = 'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full';
    if (neutral) return `${base} bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400`;
    return up
        ? `${base} bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300`
        : `${base} bg-error-100 dark:bg-error-900/40 text-error-700 dark:text-error-300`;
};

const arrow = (pct: number | undefined) => {
    if (pct === undefined) return '→';
    if (Math.abs(pct) < 0.05) return '→';
    return pct > 0 ? '▲' : '▼';
};

const WALLET_DEF_CONFIGS = [
    { key: 'life_wallet' as const, changeKey: 'life' as const, labelKey: 'wallet.lifeWallet', accent: 'sky' as const },
    { key: 'portfolio_wallet' as const, changeKey: 'portfolio' as const, labelKey: 'wallet.portfolioWallet', accent: 'violet' as const },
    { key: 'emergency_wallet' as const, changeKey: 'emergency' as const, labelKey: 'wallet.emergencyFund', accent: 'amber' as const },
] as const;

const WALLET_COLORS = {
    sky: { border: 'border-l-sky-400', text: 'text-sky-700 dark:text-sky-400', dot: '#0ea5e9' },
    violet: { border: 'border-l-violet-400', text: 'text-violet-600 dark:text-violet-400', dot: '#8b5cf6' },
    amber: { border: 'border-l-amber-400', text: 'text-amber-700 dark:text-amber-400', dot: '#f59e0b' },
};

const CHART_COLORS = {
    life:       '#0ea5e9', // sky-500
    portfolio:  '#8b5cf6', // violet-500
    emergency:  '#f59e0b', // amber-500
    debt:       '#dc2626', // error-600 (was rose-500 #f43f5e — corrected to match error token)
    total:      '#6366f1', // indigo-500
    netWorth:   '#10b981', // emerald-500 — assets − liabilities (the card's headline metric)
} as const;

interface TooltipProps {
    active?: boolean;
    payload?: Array<{ payload: WalletTrendDataPoint }>;
    isValueVisible: boolean;
    walletDefs: Array<{ key: typeof WALLET_DEF_CONFIGS[number]['key']; label: string }>;
    t: (key: string, fallback: string) => string;
}

const CustomTooltip = memo(function CustomTooltip({ active, payload, isValueVisible, walletDefs, t }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-3 min-w-[180px]">
            <p className="text-xs font-bold text-gray-900 dark:text-white mb-2 pb-1.5 border-b border-gray-100 dark:border-gray-700">
                {new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}
            </p>
            <div className="space-y-1.5">
                <div className="flex justify-between gap-3 text-xs">
                    <span className="flex items-center gap-1 font-medium" style={{ color: CHART_COLORS.netWorth }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CHART_COLORS.netWorth }} />
                        {t('wallet.netWorth', 'Net Worth')}
                    </span>
                    <span className="font-bold tabular-nums" style={{ color: CHART_COLORS.netWorth }}>
                        {isValueVisible ? formatTWD(netWorthOf(d)) : '•••'}
                    </span>
                </div>
                <div className="flex justify-between gap-3 text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('wallet.totalAsset', 'Total Asset')}</span>
                    <span className="text-gray-900 dark:text-white font-bold tabular-nums">{isValueVisible ? formatTWD(d.totalAsset) : '•••'}</span>
                </div>
                {walletDefs.map(({ key, label }) => {
                    const color = WALLET_COLORS[key === 'life_wallet' ? 'sky' : key === 'portfolio_wallet' ? 'violet' : 'amber'].dot;
                    const dataKey = key === 'life_wallet' ? 'lifeWallet' : key === 'portfolio_wallet' ? 'portfolioWallet' : 'emergencyWallet';
                    return (
                        <div key={key} className="flex justify-between gap-3 text-xs">
                            <span className="flex items-center gap-1" style={{ color }}>
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                {label}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300 tabular-nums">{isValueVisible ? formatTWD(d[dataKey]) : '•••'}</span>
                        </div>
                    );
                })}
                {(Number(d.debtBalance) || 0) > 0 && (
                    <div className="flex justify-between gap-3 text-xs pt-1 border-t border-gray-100 dark:border-gray-700">
                        <span className="flex items-center gap-1 text-error-700 dark:text-error-500">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-error-500" />
                            {t('wallet.debtBalance', 'Debt Balance')}
                        </span>
                        <span className="text-error-700 dark:text-error-500 tabular-nums">{isValueVisible ? formatTWD(d.debtBalance ?? 0) : '•••'}</span>
                    </div>
                )}
            </div>
        </div>
    );
});

export function WalletNetWorthCard({
    stats,
    walletTrendsData,
    netWorthChangePercent,
    netWorthChangeAmount,
    loading = false,
    isPeriodSwitching = false,
}: WalletNetWorthCardProps) {
    const { t, i18n } = useTranslation('dashboard');
    const { isValueVisible } = usePrivacy();

    const [lineVisibility, setLineVisibility] = useState({
        lifeWallet: false,
        portfolioWallet: false,
        emergencyWallet: false,
        debtBalance: true,
        totalAsset: true,
        netWorth: true,
    });

    const toggleLine = (key: keyof typeof lineVisibility) =>
        setLineVisibility(prev => ({ ...prev, [key]: !prev[key] }));

    const WALLET_DEFS = useMemo(() => WALLET_DEF_CONFIGS.map(d => ({
        ...d,
        label: t(d.labelKey, d.labelKey.split('.')[1]),
    })), [t]);

    const walletChanges = useMemo(() => {
        if (!walletTrendsData || walletTrendsData.length < 2) return { life: undefined, portfolio: undefined, emergency: undefined };
        const first = walletTrendsData[0];
        const last = walletTrendsData[walletTrendsData.length - 1];
        const pct = (key: keyof WalletTrendDataPoint) => {
            const f = Number(first[key]) || 0;
            const l = Number(last[key]) || 0;
            if (f === 0) return undefined;
            return ((l - f) / Math.abs(f)) * 100;
        };
        return {
            life: pct('lifeWallet'),
            portfolio: pct('portfolioWallet'),
            emergency: pct('emergencyWallet'),
        };
    }, [walletTrendsData]);

    const composition = useMemo(() => {
        const life = Math.max(0, stats.life_wallet);
        const port = Math.max(0, stats.portfolio_wallet);
        const emg = Math.max(0, stats.emergency_wallet);
        const total = life + port + emg || 1;
        return {
            life: (life / total) * 100,
            portfolio: (port / total) * 100,
            emergency: (emg / total) * 100,
        };
    }, [stats]);

    const emergencyRunway = stats.monthlyExpenses > 0
        ? stats.emergency_wallet / stats.monthlyExpenses
        : null;

    const chartData = useMemo(() => {
        if (!walletTrendsData) return [];
        return walletTrendsData.map(p => ({
            ...p,
            displayDate: new Date(p.date).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }),
            // Net worth = total assets − liabilities (the card's headline figure).
            netWorth: netWorthOf(p),
        }));
    }, [walletTrendsData, i18n.language]);

    const hasDebtTrend = useMemo(
        () => chartData.some(p => (Number(p.debtBalance) || 0) > 0),
        [chartData]
    );

    const yDomain = useMemo((): [number, number] => {
        if (!chartData.length) return [0, 1];
        const values = chartData.flatMap(p => [
            ...(lineVisibility.lifeWallet ? [Number(p.lifeWallet) || 0] : []),
            ...(lineVisibility.portfolioWallet ? [Number(p.portfolioWallet) || 0] : []),
            ...(lineVisibility.emergencyWallet ? [Number(p.emergencyWallet) || 0] : []),
            ...(hasDebtTrend && lineVisibility.debtBalance ? [Number(p.debtBalance) || 0] : []),
            ...(lineVisibility.totalAsset ? [Number(p.totalAsset) || 0] : []),
            ...(lineVisibility.netWorth ? [Number(p.netWorth) || 0] : []),
        ]);
        if (!values.length) return [0, 1];
        const min = Math.min(...values);
        const max = Math.max(...values);
        const pad = (max - min) * 0.25 || max * 0.15 || 1;
        return [Math.max(0, Math.round(min - pad)), Math.round(max + pad)];
    }, [chartData, hasDebtTrend, lineVisibility]);

    // Animate y-axis domain with ease-out cubic via rAF
    const [animatedDomain, setAnimatedDomain] = useState<[number, number]>(yDomain);
    const rafRef = useRef<number | null>(null);
    const fromDomainRef = useRef<[number, number]>(yDomain);

    useEffect(() => {
        const target = yDomain;
        fromDomainRef.current = [animatedDomain[0], animatedDomain[1]];
        let startTime: number | null = null;
        const DURATION = 350;

        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

        const tick = (ts: number) => {
            if (startTime === null) startTime = ts;
            const t = Math.min((ts - startTime) / DURATION, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const next: [number, number] = [
                Math.round(fromDomainRef.current[0] + (target[0] - fromDomainRef.current[0]) * eased),
                Math.round(fromDomainRef.current[1] + (target[1] - fromDomainRef.current[1]) * eased),
            ];
            setAnimatedDomain(next);
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [yDomain]);


    const totalDebt = stats.total_debt ?? 0;
    const netWorthValue = stats.total_asset - totalDebt;
    const debtRatio = stats.total_asset > 0 ? Math.min(1, totalDebt / stats.total_asset) : 0;
    const hasDebtBalance = totalDebt > 0;

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                <Card padding="md" className="md:col-span-2 animate-pulse space-y-3">
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                    <div className="h-48 sm:h-56 md:h-64 lg:h-72 bg-gray-200 dark:bg-gray-700 rounded-xl" />
                </Card>
                <Card padding="md" className="hidden md:block animate-pulse space-y-3">
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto w-40" />
                    {[0, 1, 2].map(i => <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded-xl" />)}
                </Card>
            </div>
        );
    }

    return (
        <div className={cn(
            'grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5',
            'transition-opacity duration-300',
            isPeriodSwitching && 'opacity-60'
        )}>
            {/* ── LEFT CARD (2/3): headline + chart ── */}
            <Card padding="md" clip className="md:col-span-2 flex flex-col gap-3">
                    <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-1">
                        <div className="h-px bg-gradient-to-r from-sky-400/60 via-primary-400/60 to-violet-400/60" />
                    </div>

                    {/* Card header: title left, change badge + link right */}
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('wallet.netWorth', 'Net Worth')}</h3>
                        <div className="flex items-center gap-2">
                            {netWorthChangePercent !== undefined && (
                                <span className={pctBadge(netWorthChangePercent, Math.abs(netWorthChangePercent) < 0.05) ?? ''}>
                                    {arrow(netWorthChangePercent)} {Math.abs(netWorthChangePercent).toFixed(1)}%
                                </span>
                            )}
                            {/* The amount beside the percentage, as on the strip
                                above: a percentage alone cannot be checked
                                against the balance it came from, and on a
                                levered account the two tell different stories. */}
                            {netWorthChangeAmount !== undefined && (
                                <span
                                    className={cn(
                                        'text-xs font-semibold tabular-nums whitespace-nowrap',
                                        Math.abs(netWorthChangeAmount) === 0
                                            ? 'text-gray-500 dark:text-gray-400'
                                            : netWorthChangeAmount > 0
                                                ? 'text-prosperity-700 dark:text-prosperity-300'
                                                : 'text-error-700 dark:text-error-300',
                                    )}
                                >
                                    {isValueVisible
                                        ? `${netWorthChangeAmount >= 0 ? '+' : '−'}${formatTWD(Math.abs(netWorthChangeAmount))}`
                                        : '•••'}
                                </span>
                            )}
                            <Link
                                href="/savings"
                                className="text-xs text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
                            >
                                {t('todayStrip.details', 'Details')}
                            </Link>
                        </div>
                    </div>

                    {/* Main value — true net worth = assets − liabilities */}
                    <p
                        className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tabular-nums truncate -mt-1"
                        aria-label={`Net worth: ${isValueVisible ? formatTWD(netWorthValue) : 'hidden'}`}
                    >
                        {isValueVisible ? formatTWD(netWorthValue) : '••••••'}
                    </p>

                    {/* Assets / Liabilities breakdown */}
                    {hasDebtBalance && (
                        <div className="flex items-center gap-4 text-xs -mt-1">
                            <div className="flex items-center gap-1">
                                <span className="text-gray-500 dark:text-gray-500">{t('wallet.assets', 'Assets')}</span>
                                <span className="font-semibold text-prosperity-700 dark:text-prosperity-400 tabular-nums">
                                    {isValueVisible ? formatTWD(stats.total_asset) : '•••'}
                                </span>
                            </div>
                            <span className="text-gray-500 dark:text-gray-600">−</span>
                            <div className="flex items-center gap-1">
                                <span className="text-gray-500 dark:text-gray-500">{t('wallet.liabilities', 'Liabilities')}</span>
                                <Link href="/loans" className="font-semibold text-error-700 dark:text-error-400 tabular-nums hover:underline">
                                    {isValueVisible ? formatTWD(totalDebt) : '•••'}
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* Sub-stats */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <div className="flex items-center gap-1.5">
                            <span className="text-gray-500 dark:text-gray-500 font-medium">{t('wallet.emergencyRunway', 'Emergency Runway')}</span>
                            {emergencyRunway !== null ? (
                                <span className={cn('font-semibold tabular-nums',
                                    emergencyRunway >= 6 ? 'text-prosperity-700 dark:text-prosperity-400' :
                                        emergencyRunway >= 3 ? 'text-amber-700 dark:text-amber-400' :
                                            'text-error-700 dark:text-error-400'
                                )}>
                                    {`${emergencyRunway.toFixed(1)} ${t('wallet.months', 'mo')}`}
                                </span>
                            ) : (
                                <span className="text-gray-500 dark:text-gray-500">—</span>
                            )}
                        </div>
                    </div>

                    {/* Wallet trend chart */}
                    <div className="h-48 sm:h-56 md:h-64 lg:h-72 flex-1">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="nwc-lifeGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={CHART_COLORS.life} stopOpacity={0.25} />
                                            <stop offset="95%" stopColor={CHART_COLORS.life} stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id="nwc-portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={CHART_COLORS.portfolio} stopOpacity={0.25} />
                                            <stop offset="95%" stopColor={CHART_COLORS.portfolio} stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id="nwc-emergencyGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={CHART_COLORS.emergency} stopOpacity={0.25} />
                                            <stop offset="95%" stopColor={CHART_COLORS.emergency} stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id="nwc-debtGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={CHART_COLORS.debt} stopOpacity={0.20} />
                                            <stop offset="95%" stopColor={CHART_COLORS.debt} stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id="nwc-totalGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={CHART_COLORS.total} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={CHART_COLORS.total} stopOpacity={0.04} />
                                        </linearGradient>
                                        <linearGradient id="nwc-netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={CHART_COLORS.netWorth} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={CHART_COLORS.netWorth} stopOpacity={0.04} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700 opacity-50" vertical={false} />
                                    <XAxis dataKey="displayDate" tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }} className="text-gray-500 dark:text-gray-400" tickLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }} className="text-gray-500 dark:text-gray-400" tickLine={false} tickFormatter={(v) => isValueVisible ? formatTWDCompact(v) : '•••'} width={84} tickMargin={4} domain={animatedDomain} />
                                    <Tooltip content={<CustomTooltip isValueVisible={isValueVisible} walletDefs={WALLET_DEFS} t={t} />} cursor={{ stroke: '#0ea5e9', strokeWidth: 1.5, strokeDasharray: '5 5' }} />
                                    {lineVisibility.totalAsset && (
                                        <Area type="monotone" dataKey="totalAsset" stroke={CHART_COLORS.total} strokeWidth={2.5} fill="url(#nwc-totalGrad)" fillOpacity={1} dot={false} activeDot={{ r: 4, fill: '#6366f1', stroke: 'white', strokeWidth: 2 }} name="Total Assets" />
                                    )}
                                    {lineVisibility.netWorth && (
                                        <Area type="monotone" dataKey="netWorth" stroke={CHART_COLORS.netWorth} strokeWidth={2.5} fill="url(#nwc-netWorthGrad)" fillOpacity={1} dot={false} activeDot={{ r: 4, fill: CHART_COLORS.netWorth, stroke: 'white', strokeWidth: 2 }} name={t('wallet.netWorth', 'Net Worth')} />
                                    )}
                                    {lineVisibility.emergencyWallet && (
                                        <Area type="monotone" dataKey="emergencyWallet" stroke={CHART_COLORS.emergency} strokeWidth={2} fill="url(#nwc-emergencyGrad)" fillOpacity={1} dot={false} activeDot={{ r: 4, fill: '#f59e0b', stroke: 'white', strokeWidth: 2 }} name={t('wallet.emergencyFund', 'Emergency Fund')} />
                                    )}
                                    {lineVisibility.portfolioWallet && (
                                        <Area type="monotone" dataKey="portfolioWallet" stroke={CHART_COLORS.portfolio} strokeWidth={2} fill="url(#nwc-portfolioGrad)" fillOpacity={1} dot={false} activeDot={{ r: 4, fill: '#8b5cf6', stroke: 'white', strokeWidth: 2 }} name={t('wallet.portfolioWallet', 'Portfolio')} />
                                    )}
                                    {lineVisibility.lifeWallet && (
                                        <Area type="monotone" dataKey="lifeWallet" stroke={CHART_COLORS.life} strokeWidth={2} fill="url(#nwc-lifeGrad)" fillOpacity={1} dot={false} activeDot={{ r: 4, fill: '#0ea5e9', stroke: 'white', strokeWidth: 2 }} name={t('wallet.lifeWallet', 'Life Wallet')} />
                                    )}
                                    {hasDebtTrend && lineVisibility.debtBalance && (
                                        <Area type="monotone" dataKey="debtBalance" stroke={CHART_COLORS.debt} strokeWidth={2} strokeDasharray="5 3" fill="url(#nwc-debtGrad)" fillOpacity={1} dot={false} activeDot={{ r: 4, fill: '#f43f5e', stroke: 'white', strokeWidth: 2 }} name={t('wallet.debtBalance', 'Debt Balance')} />
                                    )}
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-500 text-sm">
                                {t('wallet.noTrendData', 'No trend data')}
                            </div>
                        )}
                    </div>

                    {/* Legend — click a series to toggle it on/off (dot dims + label
                        strikes through when hidden, instead of the whole row graying out) */}
                    {chartData.length > 0 && (
                        <div className="flex items-center gap-x-0.5 gap-y-0.5 text-xs flex-wrap">
                            {([
                                { lineKey: 'netWorth' as const,        color: 'bg-emerald-500', labelKey: 'wallet.netWorth',       fallback: 'Net Worth' },
                                { lineKey: 'totalAsset' as const,      color: 'bg-indigo-500',  labelKey: 'wallet.totalAsset',      fallback: 'Total Assets' },
                                { lineKey: 'lifeWallet' as const,      color: 'bg-sky-500',     labelKey: 'wallet.lifeWallet',      fallback: 'Life Wallet' },
                                { lineKey: 'portfolioWallet' as const, color: 'bg-violet-500',  labelKey: 'wallet.portfolioWallet', fallback: 'Portfolio' },
                                { lineKey: 'emergencyWallet' as const, color: 'bg-amber-500',   labelKey: 'wallet.emergencyFund',   fallback: 'Emergency Fund' },
                            ]).map(({ lineKey, color, labelKey, fallback }) => {
                                const visible = lineVisibility[lineKey];
                                return (
                                    <button
                                        key={lineKey}
                                        onClick={() => toggleLine(lineKey)}
                                        aria-pressed={visible}
                                        aria-label={`${visible ? 'Hide' : 'Show'} ${t(labelKey, fallback)}`}
                                        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 min-h-[32px] transition-colors touch-manipulation hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        <span className={cn(
                                            'w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors',
                                            visible ? color : 'bg-gray-300 dark:bg-gray-600'
                                        )} />
                                        <span className={cn(
                                            'font-medium transition-colors',
                                            visible
                                                ? 'text-gray-600 dark:text-gray-300'
                                                : 'text-gray-500 dark:text-gray-500 line-through decoration-gray-300 dark:decoration-gray-600'
                                        )}>
                                            {t(labelKey, fallback)}
                                        </span>
                                    </button>
                                );
                            })}
                            {hasDebtTrend && (
                                <button
                                    onClick={() => toggleLine('debtBalance')}
                                    aria-pressed={lineVisibility.debtBalance}
                                    aria-label={`${lineVisibility.debtBalance ? 'Hide' : 'Show'} ${t('wallet.debtBalance', 'Debt Balance')}`}
                                    className="flex items-center gap-1.5 rounded-md px-1.5 py-1 min-h-[32px] transition-colors touch-manipulation hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    <svg width="14" height="6" viewBox="0 0 14 6" className={cn('flex-shrink-0 transition-opacity', !lineVisibility.debtBalance && 'opacity-40')}>
                                        <line x1="0" y1="3" x2="14" y2="3" stroke={CHART_COLORS.debt} strokeWidth="2" strokeDasharray="5 3" />
                                    </svg>
                                    <span className={cn(
                                        'font-medium transition-colors',
                                        lineVisibility.debtBalance
                                            ? 'text-rose-700 dark:text-rose-500'
                                            : 'text-gray-500 dark:text-gray-500 line-through decoration-gray-300 dark:decoration-gray-600'
                                    )}>
                                        {t('wallet.debtBalance', 'Debt Balance')}
                                    </span>
                                </button>
                            )}
                        </div>
                    )}

                    {/* Wallet tiles — mobile only (compact 3-col row) */}
                    <div className="grid grid-cols-3 gap-2 md:hidden">
                        {WALLET_DEFS.map(({ key, changeKey, label, accent }) => {
                            const colors = WALLET_COLORS[accent];
                            const value = stats[key];
                            const change = walletChanges[changeKey];
                            const isNeutral = change === undefined || Math.abs(change) < 0.05;
                            return (
                                <div key={label} className={cn(
                                    'rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 px-2 py-2',
                                    'bg-gray-50 dark:bg-gray-800/60',
                                    colors.border
                                )}>
                                    <p className={cn('text-xs font-semibold uppercase tracking-wide truncate', colors.text)}>
                                        {label}
                                    </p>
                                    <p className="text-xs font-bold text-gray-900 dark:text-white tabular-nums leading-tight mt-0.5 truncate" title={isValueVisible ? formatTWD(value) : ''}>
                                        {isValueVisible ? formatTWD(value) : '•••'}
                                    </p>
                                    {change !== undefined ? (
                                        <span className={cn(
                                            'mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold px-1 py-0.5 rounded-full',
                                            isNeutral
                                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                                : change >= 0
                                                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                                    : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                        )}>
                                            {arrow(change)} {Math.abs(change).toFixed(1)}%
                                        </span>
                                    ) : (
                                        <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">—</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
            </Card>

            {/* ── RIGHT CARD (1/3): donut + legend ── */}
            <Card padding="md" clip className="hidden md:flex md:flex-col gap-3">
                    <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-1">
                        <div className="h-px bg-gradient-to-r from-sky-400/60 via-violet-400/60 to-amber-400/60" />
                    </div>

                    {/* Card header */}
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('wallet.allocation', 'Allocation')}</h3>
                    </div>

                    {/* Donut + legend */}
                    <div className="flex flex-col items-center gap-4 flex-1">
                        {/* Donut chart */}
                        <div className="relative w-full" style={{ height: 210 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    {/* Inner asset allocation donut */}
                                    <Pie
                                        data={[
                                            { name: WALLET_DEFS[0].label, value: Math.max(composition.life, 0.01), raw: stats.life_wallet, color: '#0ea5e9' },
                                            { name: WALLET_DEFS[1].label, value: Math.max(composition.portfolio, 0.01), raw: stats.portfolio_wallet, color: '#8b5cf6' },
                                            { name: WALLET_DEFS[2].label, value: Math.max(composition.emergency, 0.01), raw: stats.emergency_wallet, color: '#f59e0b' },
                                        ]}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={55}
                                        outerRadius={hasDebtBalance ? 74 : 82}
                                        paddingAngle={2}
                                        dataKey="value"
                                        strokeWidth={0}
                                        startAngle={90}
                                        endAngle={-270}
                                    >
                                        <Cell fill={CHART_COLORS.life} />
                                        <Cell fill={CHART_COLORS.portfolio} />
                                        <Cell fill={CHART_COLORS.emergency} />
                                    </Pie>

                                    {/* Outer debt ring — gap at r=78, ring at 82–93 */}
                                    {hasDebtBalance && (
                                        <Pie
                                            data={[
                                                { name: '負債', value: debtRatio * 100, raw: totalDebt, isDebt: true },
                                                { name: '', value: (1 - debtRatio) * 100, raw: 0, isDebt: false },
                                            ]}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={93}
                                            paddingAngle={0}
                                            dataKey="value"
                                            strokeWidth={0}
                                            startAngle={90}
                                            endAngle={-270}
                                        >
                                            <Cell fill={CHART_COLORS.debt} />
                                            <Cell fill="rgba(107,114,128,0.10)" />
                                        </Pie>
                                    )}

                                    {/* Tooltip rendered outside the chart center */}
                                    <Tooltip
                                        allowEscapeViewBox={{ x: true, y: true }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const entry = payload[0].payload;
                                            if (!entry.name) return null;
                                            const isDebtSlice = entry.isDebt === true;
                                            return (
                                                <div style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#f9fafb', minWidth: 140 }}>
                                                    <p className="font-semibold mb-1" style={{ color: isDebtSlice ? '#f43f5e' : entry.color }}>{entry.name}</p>
                                                    <p className="tabular-nums text-gray-300">{isDebtSlice ? `${(debtRatio * 100).toFixed(1)}% of assets` : `${Number(entry.value).toFixed(1)}%`}</p>
                                                    <p className="tabular-nums font-medium text-white mt-0.5">{isValueVisible ? formatTWD(entry.raw) : '•••'}</p>
                                                </div>
                                            );
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>

                            {/* Center label — only 2 lines to avoid clutter */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <p className="text-xs text-gray-500 dark:text-gray-500 font-medium tracking-wide uppercase">
                                    {hasDebtBalance ? t('wallet.netWorth', 'Net Worth') : t('wallet.totalAsset', 'Total Asset')}
                                </p>
                                <p className="text-base font-bold text-gray-900 dark:text-white tabular-nums mt-0.5">
                                    {isValueVisible ? formatTWD(hasDebtBalance ? netWorthValue : stats.total_asset) : '•••'}
                                </p>
                            </div>
                        </div>

                        {/* Legend rows */}
                        <div className="w-full space-y-2">
                            {WALLET_DEFS.map(({ key, changeKey, label }, i) => {
                                const DONUT_COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b'];
                                const color = DONUT_COLORS[i];
                                const value = stats[key];
                                const pct = composition[changeKey];
                                return (
                                    <div key={label} className="flex items-center gap-2 px-1">
                                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                        <span className="text-xs text-gray-600 dark:text-gray-400 flex-1 truncate">{label}</span>
                                        <span className="text-xs font-semibold tabular-nums text-gray-700 dark:[color:var(--legend)]" style={{ '--legend': color } as CSSProperties}>
                                            {pct.toFixed(1)}%
                                        </span>
                                        <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums w-24 text-right">
                                            {isValueVisible ? formatTWD(value) : '•••'}
                                        </span>
                                    </div>
                                );
                            })}
                            {/* Subtotal: the denominator the three rows above share.
                                Without it their percentages float free, and the
                                debt row below — which is measured against the
                                same base rather than being a fourth slice of it —
                                reads as making the list sum to 145%.

                                Only alongside a debt row: with no debt the three
                                rows above already visibly total the assets, and
                                restating it just repeats the headline. */}
                            {hasDebtBalance && (
                            <div className="flex items-center gap-2 px-1 pt-1 border-t border-gray-100 dark:border-gray-700">
                                <div className="w-2.5 h-2.5 flex-shrink-0" />
                                <span className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate">{t('wallet.totalAsset', 'Total Asset')}</span>
                                <span className="text-xs font-semibold tabular-nums text-gray-500 dark:text-gray-400">100%</span>
                                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 tabular-nums w-24 text-right">
                                    {isValueVisible ? formatTWD(stats.total_asset) : '•••'}
                                </span>
                            </div>
                            )}

                            {/* Debt row — a ratio TO the assets above, not a share OF them.
                                It is the outer gauge ring, not a slice of the inner one. */}
                            {hasDebtBalance && (
                                <div className="flex items-center gap-2 px-1 pt-1 border-t border-gray-100 dark:border-gray-700">
                                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 border-2 border-rose-500" style={{ background: 'transparent' }} />
                                    <span className="text-xs text-rose-700 dark:text-rose-400 flex-1 truncate font-medium">{t('wallet.debt', 'Debt')}</span>
                                    <span className="text-xs font-semibold tabular-nums text-rose-700 dark:text-rose-400 whitespace-nowrap">
                                        {(totalDebt / stats.total_asset * 100).toFixed(1)}% {t('wallet.ofAssets', 'of assets')}
                                    </span>
                                    <span className="text-xs font-bold text-rose-700 dark:text-rose-400 tabular-nums w-24 text-right">
                                        {isValueVisible ? formatTWD(totalDebt) : '•••'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
            </Card>
        </div>
    );
}
