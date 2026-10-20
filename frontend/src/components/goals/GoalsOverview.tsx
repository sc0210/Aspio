'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/utils/formatters';
import { DEFAULT_CURRENCY } from '@/utils/constants';
import { AssetGoalCard } from './AssetGoalCard';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useTranslation } from 'react-i18next';
import { portfolioCreditedGoal } from '@/utils/goalMatchers';
import { Card } from '@/components/ui/Card';

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
                <div className="text-gray-500 dark:text-gray-500 mb-4">
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
    if (compact) {
        const firstRetirement = retirementGoals[0];
        const retirementPct = firstRetirement && firstRetirement.targetAmount > 0
            ? Math.min(100, (firstRetirement.currentAmount / firstRetirement.targetAmount) * 100) : 0;

        return (
            <Card padding="none" clip className="h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('goals:overview.title', 'Goals')}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-500">
                            <span className="font-semibold text-gray-600 dark:text-gray-400">{activeGoals.length}</span> {t('goals:overview.active')}
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <span className="font-semibold text-gray-600 dark:text-gray-400">{completedGoals.length}</span> {t('goals:overview.completed')}
                        </div>
                    </div>
                    <Link href="/goals" className="text-xs font-medium text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300">
                        {t('goals:overview.viewAll')}
                    </Link>
                </div>

                <div className="p-4 space-y-4">
                    {/* Summary + Retirement stacked */}
                    <div className="space-y-3">
                        {/* Overall Progress — semicircular gauge */}
                        <div className="bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 rounded-xl p-4 border border-primary-200 dark:border-primary-700/50">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('goals:overview.overallProgress')}</p>
                            <HalfCircleGauge
                                percent={overallProgress}
                                valueVisible={isValueVisible}
                                gradientFrom="#0ea5e9"
                                gradientTo="#0284c7"
                                label={t('goals:overview.overallProgress')}
                            />
                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 -mt-1">
                                <span>{isValueVisible ? formatCurrency(totalCurrent, goals[0]?.currency || DEFAULT_CURRENCY) : '•••'}</span>
                                <span>{isValueVisible ? formatCurrency(totalTarget, goals[0]?.currency || DEFAULT_CURRENCY) : '•••'}</span>
                            </div>
                        </div>

                        {/* Retirement mini tracker — only when a retirement goal exists
                            (drop the dashed filler to keep the dashboard column compact) */}
                        {firstRetirement && (
                            <div className="rounded-xl p-4 border border-prosperity-200 dark:border-prosperity-700/50 bg-gradient-to-br from-prosperity-50 to-prosperity-100/60 dark:from-prosperity-900/20 dark:to-prosperity-800/10">
                                <div className="flex items-center gap-1 mb-1">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-prosperity-700 dark:text-prosperity-400">{t('goals:overview.retirement')}</span>
                                    <svg className="w-3 h-3 text-prosperity-700 dark:text-prosperity-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                                </div>
                                <p className="text-2xl font-bold text-prosperity-700 dark:text-prosperity-400 mb-2">
                                    {isValueVisible ? `${retirementPct.toFixed(1)}%` : '•••%'}
                                </p>
                                <div
                                    role="progressbar"
                                    aria-valuenow={Math.round(Math.min(100, retirementPct))}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label="Retirement goal progress"
                                    className="w-full h-2 bg-white/60 dark:bg-gray-700/60 rounded-full overflow-hidden mb-2"
                                >
                                    <div
                                        className="h-full bg-gradient-to-r from-prosperity-500 to-prosperity-600 rounded-full transition-all duration-500"
                                        style={{ width: `${retirementPct}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span className="truncate mr-1">{isValueVisible ? formatCurrency(firstRetirement.currentAmount, firstRetirement.currency || DEFAULT_CURRENCY) : '•••'}</span>
                                    <span className="shrink-0">{isValueVisible ? formatCurrency(firstRetirement.targetAmount, firstRetirement.currency || DEFAULT_CURRENCY) : '•••'}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Regular goal cards — stacked list, max 3 */}
                    {regularGoals.length > 0 && (
                        <div className="space-y-2">
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
                                    dense
                                    onEdit={onEdit ? () => onEdit(goal) : undefined}
                                    onContribute={onContribute && goal.status !== 'completed' ? () => onContribute(goal) : undefined}
                                />
                            ))}
                        </div>
                    )}

                    {goals.length > 3 && (
                        <p className="text-center text-xs text-primary-700 hover:text-primary-800 dark:text-primary-400">
                            <Link href="/goals">{t('goals:overview.moreGoals', { count: goals.length - 3 })}</Link>
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
                            {isValueVisible ? formatCurrency(totalCurrent, goals[0]?.currency || DEFAULT_CURRENCY) : '•••••'}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">
                            {isValueVisible ? formatCurrency(totalTarget, goals[0]?.currency || DEFAULT_CURRENCY) : '•••••'}
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
                            <span className="truncate mr-2">{isValueVisible ? formatCurrency(goal.currentAmount, goal.currency || DEFAULT_CURRENCY) : '•••••'}</span>
                            <span className="shrink-0">{isValueVisible ? `of ${formatCurrency(goal.targetAmount, goal.currency || DEFAULT_CURRENCY)}` : '•••••'}</span>
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
