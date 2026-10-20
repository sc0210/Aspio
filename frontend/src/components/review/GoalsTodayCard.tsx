'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import type { GoalsReport } from '@/services/reportsService';

interface GoalsTodayCardProps {
    goals: GoalsReport | undefined;
    /** Still arriving. "No goals set yet" is a claim, and it would be wrong. */
    loading?: boolean;
    /** The report failed — which is also not the same fact as having no goals. */
    error?: boolean;
}

/**
 * Where the goals stand — today, not at the end of the month under review.
 *
 * The goals report is a snapshot of current balances against current targets;
 * it takes a date range and ignores it. Rather than dress a snapshot up as
 * history, the card says which it is: on a review of March it still reads
 * "today", because that is the only figure there is.
 */
export function GoalsTodayCard({ goals, loading, error }: GoalsTodayCardProps) {
    const { t } = useTranslation('common');
    const { maskValue } = usePrivacy();

    const heading = (
        <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t('review.goals', 'Goals')}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-500">
                {t('review.asOfToday', 'as of today')}
            </span>
        </div>
    );

    if (loading && !goals) {
        return (
            <Card className="h-full">
                {heading}
                <div className="mt-4 space-y-3" aria-hidden="true">
                    <div className="h-7 w-16 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="h-4 w-40 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                </div>
                <span className="sr-only">{t('common.loading', 'Loading')}</span>
            </Card>
        );
    }

    if (error && !goals) {
        return (
            <Card className="h-full">
                {heading}
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t('review.goalsUnavailable', "Your goals couldn't be loaded just now.")}
                </p>
            </Card>
        );
    }

    if (!goals || goals.totalGoals === 0) {
        return (
            <Card className="h-full">
                {heading}
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t('review.noGoals', 'No goals set yet.')}
                </p>
                <Link
                    href="/goals"
                    className="mt-2 inline-block text-xs font-medium text-primary-700 dark:text-primary-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                >
                    {t('review.setAGoal', 'Set one')}
                </Link>
            </Card>
        );
    }

    const progress = Math.max(0, Math.min(100, goals.overallProgress ?? 0));

    return (
        <Card className="h-full">
            {heading}

            <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">
                {progress.toFixed(0)}%
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('review.goalsProgress', '{{current}} of {{target}} saved', {
                    current: maskValue(formatTWD(goals.totalCurrentAmount)),
                    target: maskValue(formatTWD(goals.totalTargetAmount)),
                })}
            </p>

            <div className="mt-3 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-prosperity-500" style={{ width: `${progress}%` }} />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">
                        {t('review.onTrack', 'On track')}
                    </dt>
                    <dd className="font-semibold text-prosperity-700 dark:text-prosperity-400">
                        {goals.goalsOnTrack}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">
                        {t('review.behind', 'Behind')}
                    </dt>
                    <dd className="font-semibold text-amber-700 dark:text-amber-400">
                        {goals.goalsBehind}
                    </dd>
                </div>
            </dl>

            <Link
                href="/goals"
                className="mt-4 inline-block text-xs font-medium text-primary-700 dark:text-primary-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
            >
                {t('review.allGoals', 'All goals')}
            </Link>
        </Card>
    );
}
