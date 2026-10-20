'use client';

import { useTranslation } from 'react-i18next';
import {
    BanknotesIcon,
    ChartBarIcon,
    ShieldCheckIcon,
    Squares2X2Icon,
    ArrowRightIcon,
} from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DataRefreshButton } from '@/components/ui/DataRefreshButton';
import { DashboardViewToggle } from './DashboardViewToggle';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { useDashboardViewMode } from '@/hooks/useDashboardViewMode';
import { useAppMode } from '@/hooks/useAppMode';
import { greetingName } from '@/lib/dashboard/greetingName';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';

const NW_COLOR = '#10b981';
const hidden = '••••';

/**
 * Desktop "compact" focus view — the same glanceable redesign as the phone, but
 * laid out for laptop width: a wide hero with a taller sparkline, three wallet
 * cards in a row, and all three insight cards shown at once (no swipe). A footer
 * affordance jumps to the Full power dashboard. Shares data with the mobile view
 * via useDashboardSummary so the two never diverge.
 */
export function CompactDashboard() {
    const { t } = useTranslation(['dashboard', 'common']);
    const { isDemo, user } = useAppMode();
    const { isValueVisible } = usePrivacy();
    const [, setMode] = useDashboardViewMode();
    const m = useDashboardSummary();

    if (m.isLoading && !m.stats) {
        return (
            <DashboardLayout topBarActions={<DashboardViewToggle />}>
                <div className="flex items-center justify-center py-24"><LoadingSpinner size="lg" /></div>
            </DashboardLayout>
        );
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? t('greeting.morning', 'Good morning')
        : hour < 18 ? t('greeting.afternoon', 'Good afternoon')
            : t('greeting.evening', 'Good evening');
    const name = greetingName(isDemo, user, t('common:user', 'there'));
    const up = m.changeAbs >= 0;

    const wallets = [
        { label: t('wallet.lifeWallet', 'Life'), value: m.stats?.life_wallet ?? 0, color: '#0ea5e9', Icon: BanknotesIcon },
        { label: t('wallet.portfolioWallet', 'Portfolio'), value: m.stats?.portfolio_wallet ?? 0, color: '#8b5cf6', Icon: ChartBarIcon },
        { label: t('wallet.emergencyFund', 'Emergency'), value: m.stats?.emergency_wallet ?? 0, color: '#f59e0b', Icon: ShieldCheckIcon },
    ];

    return (
        <DashboardLayout topBarActions={<><DashboardViewToggle /><DataRefreshButton size="sm" showLabel={false} /></>}>
            <div className="max-w-4xl mx-auto space-y-5 pb-8">
                <div className="flex items-baseline justify-between">
                    <h2 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                        {greeting}, {name}
                    </h2>
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-500">{t('view.compactBadge', 'Compact view')}</span>
                </div>

                {/* HERO — net worth + wide sparkline */}
                <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm px-7 pt-6 pb-2 overflow-hidden">
                    <p className="text-[13px] font-bold tracking-wide text-gray-500 dark:text-gray-500">{t('wallet.netWorth', 'Net Worth')}</p>
                    <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                        <p className="text-[clamp(2.5rem,5vw,3.5rem)] leading-none font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
                            {isValueVisible ? formatTWD(m.netWorth) : hidden}
                        </p>
                        <p className={cn('mb-1 text-[15px] font-bold tabular-nums', up ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-500')}>
                            {up ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(m.changeAbs)) : '•••'}
                            <span className="text-gray-500 dark:text-gray-500 font-semibold ml-1.5">
                                {up ? '+' : '−'}{Math.abs(m.changePct).toFixed(1)}% · {t('mobile.thisMonth', 'this month')}
                            </span>
                        </p>
                    </div>
                    {m.spark && (
                        <div className="-mx-7 mt-4">
                            <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="block w-full h-[120px]" aria-hidden="true">
                                <defs>
                                    <linearGradient id="cnw" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0" stopColor={NW_COLOR} stopOpacity="0.22" />
                                        <stop offset="1" stopColor={NW_COLOR} stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                <path d={m.spark.area} fill="url(#cnw)" />
                                <path d={m.spark.line} fill="none" stroke={NW_COLOR} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            </svg>
                        </div>
                    )}
                    <div className="pb-4" />
                </section>

                {/* THREE WALLETS */}
                <section className="grid grid-cols-3 gap-4">
                    {wallets.map(({ label, value, color, Icon }) => (
                        <Card key={label} padding="none" shadow="none" className="flex items-center gap-3.5 px-5 py-4">
                            <span className="grid place-items-center w-11 h-11 rounded-xl flex-shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
                                <Icon className="w-5 h-5" style={{ color }} />
                            </span>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-500 truncate">{label}</p>
                                <p className="text-[19px] font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white truncate">
                                    {isValueVisible ? formatTWDCompact(value) : hidden}
                                </p>
                            </div>
                        </Card>
                    ))}
                </section>

                {/* THREE INSIGHTS — all visible, no swipe */}
                <section>
                    <p className="mb-3 text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-white">{t('mobile.highlights', "Today's highlights")}</p>
                    <div className="grid grid-cols-3 gap-4">
                        {/* Cash flow */}
                        <article className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5">
                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-500">{t('mobile.cashFlow', 'Cash flow this month')}</p>
                            <p className={cn('mt-2 text-[26px] font-extrabold tracking-tight tabular-nums', m.net >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-500')}>
                                {m.net >= 0 ? '+' : '−'}{isValueVisible ? formatTWDCompact(Math.abs(m.net)) : '•••'}
                            </p>
                            <p className="text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">
                                {t('mobile.income', 'Income')} {isValueVisible ? formatTWDCompact(m.income) : '•••'} · {t('mobile.expense', 'Spent')} {isValueVisible ? formatTWDCompact(m.expenses) : '•••'}
                            </p>
                            <div className="mt-4 h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
                                <span className="h-full bg-error-400" style={{ width: `${m.expenseShare}%` }} />
                                <span className="h-full bg-prosperity-500" style={{ width: `${100 - m.expenseShare}%` }} />
                            </div>
                        </article>

                        {/* Portfolio P/L */}
                        <article className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5">
                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-500">{t('mobile.portfolioPnl', 'Portfolio gain / loss')}</p>
                            <p className={cn('mt-2 text-[26px] font-extrabold tracking-tight tabular-nums', m.pnl >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-500')}>
                                {m.pnl >= 0 ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(m.pnl)) : '•••'}
                            </p>
                            <p className="text-[12.5px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                {m.pnl >= 0 ? '+' : '−'}{Math.abs(m.pnlPct).toFixed(1)}% · {t('mobile.totalReturn', 'total return')}
                            </p>
                            <p className="mt-4 text-[12.5px] font-semibold text-gray-500 dark:text-gray-500">
                                {t('wallet.portfolioWallet', 'Portfolio')}: {isValueVisible ? formatTWDCompact(m.portfolioValue) : '•••'}
                            </p>
                        </article>

                        {/* Primary goal ring */}
                        <article className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5">
                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-500 truncate">
                                {m.primaryGoal ? m.primaryGoal.title : t('mobile.noGoal', 'Set a goal')}
                            </p>
                            {m.primaryGoal ? (
                                <div className="mt-2 flex items-center gap-4">
                                    <svg viewBox="0 0 60 60" className="w-[66px] h-[66px] flex-shrink-0" aria-hidden="true">
                                        <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="7" className="text-gray-100 dark:text-gray-700" />
                                        <circle cx="30" cy="30" r="24" fill="none" stroke={NW_COLOR} strokeWidth="7" strokeLinecap="round"
                                            strokeDasharray={2 * Math.PI * 24}
                                            strokeDashoffset={(2 * Math.PI * 24) * (1 - m.goalPct / 100)}
                                            transform="rotate(-90 30 30)" />
                                        <text x="30" y="34" textAnchor="middle" className="fill-gray-900 dark:fill-white" style={{ fontSize: 14, fontWeight: 800 }}>
                                            {Math.round(m.goalPct)}%
                                        </text>
                                    </svg>
                                    <div className="min-w-0">
                                        <p className="text-[19px] font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
                                            {isValueVisible ? formatTWDCompact(m.primaryGoal.currentAmount || 0) : '•••'}
                                        </p>
                                        <p className="text-[12.5px] font-semibold text-gray-500 dark:text-gray-500 tabular-nums">
                                            / {isValueVisible ? formatTWDCompact(m.primaryGoal.targetAmount || 0) : '•••'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-4 text-[12.5px] font-semibold text-gray-500 dark:text-gray-500">
                                    {t('mobile.noGoalHint', 'Create a savings goal to track progress here.')}
                                </p>
                            )}
                        </article>
                    </div>
                </section>

                {/* Switch to full — reinforces that the power tool is one click away */}
                <button
                    type="button"
                    onClick={() => setMode('full')}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 py-3.5 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-300 hover:border-primary-300 dark:hover:border-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    <Squares2X2Icon className="w-4 h-4" />
                    {t('view.switchToFull', 'Switch to the full dashboard — heatmaps, forecasts, detailed history')}
                    <ArrowRightIcon className="w-4 h-4" />
                </button>
            </div>
        </DashboardLayout>
    );
}
