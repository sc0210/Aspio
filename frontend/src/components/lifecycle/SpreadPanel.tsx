'use client';

import { useTranslation } from 'react-i18next';
import { ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { DebtAggregate, InterestToDate, SpreadResult } from '@/lib/lifecycle';
import { Card } from '@/components/ui/Card';


interface Props {
    spread: SpreadResult;
    debt: DebtAggregate;
    interest: InterestToDate;
    realizedReturnPct: number | null;
    /** Which measure the figure is: time-weighted since inception, or the per-lot IRR average. */
    realizedReturnSource?: 'twr' | 'lots' | null;
    /** First day of the TWR window, YYYY-MM-DD. */
    realizedReturnSince?: string | null;
}

/**
 * Is the borrowing paying for itself?
 *
 * Both sides are measured, not assumed: the APR comes from the loan records and
 * the return from the per-holding IRR the backend already computes. Interest
 * paid to date is the number almost nobody tracks — it is what the strategy has
 * actually cost so far, regardless of how the portfolio looks.
 */
export function SpreadPanel({ spread, debt, interest, realizedReturnPct, realizedReturnSource, realizedReturnSince }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    return (
        <Card padding="md">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <ArrowTrendingUpIcon className="w-4 h-4 text-prosperity-500" />
                {t('lifecycle.spread.title', 'Is the leverage paying for itself?')}
            </h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 mb-4">
                {t('lifecycle.spread.subtitle', 'Measured, not assumed: the rate your loans actually charge against the return your holdings actually delivered.')}
            </p>

            <div className="grid grid-cols-3 gap-2 mb-4">
                <Metric
                    label={realizedReturnSource === 'twr'
                        ? t('lifecycle.spread.earnedTwr', 'Annual return')
                        : t('lifecycle.spread.earned', 'Portfolio IRR')}
                    value={realizedReturnPct === null ? '—' : `${realizedReturnPct.toFixed(1)}%`}
                    tone="good"
                />
                <Metric
                    label={t('lifecycle.spread.cost', 'Blended APR')}
                    value={`${debt.blendedRatePct.toFixed(2)}%`}
                    tone="bad"
                />
                <Metric
                    label={t('lifecycle.spread.net', 'Spread')}
                    value={spread.spreadPct === null ? '—' : `${spread.spreadPct >= 0 ? '+' : '−'}${Math.abs(spread.spreadPct).toFixed(1)}%`}
                    tone={spread.unknown ? 'neutral' : spread.isPositive ? 'good' : 'bad'}
                    emphasise
                />
            </div>

            {realizedReturnSource === 'twr' && (
                <p className="-mt-2 mb-3 text-xs text-gray-400 dark:text-gray-500">
                    {t('lifecycle.spread.twrBasis', 'Time-weighted since {{since}}: your own deposits are taken out, so it measures the investments, not the saving.', {
                        since: realizedReturnSince ?? '—',
                    })}
                </p>
            )}

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                {spread.unknown
                    ? t('lifecycle.spread.unknown', 'No annualized return yet — holdings need enough history for an IRR before the spread means anything.')
                    : spread.isPositive
                        ? t('lifecycle.spread.positive', 'The borrowed {{debt}} is earning about {{carry}} a year more than it costs. Expect this to swing hard year to year — the case for leverage rests on long-run averages, never on any single year.', {
                            debt: isValueVisible ? formatTWDCompact(debt.balance) : '•••',
                            carry: isValueVisible ? formatTWDCompact(Math.abs(spread.annualCarry ?? 0)) : '•••',
                        })
                        : t('lifecycle.spread.negative', 'The borrowed {{debt}} is currently costing about {{carry}} a year more than it earns. One bad stretch does not invalidate the strategy, but a persistent negative spread does.', {
                            debt: isValueVisible ? formatTWDCompact(debt.balance) : '•••',
                            carry: isValueVisible ? formatTWDCompact(Math.abs(spread.annualCarry ?? 0)) : '•••',
                        })}
            </p>

            {/* What it has cost so far. */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {t('lifecycle.spread.paidLabel', 'Interest paid so far')}
                    </p>
                    <p className="text-lg font-bold tabular-nums text-error-600 dark:text-error-400 mt-0.5">
                        {isValueVisible ? formatTWDCompact(interest.paid) : '•••'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {t('lifecycle.spread.onSchedule', 'on the contractual schedule')}
                    </p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {t('lifecycle.spread.remainingLabel', 'Interest still ahead')}
                    </p>
                    <p className="text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100 mt-0.5">
                        {isValueVisible ? formatTWDCompact(interest.remaining) : '•••'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {t('lifecycle.spread.ifRunToTerm', 'if the loans run to term')}
                    </p>
                </div>
            </div>
        </Card>
    );
}

function Metric({
    label,
    value,
    tone,
    emphasise = false,
}: {
    label: string;
    value: string;
    tone: 'good' | 'bad' | 'neutral';
    emphasise?: boolean;
}) {
    return (
        <div className={cn(
            'rounded-xl border p-3 text-center',
            emphasise ? 'border-gray-300 dark:border-gray-600' : 'border-gray-200 dark:border-gray-700',
        )}>
            <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
            <p className={cn(
                'font-bold tabular-nums mt-0.5',
                emphasise ? 'text-xl' : 'text-lg',
                tone === 'good' && 'text-prosperity-600 dark:text-prosperity-400',
                tone === 'bad' && 'text-error-600 dark:text-error-400',
                tone === 'neutral' && 'text-gray-500 dark:text-gray-400',
            )}>
                {value}
            </p>
        </div>
    );
}
