'use client';

import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { monthLabel, type ContextMonth, type MonthContext } from '@/lib/review';

interface MonthContextCardProps {
    context: MonthContext;
    loading?: boolean;
    /** The series failed to load — the account's history is unknown, not absent. */
    error?: boolean;
}

/**
 * The month among the twelve around it.
 *
 * The rest of the page compares one month with the one before it, which is a
 * sample of two: a bonus, an insurance renewal or a trip makes that comparison
 * true and misleading at the same time. A year of neighbours is what says
 * whether the month was actually unusual.
 *
 * The bars are deliberately not a chart component. There are twelve values and
 * one question — is this one taller or shorter than usual — and the sentence
 * below states the answer in words, so the bars are decoration for a fact the
 * reader has already been told rather than the only place it exists.
 */
export function MonthContextCard({ context, loading, error }: MonthContextCardProps) {
    const { t, i18n } = useTranslation('common');
    const { maskValue } = usePrivacy();

    // First, because it is settled by the calendar rather than by the fetch:
    // a month outside the window stays outside it whether the series is still
    // loading, failed, or arrived intact.
    if (context.outOfWindow) {
        return (
            <Card>
                <Heading />
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t(
                        'review.contextOutOfWindow',
                        'This page compares against the last twelve months, and this one is further back than that.',
                    )}
                </p>
            </Card>
        );
    }

    if (loading && !context.of) {
        return (
            <Card>
                <Heading />
                <div className="mt-4 h-20 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" aria-hidden="true" />
                <span className="sr-only">{t('common.loading', 'Loading')}</span>
            </Card>
        );
    }

    if (error && !context.of) {
        return (
            <Card>
                <Heading />
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t('review.contextUnavailable', "The last twelve months couldn't be loaded just now.")}
                </p>
            </Card>
        );
    }

    if (context.of === 0) {
        return (
            <Card>
                <Heading />
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t('review.contextTooNew', 'Once there is a second month on record, this is where the two get compared.')}
                </p>
            </Card>
        );
    }

    // One scale for all twelve bars, so their heights are comparable to each
    // other rather than each filling its own column.
    const scale = Math.max(...context.months.map((month) => Math.abs(month.net)), 1);

    return (
        <Card>
            <Heading />

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {context.rank === undefined
                    ? t('review.contextRunning', 'Still running — it joins the comparison when the month closes.')
                    : t('review.contextRank', 'Its {{rank}} best saving month of the last {{of}}.', {
                          rank: ordinal(context.rank, i18n.language),
                          of: context.of,
                      })}
            </p>

            {context.vsAverage !== undefined && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {context.vsAverage >= 0
                        ? t('review.contextAboveAverage', '{{amount}} above the average month.', {
                              amount: maskValue(formatTWD(Math.abs(context.vsAverage))),
                          })
                        : t('review.contextBelowAverage', '{{amount}} below the average month.', {
                              amount: maskValue(formatTWD(Math.abs(context.vsAverage))),
                          })}
                </p>
            )}

            <ol className="mt-4 flex items-end gap-1 h-20" aria-hidden="true">
                {context.months.map((month) => (
                    <Bar
                        key={month.key}
                        month={month}
                        scale={scale}
                        title={
                            month.empty
                                ? t('review.contextNoData', '{{month}}: nothing recorded', {
                                      month: monthLabel(month.key, i18n.language),
                                  })
                                : `${monthLabel(month.key, i18n.language)}: ${maskValue(formatTWD(month.net))}`
                        }
                    />
                ))}
            </ol>

            <div className="mt-1 flex justify-between text-xs text-gray-500 dark:text-gray-500">
                <span>{monthLabel(context.months[0].key, i18n.language)}</span>
                <span>{monthLabel(context.months[context.months.length - 1].key, i18n.language)}</span>
            </div>

            {/* The bars carry no information a screen reader can reach, so the
                series is stated once, in full, for anyone not looking at them. */}
            <ul className="sr-only">
                {context.months
                    .filter((month) => !month.empty)
                    .map((month) => (
                        <li key={month.key}>
                            {monthLabel(month.key, i18n.language)}: {maskValue(formatTWD(month.net))}
                        </li>
                    ))}
            </ul>
        </Card>
    );
}

function Heading() {
    const { t } = useTranslation('common');
    return (
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('review.contextTitle', 'The year around it')}
        </h2>
    );
}

function Bar({ month, scale, title }: { month: ContextMonth; scale: number; title: string }) {
    // Zero-baselined on purpose. Scaling these from the smallest month would
    // make a normal month look dramatic, which is the opposite of what the card
    // is for: if every bar is the same height, the month was ordinary, and that
    // is the answer.
    const height = month.empty ? 0 : Math.max(4, (Math.abs(month.net) / scale) * 100);

    return (
        <li className="flex-1 flex flex-col justify-end h-full" title={title}>
            <div
                className={cn(
                    'w-full rounded-sm transition-colors',
                    month.empty && 'bg-gray-100 dark:bg-gray-800 h-1',
                    !month.empty && month.net < 0 && 'bg-error-400/70',
                    !month.empty && month.net >= 0 && (month.selected
                        ? 'bg-prosperity-500'
                        : month.partial
                            ? 'bg-prosperity-200 dark:bg-prosperity-900/60'
                            : 'bg-prosperity-300/70 dark:bg-prosperity-700/60'),
                    month.selected && 'ring-2 ring-prosperity-500 ring-offset-1 dark:ring-offset-gray-900',
                )}
                style={month.empty ? undefined : { height: `${height}%` }}
            />
        </li>
    );
}

/** "3rd" / 「第 3」 — the rank reads as a position, not a count. */
function ordinal(value: number, locale: string): string {
    if (!locale.startsWith('en')) return String(value);
    const rules = new Intl.PluralRules('en', { type: 'ordinal' });
    const suffixes: Partial<Record<Intl.LDMLPluralRule, string>> = {
        one: 'st',
        two: 'nd',
        few: 'rd',
    };
    return `${value}${suffixes[rules.select(value)] ?? 'th'}`;
}
