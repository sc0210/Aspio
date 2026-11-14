'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { formatCashAmount } from '@/utils/formatters';
import { DEFAULT_CURRENCY, GOAL_CATEGORIES } from '@/utils/constants';
import { AssetGoalCard } from './AssetGoalCard';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useTranslation } from 'react-i18next';
import { portfolioCreditedGoal } from '@/utils/goalMatchers';
import { Card } from '@/components/ui/Card';
import { canMoveGoalCash, goalProgressAmount, monthsUntil } from '@/lib/goals/goalMoney';

interface Goal {
    id: string;
    title: string;
    currentAmount: number;
    targetAmount: number;
    currency: string;
    targetDate?: string;
    category?: string;
    priority?: 'high' | 'medium' | 'low';
    status?: 'active' | 'completed' | 'paused' | 'cancelled';
    // Goal money (goals/reservations.py), when the list carries it.
    reservedAmount?: number;
    investedAmount?: number;
    atRiskAmount?: number;
    valueAmount?: number | null;
    tracksEmergency?: boolean;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Highest priority first, then the nearest date, then the most left to save. */
function rankByPriority<T extends { priority?: string; targetDate?: string; targetAmount: number; currentAmount: number }>(goals: T[]): T[] {
    return [...goals].sort((a, b) =>
        (PRIORITY_RANK[a.priority ?? 'medium'] ?? 1) - (PRIORITY_RANK[b.priority ?? 'medium'] ?? 1)
        || (a.targetDate ? new Date(a.targetDate).getTime() : Infinity) - (b.targetDate ? new Date(b.targetDate).getTime() : Infinity)
        || (b.targetAmount - b.currentAmount) - (a.targetAmount - a.currentAmount),
    );
}

function categoryIcon(category?: string): string {
    return GOAL_CATEGORIES.find((c) => c.id === category)?.icon ?? '🎯';
}

interface GoalsOverviewProps {
    goals?: Goal[];
    isLoading?: boolean;
    onEdit?: (goal: Goal) => void;
    onContribute?: (goal: Goal) => void;
    /** Total portfolio value — fallback if portfolio hook hasn't loaded yet */
    portfolioTotalValue?: number;
    /** Compact mode: side-by-side summary + retirement, 2-col goal grid, used in dashboard */
    compact?: boolean;
}

/**
 * Semicircular ("steering-wheel"/speedometer) progress gauge.
 * The arc fills left→right as `percent` grows; the label sits in the well.
 */
function HalfCircleGauge({
    percent,
    valueVisible = true,
    gradientFrom,
    gradientTo,
    label,
}: {
    percent: number;
    valueVisible?: boolean;
    gradientFrom: string;
    gradientTo: string;
    label?: string;
}) {
    const gradientId = React.useId();
    const clamped = Math.max(0, Math.min(100, percent));
    const radius = 82;
    const arcLength = Math.PI * radius; // half-circumference
    const dashOffset = arcLength * (1 - clamped / 100);
    // Semicircle from (18,100) over the top to (182,100).
    const arcPath = 'M 18 100 A 82 82 0 0 1 182 100';

    return (
        <svg
            viewBox="0 0 200 112"
            className="w-full max-w-[220px] mx-auto"
            role="img"
            aria-label={`${label ? label + ': ' : ''}${Math.round(clamped)}%`}
        >
            <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={gradientFrom} />
                    <stop offset="100%" stopColor={gradientTo} />
                </linearGradient>
            </defs>
            {/* Track */}
            <path
                d={arcPath}
                fill="none"
                strokeWidth={16}
                strokeLinecap="round"
                className="stroke-gray-200 dark:stroke-gray-700"
            />
            {/* Progress */}
            <path
                d={arcPath}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={16}
                strokeLinecap="round"
                strokeDasharray={arcLength}
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 0.7s ease-out' }}
            />
            {/* Percentage in the well */}
            <text
                x="100"
                y="90"
                textAnchor="middle"
                fontSize="32"
                fontWeight={700}
                className="fill-gray-900 dark:fill-white"
            >
                {valueVisible ? `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%` : '•••%'}
            </text>
        </svg>
    );
}

export function GoalsOverview({ goals = [], isLoading = false, onEdit, onContribute, portfolioTotalValue: portfolioTotalValueProp = 0, compact = false }: GoalsOverviewProps) {
    const { t } = useTranslation(['goals']);
    const { isValueVisible } = usePrivacy();

    // Always fetch the live portfolio total — same source as goals/portfolio pages.
    const { portfolio } = usePortfolio();
    const rawPortfolio = portfolio as { data?: { totalValue?: number } } | undefined;
    const portfolioTotalValue: number =
        portfolioTotalValueProp > 0
            ? portfolioTotalValueProp
            : (rawPortfolio?.data?.totalValue ?? 0);

    // Coerce backend Decimal strings to numbers; apply portfolio override to retirement goals.
    // One goal is credited the portfolio even when several look like retirement
    // goals; crediting each counted the portfolio once per goal.
    const creditedGoalId = useMemo(() => portfolioCreditedGoal(goals)?.id, [goals]);
    const normalizedGoals = useMemo(() => goals.map(g => {
        const current = Number(g.currentAmount);
        const target = Number(g.targetAmount);
        const isRetirement = g.id === creditedGoalId;
        const effectiveCurrent = isRetirement && portfolioTotalValue > 0
            ? Math.max(current, portfolioTotalValue)
            : current;
        return { ...g, currentAmount: effectiveCurrent, targetAmount: target };
    }), [goals, portfolioTotalValue, creditedGoalId]);

    // Separate retirement goals so they can be displayed differently.
    const retirementGoals = useMemo(() =>
        normalizedGoals.filter(g => g.id === creditedGoalId),
        [normalizedGoals, creditedGoalId]
    );
    // Every goal but the credited one, by id. Excluding by title as well hid a
    // real goal that merely shared the retirement goal's name, from this card
    // and from its totals.
    const regularGoals = useMemo(() =>
        normalizedGoals.filter(g => g.id !== creditedGoalId),
        [normalizedGoals, creditedGoalId]
    );

    // Summary counts & progress span every goal — retirement / portfolio-linked
    // goals included — so the "overall progress" rollup is never a misleading 0%
    // when a user's only goal is portfolio-linked. The two groups partition the
    // goals by id, so their union counts each goal exactly once.
    const summaryGoals = useMemo(() => [...retirementGoals, ...regularGoals], [retirementGoals, regularGoals]);
    const activeGoals = useMemo(() =>
        summaryGoals.filter(g => g.status ? g.status === 'active' : g.currentAmount < g.targetAmount),
        [summaryGoals]
    );
    const completedGoals = useMemo(() =>
        summaryGoals.filter(g => g.status ? g.status === 'completed' : g.currentAmount >= g.targetAmount),
        [summaryGoals]
    );
    const totalTarget = useMemo(() => summaryGoals.reduce((sum, g) => sum + g.targetAmount, 0), [summaryGoals]);
    const totalCurrent = useMemo(() => summaryGoals.reduce((sum, g) => sum + g.currentAmount, 0), [summaryGoals]);
    const overallProgress = totalTarget > 0 ? (totalCurrent / totalTarget) * 100 : 0;

    if (isLoading) {
        return (
            <div className="rounded-xl p-5 sm:p-6 border border-gray-100 dark:border-gray-700/50">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-3"></div>
                    <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
            </div>
        );
    }

    if (goals.length === 0) {
        return (
            <div className="rounded-xl p-6 border border-gray-100 dark:border-gray-700/50 text-center">
                <div className="text-gray-500 dark:text-gray-400 mb-4">
                    <svg className="w-16 h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        {t('goals:overview.noGoalsTitle')}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('goals:overview.noGoalsDesc')}
                    </p>
                </div>
                <Link
                    href="/goals"
                    className="inline-block px-4 py-2 bg-primary-700 hover:bg-primary-800 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    {t('goals:createFirst')}
                </Link>
            </div>
        );
    }

    // ── Compact (dashboard) layout ──────────────────────────────────────────
    // One line of overall progress, the goal that matters most in full, the
    // rest as one row each: the dashboard is a glance, not the goals page.
    if (compact) {
        const money = (n: number, currency?: string) =>
            isValueVisible ? formatCashAmount(n, currency || DEFAULT_CURRENCY) : '•••';
        // Progress as the goal cards read it (goalMoney.ts); the retirement
        // goal keeps the portfolio value credited above.
        const shown = (g: typeof normalizedGoals[number]) =>
            g.id === creditedGoalId ? g.currentAmount : goalProgressAmount(g);
        const pctOf = (g: typeof normalizedGoals[number]) =>
            g.targetAmount > 0 ? Math.min(100, (shown(g) / g.targetAmount) * 100) : 0;
        const live = normalizedGoals.filter((g) => g.status !== 'cancelled');
        const open = live.filter((g) => g.status !== 'completed' && pctOf(g) < 100);
        const top = rankByPriority(open)[0] ?? rankByPriority(live)[0];
        // Open goals first, by priority; finished ones after, never ahead of them.
        const rest = [
            ...rankByPriority(open.filter((g) => g.id !== top?.id)),
            ...rankByPriority(live.filter((g) => g.id !== top?.id && !open.includes(g))),
        ];
        // Summed the way every row reads progress (market value, Emergency Wallet).
        const shownTotal = live.reduce((sum, g) => sum + shown(g), 0);
        const targetTotal = live.reduce((sum, g) => sum + g.targetAmount, 0);
        const overallPct = targetTotal > 0 ? Math.min(100, (shownTotal / targetTotal) * 100) : 0;
        const months = top ? monthsUntil(top.targetDate) : null;
        // Privacy hides amounts; a bar's width would still give the percent away.
        const barWidth = (pct: number) => (isValueVisible ? `${pct}%` : '0%');
        const remaining = top ? Math.max(0, top.targetAmount - shown(top)) : 0;
        const perMonth = months !== null && months > 0 && remaining > 0 ? remaining / Math.max(1, months) : null;
        const isRetirement = top?.id === creditedGoalId;

        return (
            <Card padding="none" clip className="h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('goals:overview.title', 'Goals')}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold text-gray-600 dark:text-gray-400">{activeGoals.length}</span> {t('goals:overview.active')}
                            <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">·</span>
                            <span className="font-semibold text-gray-600 dark:text-gray-400">{completedGoals.length}</span> {t('goals:overview.completed')}
                        </div>
                    </div>
                    <Link href="/goals" className="text-xs font-medium text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300">
                        {t('goals:overview.viewAll')}
                    </Link>
                </div>

                <div className="p-4 space-y-4">
                    {/* Overall progress — one line, every goal together */}
                    <div>
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('goals:overview.overallProgress')}</span>
                            <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                                {isValueVisible ? `${overallPct.toFixed(1)}%` : '•••%'}
                            </span>
                        </div>
                        <div
                            role="progressbar"
                            aria-valuenow={isValueVisible ? Math.round(overallPct) : undefined}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={t('goals:overview.overallProgress')}
                            className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
                        >
                            <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: barWidth(overallPct) }} />
                        </div>
                        <p className="mt-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                            {money(shownTotal, goals[0]?.currency)} / {money(targetTotal, goals[0]?.currency)}
                        </p>
                    </div>

                    {/* Top priority — the goal that matters most, in full */}
                    {top && (
                        <section aria-label={t('goals:overview.topPriority')} className="rounded-xl border border-primary-200 dark:border-primary-800/60 bg-primary-50/60 dark:bg-primary-900/15 p-4">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                                    {t('goals:overview.topPriority')}
                                </p>
                                {isRetirement ? (
                                    <span className="text-[11px] font-medium text-prosperity-700 dark:text-prosperity-400">{t('goals:overview.portfolioLinked')}</span>
                                ) : top.priority ? (
                                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('goals:overview.priorityLabel', { level: t(`goals:priorities.${top.priority}`) })}</span>
                                ) : null}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 min-w-0">
                                <span aria-hidden="true">{categoryIcon(top.category)}</span>
                                <p className="text-base font-semibold text-gray-900 dark:text-white truncate">{top.title}</p>
                            </div>
                            <div className="mt-2 flex items-baseline justify-between gap-2">
                                <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white truncate">{money(shown(top), top.currency)}</span>
                                <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 shrink-0">/ {money(top.targetAmount, top.currency)}</span>
                            </div>
                            <div
                                role="progressbar"
                                aria-valuenow={isValueVisible ? Math.round(pctOf(top)) : undefined}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={t('goals:card.aria.progress', { title: top.title })}
                                className="mt-2 h-2 w-full rounded-full bg-white/80 dark:bg-gray-700 overflow-hidden"
                            >
                                <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: barWidth(pctOf(top)) }} />
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                                <p className="text-xs tabular-nums text-gray-600 dark:text-gray-400 min-w-0 truncate">
                                    {isValueVisible ? `${pctOf(top).toFixed(0)}%` : '•••%'}
                                    {months !== null && (
                                        <> · {months < 0
                                            ? t('goals:overview.overdue')
                                            : months >= 24
                                                ? t('goals:overview.yearsLeft', { count: Math.round(months / 12) })
                                                : t('goals:overview.monthsLeft', { count: Math.max(1, Math.round(months)) })}</>
                                    )}
                                    {perMonth !== null && isValueVisible && (
                                        <> · {t('goals:overview.perMonth', { amount: formatCashAmount(Math.ceil(perMonth), top.currency || DEFAULT_CURRENCY) })}</>
                                    )}
                                </p>
                                {onContribute && !isRetirement && canMoveGoalCash(top) && (
                                    <button
                                        type="button"
                                        onClick={() => onContribute(top)}
                                        className="shrink-0 inline-flex min-h-9 items-center rounded-lg bg-primary-700 hover:bg-primary-800 px-3 text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    >
                                        {t('goals:reserve.mobileButton')}
                                    </button>
                                )}
                            </div>
                        </section>
                    )}

                    {/* The rest — one row each, by priority */}
                    {rest.length > 0 && (
                        <ul className="space-y-3">
                            {rest.slice(0, 3).map((g) => (
                                <li key={g.id}>
                                    <Link href="/goals" className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-2 min-w-0">
                                                <span aria-hidden="true" className="text-sm">{categoryIcon(g.category)}</span>
                                                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{g.title}</span>
                                            </span>
                                            <span className="text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-400 shrink-0">
                                                {isValueVisible ? `${pctOf(g).toFixed(0)}%` : '•••%'}
                                            </span>
                                        </div>
                                        <div className="mt-1.5 h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden="true">
                                            <div className="h-full rounded-full bg-gray-400 dark:bg-gray-500" style={{ width: barWidth(pctOf(g)) }} />
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}

                    {rest.length > 3 && (
                        <p className="text-center text-xs text-primary-700 hover:text-primary-800 dark:text-primary-400">
                            <Link href="/goals">{t('goals:overview.moreGoals', { count: rest.length - 3 })}</Link>
                        </p>
                    )}
                </div>
            </Card>
        );
    }

    // ── Full layout (goals page / sidebar) ──────────────────────────────────
    return (
        <div className="space-y-4">
            {/* Summary Card — counts & progress from regular goals only */}
            <div className="bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 rounded-xl p-5 border border-primary-200 dark:border-primary-700/50">
                <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                        {activeGoals.length} {t('goals:overview.active')} &bull; {completedGoals.length} {t('goals:overview.completed')}
                    </p>
                    <Link
                        href="/goals"
                        className="text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 text-sm font-medium"
                    >
                        {t('goals:overview.viewAll')}
                    </Link>
                </div>

                {/* Overall Progress — semicircular gauge */}
                <div className="space-y-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('goals:overview.overallProgress')}
                    </span>
                    <HalfCircleGauge
                        percent={overallProgress}
                        valueVisible={isValueVisible}
                        gradientFrom="#0ea5e9"
                        gradientTo="#0284c7"
                        label={t('goals:overview.overallProgress')}
                    />
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">
                            {isValueVisible ? formatCashAmount(totalCurrent, goals[0]?.currency || DEFAULT_CURRENCY) : '•••••'}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">
                            {isValueVisible ? formatCashAmount(totalTarget, goals[0]?.currency || DEFAULT_CURRENCY) : '•••••'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Retirement Goal(s) — portfolio-linked mini tracker */}
            {retirementGoals.map(goal => {
                const pct = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
                return (
                    <div key={goal.id} className="rounded-xl p-4 sm:p-5 border border-prosperity-200 dark:border-prosperity-700/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-prosperity-700 dark:text-prosperity-400">
                                        {t('goals:overview.retirement')}
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 dark:bg-emerald-800/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                                        <span className="whitespace-nowrap">{t('goals:overview.portfolioLinked')}</span>
                                    </span>
                                </div>
                                <p className="text-sm sm:text-base font-semibold text-gray-800 dark:text-gray-100 leading-tight truncate">{goal.title}</p>
                            </div>
                            <span className="text-xl sm:text-2xl font-bold text-prosperity-700 dark:text-prosperity-400 shrink-0">
                                {isValueVisible ? `${pct.toFixed(1)}%` : '•••%'}
                            </span>
                        </div>
                        <div className="w-full h-2.5 bg-white/60 dark:bg-gray-700/60 rounded-full overflow-hidden mb-2">
                            <div
                                className="h-full bg-gradient-to-r from-prosperity-500 to-prosperity-600 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            <span className="truncate mr-2">{isValueVisible ? formatCashAmount(goal.currentAmount, goal.currency || DEFAULT_CURRENCY) : '•••••'}</span>
                            <span className="shrink-0">{isValueVisible ? t('goals:overview.ofTarget', { amount: formatCashAmount(goal.targetAmount, goal.currency || DEFAULT_CURRENCY) }) : '•••••'}</span>
                        </div>
                    </div>
                );
            })}

            {/* Regular goal cards — up to 3 */}
            {regularGoals.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {regularGoals.slice(0, 3).map((goal) => (
                        <AssetGoalCard
                            key={goal.id}
                            title={goal.title}
                            currentAmount={goal.currentAmount}
                            targetAmount={goal.targetAmount}
                            currency={goal.currency}
                            targetDate={goal.targetDate ? new Date(goal.targetDate) : undefined}
                            category={goal.category}
                            priority={goal.priority}
                            onEdit={onEdit ? () => onEdit(goal) : undefined}
                            onContribute={onContribute && goal.status !== 'completed' ? () => onContribute(goal) : undefined}
                        />
                    ))}
                </div>
            )}

            {goals.length > 3 && (
                <div className="text-center pt-2">
                    <Link
                        href="/goals"
                        className="text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 text-sm font-medium"
                    >
                        {t('goals:overview.moreGoals', { count: goals.length - 3 })}
                    </Link>
                </div>
            )}
        </div>
    );
}
