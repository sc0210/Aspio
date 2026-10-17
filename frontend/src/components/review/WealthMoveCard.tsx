'use client';

import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { WealthMove } from '@/lib/review';
import { ChangeChip } from './ChangeChip';

interface WealthMoveCardProps {
    portfolio: WealthMove | undefined;
    /** The Life wallet — day-to-day cash. */
    life: WealthMove | undefined;
    /** The Emergency fund. */
    emergency: WealthMove | undefined;
    netWorth: WealthMove | undefined;
    loading?: boolean;
    /** The month is further back than the year of balances the page fetches. */
    outOfRange?: boolean;
    /** The fetch failed. The account's balances are unknown, not absent. */
    error?: boolean;
}

/**
 * What the balances did over the month.
 *
 * Stated as balances, and labelled as balances. Money moves between these rows
 * without anyone earning or spending it: buying a holding debits Life and
 * credits Portfolio, and a transfer moves cash from Life to Emergency. So
 * "Portfolio +NT$40,000" can be a purchase as much as a rising market, and
 * "Life −NT$40,000" that same purchase rather than spending. That is why the
 * cash rows carry no good-or-bad colour, and why the footnote exists.
 */
export function WealthMoveCard({
    portfolio,
    life,
    emergency,
    netWorth,
    loading,
    outOfRange,
    error,
}: WealthMoveCardProps) {
    const { t } = useTranslation('common');
    const moves = [netWorth, portfolio, life, emergency];
    const hasAny = moves.some(Boolean);

    if (loading && !hasAny) {
        return (
            <Card className="h-full">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {t('review.balances', 'Balances')}
                </h2>
                <div className="mt-4 space-y-4" aria-hidden="true">
                    <div className="h-4 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="h-7 w-40 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="h-4 w-32 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                </div>
                <span className="sr-only">{t('common.loading', 'Loading')}</span>
            </Card>
        );
    }

    if (!hasAny) {
        return (
            <Card className="h-full">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {t('review.balances', 'Balances')}
                </h2>
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {error
                        ? t('review.balancesUnavailable', "Your balances couldn't be loaded just now.")
                        : outOfRange
                        ? t(
                              'review.balancesOutOfRange',
                              'This page keeps a year of daily balances on hand, and this month is further back than that.',
                          )
                        : t(
                              'review.noSnapshots',
                              'No daily balances were recorded for this month, so there is nothing to compare.',
                          )}
                </p>
            </Card>
        );
    }

    // Every reading comes from one series, so they are short by the same days
    // or not at all — one footnote covers them all.
    const short = moves.find((move) => move?.openedInside);

    return (
        <Card className="h-full">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t('review.balances', 'Balances')}
            </h2>

            <div className="mt-4 space-y-4">
                {netWorth && (
                    <MoveRow label={t('review.netWorth', 'Net worth')} move={netWorth} emphasis />
                )}
                {portfolio && (
                    <MoveRow label={t('review.portfolio', 'Portfolio')} move={portfolio} />
                )}
                {life && (
                    <MoveRow label={t('review.lifeWallet', 'Life Wallet')} move={life} neutral />
                )}
                {emergency && (
                    <MoveRow label={t('review.emergency', 'Emergency Fund')} move={emergency} neutral />
                )}
            </div>

            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                {t(
                    'review.balancesNote',
                    'These are balances, not returns — money moved between wallets, invested or earned all counts toward the change.',
                )}
                {short && (
                    <>
                        {' '}
                        {t('review.openedInside', 'Measured from {{date}}, the first day with a balance on record.', {
                            date: short.openedOn,
                        })}
                    </>
                )}
            </p>
        </Card>
    );
}

function MoveRow({
    label,
    move,
    emphasis,
    neutral,
}: {
    label: string;
    move: WealthMove;
    emphasis?: boolean;
    /** A cash wallet: moving money in or out of it is neither good nor bad news. */
    neutral?: boolean;
}) {
    const { t } = useTranslation('common');
    const { maskValue } = usePrivacy();

    return (
        <div>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
                <ChangeChip change={{ amount: move.change, percent: move.percent }} moreIsBetter neutral={neutral} />
            </div>
            <p
                className={cn(
                    'font-semibold text-gray-900 dark:text-white',
                    emphasis ? 'text-xl' : 'text-base',
                )}
            >
                {maskValue(formatTWD(move.close))}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
                {t('review.openedAt', 'opened at {{amount}}', {
                    amount: maskValue(formatTWD(move.open)),
                })}
            </p>
        </div>
    );
}
