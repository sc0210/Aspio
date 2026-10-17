'use client';

import { useTranslation } from 'react-i18next';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { cn } from '@/utils/cn';
import { monthLabel, shiftMonth, type MonthRange } from '@/lib/review';

interface MonthPickerProps {
    range: MonthRange;
    onChange: (monthKey: string) => void;
}

/**
 * Which month is under review, and the two steps either side of it.
 *
 * Forward is barred at the current month rather than merely discouraged: a
 * future month has no transactions, and a page that will happily render an
 * empty October in September teaches the reader that empty means "nothing
 * recorded" when it means "has not happened".
 */
export function MonthPicker({ range, onChange }: MonthPickerProps) {
    const { t, i18n } = useTranslation('common');

    const previous = shiftMonth(range.key, -1);
    const next = shiftMonth(range.key, 1);
    // range.today, not new Date(): the range already carries the day it was measured
    // against, and reading a second clock here let this disagree with the month it was
    // showing — "next month" stayed enabled into a month that had since begun.
    const thisMonth = range.today.slice(0, 7);
    const atLatest = next > thisMonth;

    const step =
        'p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ' +
        'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ' +
        'disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed';

    return (
        <Card padding="sm" className="flex items-center justify-between gap-3">
            <button
                type="button"
                onClick={() => onChange(previous)}
                aria-label={t('review.previousMonth', 'Previous month')}
                className={step}
            >
                <ChevronLeftIcon className="w-5 h-5" />
            </button>

            <div className="min-w-0 text-center">
                <p className="text-base font-semibold text-gray-900 dark:text-white truncate">
                    {monthLabel(range.key, i18n.language)}
                </p>
                {range.partial ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('review.soFar', 'Day {{days}} — the month is still running', { days: range.days })}
                    </p>
                ) : (
                    range.key !== thisMonth && (
                        <button
                            type="button"
                            onClick={() => onChange(thisMonth)}
                            className={cn(
                                'text-xs text-primary-600 dark:text-primary-400 hover:underline',
                                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded',
                            )}
                        >
                            {t('review.backToThisMonth', 'Back to this month')}
                        </button>
                    )
                )}
            </div>

            <button
                type="button"
                onClick={() => onChange(next)}
                disabled={atLatest}
                aria-label={t('review.nextMonth', 'Next month')}
                className={step}
            >
                <ChevronRightIcon className="w-5 h-5" />
            </button>
        </Card>
    );
}
