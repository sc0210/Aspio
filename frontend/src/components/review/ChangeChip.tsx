'use client';

import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { Delta } from '@/lib/review';

interface ChangeChipProps {
    change: Delta;
    /**
     * Which way is good news. Spending more is worse; earning, saving and
     * holding more is better — and the same red-for-up chip has to mean both
     * on one screen, so every caller states which it is.
     */
    moreIsBetter: boolean;
    /**
     * Neither direction is good or bad news — a cash wallet that fell because
     * the money was invested, or rose because it was moved in. The chip still
     * says which way and by how much; it just does not colour it as a verdict.
     */
    neutral?: boolean;
    /**
     * Nothing to compare against — the chip says so instead of showing +100%.
     *
     * The copy is deliberately neutral about *why*. A month with no previous
     * month and one whose previous month failed to load are the same fact from
     * here, and "no last month" would state the first as though it were known.
     */
    unavailable?: boolean;
    className?: string;
}

/**
 * "▲ NT$4,200 (12%)" — a month-over-month change, in the direction that reads
 * as good or bad for the figure it sits beside.
 *
 * The percentage is in brackets and the money is not, because the money is the
 * part that survives a missing base: a category that did not exist last month
 * has no percentage, only an amount, and the chip is built so that case needs
 * no special caller.
 */
export function ChangeChip({ change, moreIsBetter, neutral, unavailable, className }: ChangeChipProps) {
    const { t } = useTranslation('common');
    const { maskValue } = usePrivacy();

    if (unavailable) {
        return (
            <span className={cn('text-xs text-gray-400 dark:text-gray-500', className)}>
                {t('review.noComparison', 'no comparison')}
            </span>
        );
    }

    if (change.amount === 0) {
        return (
            <span className={cn('text-xs text-gray-400 dark:text-gray-500', className)}>
                {t('review.unchanged', 'flat')}
            </span>
        );
    }

    const up = change.amount > 0;
    const tone = neutral ? 'neutral' : up === moreIsBetter ? 'good' : 'bad';
    // A percentage that rounds to 0% reads as "no change" beside an amount
    // that plainly is one — NT$6,266 on a NT$2M balance. The amount carries
    // that row on its own.
    const percent = change.percent !== undefined && Math.abs(change.percent) >= 1 ? change.percent : undefined;

    return (
        <span
            data-tone={tone}
            className={cn(
                'inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                tone === 'good' && 'bg-prosperity-50 text-prosperity-700 dark:bg-prosperity-900/30 dark:text-prosperity-300',
                tone === 'bad' && 'bg-error-50 text-error-700 dark:bg-error-900/30 dark:text-error-300',
                tone === 'neutral' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                className,
            )}
        >
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            {/* The triangle and the colour are the only things saying which way
                this went, and a screen reader gets neither. */}
            <span className="sr-only">{up ? t('review.up', 'up') : t('review.down', 'down')}</span>
            {maskValue(formatTWD(Math.abs(change.amount)))}
            {percent !== undefined && (
                <span className="font-normal opacity-80">({Math.abs(percent).toFixed(0)}%)</span>
            )}
        </span>
    );
}
