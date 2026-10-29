'use client';

import { useTranslation } from 'react-i18next';
import {
    BanknotesIcon,
    ChartBarIcon,
    ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BiggerScreenHint } from './BiggerScreenHint';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { useAppMode } from '@/hooks/useAppMode';
import { greetingName } from '@/lib/dashboard/greetingName';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';

const NW_COLOR = '#10b981'; // emerald — matches the desktop net-worth chart

export function MobileDashboard() {
    const { t } = useTranslation(['dashboard', 'common']);
    const { isDemo, user } = useAppMode();
    const { isValueVisible } = usePrivacy();

    // Shared with the desktop CompactDashboard so the two focused views never drift.
    const model = useDashboardSummary();

    if (model.isLoading && !model.stats) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner size="lg" /></div>
            </DashboardLayout>
        );
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? t('greeting.morning', 'Good morning')
        : hour < 18 ? t('greeting.afternoon', 'Good afternoon')
            : t('greeting.evening', 'Good evening');
    const name = greetingName(isDemo, user, t('common:user', 'there'));
    const up = model.changeAbs >= 0;

    // The system has THREE wallets. Debt is a liability (already netted into the
    // net-worth hero above), not a wallet — so it is not shown as a chip.
    const wallets = [
        { label: t('wallet.lifeWallet', 'Life'), value: model.stats?.life_wallet ?? 0, color: '#0ea5e9', Icon: BanknotesIcon },
        { label: t('wallet.portfolioWallet', 'Portfolio'), value: model.stats?.portfolio_wallet ?? 0, color: '#8b5cf6', Icon: ChartBarIcon },
        { label: t('wallet.emergencyFund', 'Emergency'), value: model.stats?.emergency_wallet ?? 0, color: '#f59e0b', Icon: ShieldCheckIcon },
    ];

    const hidden = '••••';

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                {/* Greeting */}
                <div className="flex items-baseline justify-between pt-1">
                    <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                        {greeting}, {name}
                    </h1>
                </div>

                <BiggerScreenHint />

                {/* HERO — net worth + sparkline */}
                <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm px-5 pt-5 pb-1 overflow-hidden">
                    <p className="text-xs font-bold tracking-wide text-gray-500 dark:text-gray-500">
                        {t('wallet.netWorth', 'Net Worth')}
                    </p>
                    <p className="mt-1.5 text-[40px] leading-none font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
                        {isValueVisible ? formatTWD(model.netWorth) : hidden}
                    </p>
                    <p className={cn('mt-2 text-[13.5px] font-bold tabular-nums', up ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                        {up ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(model.changeAbs)) : '•••'}
                        <span className="text-gray-500 dark:text-gray-500 font-semibold ml-1.5">
                            {up ? '+' : '−'}{Math.abs(model.changePct).toFixed(1)}% · {t('mobile.thisMonth', 'this month')}
                        </span>
                    </p>
                    {/* Sparkline — only when there's a real series (≥2 points); otherwise
                        the card stays compact rather than showing a blank gap. */}
                    {model.spark && (
                        <div className="-mx-5 mt-3">
                            <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="block w-full h-[60px]" aria-hidden="true">
                                <defs>
                                    <linearGradient id="mnw" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0" stopColor={NW_COLOR} stopOpacity="0.24" />
                                        <stop offset="1" stopColor={NW_COLOR} stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                <path d={model.spark.area} fill="url(#mnw)" />
                                <path d={model.spark.line} fill="none" stroke={NW_COLOR} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                <circle cx={model.spark.last[0]} cy={model.spark.last[1]} r="3.6" fill={NW_COLOR} stroke="white" strokeWidth="2" />
                            </svg>
                        </div>
                    )}
                    <div className="pb-4" />
                </section>

                {/* THREE WALLETS — one compact row */}
                <section className="grid grid-cols-3 gap-2.5">
                    {wallets.map(({ label, value, color, Icon }) => (
                        <Card key={label} padding="none" shadow="none" className="flex flex-col gap-2 px-3 py-3">
                            <span className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
                                <Icon className="w-[17px] h-[17px]" style={{ color }} />
                            </span>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-500 dark:text-gray-500 truncate">{label}</p>
                                <p className="text-[14.5px] font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white truncate">
                                    {isValueVisible ? formatTWDCompact(value) : hidden}
                                </p>
                            </div>
                        </Card>
                    ))}
                </section>

                {/* TODAY'S HIGHLIGHTS — swipeable */}
                <section>
                    <p className="flex items-center px-1 mb-2.5 text-sm font-extrabold tracking-tight text-gray-900 dark:text-white">
                        {t('mobile.highlights', "Today's highlights")}
                        <span className="ml-auto text-xs font-semibold text-gray-500 dark:text-gray-500">
                            {t('mobile.swipe', 'Swipe ›')}
                        </span>
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory scrollbar-hide">
                        {/* Cash flow */}
                        <article className="snap-start flex-[0_0_78%] rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 min-h-[130px]">
                            <p className="text-[12.5px] font-bold text-gray-500 dark:text-gray-500">{t('mobile.cashFlow', 'Cash flow this month')}</p>
                            <p className={cn('mt-2 text-[22px] font-extrabold tracking-tight tabular-nums', model.net >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                                {model.net >= 0 ? '+' : '−'}{isValueVisible ? formatTWDCompact(Math.abs(model.net)) : '•••'}
                            </p>
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                {t('mobile.income', 'Income')} {isValueVisible ? formatTWDCompact(model.income) : '•••'} · {t('mobile.expense', 'Spent')} {isValueVisible ? formatTWDCompact(model.expenses) : '•••'}
                            </p>
                            <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
                                <span className="h-full bg-error-400" style={{ width: `${model.expenseShare}%` }} />
                                <span className="h-full bg-prosperity-500" style={{ width: `${100 - model.expenseShare}%` }} />
                            </div>
                        </article>

                        {/* Portfolio P/L */}
                        <article className="snap-start flex-[0_0_78%] rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 min-h-[130px]">
                            <p className="text-[12.5px] font-bold text-gray-500 dark:text-gray-500">{t('mobile.portfolioPnl', 'Portfolio gain / loss')}</p>
                            <p className={cn('mt-2 text-[22px] font-extrabold tracking-tight tabular-nums', model.pnl >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                                {model.pnl >= 0 ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(model.pnl)) : '•••'}
                            </p>
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                {model.pnl >= 0 ? '+' : '−'}{Math.abs(model.pnlPct).toFixed(1)}% · {t('mobile.totalReturn', 'total return')}
                            </p>
                            <p className="mt-3 text-xs font-semibold text-gray-500 dark:text-gray-500">
                                {t('wallet.portfolioWallet', 'Portfolio')}: {isValueVisible ? formatTWDCompact(model.portfolioValue) : '•••'}
                            </p>
                        </article>

                        {/* Primary goal ring */}
                        <article className="snap-start flex-[0_0_78%] rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 min-h-[130px]">
                            <p className="text-[12.5px] font-bold text-gray-500 dark:text-gray-500 truncate">
                                {model.primaryGoal ? model.primaryGoal.title : t('mobile.noGoal', 'Set a goal')}
                            </p>
                            {model.primaryGoal ? (
                                <div className="mt-2 flex items-center gap-3.5">
                                    <svg viewBox="0 0 60 60" className="w-[58px] h-[58px] flex-shrink-0" aria-hidden="true">
                                        <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="7" className="text-gray-100 dark:text-gray-700" />
                                        <circle cx="30" cy="30" r="24" fill="none" stroke={NW_COLOR} strokeWidth="7" strokeLinecap="round"
                                            strokeDasharray={2 * Math.PI * 24}
                                            strokeDashoffset={(2 * Math.PI * 24) * (1 - model.goalPct / 100)}
                                            transform="rotate(-90 30 30)" />
                                        <text x="30" y="34" textAnchor="middle" className="fill-gray-900 dark:fill-white" style={{ fontSize: 14, fontWeight: 800 }}>
                                            {Math.round(model.goalPct)}%
                                        </text>
                                    </svg>
                                    <div className="min-w-0">
                                        <p className="text-lg font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
                                            {isValueVisible ? formatTWDCompact(model.primaryGoal.currentAmount || 0) : '•••'}
                                        </p>
                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-500 tabular-nums">
                                            / {isValueVisible ? formatTWDCompact(model.primaryGoal.targetAmount || 0) : '•••'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-4 text-xs font-semibold text-gray-500 dark:text-gray-500">
                                    {t('mobile.noGoalHint', 'Create a savings goal to track progress here.')}
                                </p>
                            )}
                        </article>
                    </div>
                </section>

                {/* Deferred-to-desktop line */}
                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-500">
                    {t('mobile.fullDashboard', 'Full dashboard — heatmaps, forecasts, detailed history')}
                    <br />
                    <span className="text-primary-700 dark:text-primary-400">→ {t('mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
