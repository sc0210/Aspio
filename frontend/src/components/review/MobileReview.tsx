'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { useAppMode } from '@/hooks/useAppMode';
import { useMonthReview } from '@/hooks/useMonthReview';
import { defaultReviewMonth } from '@/lib/review';
import { MonthPicker } from '@/components/review/MonthPicker';
import { ReviewHero } from '@/components/review/ReviewHero';
import { SpendingBreakdown } from '@/components/review/SpendingBreakdown';
import { NextMonthCard } from '@/components/review/NextMonthCard';

/**
 * The month on a phone (#344): the verdict and the month's net (ReviewHero), then
 * where the money went. Context, income sources, wealth moves and goals are the
 * "and also" of the month — they stay on the full page.
 */
export function MobileReview() {
    const { t } = useTranslation(['common', 'dashboard']);
    const { isAuthenticated, isDemo, isLoading: authLoading } = useAppMode();
    const router = useRouter();
    const [monthKey, setMonthKey] = useState(() => defaultReviewMonth());
    const { review, isLoading, isError } = useMonthReview(monthKey);

    useEffect(() => {
        if (!authLoading && !isAuthenticated && !isDemo) router.replace('/auth/signin');
    }, [authLoading, isAuthenticated, isDemo, router]);

    const showSpinner = authLoading || ((isAuthenticated || isDemo) && isLoading);

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <h1 className="pt-1 text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    {t('common:review.pageTitle', 'Month in Review')}
                </h1>

                <BiggerScreenHint />

                <MonthPicker range={review.range} onChange={setMonthKey} />

                {showSpinner ? (
                    <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
                ) : isError ? (
                    <EmptyState
                        icon="⚠️"
                        title={t('common:review.errorTitle', "This month wouldn't load")}
                        description={t('common:review.errorBody', 'The figures for this month could not be fetched. Try again, or pick another month.')}
                    />
                ) : review.isEmpty ? (
                    <EmptyState
                        icon="📭"
                        title={t('common:review.emptyTitle', 'Nothing recorded this month')}
                        description={t('common:review.emptyBody', 'No income or spending was logged in this month, so there is nothing to review yet.')}
                        action={
                            <Link href="/transactions/add"
                                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-prosperity-600 hover:bg-prosperity-700 text-white text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-prosperity-500">
                                {t('common:review.addTransaction', 'Add a transaction')}
                            </Link>
                        }
                    />
                ) : (
                    <>
                        <ReviewHero review={review} />
                        {/* No twelve-month context on phones, so the below-average prompt is desktop-only. */}
                        <NextMonthCard review={review} />
                        <SpendingBreakdown review={review} />
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-400 dark:text-gray-500">
                    {t('dashboard:mobile.fullReview', 'Income sources, wealth moves & goals')}
                    <br />
                    <span className="text-primary-600 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
