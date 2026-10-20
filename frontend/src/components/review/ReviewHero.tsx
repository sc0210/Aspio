'use client';

import { useTranslation } from 'react-i18next';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { monthLabel, shiftMonth } from '@/lib/review';
import type { MonthReview, Verdict } from '@/lib/review';
import { ChangeChip } from './ChangeChip';

/**
 * The one figure the month is about: what was left after living on it.
 *
 * Net, not income and not spending — either alone can be read as a good month
 * and a bad one. The verdict sentence above it and the colour of the number
 * come from the same `verdict`, so the words and the colour cannot say
 * different things.
 */
interface ReviewHeroProps {
    review: MonthReview;
}

const TONE: Record<Verdict, string> = {
    over: 'text-error-700 dark:text-error-400',
    tight: 'text-amber-700 dark:text-amber-400',
    steady: 'text-prosperity-700 dark:text-prosperity-400',
    strong: 'text-prosperity-700 dark:text-prosperity-400',
};

const VERDICT_FALLBACK: Record<Verdict, string> = {
    over: 'You spent more than you earned.',
    tight: 'A tight month — most of what came in went out again.',
    steady: 'A steady month.',
    strong: 'A strong month.',
};

export function ReviewHero({ review }: ReviewHeroProps) {
    const { t, i18n } = useTranslation('common');
    const { maskValue } = usePrivacy();

    const { income, expenses, net, savingsRate, verdict } = review;
    const saved = net >= 0;
    // Both bars share one scale, so their lengths are comparable to each other
    // rather than each filling its own row.
    const scale = Math.max(income, expenses, 1);

    return (
        <Card accent="primary" padding="none">
            <div className="p-5 sm:p-6">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t(`review.verdict.${verdict}`, VERDICT_FALLBACK[verdict])}
                </p>

                <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <p className={cn('text-3xl sm:text-4xl font-bold tracking-tight', TONE[verdict])}>
                        {maskValue(formatTWD(Math.abs(net)))}
                    </p>
                    <div className="pb-1 flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {saved
                                ? t('review.kept', 'kept')
                                : t('review.overspent', 'over what came in')}
                        </span>
                        <ChangeChip
                            change={review.netChange}
                            moreIsBetter
                            unavailable={!review.hasPrevious}
                        />
                    </div>
                </div>

                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {savingsRate === undefined
                        ? t('review.noIncomeRecorded', 'No income recorded this month')
                        : t('review.savingsRate', '{{rate}}% of income kept', {
                              rate: savingsRate.toFixed(0),
                          })}
                </p>

                <div className="mt-5 space-y-4">
                    <Flow
                        label={t('review.income', 'Income')}
                        amount={income}
                        width={(income / scale) * 100}
                        change={review.incomeChange}
                        moreIsBetter
                        hasPrevious={review.hasPrevious}
                        positive
                    />
                    <Flow
                        label={t('review.expenses', 'Spending')}
                        amount={expenses}
                        width={(expenses / scale) * 100}
                        change={review.expensesChange}
                        moreIsBetter={false}
                        hasPrevious={review.hasPrevious}
                        positive={false}
                    />
                </div>

                {review.hasPrevious && (
                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        {t('review.comparedWith', 'Changes are against {{month}}, the whole month', {
                            month: monthLabel(shiftMonth(review.range.key, -1), i18n.language),
                        })}
                    </p>
                )}

                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    {t('review.perDay', '{{amount}} a day · {{count}} transactions', {
                        amount: maskValue(formatTWD(review.perDay)),
                        count: review.transactionCount,
                    })}
                </p>
            </div>
        </Card>
    );
}

interface FlowProps {
    label: string;
    amount: number;
    width: number;
    change: MonthReview['incomeChange'];
    moreIsBetter: boolean;
    hasPrevious: boolean;
    positive: boolean;
}

function Flow({ label, amount, width, change, moreIsBetter, hasPrevious, positive }: FlowProps) {
    const { maskValue } = usePrivacy();
    const Icon = positive ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;

    return (
        <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon
                        className={cn(
                            'w-4 h-4 flex-shrink-0',
                            positive ? 'text-prosperity-700 dark:text-prosperity-500' : 'text-error-700 dark:text-error-500',
                        )}
                        aria-hidden="true"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{label}</span>
                    <ChangeChip change={change} moreIsBetter={moreIsBetter} unavailable={!hasPrevious} />
                </div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                    {maskValue(formatTWD(amount))}
                </span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                    className={cn(
                        'h-full rounded-full',
                        positive ? 'bg-prosperity-500' : 'bg-error-500',
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, width))}%` }}
                />
            </div>
        </div>
    );
}
