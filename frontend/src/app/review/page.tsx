'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAppMode } from '@/hooks/useAppMode';
import { useMonthReview } from '@/hooks/useMonthReview';
import { defaultReviewMonth } from '@/lib/review';
import { MonthContextCard } from '@/components/review/MonthContextCard';
import { MonthPicker } from '@/components/review/MonthPicker';
import { ReviewHero } from '@/components/review/ReviewHero';
import { IncomeBreakdown, SpendingBreakdown } from '@/components/review/SpendingBreakdown';
import { WealthMoveCard } from '@/components/review/WealthMoveCard';
import { GoalsTodayCard } from '@/components/review/GoalsTodayCard';
import { MobileReview } from '@/components/review/MobileReview';
import { NextMonthCard } from '@/components/review/NextMonthCard';
import { TopExpensesCard } from '@/components/review/TopExpensesCard';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { TOP_BAR_BUTTON } from '@/components/layout/topBarStyles';
import { transactionService } from '@/services/transactionService';

/**
 * One month, read as a story rather than a data set.
 *
 * It answers "how did last month go": a fixed window, a verdict, and the
 * handful of figures that change what you would do next month. It replaced
 * /reports (retired 2026-09-17), which read the same endpoints for a range you
 * picked; the difference was entirely in what gets left out.
 */
function DesktopReviewPage() {
    const { t } = useTranslation('common');
    const { isAuthenticated, isDemo, isLoading: authLoading } = useAppMode();
    const router = useRouter();

    // Resolved once, on the client: a month picked during render would differ
    // between the server pass and the first client one.
    const [monthKey, setMonthKey] = useState(() => defaultReviewMonth());

    const {
        review,
        context,
        portfolio,
        life,
        emergency,
        netWorth,
        goals,
        isLoading,
        isError,
        balancesLoading,
        balancesOutOfRange,
        balancesError,
        goalsLoading,
        goalsError,
        contextLoading,
        contextError,
    } = useMonthReview(monthKey);

    useEffect(() => {
        if (!authLoading && !isAuthenticated && !isDemo) {
            router.replace('/auth/signin');
        }
    }, [authLoading, isAuthenticated, isDemo, router]);

    const showSpinner = authLoading || ((isAuthenticated || isDemo) && isLoading);

    // The month on screen as a CSV — the same backend export /transactions uses.
    // Not in demo mode: there is no backend behind it.
    const [exporting, setExporting] = useState(false);
    const exportMonth = async () => {
        setExporting(true);
        try {
            await transactionService.downloadCSV(review.range.from, review.range.to);
        } catch {
            toast.error(t('review.exportFailed', "The month couldn't be exported. Try again."));
        } finally {
            setExporting(false);
        }
    };
    const topBarActions = isAuthenticated && !isDemo ? (
        // Nothing recorded, or a month not yet begun: no header-only download.
        <button type="button" onClick={exportMonth} disabled={exporting || review.isEmpty || review.range.days === 0} className={TOP_BAR_BUTTON}>
            <ArrowDownTrayIcon className="w-4 h-4" />
            {t('review.exportMonth', 'Export month (CSV)')}
        </button>
    ) : undefined;

    return (
        <DashboardLayout topBarActions={topBarActions}>
            <div className="max-w-6xl mx-auto space-y-5 pb-8">
                <PageHeader
                    title={t('review.pageTitle', 'Month in Review')}
                    subtitle={t('review.pageSubtitle', 'How the month went, and what changed since the one before.')}
                    accent="primary"
                />

                <MonthPicker range={review.range} onChange={setMonthKey} />

                {showSpinner ? (
                    <div className="flex items-center justify-center py-24">
                        <LoadingSpinner />
                    </div>
                ) : isError ? (
                    <EmptyState
                        icon="⚠️"
                        title={t('review.errorTitle', "This month wouldn't load")}
                        description={t(
                            'review.errorBody',
                            'The figures for this month could not be fetched. Try again, or pick another month.',
                        )}
                    />
                ) : review.isEmpty ? (
                    <EmptyState
                        icon="📭"
                        title={t('review.emptyTitle', 'Nothing recorded this month')}
                        description={t(
                            'review.emptyBody',
                            'No income or spending was logged in this month, so there is nothing to review yet.',
                        )}
                        action={
                            <Link
                                href="/transactions/add"
                                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-prosperity-700 hover:bg-prosperity-800 text-white text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-prosperity-500"
                            >
                                {t('review.addTransaction', 'Add a transaction')}
                            </Link>
                        }
                    />
                ) : (
                    <>
                        <ReviewHero review={review} />

                        <MonthContextCard
                            context={context}
                            loading={contextLoading}
                            error={contextError}
                        />

                        <NextMonthCard review={review} context={contextLoading || contextError ? undefined : context} />

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                            <div className="lg:col-span-2 space-y-5">
                                <SpendingBreakdown review={review} />
                                {/* Where it came from, beneath where it went. */}
                                <IncomeBreakdown review={review} />
                            </div>
                            <div className="space-y-5">
                                <WealthMoveCard
                                    portfolio={portfolio}
                                    life={life}
                                    emergency={emergency}
                                    netWorth={netWorth}
                                    loading={balancesLoading}
                                    outOfRange={balancesOutOfRange}
                                    error={balancesError}
                                />
                                <TopExpensesCard range={review.range} />
                                <GoalsTodayCard
                                    goals={goals}
                                    loading={goalsLoading}
                                    error={goalsError}
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}

/**
 * Breakpoint switch (#344): phones get MobileReview — the month's verdict and net,
 * then where the money went; tablet/desktop get the full page.
 */
export default function ReviewPage() {
    const isMobile = useIsMobile();
    if (isMobile === null) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
            </DashboardLayout>
        );
    }
    return isMobile ? <MobileReview /> : <DesktopReviewPage />;
}
