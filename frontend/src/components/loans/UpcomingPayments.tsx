'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { DebtAccount } from '@/services/loanService';
import { upcomingPayments } from '@/lib/loans/upcoming';
import { formatCurrency } from '@/utils/formatters';
import { cn } from '@/utils/cn';

const HORIZON_DAYS = 30;

/**
 * Every loan payment due in the next 30 days, soonest first — the summary card
 * above shows only the single next one. Overdue payments stay listed, in red.
 */
export function UpcomingPayments({ loans }: { loans: DebtAccount[] }) {
    const { t, i18n } = useTranslation('loans');
    const { isValueVisible } = usePrivacy();
    const items = useMemo(() => upcomingPayments(loans, new Date(), HORIZON_DAYS), [loans]);

    const when = (days: number) =>
        days < 0 ? t('upcoming.overdue', { count: -days })
            : days === 0 ? t('upcoming.today')
                : t('upcoming.inDays', { count: days });
    const fmtDay = (s: string) => {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', weekday: 'short' });
    };
    const total = items.reduce((sum, p) => sum + (p.currency === items[0]?.currency ? p.amount : 0), 0);
    const oneCurrency = items.every((p) => p.currency === items[0]?.currency);

    return (
        <Card as="section" padding="md">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <CalendarDaysIcon className="w-4 h-4 text-amber-500" />
                    {t('upcoming.title', { count: HORIZON_DAYS })}
                </h2>
                {items.length > 0 && (oneCurrency ? (
                    <span className="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                        {isValueVisible ? formatCurrency(total, items[0].currency, { precision: 0 }) : '••••'}
                    </span>
                ) : (
                    // Amounts in different currencies don't add up to one figure.
                    <span className="text-xs text-gray-500 dark:text-gray-500">{t('upcoming.mixedCurrencies')}</span>
                ))}
            </div>
            {items.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('upcoming.none', { count: HORIZON_DAYS })}</p>
            ) : (
                <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {items.map((p) => (
                        <li key={`${p.loanId}-${p.date}`} className="flex items-center gap-3 py-2.5">
                            <span className="sm:w-28 shrink-0 whitespace-nowrap text-sm tabular-nums text-gray-700 dark:text-gray-300">{fmtDay(p.date)}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">{p.name}</span>
                            <span className={cn('shrink-0 text-xs font-medium',
                                p.daysAway < 0 ? 'text-error-700 dark:text-error-400'
                                    : p.daysAway <= 3 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400')}>
                                {when(p.daysAway)}
                            </span>
                            <span className="sm:w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                                {isValueVisible ? formatCurrency(p.amount, p.currency, { precision: 0 }) : '••••'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
