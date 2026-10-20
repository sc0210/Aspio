'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TruckIcon, ChevronDownIcon, ExclamationTriangleIcon, ClockIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { evaluateCarImpact, DEFAULT_CAR_IMPACT, WAN, type CarImpactInputs, type HouseTimelineContext } from '@/lib/housing';
import { Card } from '@/components/ui/Card';


interface Props {
    /** House-saving situation the car is measured against (from live data). */
    context: HouseTimelineContext;
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
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 tabular-nums">{value}{suffix}</span>
            </div>
            <input
                type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-11 sm:h-6 cursor-pointer accent-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                aria-label={label}
            />
            {hint && <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">{hint}</p>}
        </div>
    );
}

export function CarImpactPanel({ context }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();
    const [open, setOpen] = useState(false);
    const [car, setCar] = useState<CarImpactInputs>(DEFAULT_CAR_IMPACT);
    const set = <K extends keyof CarImpactInputs>(k: K, v: CarImpactInputs[K]) => setCar((p) => ({ ...p, [k]: v }));

    const impact = useMemo(() => evaluateCarImpact(car, context), [car, context]);
    const priceWan = Math.round(car.carPrice / WAN);

    // Headline state: reachable-with-delay / no-delay / never-reaches / base-unreachable.
    const baseYear = impact.baseline.targetYear;
    const carYear = impact.withCar.targetYear;

    return (
        <Card padding="md" clip>
            <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-3">
                <div className="h-px bg-gradient-to-r from-amber-400/60 via-primary-400/60 to-rose-400/60" />
            </div>

            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <TruckIcon className="w-4 h-4 text-amber-500" />
                    {t('housing.car.title', 'What if you buy a car first?')}
                </h3>
                <ChevronDownIcon className={cn('w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform', open && 'rotate-180')} />
            </button>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                {t('housing.car.subtitle', 'See how many years a car — and its loan — pushes back your house.')}
            </p>

            {open && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 mt-4">
                    {/* LEFT: headline + impact (2/3) */}
                    <div className="lg:col-span-2 space-y-3">
                        {/* Headline */}
                        <div className={cn(
                            'rounded-xl border p-4',
                            impact.neverReaches
                                ? 'border-error-200 dark:border-error-700/50 bg-error-50 dark:bg-error-900/20'
                                : impact.delayMonths && impact.delayMonths > 0
                                    ? 'border-warning-200 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20'
                                    : 'border-prosperity-200 dark:border-prosperity-700/50 bg-prosperity-50 dark:bg-prosperity-900/20',
                        )}>
                            {impact.baseline.months === null ? (
                                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                                    <ExclamationTriangleIcon className="w-4 h-4 text-error-500 flex-shrink-0" />
                                    {t('housing.car.baseUnreachable', 'Improve your cash flow first to estimate a house timeline.')}
                                </p>
                            ) : impact.neverReaches ? (
                                <p className="text-sm font-semibold text-error-700 dark:text-error-300 flex items-center gap-1.5">
                                    <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
                                    {t('housing.car.neverReach', 'With this car, the house target is out of reach at your current savings.')}
                                </p>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2">
                                        <ClockIcon className={cn('w-5 h-5 flex-shrink-0', impact.delayMonths && impact.delayMonths > 0 ? 'text-warning-700 dark:text-warning-400' : 'text-prosperity-700 dark:text-prosperity-400')} />
                                        <span className={cn('text-lg sm:text-xl font-bold', impact.delayMonths && impact.delayMonths > 0 ? 'text-warning-700 dark:text-warning-300' : 'text-prosperity-700 dark:text-prosperity-300')}>
                                            {impact.delayMonths && impact.delayMonths > 0
                                                ? t('housing.car.delayHeadline', 'Delays your house by ~{{y}} yr', { y: impact.delayYears })
                                                : t('housing.car.noDelay', 'No delay to your house timeline')}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1.5">
                                        {t('housing.car.delayDetail', 'House-ready {{from}} → {{to}}', { from: baseYear, to: carYear })}
                                    </p>
                                </>
                            )}
                        </div>

                        {/* Before / after chips */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-0.5">{t('housing.car.withoutCar', 'Without car')}</p>
                                <p className="text-base font-bold text-prosperity-700 dark:text-prosperity-400 tabular-nums">
                                    {baseYear ?? '—'}
                                </p>
                            </div>
                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-0.5">{t('housing.car.withCar', 'With car')}</p>
                                <p className="text-base font-bold text-warning-700 dark:text-warning-400 tabular-nums">
                                    {carYear ?? t('housing.car.never', 'never')}
                                </p>
                            </div>
                        </div>

                        {/* Impact stats */}
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <Stat label={t('housing.car.burden', 'Cost / mo (loan+run)')} value={isValueVisible ? formatTWDCompact(impact.monthlyBurden) : '•••'} tone="warn" />
                            <Stat label={t('housing.car.liquidAfter', 'Liquid after car')} value={isValueVisible ? formatTWDCompact(impact.liquidAfterCar) : '•••'} />
                            <Stat label={t('housing.car.savingsAfter', 'Surplus during loan')} value={isValueVisible ? formatTWDCompact(impact.savingsAfterCar) : '•••'} tone={impact.savingsAfterCar < 0 ? 'bad' : undefined} />
                            <Stat label={t('housing.car.debtAfter', 'Debt after car')} value={isValueVisible ? formatTWDCompact(impact.debtAfterCar) : '•••'} tone="warn" />
                        </div>

                        <p className="text-sm text-gray-500 dark:text-gray-500">
                            {t('housing.car.valueAtEnd', 'A depreciating asset — worth about {{amount}} after {{n}} years (not counted toward house liquidity).', {
                                amount: isValueVisible ? formatTWDCompact(impact.carValueAtLoanEnd) : '•••',
                                n: car.loanTermYears,
                            })}
                        </p>
                    </div>

                    {/* RIGHT: inputs (1/3) */}
                    <div className="lg:col-span-1">
                        <div className="h-full rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-4">
                            <div>
                                <div className="flex items-baseline justify-between mb-1">
                                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('housing.car.carPrice', 'Car price')}</label>
                                    <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">{priceWan.toLocaleString()} {t('housing.unitWan')}</span>
                                </div>
                                <input
                                    type="number" min={0} step={5} value={priceWan}
                                    inputMode="decimal"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => set('carPrice', Math.max(0, Math.round(Number(e.target.value) || 0)) * WAN)}
                                    className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-amber-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                                    aria-label={t('housing.car.carPrice', 'Car price')}
                                />
                            </div>
                            <Slider label={t('housing.car.down', 'Down payment')} value={car.downPaymentPct} min={0} max={100} step={5} suffix="%" onChange={(v) => set('downPaymentPct', v)} />
                            <Slider label={t('housing.car.rate', 'Car-loan rate')} value={car.loanRatePct} min={0} max={10} step={0.1} suffix="%" onChange={(v) => set('loanRatePct', v)} />
                            <Slider label={t('housing.car.term', 'Loan term')} value={car.loanTermYears} min={1} max={8} step={1} suffix={t('housing.car.yearShort', 'y')} onChange={(v) => set('loanTermYears', v)} />
                            <Slider label={t('housing.car.depreciation', 'Depreciation / yr')} value={car.depreciationPct} min={0} max={25} step={1} suffix="%" onChange={(v) => set('depreciationPct', v)} />
                            <div>
                                <div className="flex items-baseline justify-between mb-1">
                                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('housing.car.running', 'Running cost / mo')}</label>
                                    <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">{isValueVisible ? formatTWD(car.monthlyRunningCost) : '•••'}</span>
                                </div>
                                <input
                                    type="number" min={0} step={1000} value={car.monthlyRunningCost}
                                    inputMode="decimal"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => set('monthlyRunningCost', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                                    className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-amber-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                                    aria-label={t('housing.car.running', 'Running cost / mo')}
                                />
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">{t('housing.car.runningHint', 'insurance, fuel, upkeep, parking')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
    return (
        <div>
            <p className={cn(
                'text-sm sm:text-base font-bold tabular-nums',
                tone === 'bad' ? 'text-error-700 dark:text-error-400' : tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white',
            )}>{value}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-tight mt-0.5">{label}</p>
        </div>
    );
}
