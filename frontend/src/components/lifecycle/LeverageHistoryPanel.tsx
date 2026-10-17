'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import {
    buildLeverageHistory,
    summarizeLeverageHistory,
    type LifecycleLoan,
    type WalletDayBalances,
} from '@/lib/lifecycle';
import { LeverageHistoryChart } from './LeverageHistoryChart';

import { LIFECYCLE_CHART_COLORS as COLORS } from './chartColors';
import { Card } from '@/components/ui/Card';

export type LeverageHistoryPeriod = '30d' | '90d' | '1y' | 'ytd';

const PERIODS: LeverageHistoryPeriod[] = ['30d', '90d', 'ytd', '1y'];

interface Props {
    points: WalletDayBalances[];
    loans: LifecycleLoan[];
    /** Today's position, from the same numbers the headline reads. */
    today: { stockExposure: number; cashAssets: number; investmentDebt: number };
    targetLeverage: number;
    maxLeverage: number;
    period: LeverageHistoryPeriod;
    onPeriodChange: (period: LeverageHistoryPeriod) => void;
    isLoading: boolean;
}

/**
 * Which way has the leverage been going?
 *
 * The headline ratio is a single reading, and a single reading cannot tell
 * deleveraging from a good quarter. This panel answers the question it leaves
 * open — with debt at both ends of the window beside the ratio, because the two
 * ways of getting to the same number are not the same achievement.
 */
export function LeverageHistoryPanel({
    points,
    loans,
    today,
    targetLeverage,
    maxLeverage,
    period,
    onPeriodChange,
    isLoading,
}: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    const money = (v: number) => (isValueVisible ? formatTWDCompact(v) : '••••');

    const rows = useMemo(
        () => buildLeverageHistory({ points, loans, today }),
        [points, loans, today],
    );
    const summary = useMemo(
        () => summarizeLeverageHistory(rows, maxLeverage),
        [rows, maxLeverage],
    );

    const periodLabel = (p: LeverageHistoryPeriod) => ({
        '30d': t('lifecycle.history.p30d', '30 days'),
        '90d': t('lifecycle.history.p90d', '90 days'),
        ytd: t('lifecycle.history.pytd', 'YTD'),
        '1y': t('lifecycle.history.p1y', '1 year'),
    }[p]);

    // Debt tells you which of the two stories a change in the ratio is: paying
    // the loan down, or the market moving under a fixed loan.
    const debtFell = summary.debtEnd < summary.debtStart - 1;
    // A hair either side of zero is not a move worth narrating — and calling
    // exactly 0 a rise, as `< 0 ? … : …` alone would, contradicted the Change
    // tile colouring the same 0 as good.
    const FLAT = 0.005;
    const changeStory = summary.change === null
        ? null
        : !summary.everBorrowed
        // Below 1× with no loan at all, this ratio is not leverage in any
        // meaningful sense — it is the share of net assets held as stock. Saying
        // "leverage rose" there would read as a warning about borrowing that
        // never happened.
        ? t('lifecycle.history.equityShare', 'No investment debt in this window, so the line is your equity share rather than leverage: the portion of your net assets held as stock. It only becomes leverage above 1×.')
        : Math.abs(summary.change) < FLAT
        ? t('lifecycle.history.flat', 'Leverage held steady across this window.')
        : summary.change < 0
            ? debtFell
                ? t('lifecycle.history.downByRepaying', 'Leverage fell and so did the debt — this is the strategy working, not the market flattering it.')
                : t('lifecycle.history.downByMarket', 'Leverage fell while the debt stayed put, so the portfolio rose. Real progress, but it can reverse without you doing anything.')
            : debtFell
                ? t('lifecycle.history.upDespiteRepaying', 'Leverage rose even though you repaid — the portfolio fell faster than the loan did.')
                : t('lifecycle.history.upByBorrowing', 'Leverage rose on flat or growing debt. Check that this was a decision rather than a drift.');

    return (
        <Card padding="md">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <ChartBarIcon className="w-4 h-4 text-indigo-500" />
                        {t('lifecycle.history.title', 'Leverage over time')}
                    </h3>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                        {t('lifecycle.history.subtitle', 'Today’s ratio cannot tell you whether you are deleveraging. The direction can.')}
                    </p>
                </div>

                <div
                    className="flex items-center gap-1 shrink-0"
                    role="group"
                    aria-label={t('lifecycle.history.periodGroup', 'Time range')}
                >
                    {PERIODS.map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => onPeriodChange(p)}
                            aria-pressed={p === period}
                            className={cn(
                                'px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                p === period
                                    ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                            )}
                        >
                            {periodLabel(p)}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="h-56 sm:h-64 mt-4 rounded-xl bg-gray-50 dark:bg-gray-700/30 animate-pulse" />
            ) : points.length === 0 ? (
                // Keyed on the incoming series, not on the summary: a today row
                // is always appended, so `end === null` never means "no data" —
                // it means every day was underwater, which is a position to
                // report, not an empty state.
                <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
                    {t('lifecycle.history.empty', 'No balance history for this window yet. It is replayed from your recorded transactions and holdings, so it fills in as those accumulate.')}
                </p>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 mb-4">
                        <Stat
                            label={t('lifecycle.history.start', 'Window open')}
                            value={summary.start === null ? '—' : `${summary.start.toFixed(2)}×`}
                        />
                        <Stat
                            // Null when every day of the window was underwater:
                            // debt exceeded everything owned, so there is no
                            // ratio to state. The dash is the honest answer.
                            label={t('lifecycle.history.end', 'Today')}
                            value={summary.end === null ? '—' : `${summary.end.toFixed(2)}×`}
                            emphasise
                        />
                        <Stat
                            label={t('lifecycle.history.change', 'Change')}
                            value={summary.change === null
                                ? '—'
                                : `${summary.change >= 0 ? '+' : '−'}${Math.abs(summary.change).toFixed(2)}`}
                            // A flat window is neither good nor bad; only a real
                            // rise earns the warning colour.
                            tone={summary.change === null || Math.abs(summary.change) < FLAT
                                ? 'neutral'
                                : summary.change < 0 ? 'good' : 'bad'}
                        />
                        <Stat
                            label={t('lifecycle.history.peak', 'Highest')}
                            value={summary.peak === null ? '—' : `${summary.peak.value.toFixed(2)}×`}
                            tone={summary.peak && summary.peak.value > maxLeverage ? 'bad' : 'neutral'}
                        />
                    </div>

                    <LeverageHistoryChart
                        data={rows}
                        colors={COLORS}
                        targetLeverage={targetLeverage}
                        maxLeverage={maxLeverage}
                        formatMoney={money}
                        labels={{
                            actual: t('lifecycle.history.actual', 'Your leverage'),
                            target: t('lifecycle.history.targetLine', 'Target today'),
                            ceiling: t('lifecycle.glide.ceiling', 'Ceiling'),
                            noDebt: t('lifecycle.glide.noDebtLine', 'No debt'),
                            debt: t('lifecycle.history.debt', 'Investment debt'),
                            exposure: t('lifecycle.history.exposure', 'Portfolio'),
                        }}
                    />

                    {summary.daysUnderwater > 0 && (
                        <p className="mt-3 text-xs font-medium text-error-600 dark:text-error-400">
                            {t('lifecycle.history.underwater', {
                                defaultValue: '{{n}} days with no ratio to report: investment debt exceeded everything you owned, and the line breaks across them.',
                                n: summary.daysUnderwater,
                            })}
                        </p>
                    )}

                    {summary.daysOverCeiling > 0 && (
                        <p className="mt-3 text-xs font-medium text-error-600 dark:text-error-400">
                            {t('lifecycle.history.overCeiling', {
                                defaultValue: '{{n}} days above your {{max}}× ceiling in this window.',
                                n: summary.daysOverCeiling,
                                max: maxLeverage,
                            })}
                        </p>
                    )}

                    {changeStory && (
                        <p className="mt-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                            {changeStory}
                        </p>
                    )}

                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                        {t('lifecycle.history.basis', 'Both halves are measured, not projected: balances are replayed from your transactions and holdings, and past debt from the payments recorded against each loan — the same payments that set the balance shown today.')}
                    </p>
                </>
            )}
        </Card>
    );
}

function Stat({
    label,
    value,
    tone = 'neutral',
    emphasise = false,
}: {
    label: string;
    value: string;
    tone?: 'good' | 'bad' | 'neutral';
    emphasise?: boolean;
}) {
    const toneClass = {
        good: 'text-prosperity-600 dark:text-prosperity-400',
        bad: 'text-warning-600 dark:text-warning-400',
        neutral: 'text-gray-900 dark:text-white',
    }[tone];

    return (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
            <p className={cn('font-bold tabular-nums', emphasise ? 'text-lg' : 'text-base', toneClass)}>
                {value}
            </p>
        </div>
    );
}
