'use client';

import { useTranslation } from 'react-i18next';
import { ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { Severity, StressResult } from '@/lib/lifecycle';
import { Card } from '@/components/ui/Card';
import { DrawdownSlider } from './DrawdownSlider';


interface Props {
    stress: StressResult;
    /** Months the income/expense seed averages over (0 = current-month fallback). */
    cashFlowBasisMonths?: number;
}

const SEVERITY: Record<Severity, { text: string; ring: string; dot: string }> = {
    safe: {
        text: 'text-prosperity-700 dark:text-prosperity-300',
        ring: 'border-prosperity-200 dark:border-prosperity-700/50 bg-prosperity-50 dark:bg-prosperity-900/20',
        dot: '🟢',
    },
    watch: {
        text: 'text-warning-700 dark:text-warning-300',
        ring: 'border-warning-200 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20',
        dot: '🟡',
    },
    danger: {
        text: 'text-error-700 dark:text-error-300',
        ring: 'border-error-200 dark:border-error-700/50 bg-error-50 dark:bg-error-900/20',
        dot: '🔴',
    },
};

/**
 * The panel this page exists for.
 *
 * A personal loan is recourse, amortizing debt: the payment falls due whatever
 * the market did, and you cannot deleverage by selling. So the risk that ends
 * the strategy is not a drawdown — it is a drawdown that forces you to sell
 * into it. Coverage and runway are shown first for that reason; the drawdown
 * table is the consequence, not the cause.
 */
export function SafetyPanel({ stress, cashFlowBasisMonths = 0 }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    const cov = SEVERITY[stress.coverageSeverity];
    const run = SEVERITY[stress.runwaySeverity];

    return (
        <Card padding="md">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <ShieldExclamationIcon className="w-4 h-4 text-error-500" />
                {t('lifecycle.safety.title', 'Can you survive a bad market?')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 mb-4">
                {t('lifecycle.safety.subtitle', 'The loan payment is due whatever the market does. Being forced to sell holdings to make it is the one failure the strategy cannot recover from.')}
            </p>

            {stress.forcedSaleRisk && (
                <div className="mb-4 rounded-xl border border-error-200 dark:border-error-700/50 bg-error-50 dark:bg-error-900/20 p-3">
                    <p className="text-xs font-bold text-error-700 dark:text-error-300">
                        {t('lifecycle.safety.forcedSaleTitle', 'Forced-sale risk')}
                    </p>
                    <p className="text-xs text-error-700 dark:text-error-400 mt-0.5 leading-relaxed">
                        {t('lifecycle.safety.forcedSaleBody', 'Your free cash flow or your reserves are too thin to carry the payment through a rough patch. Fix this before adding exposure — it matters more than the leverage ratio.')}
                    </p>
                </div>
            )}

            {/* The two cash-flow gauges. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className={cn('rounded-xl border p-3', cov.ring)}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                            <span aria-hidden="true">{cov.dot}</span>
                            {t('lifecycle.safety.coverage', 'Payment coverage')}
                        </span>
                        <span className={cn('text-sm font-bold tabular-nums', cov.text)}>
                            {stress.coverageRatio === null ? '—' : `${stress.coverageRatio.toFixed(1)}×`}
                        </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                        {stress.coverageRatio === null
                            ? t('lifecycle.safety.coverageNone', 'No investment-loan payment to cover.')
                            : t('lifecycle.safety.coverageBody', 'Free cash flow before the payment is {{surplus}}/mo. Aim for 2× or more.', {
                                surplus: isValueVisible ? formatTWDCompact(stress.preDebtSurplus) : '•••',
                            })}
                    </p>
                    {cashFlowBasisMonths > 0 && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                            {t('lifecycle.safety.basis', 'based on a {{n}}-month average', { n: cashFlowBasisMonths })}
                        </p>
                    )}
                </div>

                <div className={cn('rounded-xl border p-3', run.ring)}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                            <span aria-hidden="true">{run.dot}</span>
                            {t('lifecycle.safety.runway', 'Payment runway')}
                        </span>
                        <span className={cn('text-sm font-bold tabular-nums', run.text)}>
                            {stress.runwayMonths === null
                                ? '—'
                                : t('lifecycle.safety.months', '{{n}} mo', { n: Math.floor(stress.runwayMonths) })}
                        </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                        {stress.runwayMonths === null
                            ? t('lifecycle.safety.runwayNone', 'No payment to fund from reserves.')
                            : t('lifecycle.safety.runwayBody', 'How long your reserves keep paying with zero income, without selling stock. Aim for 12 months.')}
                    </p>
                </div>
            </div>

            {/* Wipeout headline. `wipeoutDropPct` is null in two opposite cases —
                unlevered (nothing can wipe you out) and already underwater — so
                check the underwater state first rather than reading null as safe. */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 mb-3">
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                    {!Number.isFinite(stress.leverage)
                        ? t('lifecycle.safety.wipeoutUnderwater', 'Your investment debt already exceeds everything you own, so every drawdown below leaves you underwater. Reduce the debt first.')
                        : stress.wipeoutDropPct === null
                            ? t('lifecycle.safety.wipeoutSafe', 'With no net leverage, no market drop alone can wipe out your own money.')
                            : (
                                <>
                                    {t('lifecycle.safety.wipeoutPre', 'A market fall of')}{' '}
                                    <span className="font-bold text-error-700 dark:text-error-400 tabular-nums">
                                        {stress.wipeoutDropPct.toFixed(0)}%
                                    </span>{' '}
                                    {t('lifecycle.safety.wipeoutPost', 'takes your own money to zero. That is simply 1 ÷ leverage — the price of the ratio above.')}
                                </>
                            )}
                </p>
            </div>

            <DrawdownSlider stress={stress} />

            {/* Drawdown table. */}
            <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-xs min-w-[380px]">
                    <thead>
                        <tr className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-500">
                            <th className="text-left font-medium py-1.5">{t('lifecycle.safety.colDrop', 'Market drop')}</th>
                            <th className="text-right font-medium py-1.5">{t('lifecycle.safety.colYours', 'Your money left')}</th>
                            <th className="text-right font-medium py-1.5">{t('lifecycle.safety.colLoss', 'You lose')}</th>
                            <th className="text-right font-medium py-1.5">{t('lifecycle.safety.colLev', 'Leverage after')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {stress.scenarios.map((s) => (
                            <tr key={s.dropPct} className={cn(s.wipedOut && 'bg-error-50/60 dark:bg-error-900/20')}>
                                <td className="py-2 font-medium text-gray-700 dark:text-gray-200 tabular-nums">−{s.dropPct}%</td>
                                <td className={cn(
                                    'py-2 text-right font-bold tabular-nums',
                                    s.wipedOut ? 'text-error-700 dark:text-error-400' : 'text-gray-800 dark:text-gray-100',
                                )}>
                                    {s.wipedOut
                                        ? t('lifecycle.safety.wipedOut', 'wiped out')
                                        : (isValueVisible ? formatTWDCompact(s.netAfter) : '•••')}
                                </td>
                                <td className="py-2 text-right tabular-nums text-error-700 dark:text-error-400">
                                    −{Math.min(100, s.ownMoneyLossPct).toFixed(0)}%
                                </td>
                                <td className="py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                                    {s.leverageAfter === null ? '—' : `${s.leverageAfter.toFixed(2)}×`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
                {t('lifecycle.safety.note', 'Drops apply to the stock exposure only; cash and reserves are assumed intact. Leverage rises after a fall because the debt does not shrink with the market.')}
            </p>
        </Card>
    );
}
