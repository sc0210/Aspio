'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { lineDelta, type CategoryLine, type MonthReview } from '@/lib/review';
import { ChangeChip } from './ChangeChip';

/** Rows past this are a long tail nobody reads; the total below accounts for them. */
const SHOWN = 6;

interface BreakdownProps {
    review: MonthReview;
}

/**
 * Where the month's money went, and what moved since the month before.
 *
 * The two questions share one card on purpose. Split across a "top categories"
 * list and a "biggest changes" list they duplicate most rows and force the
 * reader to match them up by name; together, the change is simply a column.
 */
export function SpendingBreakdown({ review }: BreakdownProps) {
    const { t } = useTranslation('common');

    return (
        <CategoryBreakdownCard
            title={t('review.whereItWent', 'Where it went')}
            lines={review.categories}
            mover={review.biggestMover}
            hasPrevious={review.hasPrevious}
            moreIsBetter={false}
            emptyText={t('review.noSpending', 'No spending recorded in this month.')}
            showAllTransactionsLink
        />
    );
}

/**
 * Where the month's money came from — the same card read the other way round:
 * a category that rose is good news, so its chip is green rather than red.
 */
export function IncomeBreakdown({ review }: BreakdownProps) {
    const { t } = useTranslation('common');

    return (
        <CategoryBreakdownCard
            title={t('review.whereItCameFrom', 'Where it came from')}
            lines={review.incomeCategories}
            mover={review.biggestIncomeMover}
            hasPrevious={review.hasPrevious}
            moreIsBetter
            emptyText={t('review.noIncome', 'No income recorded in this month.')}
        />
    );
}

interface CategoryBreakdownCardProps {
    title: string;
    lines: CategoryLine[];
    mover: CategoryLine | undefined;
    hasPrevious: boolean;
    /** Spending: a rise is bad news. Income: a rise is good news. */
    moreIsBetter: boolean;
    emptyText: string;
    showAllTransactionsLink?: boolean;
}

function CategoryBreakdownCard({
    title,
    lines,
    mover,
    hasPrevious,
    moreIsBetter,
    emptyText,
    showAllTransactionsLink,
}: CategoryBreakdownCardProps) {
    const { t } = useTranslation('common');
    const { maskValue } = usePrivacy();

    const recorded = lines.filter((line) => line.amount > 0);
    const shown = recorded.slice(0, SHOWN);
    const rest = recorded.slice(SHOWN);
    const restTotal = rest.reduce((sum, line) => sum + line.amount, 0);

    return (
        <Card padding="none" className="flex flex-col">
            <div className="p-5 pb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
                {showAllTransactionsLink && (
                    <Link
                        href="/transactions"
                        className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                    >
                        {t('review.allTransactions', 'All transactions')}
                    </Link>
                )}
            </div>

            {mover && (
                <p className="px-5 pb-3 text-sm text-gray-600 dark:text-gray-300">
                    {mover.change > 0
                        ? t('review.moverUp', '{{category}} rose the most against last month.', {
                              category: mover.category,
                          })
                        : t('review.moverDown', '{{category}} fell the most against last month.', {
                              category: mover.category,
                          })}{' '}
                    <ChangeChip change={lineDelta(mover)} moreIsBetter={moreIsBetter} />
                </p>
            )}

            <ul className="px-5 pb-5 space-y-3 flex-1">
                {shown.map((line) => (
                    <Row key={line.category} line={line} hasPrevious={hasPrevious} moreIsBetter={moreIsBetter} />
                ))}

                {recorded.length === 0 && (
                    <li className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">{emptyText}</li>
                )}
            </ul>

            {rest.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>
                        {t('review.otherCategories', '{{count}} more categories', { count: rest.length })}
                    </span>
                    <span>{maskValue(formatTWD(restTotal))}</span>
                </div>
            )}
        </Card>
    );
}

function Row({
    line,
    hasPrevious,
    moreIsBetter,
}: {
    line: CategoryLine;
    hasPrevious: boolean;
    moreIsBetter: boolean;
}) {
    const { maskValue } = usePrivacy();

    return (
        <li>
            <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                    <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: line.color || '#94a3b8' }}
                        aria-hidden="true"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-200 truncate">
                        {line.category}
                    </span>
                    <ChangeChip
                        change={lineDelta(line)}
                        moreIsBetter={moreIsBetter}
                        unavailable={!hasPrevious}
                    />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                    {maskValue(formatTWD(line.amount))}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    {/* The bar carries the category's own colour, the same one the
                        dot and the dashboard's category charts use — two greys and
                        a legend would be a third spelling of one mapping. */}
                    <div
                        className="h-full rounded-full"
                        style={{
                            width: `${Math.max(2, Math.min(100, line.share))}%`,
                            backgroundColor: line.color || '#94a3b8',
                        }}
                    />
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 w-10 text-right">
                    {line.share.toFixed(0)}%
                </span>
            </div>
        </li>
    );
}
