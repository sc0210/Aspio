'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChartBarSquareIcon,
    AdjustmentsHorizontalIcon,
    FlagIcon,
    ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { projectGlidepath, type GlidepathInputs } from '@/lib/lifecycle';
import type { LifecyclePreferences } from '@/hooks/useLifecyclePreferences';
import { GlidepathChart } from './GlidepathChart';

import { LIFECYCLE_CHART_COLORS as COLORS } from './chartColors';
import { Card } from '@/components/ui/Card';

export interface GlidepathSeed {
    stockExposure: number;
    cashAssets: number;
    debtBalance: number;
    debtAnnualRatePct: number;
    debtMonthlyPayment: number;
    monthlySavings: number;
    currentAge: number;
}

interface Props {
    seed: GlidepathSeed;
    preferences: LifecyclePreferences;
    onPreferenceChange: <K extends keyof LifecyclePreferences>(key: K, value: LifecyclePreferences[K]) => void;
}

function Slider({
    label, value, min, max, step, suffix, onChange, hint,
}: {
    label: string; value: number; min: number; max: number; step: number;
    suffix: string; onChange: (v: number) => void; hint?: string;
}) {
    return (
        <div>
            <div className="flex items-baseline justify-between mb-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-300 tabular-nums">
                    {value}{suffix}
                </span>
            </div>
            <input
                type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-11 sm:h-6 cursor-pointer accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                aria-label={label}
            />
            {hint && <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">{hint}</p>}
        </div>
    );
}

/**
 * The glidepath — and the milestone the whole strategy is actually working
 * toward: the **crossover**, the year savings have grown enough that leverage
 * falls to 1× on its own and you stop being a borrower.
 *
 * That date, not a return figure, is the honest progress bar for lifecycle
 * investing. It moves when you save more, and it barely moves when the market
 * has a good quarter.
 */
export function GlidepathPanel({ seed, preferences, onPreferenceChange }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();
    const [showAssumptions, setShowAssumptions] = useState(false);

    const inputs: GlidepathInputs = useMemo(
        () => ({
            currentAge: seed.currentAge,
            retirementAge: preferences.retirementAge,
            stockExposure: seed.stockExposure,
            cashAssets: seed.cashAssets,
            debtBalance: seed.debtBalance,
            debtAnnualRatePct: seed.debtAnnualRatePct,
            debtMonthlyPayment: seed.debtMonthlyPayment,
            monthlySavings: seed.monthlySavings,
            investedSharePct: preferences.investedSharePct,
            expectedReturnPct: preferences.expectedReturnPct,
            samuelsonSharePct: preferences.samuelsonSharePct,
            discountRatePct: preferences.discountRatePct,
            savingsGrowthPct: preferences.savingsGrowthPct,
            maxLeverage: preferences.maxLeverage,
        }),
        [seed, preferences],
    );

    const path = useMemo(() => projectGlidepath(inputs), [inputs]);

    return (
        <Card padding="md">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <ChartBarSquareIcon className="w-4 h-4 text-indigo-500" />
                        {t('lifecycle.glide.title', 'The glidepath')}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                        {t('lifecycle.glide.subtitle', 'Target leverage falls on its own as savings accumulate. Your job is to follow it down, not to predict the market.')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setShowAssumptions((s) => !s)}
                    aria-expanded={showAssumptions}
                    className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 shrink-0"
                >
                    <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                    {t('lifecycle.glide.assumptions', 'Assumptions')}
                    <ChevronDownIcon className={cn('w-3.5 h-3.5 transition-transform', showAssumptions && 'rotate-180')} />
                </button>
            </div>

            {/* The milestone. */}
            <div className={cn(
                'mt-4 rounded-xl border p-3.5',
                path.crossoverYear !== null
                    ? 'border-prosperity-200 dark:border-prosperity-700/50 bg-prosperity-50 dark:bg-prosperity-900/20'
                    : 'border-gray-200 dark:border-gray-700',
            )}>
                <div className="flex items-start gap-2.5">
                    <FlagIcon className={cn(
                        'w-5 h-5 shrink-0 mt-0.5',
                        path.crossoverYear !== null ? 'text-prosperity-700' : 'text-gray-500 dark:text-gray-400',
                    )} />
                    <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 dark:text-gray-100">
                            {path.crossoverYear === null
                                ? t('lifecycle.glide.noCrossover', 'No crossover before retirement')
                                : path.crossoverYear === 0
                                    ? t('lifecycle.glide.crossedAlready', 'You are no longer a net borrower')
                                    : t('lifecycle.glide.crossover', 'Leverage reaches 1× in ~{{y}} years, at age {{age}}', {
                                        y: path.crossoverYear,
                                        age: path.crossoverAge,
                                    })}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                            {path.crossoverYear === null
                                ? t('lifecycle.glide.noCrossoverHint', 'At these savings the debt never stops outweighing your own money. Raise savings or lower the target share.')
                                : t('lifecycle.glide.crossoverHint', 'That is the milestone worth tracking — it moves when you save more, and barely moves when the market has a good quarter.')}
                        </p>
                        {/* Only meaningful when there was debt to repay — otherwise
                            it reads "repaid in 0 years" at someone who never borrowed. */}
                        {path.debtFreeYear !== null && seed.debtBalance > 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {t('lifecycle.glide.debtFree', 'Loans fully repaid in {{y}} years (age {{age}}) · {{interest}} interest still ahead', {
                                    y: path.debtFreeYear,
                                    age: path.debtFreeAge,
                                    interest: isValueVisible ? formatTWDCompact(path.interestAhead) : '•••',
                                })}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {showAssumptions && (
                <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Slider
                        label={t('lifecycle.glide.share', 'Target share of lifetime wealth in stocks')}
                        value={preferences.samuelsonSharePct}
                        min={30} max={100} step={1} suffix="%"
                        onChange={(v) => onPreferenceChange('samuelsonSharePct', v)}
                        hint={t('lifecycle.glide.shareHint', "The book's own default is 83%; most people who run this for real sit between 50% and 67%.")}
                    />
                    <Slider
                        label={t('lifecycle.glide.maxLev', 'Leverage ceiling')}
                        value={preferences.maxLeverage}
                        min={1} max={2} step={0.1} suffix="×"
                        onChange={(v) => onPreferenceChange('maxLeverage', v)}
                        hint={t('lifecycle.glide.maxLevHint', 'Never above 2:1 — the book is explicit about this.')}
                    />
                    <Slider
                        label={t('lifecycle.glide.return', 'Expected annual return')}
                        value={preferences.expectedReturnPct}
                        min={0} max={12} step={0.5} suffix="%"
                        onChange={(v) => onPreferenceChange('expectedReturnPct', v)}
                    />
                    <Slider
                        label={t('lifecycle.glide.invested', 'Share of savings invested')}
                        value={preferences.investedSharePct}
                        min={0} max={100} step={5} suffix="%"
                        onChange={(v) => onPreferenceChange('investedSharePct', v)}
                    />
                    <Slider
                        label={t('lifecycle.glide.discount', 'Discount rate on future savings')}
                        value={preferences.discountRatePct}
                        min={0} max={10} step={0.5} suffix="%"
                        onChange={(v) => onPreferenceChange('discountRatePct', v)}
                        hint={t('lifecycle.glide.discountHint', 'A modest real rate — not the equity return. Higher discounting shrinks the target.')}
                    />
                    <Slider
                        label={t('lifecycle.glide.savingsGrowth', 'Annual growth in your savings')}
                        value={preferences.savingsGrowthPct}
                        min={0} max={8} step={0.5} suffix="%"
                        onChange={(v) => onPreferenceChange('savingsGrowthPct', v)}
                    />
                    <Slider
                        label={t('lifecycle.glide.retireAge', 'Retirement age')}
                        value={preferences.retirementAge}
                        min={45} max={80} step={1} suffix=""
                        onChange={(v) => onPreferenceChange('retirementAge', v)}
                    />
                    <Slider
                        label={t('lifecycle.glide.birthYear', 'Birth year')}
                        value={preferences.birthYear}
                        min={1950} max={new Date().getFullYear() - 18} step={1} suffix=""
                        onChange={(v) => onPreferenceChange('birthYear', v)}
                        hint={t('lifecycle.glide.ageNow', 'Age now: {{n}}', { n: seed.currentAge })}
                    />
                </div>
            )}

            <div className="mt-4">
                <GlidepathChart
                    data={path.points}
                    colors={COLORS}
                    crossoverAge={path.crossoverAge}
                    maxLeverage={preferences.maxLeverage}
                    labels={{
                        actual: t('lifecycle.glide.actual', 'Your leverage'),
                        target: t('lifecycle.glide.targetLine', 'Target'),
                        ceiling: t('lifecycle.glide.ceiling', 'ceiling'),
                        ageAxis: t('lifecycle.glide.age', 'Age'),
                        crossover: t('lifecycle.glide.crossoverShort', 'crossover'),
                        noDebt: t('lifecycle.glide.noDebtLine', 'no debt'),
                    }}
                />
            </div>

            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
                {t('lifecycle.glide.note', 'A projection, not a forecast: it assumes a steady return and that you keep saving. Loan repayments already sit in your recorded expenses, so the payment is added back to savings the month the loan clears.')}
            </p>
        </Card>
    );
}
