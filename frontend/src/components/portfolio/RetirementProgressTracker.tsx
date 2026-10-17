'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    ChevronRightIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    PencilSquareIcon,
    PlusIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useTranslation } from 'react-i18next';
import { formatCurrency as utilsFormatCurrency } from '@/utils/formatters';
import {
    type RetirementProjection,
    FINANCIAL_STAGES,
} from '@/hooks/useRetirementProjection';

interface RetirementProgressTrackerProps {
    projection: RetirementProjection;
    isValueVisible: boolean;
    currency?: string;
    onSetGoal?: () => void;
}

const fmt = (amount: number, currency: string = 'TWD') =>
    utilsFormatCurrency(amount, currency, { precision: 0, compact: true });

const fmtFull = (amount: number, currency: string = 'TWD') =>
    utilsFormatCurrency(amount, currency, { precision: 0 });

// Map stage accent colour to a Tailwind progress-fill class
const STAGE_BAR_COLOR: Record<string, string> = {
    seed:        'bg-blue-500',
    sprout:      'bg-emerald-500',
    growth:      'bg-teal-500',
    momentum:    'bg-amber-500',
    freedom:     'bg-violet-500',
    legacy:      'bg-yellow-500',
};

export function RetirementProgressTracker({
    projection,
    isValueVisible,
    currency = 'TWD',
    onSetGoal,
}: RetirementProgressTrackerProps) {
    const { t } = useTranslation(['portfolio']);
    const [isExpanded, setIsExpanded] = useState(false);
    const [hoveredMilestone, setHoveredMilestone] = useState<number | null>(null);

    const {
        currentValue,
        targetValue,
        progressPercent,
        stage,
        stageIndex,
        yearsToTarget,
        targetYear,
        milestones,
        hasRetirementGoal,
        monthlyPassiveIncome,
        monthlyRequired,
        isLoading,
    } = projection;

    const masked = '••••';
    const barColor = STAGE_BAR_COLOR[stage.key] ?? 'bg-blue-500';

    const [animatedProgress, setAnimatedProgress] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => setAnimatedProgress(Math.min(progressPercent, 100)), 300);
        return () => clearTimeout(t);
    }, [progressPercent]);

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg" />
                    <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded" />
                    <div className="w-20 h-7 bg-gray-100 dark:bg-gray-700 rounded-md" />
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mb-3" />
                <div className="flex gap-2">
                    {[1, 2, 3].map(i => <div key={i} className="flex-1 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg" />)}
                </div>
            </div>
        );
    }

    if (currentValue <= 0) return null;

    const reachedMilestones = milestones.filter(m => m.reached).length;
    const nextMilestone = milestones.find(m => !m.reached);
    const gap = Math.max(0, targetValue - currentValue);

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="p-4">

                {/* ── Header ─────────────────────────────────────────────── */}
                <div className="flex items-center gap-3 mb-3">
                    {/* Stage badge */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-base border border-gray-200 dark:border-gray-600">
                        {stage.emoji}
                    </div>

                    {/* Title + stage info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none">
                                {t('portfolio:retirement.title')}
                            </span>
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                {t(`portfolio:retirement.stages.${stage.key}.label`, stage.label)} · {stageIndex + 1}/{FINANCIAL_STAGES.length}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {t(`portfolio:retirement.stages.${stage.key}.description`, stage.description)}
                        </p>
                    </div>

                    {/* Edit / Set Goal button */}
                    {onSetGoal ? (
                        <button
                            onClick={onSetGoal}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary-600 hover:bg-primary-700 text-white transition-colors"
                        >
                            {hasRetirementGoal
                                ? <><PencilSquareIcon className="w-3.5 h-3.5" />{t('portfolio:retirement.editGoal')}</>
                                : <><PlusIcon className="w-3.5 h-3.5" />{t('portfolio:retirement.setGoal')}</>
                            }
                        </button>
                    ) : (
                        <Link
                            href="/goals"
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary-600 hover:bg-primary-700 text-white transition-colors"
                        >
                            <PlusIcon className="w-3.5 h-3.5" />Set Goal
                        </Link>
                    )}
                </div>

                {/* ── Progress bar ────────────────────────────────────────── */}
                <div className="mb-3">
                    <div
                        role="progressbar"
                        aria-valuenow={Math.min(animatedProgress, 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t('portfolio:retirement.progressLabel')}
                        className="relative w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-visible mb-1.5"
                    >
                        {/* Fill */}
                        <div
                            className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out", barColor)}
                            style={{ width: `${Math.min(animatedProgress, 100)}%` }}
                        />

                        {/* Milestone dots */}
                        {milestones.map((m, idx) => {
                            const pos = (m.amount / targetValue) * 100;
                            if (pos > 100) return null;
                            return (
                                <div
                                    key={idx}
                                    className="absolute top-1/2 -translate-y-1/2 z-10"
                                    style={{ left: `${pos}%` }}
                                    onMouseEnter={() => setHoveredMilestone(idx)}
                                    onMouseLeave={() => setHoveredMilestone(null)}
                                >
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full border-2 -ml-[5px] transition-all duration-200 cursor-pointer",
                                        m.reached
                                            ? "bg-white dark:bg-gray-800 border-blue-500 shadow-sm"
                                            : "bg-gray-200 dark:bg-gray-600 border-gray-300 dark:border-gray-500",
                                        hoveredMilestone === idx && "scale-150"
                                    )} />
                                    {hoveredMilestone === idx && (
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-20">
                                            <p className="font-semibold">{m.emoji} {t(`portfolio:retirement.milestones.${m.key}`, m.label)}</p>
                                            <p className={m.reached ? "text-prosperity-400" : "text-gray-300"}>
                                                {m.reached
                                                    ? t('portfolio:retirement.milestoneReached')
                                                    : t('portfolio:retirement.milestoneProgress', { percent: m.progress.toFixed(0) })}
                                            </p>
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Current / Target + % */}
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">
                            {isValueVisible ? fmt(currentValue, currency) : masked}
                        </span>
                        <span className="font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                            {progressPercent.toFixed(0)}%
                        </span>
                        <span className="font-medium">
                            🎯 {isValueVisible ? fmt(targetValue, currency) : masked}
                        </span>
                    </div>
                </div>

                {/* ── Stats row ───────────────────────────────────────────── */}
                <div className="flex items-stretch gap-2">
                    {/* Save / month */}
                    <div className="flex-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
                            {t('portfolio:retirement.savePerMonth')}
                        </p>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
                            {monthlyRequired === null
                                ? <span className="text-gray-400">—</span>
                                : monthlyRequired === 0
                                    ? <span className="text-emerald-600 dark:text-emerald-400 text-xs">{t('portfolio:retirement.onTrack')}</span>
                                    : isValueVisible ? fmt(monthlyRequired, currency) : masked
                            }
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 leading-tight mt-0.5">
                            {monthlyRequired === null
                                ? t('portfolio:retirement.setTargetDate')
                                : monthlyRequired === 0
                                    ? t('portfolio:retirement.growthCoversGap')
                                    : t('portfolio:retirement.byYear', { year: targetYear ?? '—' })
                            }
                        </p>
                    </div>

                    {/* Time to goal */}
                    <div className="flex-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
                            {t('portfolio:retirement.timeLeft')}
                        </p>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
                            {yearsToTarget === 0
                                ? <span className="text-emerald-600 dark:text-emerald-400 text-xs">{t('portfolio:retirement.done')}</span>
                                : yearsToTarget !== null
                                    ? <>{yearsToTarget}<span className="text-xs font-medium text-gray-400 ml-0.5">{t('portfolio:retirement.years', { count: yearsToTarget })}</span></>
                                    : <span className="text-gray-400">—</span>
                            }
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 leading-tight mt-0.5">
                            {yearsToTarget !== null && yearsToTarget > 0
                                ? t('portfolio:retirement.estimatedYear', { year: targetYear })
                                : yearsToTarget === 0
                                    ? t('portfolio:retirement.goalAchieved')
                                    : t('portfolio:retirement.keepInvesting')
                            }
                        </p>
                    </div>

                    {/* Still needed */}
                    <div className="flex-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
                            {t('portfolio:retirement.stillNeed')}
                        </p>
                        <p className={cn(
                            "text-sm font-bold tabular-nums leading-tight",
                            progressPercent >= 100
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-gray-900 dark:text-gray-100"
                        )}>
                            {progressPercent >= 100
                                ? <span className="text-xs">{t('portfolio:retirement.done')}</span>
                                : isValueVisible ? fmt(gap, currency) : masked
                            }
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 leading-tight mt-0.5">
                            {progressPercent >= 100
                                ? t('portfolio:retirement.enjoy')
                                : t('portfolio:retirement.percentComplete', { percent: Math.min(progressPercent, 100).toFixed(0) })
                            }
                        </p>
                    </div>

                    {/* Expand toggle */}
                    <button
                        onClick={() => setIsExpanded(v => !v)}
                        className="flex-shrink-0 self-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        aria-label={isExpanded ? t('portfolio:retirement.collapse') : t('portfolio:retirement.expand')}
                    >
                        {isExpanded
                            ? <ChevronUpIcon className="w-4 h-4" />
                            : <ChevronDownIcon className="w-4 h-4" />
                        }
                    </button>
                </div>

                {/* ── Expanded details ─────────────────────────────────────── */}
                {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">

                        {/* Passive income + milestones */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">{t('portfolio:retirement.passiveIncome')}</p>
                                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                    {isValueVisible ? `${fmtFull(monthlyPassiveIncome, currency)}/mo` : masked}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">{t('portfolio:retirement.withdrawalRule')}</p>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">{t('portfolio:retirement.milestonesLabel')}</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                                    {reachedMilestones}/{milestones.length}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    {nextMilestone
                                        ? t('portfolio:retirement.nextMilestone', {
                                            milestone: `${nextMilestone.emoji} ${t(`portfolio:retirement.milestones.${nextMilestone.key}`, nextMilestone.label)}`,
                                        })
                                        : t('portfolio:retirement.allMilestonesDone')}
                                </p>
                            </div>
                        </div>

                        {/* Stage journey strip */}
                        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                            {FINANCIAL_STAGES.map((s, idx) => {
                                const isCurrent = idx === stageIndex;
                                const isPast = idx < stageIndex;
                                return (
                                    <div key={s.key} className="flex items-center gap-1 shrink-0">
                                        <span
                                            className={cn(
                                                "text-sm transition-all",
                                                isCurrent ? "scale-125 drop-shadow-sm" : isPast ? "opacity-60" : "opacity-25 grayscale"
                                            )}
                                            title={s.label}
                                        >
                                            {isPast ? '✅' : s.emoji}
                                        </span>
                                        {idx < FINANCIAL_STAGES.length - 1 && (
                                            <span className={cn("text-xs", isPast ? "text-emerald-400" : "text-gray-300 dark:text-gray-600")}>›</span>
                                        )}
                                    </div>
                                );
                            })}
                            <span className="ml-2 text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">
                                {stage.label}
                            </span>
                        </div>

                        {/* Tip + View Goals */}
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {progressPercent < 25
                                    ? '📈 Small contributions compound dramatically over time.'
                                    : progressPercent < 50
                                        ? '⚡ Automate contributions to stay consistent.'
                                        : progressPercent < 75
                                            ? '🚀 Past halfway! Diversification can accelerate your journey.'
                                            : '🛡️ Almost there! Protect gains with a balanced allocation.'}
                            </p>
                            <Link
                                href="/goals"
                                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors"
                            >
                                View Goals <ChevronRightIcon className="w-3 h-3" />
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
