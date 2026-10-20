'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import type { MonthContext, MonthReview } from '@/lib/review';
import { monthSuggestions, type Suggestion, type SuggestionTone } from '@/lib/review/suggestions';
import { cn } from '@/utils/cn';

const TONE: Record<SuggestionTone, { dot: string; icon: string }> = {
    warn: { dot: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', icon: '!' },
    good: { dot: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', icon: '✓' },
    info: { dot: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300', icon: 'i' },
};

interface Props {
    review: MonthReview;
    /** The twelve-month context; omitted while it loads or if it failed. */
    context?: MonthContext;
}

/**
 * "So what do I do next month?" — up to three prompts read off the figures
 * above it. Nothing is shown when nothing is worth saying: a card of filler is
 * worse than no card.
 */
export function NextMonthCard({ review, context }: Props) {
    const { t } = useTranslation('common');
    const { maskValue } = usePrivacy();
    const items = useMemo(() => monthSuggestions(review, context), [review, context]);
    if (items.length === 0) return null;

    const money = (v: number) => maskValue(formatTWD(v));

    const sentence = (s: Suggestion): { text: string; href?: string } => {
        switch (s.kind) {
            case 'overspent':
                return {
                    text: s.category
                        ? t('review.next.overspent', 'You spent {{amount}} more than came in. {{category}} is the biggest line — the first place to look.', { amount: money(s.shortfall), category: s.category })
                        : t('review.next.overspentPlain', 'You spent {{amount}} more than came in.', { amount: money(s.shortfall) }),
                    href: '/transactions',
                };
            case 'categorySpike':
                return {
                    text: t('review.next.categorySpike', '{{category}} came to {{amount}}, up from {{previous}}. Capping it at last month\'s level frees {{diff}}.', {
                        category: s.category, amount: money(s.amount), previous: money(s.previous), diff: money(s.amount - s.previous),
                    }),
                    href: '/transactions',
                };
            case 'newCategory':
                return { text: t('review.next.newCategory', '{{category}} is new this month at {{amount}}. Worth deciding whether it\'s a one-off or a new regular.', { category: s.category, amount: money(s.amount) }) };
            case 'saveMore':
                return {
                    text: t('review.next.saveMore', 'You kept {{rate}}% of income. Keeping 20% would mean {{gap}} more — a goal makes it automatic.', { rate: Math.round(s.rate), gap: money(s.gap) }),
                    href: '/goals',
                };
            case 'putToWork':
                return {
                    text: t('review.next.putToWork', 'A strong month: {{amount}} kept. Consider moving some to Emergency or investing it.', { amount: money(s.kept) }),
                    href: '/transactions',
                };
            case 'belowAverage':
                return { text: t('review.next.belowAverage', 'You kept {{gap}} less than your twelve-month average of {{average}}.', { gap: money(s.gap), average: money(s.average) }) };
            case 'pace':
                return { text: t('review.next.pace', 'At this pace the month ends near {{projected}} of spending, against {{previous}} last month.', { projected: money(s.projected), previous: money(s.previous) }) };
        }
    };

    return (
        <Card as="section">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {review.range.partial ? t('review.next.titleRunning', 'So far this month') : t('review.next.title', 'For next month')}
            </h2>
            <ul className="mt-3 space-y-3">
                {items.map((s) => {
                    const { text, href } = sentence(s);
                    return (
                        <li key={s.kind} className="flex gap-3">
                            <span aria-hidden="true" className={cn('mt-0.5 grid place-items-center w-6 h-6 shrink-0 rounded-full text-xs font-bold', TONE[s.tone].dot)}>
                                {TONE[s.tone].icon}
                            </span>
                            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                                {text}
                                {href && (
                                    <>
                                        {' '}
                                        <Link href={href} className="font-medium text-prosperity-700 dark:text-prosperity-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-prosperity-500 rounded">
                                            {href === '/goals' ? t('review.next.go.goals', 'Goals') : t('review.next.go.transactions', 'Transactions')} →
                                        </Link>
                                    </>
                                )}
                            </p>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}
