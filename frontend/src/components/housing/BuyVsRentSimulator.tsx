'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dynamic from 'next/dynamic';
import {
    HomeModernIcon,
    BuildingOffice2Icon,
    AdjustmentsHorizontalIcon,
    ArrowPathIcon,
    InformationCircleIcon,
    ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { projectBuyVsRent, loanTermsOf, DEFAULT_BUY_VS_RENT, WAN, type BuyVsRentInputs, type LoanTerms } from '@/lib/housing';
import { Card } from '@/components/ui/Card';
import { ScenarioCompare } from './ScenarioCompare';

// Recharts loads with the chart, not with the page.
const BuyVsRentChart = dynamic(
    () => import('./BuyVsRentChart').then(m => ({ default: m.BuyVsRentChart })),
    { ssr: false, loading: () => <div aria-hidden="true" className="h-56 sm:h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700/40" /> },
);

const COLORS = { buy: '#6366f1', rent: '#f59e0b' }; // indigo-500 / amber-500 — CVD-safe pair

export interface SimulatorDerived {
    housePrice: number;
    upfrontCash: number;
    monthlyPayment: number;
    monthlyHousingCost: number;
    /** The borrowing terms these figures were produced with, so the affordability
     *  ceiling is priced on the same mortgage the user is looking at. */
    terms: LoanTerms;
}

interface Props {
    /** Seed defaults (e.g. from the user's real rent / target price). */
    defaults?: Partial<BuyVsRentInputs>;
    /** Fires whenever the derived cash figures change, so readiness stays in sync. */
    onDerivedChange?: (d: SimulatorDerived) => void;
}

const BASE_DEFAULTS = DEFAULT_BUY_VS_RENT;

const TERMS = [20, 30, 40] as const;

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

export function BuyVsRentSimulator({ defaults, onDerivedChange }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    const [inputs, setInputs] = useState<BuyVsRentInputs>({ ...BASE_DEFAULTS, ...defaults });
    // Folded by default — only the affordability headline opens unprompted.
    const [open, setOpen] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const set = <K extends keyof BuyVsRentInputs>(k: K, v: BuyVsRentInputs[K]) =>
        setInputs((prev) => ({ ...prev, [k]: v }));

    const result = useMemo(() => projectBuyVsRent(inputs), [inputs]);

    // Ownership cost at year 0 + mortgage payment = the monthly housing burden the
    // readiness card scores against.
    const monthlyHousingCost = result.monthlyPayment + (inputs.housePrice * inputs.ownershipCostPctPerYear) / 100 / 12;

    const {
        downPaymentPct, buyingCostPct, ownershipCostPctPerYear, mortgageRatePct, mortgageTermYears,
    } = inputs;

    useEffect(() => {
        onDerivedChange?.({
            housePrice: inputs.housePrice,
            upfrontCash: result.upfrontCash,
            monthlyPayment: result.monthlyPayment,
            monthlyHousingCost,
            terms: loanTermsOf(inputs),
        });
    }, [
        inputs.housePrice, result.upfrontCash, result.monthlyPayment, monthlyHousingCost,
        downPaymentPct, buyingCostPct, ownershipCostPctPerYear, mortgageRatePct, mortgageTermYears,
        onDerivedChange,
    ]);

    const reset = () => setInputs({ ...BASE_DEFAULTS, ...defaults });

    const buyWins = result.finalAdvantage >= 0;
    const priceWan = Math.round(inputs.housePrice / WAN);

    // First-year rent vs buyer monthly cost for the outflow row.
    const rentY1 = result.points[0]?.rentMonthlyCost ?? inputs.monthlyRent;
    const buyMoNow = result.points[0]?.buyMonthlyCost ?? result.monthlyPayment;

    return (
        <Card padding="md" clip>
            <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-3">
                <div className="h-px bg-gradient-to-r from-indigo-400/60 via-primary-400/60 to-amber-400/60" />
            </div>

            {/* Header — the title toggles the section; "Reset" only shows when open
                (it cannot nest inside the toggle button). */}
            <div className={cn('flex items-center justify-between gap-2', open && 'mb-4')}>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <HomeModernIcon className="w-4 h-4 text-indigo-500" />
                        {t('housing.sim.title', 'Buy vs. Rent')}
                    </h3>
                    <ChevronDownIcon className={cn('w-4 h-4 shrink-0 text-gray-500 dark:text-gray-400 transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                    <button
                        type="button"
                        onClick={reset}
                        className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <ArrowPathIcon className="w-3.5 h-3.5" />
                        {t('housing.sim.reset', 'Reset')}
                    </button>
                )}
            </div>

            {open && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
                {/* LEFT: chart + headline (2/3) */}
                <div className="lg:col-span-2 flex flex-col min-w-0">
                    {/* Headline */}
                    <div className="flex flex-wrap items-end gap-x-3 gap-y-1 mb-1">
                        <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">
                            {t('housing.sim.after', 'After {{n}} years', { n: inputs.holdingYears })}
                        </span>
                        <span className={cn('text-xl sm:text-2xl font-bold tabular-nums', buyWins ? 'text-indigo-600 dark:text-indigo-300' : 'text-amber-700 dark:text-amber-400')}>
                            {buyWins ? t('housing.sim.buyingWins', 'Buying wins') : t('housing.sim.rentingWins', 'Renting wins')}
                        </span>
                        <span className={cn(
                            'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
                            buyWins
                                ? 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300'
                                : 'bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300',
                        )}>
                            {t('housing.sim.by', 'by {{amount}}', { amount: isValueVisible ? formatTWDCompact(Math.abs(result.finalAdvantage)) : '•••' })}
                        </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-500 mb-2">
                        {result.breakEvenYear !== null
                            ? t('housing.sim.breakEvenLine', 'Buying overtakes renting in year {{y}}.', { y: result.breakEvenYear })
                            : t('housing.sim.noBreakEven', 'Renting stays ahead for the whole period.')}
                    </p>

                    {/* Legend */}
                    <div className="flex items-center gap-4 text-xs mb-1">
                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                            <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: COLORS.buy }} />
                            {t('housing.sim.buy', 'Buy')}
                        </span>
                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                            <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: COLORS.rent }} />
                            {t('housing.sim.rentInvest', 'Rent + invest')}
                        </span>
                    </div>

                    <BuyVsRentChart
                        data={result.yearlyPoints}
                        colors={COLORS}
                        breakEvenYear={result.breakEvenYear}
                        isValueVisible={isValueVisible}
                        labels={{
                            buy: t('housing.sim.buy', 'Buy'),
                            rent: t('housing.sim.rentInvest', 'Rent + invest'),
                            yearAxis: t('housing.sim.year', 'Year'),
                            breakEven: t('housing.sim.breakEven', 'Break-even'),
                            yearWord: t('housing.sim.yearShort', 'Y'),
                        }}
                    />
                    <p className="text-center text-sm text-gray-500 dark:text-gray-500 mt-1">
                        {t('housing.sim.xAxis', 'Years from today · net worth if liquidated')}
                    </p>

                    {/* Report card */}
                    <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                        <Stat label={t('housing.sim.upfront', 'Cash at closing')} value={isValueVisible ? formatTWDCompact(result.upfrontCash) : '•••'} />
                        <Stat label={t('housing.sim.monthlyPay', 'Mortgage / mo')} value={isValueVisible ? formatTWDCompact(result.monthlyPayment) : '•••'} />
                        <Stat label={t('housing.sim.interestPaid', 'Interest paid')} value={isValueVisible ? formatTWDCompact(result.interestPaidOverHold) : '•••'} tone="warn" />
                        <Stat label={t('housing.sim.rentPaid', 'Rent paid')} value={isValueVisible ? formatTWDCompact(result.rentPaidOverHold) : '•••'} tone="warn" />
                    </div>

                    {/* Monthly outflow comparison, year 1 */}
                    <div className="mt-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                            {t('housing.sim.monthlyOutflow', 'Monthly housing cost — year 1')}
                        </p>
                        <OutflowBar label={t('housing.sim.buy', 'Buy')} value={buyMoNow} max={Math.max(buyMoNow, rentY1)} color={COLORS.buy} isValueVisible={isValueVisible} />
                        <OutflowBar label={t('housing.sim.rent', 'Rent')} value={rentY1} max={Math.max(buyMoNow, rentY1)} color={COLORS.rent} isValueVisible={isValueVisible} />
                    </div>
                </div>

                {/* RIGHT: controls (1/3) */}
                <div className="lg:col-span-1">
                    <div className="h-full rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-4">
                        {/* House price */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1">
                                    <BuildingOffice2Icon className="w-3.5 h-3.5" />
                                    {t('housing.sim.housePrice', 'House price')}
                                </label>
                                <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">{priceWan.toLocaleString()} {t('housing.unitWan')}</span>
                            </div>
                            <input
                                type="number" min={0} step={50} value={priceWan}
                                inputMode="decimal"
                                onWheel={(e) => e.currentTarget.blur()}
                                onChange={(e) => set('housePrice', Math.max(0, Math.round(Number(e.target.value) || 0)) * WAN)}
                                className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-indigo-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                                aria-label={t('housing.sim.housePrice', 'House price')}
                            />
                        </div>

                        <Slider label={t('housing.sim.downPct', 'Down payment')} value={inputs.downPaymentPct} min={10} max={60} step={5} suffix="%" onChange={(v) => set('downPaymentPct', v)} hint={t('housing.sim.downHint', 'of price')} />
                        <Slider label={t('housing.sim.rate', 'Mortgage rate')} value={inputs.mortgageRatePct} min={1} max={6} step={0.05} suffix="%" onChange={(v) => set('mortgageRatePct', v)} />

                        {/* Term */}
                        <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('housing.sim.term', 'Loan term')}</label>
                            <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700/60 p-0.5 w-full">
                                {TERMS.map((yr) => (
                                    <button
                                        key={yr}
                                        type="button"
                                        onClick={() => set('mortgageTermYears', yr)}
                                        aria-pressed={inputs.mortgageTermYears === yr}
                                        className={cn(
                                            'flex-1 px-2 py-1 text-xs font-semibold rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                            inputs.mortgageTermYears === yr
                                                ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 shadow-sm'
                                                : 'text-gray-500 dark:text-gray-400',
                                        )}
                                    >
                                        {yr}{t('housing.sim.yearShort', 'y')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Monthly rent */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('housing.sim.rent', 'Rent')} / {t('housing.sim.moShort', 'mo')}</label>
                                <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">{isValueVisible ? formatTWD(inputs.monthlyRent) : '•••'}</span>
                            </div>
                            <input
                                type="number" min={0} step={1000} value={inputs.monthlyRent}
                                inputMode="decimal"
                                onWheel={(e) => e.currentTarget.blur()}
                                onChange={(e) => set('monthlyRent', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                                className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-indigo-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                                aria-label={t('housing.sim.rent', 'Rent')}
                            />
                        </div>

                        <Slider label={t('housing.sim.return', 'Investment return')} value={inputs.investmentReturnPct} min={0} max={12} step={0.5} suffix="%" onChange={(v) => set('investmentReturnPct', v)} hint={t('housing.sim.returnHint', 'if you invest instead')} />
                        <Slider label={t('housing.sim.appreciation', 'Home appreciation')} value={inputs.appreciationPct} min={-2} max={6} step={0.5} suffix="%" onChange={(v) => set('appreciationPct', v)} />
                        <Slider label={t('housing.sim.holding', 'Years you stay')} value={inputs.holdingYears} min={3} max={30} step={1} suffix={t('housing.sim.yearShort', 'y')} onChange={(v) => set('holdingYears', v)} />

                        {/* Advanced */}
                        <button
                            type="button"
                            onClick={() => setShowAdvanced((s) => !s)}
                            aria-expanded={showAdvanced}
                            className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                        >
                            <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                            {showAdvanced ? t('housing.sim.hideAdvanced', 'Hide advanced') : t('housing.sim.showAdvanced', 'Advanced')}
                        </button>
                        {showAdvanced && (
                            <div className="space-y-4 pt-1">
                                <Slider label={t('housing.sim.rentGrowth', 'Rent growth')} value={inputs.rentGrowthPct} min={0} max={6} step={0.5} suffix="%" onChange={(v) => set('rentGrowthPct', v)} />
                                <Slider label={t('housing.sim.buyingCost', 'Buying costs')} value={inputs.buyingCostPct} min={0} max={8} step={0.5} suffix="%" onChange={(v) => set('buyingCostPct', v)} hint={t('housing.sim.buyingCostHint', 'tax, agent, deed')} />
                                <Slider label={t('housing.sim.sellingCost', 'Selling costs')} value={inputs.sellingCostPct} min={0} max={8} step={0.5} suffix="%" onChange={(v) => set('sellingCostPct', v)} />
                                <Slider label={t('housing.sim.ownership', 'Ownership cost / yr')} value={inputs.ownershipCostPctPerYear} min={0} max={3} step={0.25} suffix="%" onChange={(v) => set('ownershipCostPctPerYear', v)} hint={t('housing.sim.ownershipHint', 'tax, fees, upkeep')} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
            )}

            {open && <ScenarioCompare current={inputs} onLoad={(next) => setInputs({ ...next })} />}

            {/* Disclaimer */}
            {open && (
                <div className="mt-4 flex items-start gap-1.5 text-sm text-gray-500 dark:text-gray-500">
                    <InformationCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    <p>{t('housing.sim.disclaimer', 'A model, not advice. It assumes steady returns and rents; real markets vary. Net worth is measured as if you sold today (selling costs deducted).')}</p>
                </div>
            )}
        </Card>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
    return (
        <div>
            <p className={cn('text-sm sm:text-base font-bold tabular-nums', tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white')}>{value}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-tight mt-0.5">{label}</p>
        </div>
    );
}

function OutflowBar({ label, value, max, color, isValueVisible }: { label: string; value: number; max: number; color: string; isValueVisible: boolean }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return (
        <div className="flex items-center gap-2 mb-1.5 last:mb-0">
            <span className="text-sm text-gray-500 dark:text-gray-400 w-9 flex-shrink-0">{label}</span>
            <div className="flex-1 h-4 rounded-full bg-gray-100 dark:bg-gray-700/60 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            {/* min-width rather than a fixed w-16: the compact format carries a
                unit suffix ("NT$8.6 萬"), which overflows 4rem and wrapped the
                萬 onto its own line. The minimum keeps both rows' bars ending
                at the same x for values of the usual magnitude, and nowrap
                keeps a larger one on one line instead of breaking it. */}
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 tabular-nums min-w-[5rem] text-right flex-shrink-0 whitespace-nowrap">
                {isValueVisible ? formatTWDCompact(value) : '•••'}
            </span>
        </div>
    );
}
