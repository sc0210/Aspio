'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatCurrency } from '@/utils/formatters';
import { useReviewTopExpenses } from '@/hooks/useReviewTopExpenses';
import type { MonthRange } from '@/lib/review';

interface Props {
    range: MonthRange;
}

/**
 * The month's biggest single expenses — the rows behind "Where it went". A
 * category total says Shopping was high; this says it was one pair of shoes.
 */
export function TopExpensesCard({ range }: Props) {
    const { t, i18n } = useTranslation('common');
    const { maskValue } = usePrivacy();
    const { data, isLoading, isError } = useReviewTopExpenses(range);

    const day = (date: string) => {
        const [y, m, d] = date.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
    };

    return (
        <Card as="section">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {t('review.topExpenses.title', 'Biggest expenses')}
                </h2>
                <Link href="/transactions" className="inline-block py-3.5 -my-3.5 sm:py-1 sm:-my-1 text-xs font-medium text-prosperity-700 dark:text-prosperity-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-prosperity-500 rounded">
                    {t('review.allTransactions', 'All transactions')}
                </Link>
            </div>

            {isLoading ? (
                <div className="mt-4 space-y-2" aria-hidden="true">
                    {[0, 1, 2].map((i) => <div key={i} className="h-6 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
                </div>
            ) : isError ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t('review.topExpenses.unavailable', "The month's expenses couldn't be loaded just now.")}
                </p>
            ) : !data || data.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('review.noSpending', 'No spending recorded in this month.')}</p>
            ) : (
                <ol className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {data.map((e, i) => (
                        <li key={e.id} className="flex items-center gap-3 py-2.5">
                            <span className="w-4 text-xs tabular-nums text-gray-500 dark:text-gray-400">{i + 1}</span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{e.description || e.category}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {e.category} · {day(e.date)}
                                </p>
                            </div>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                                {maskValue(formatCurrency(e.amount, e.currency, { precision: 0 }))}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                {t('review.topExpenses.note', 'Transfers between your own wallets are left out.')}
            </p>
        </Card>
    );
}
