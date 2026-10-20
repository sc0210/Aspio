'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/utils/formatters';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { GOAL_CATEGORIES } from '@/utils/constants';
import { Card } from '@/components/ui/Card';

interface AssetGoalCardProps {
    title: string;
    currentAmount: number;
    targetAmount: number;
    currency?: string;
    targetDate?: Date;
    category?: string;
    priority?: 'high' | 'medium' | 'low';
    isAtRisk?: boolean;
    monthlyNeeded?: number;
    onContribute?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    /** Dense variant for the dashboard overview — one title line, compact rows, icon-only edit. */
    dense?: boolean;
}

export function AssetGoalCard({
    title,
    currentAmount,
    targetAmount,
    currency = 'USD',
    targetDate,
    category,
    priority = 'medium',
    isAtRisk = false,
    monthlyNeeded,
    onContribute,
    onEdit,
    onDelete,
    dense = false,
}: AssetGoalCardProps) {
    const { t } = useTranslation(['goals', 'common']);
    const { isValueVisible } = usePrivacy();
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const target = Number(targetAmount);
    const current = Number(currentAmount);
    const progress = target > 0 ? (current / target) * 100 : 0;
    const remaining = Math.max(0, target - current);
    const isCompleted = current >= target;

    const categoryMeta = GOAL_CATEGORIES.find((c) => c.id === category);
    const categoryIcon = categoryMeta?.icon ?? '🎯';
    const categoryName = category
        ? t(`goals:categories.${category}`, categoryMeta?.name ?? category.replace(/_/g, ' '))
        : '';

    const getProgressColor = () => {
        if (isCompleted) return 'bg-success-500';
        if (isAtRisk || progress < 25) return 'bg-error-500';
        if (progress < 60) return 'bg-warning-500';
        if (progress < 90) return 'bg-prosperity-500';
        return 'bg-prosperity-600';
    };

    const getDateUrgency = () => {
        if (!targetDate) return { text: '', className: 'text-gray-600 dark:text-gray-400' };
        const diff = targetDate.getTime() - Date.now();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

        let text: string;
        if (days < 0) text = t('goals:card.date.overdue');
        else if (days === 0) text = t('goals:card.date.today');
        else if (days === 1) text = t('goals:card.date.oneDay');
        else if (days < 30) text = t('goals:card.date.days', { days });
        else if (days < 365) text = t('goals:card.date.months', { months: Math.ceil(days / 30) });
        else text = t('goals:card.date.years', { years: Math.ceil(days / 365) });

        let className: string;
        if (days < 0) className = 'text-error-700 dark:text-error-400 font-semibold';
        else if (days <= 14) className = 'text-error-700 dark:text-error-400 font-medium';
        else if (days <= 60) className = 'text-amber-700 dark:text-amber-400';
        else className = 'text-gray-600 dark:text-gray-400';

        return { text, className };
    };

    const { text: dateText, className: dateClassName } = getDateUrgency();

    // ── Dense variant (dashboard overview list) ─────────────────────────────
    if (dense) {
        const isOverdue = !!targetDate && targetDate.getTime() < Date.now() && !isCompleted;
        // Soften the date: overdue reads as muted amber, not an alarming bold red.
        const denseDateClass = isOverdue
            ? 'text-amber-700 dark:text-amber-500'
            : 'text-gray-500 dark:text-gray-500';
        return (
            <Card padding="none" radius="xl" shadow="none" className="p-3 hover:border-primary-300 dark:hover:border-primary-500 transition-colors">
                {/* Row 1: icon + title + status/priority */}
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base flex-shrink-0" aria-hidden="true">{categoryIcon}</span>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight truncate flex-1 min-w-0">
                        {title}
                    </h3>
                    {isCompleted ? (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
                            {t('goals:card.done')}
                        </span>
                    ) : priority === 'high' ? (
                        <span className="text-xs font-semibold uppercase tracking-wide text-error-700 dark:text-error-400">
                            {t('goals:priorities.high')}
                        </span>
                    ) : null}
                </div>

                {/* Row 2: amount / target */}
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-lg font-bold text-gray-900 dark:text-white tabular-nums truncate">
                        {isValueVisible ? formatCurrency(current, currency) : '•••••'}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-500 shrink-0">
                        / {isValueVisible ? formatCurrency(target, currency) : '•••••'}
                    </span>
                </div>

                {/* Progress bar */}
                <div
                    role="progressbar"
                    aria-valuenow={Math.round(Math.min(100, progress))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('goals:card.aria.progress', { title })}
                    className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
                >
                    <div
                        className={`h-full ${getProgressColor()} rounded-full transition-all duration-500 ease-out`}
                        style={{ width: `${Math.min(100, progress)}%` }}
                    />
                </div>

                {/* Row 3: pct · date + actions */}
                <div className="flex items-center justify-between gap-2 mt-2">
                    <div className="flex items-center gap-1.5 text-xs min-w-0">
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                            {isValueVisible ? `${progress.toFixed(0)}%` : '•••%'}
                        </span>
                        {dateText && (
                            <span className={`truncate ${denseDateClass}`}>· {dateText}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {onContribute && !isCompleted && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onContribute(); }}
                                aria-label={t('goals:card.aria.contribute', { title })}
                                className="px-3 py-1.5 bg-primary-700 hover:bg-primary-800 text-white text-xs font-medium rounded-lg transition-colors"
                            >
                                {t('goals:card.contribute')}
                            </button>
                        )}
                        {onEdit && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                aria-label={t('goals:card.aria.edit', { title })}
                                title={t('goals:card.editTitle')}
                                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            </Card>
        );
    }

    return (
        <div
            className={`
                bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 transition-all duration-200 shadow-sm hover:shadow-md
                ${isAtRisk && !isCompleted
                    ? 'border border-amber-300 dark:border-amber-600 border-l-4 border-l-amber-500'
                    : 'border border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-500'
                }
            `}
        >
            {/* Header */}
            <div className="flex items-start justify-between mb-3 gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-xl flex-shrink-0 mt-0.5">{categoryIcon}</span>
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                            {title}
                        </h3>
                        {categoryName && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                                {categoryName}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {isAtRisk && !isCompleted && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            {t('goals:card.atRisk')}
                        </span>
                    )}
                    <div
                        className={`
                            px-2.5 py-1 rounded-full text-xs font-medium
                            ${isCompleted ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : ''}
                            ${!isCompleted && priority === 'high' ? 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-400' : ''}
                            ${!isCompleted && priority === 'medium' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400' : ''}
                            ${!isCompleted && priority === 'low' ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' : ''}
                        `}
                    >
                        {isCompleted ? t('goals:card.complete') : t(`goals:priorities.${priority}`).toUpperCase()}
                    </div>
                </div>
            </div>

            {/* Progress */}
            <div className="mb-3">
                <div className="flex justify-between items-baseline mb-2 gap-2">
                    <span className="text-xl font-bold text-gray-900 dark:text-white truncate">
                        {isValueVisible ? formatCurrency(current, currency) : '•••••'}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                        / {isValueVisible ? formatCurrency(target, currency) : '•••••'}
                    </span>
                </div>

                <div
                    role="progressbar"
                    aria-valuenow={Math.round(Math.min(100, progress))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('goals:card.aria.progress', { title })}
                    className="relative w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
                >
                    <div
                        className={`h-full ${getProgressColor()} transition-all duration-500 ease-out rounded-full relative overflow-hidden`}
                        style={{ width: `${Math.min(100, progress)}%` }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    </div>
                </div>

                <div className="flex justify-between items-center mt-2 gap-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {isValueVisible ? `${progress.toFixed(1)}%` : '•••%'}
                    </span>
                    {!isCompleted && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate text-right">
                            {t('goals:card.left', { amount: isValueVisible ? formatCurrency(remaining, currency) : '•••••' })}
                        </span>
                    )}
                </div>
            </div>

            {/* Date + Monthly Needed */}
            <div className="flex items-center justify-between mb-3 gap-2 min-h-[1.25rem]">
                {targetDate && !isCompleted ? (
                    <div className={`flex items-center gap-1.5 text-sm truncate max-w-[60%] ${dateClassName}`}>
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>{dateText}</span>
                    </div>
                ) : <div />}

                {monthlyNeeded !== undefined && monthlyNeeded > 0 && !isCompleted && isValueVisible && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
                        {t('goals:card.perMonth', { amount: formatCurrency(monthlyNeeded, currency) })}
                    </span>
                )}
            </div>

            {/* Actions */}
            {confirmingDelete ? (
                <div role="alert" className="flex items-center gap-2 bg-error-50 dark:bg-error-900/20 rounded-lg px-3 py-2.5">
                    <span className="text-sm text-error-700 dark:text-error-400 flex-1">{t('goals:card.deleteConfirm')}</span>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false); }}
                        className="px-3 py-2.5 min-h-[44px] text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
                        aria-label={t('goals:card.aria.cancelDelete')}
                    >
                        {t('common:common.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete?.();
                            setConfirmingDelete(false);
                        }}
                        className="px-3 py-2.5 min-h-[44px] text-xs font-medium bg-error-600 hover:bg-error-700 text-white rounded-md transition-colors"
                        aria-label={t('goals:card.aria.confirmDelete', { title })}
                    >
                        {t('common:common.delete')}
                    </button>
                </div>
            ) : (
                <div className="flex gap-2">
                    {onContribute && !isCompleted && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onContribute(); }}
                            aria-label={t('goals:card.aria.contribute', { title })}
                            className="flex-1 px-4 py-2.5 min-h-[44px] bg-primary-700 hover:bg-primary-800 text-white text-sm font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md"
                        >
                            {t('goals:card.contribute')}
                        </button>
                    )}
                    {onEdit && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEdit(); }}
                            aria-label={t('goals:card.aria.edit', { title })}
                            title={t('goals:card.editTitle')}
                            className="flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] border border-primary-300 dark:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-semibold rounded-lg transition-all duration-200 hover:border-primary-400 dark:hover:border-primary-500"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            {t('common:common.edit')}
                        </button>
                    )}
                    {onDelete && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
                            aria-label={t('goals:card.aria.delete', { title })}
                            className="px-4 py-2.5 min-h-[44px] border border-error-300 dark:border-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 text-error-700 dark:text-error-400 text-sm font-medium rounded-lg transition-colors duration-200"
                        >
                            {t('common:common.delete')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
