'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    BanknotesIcon,
    ArrowTrendingUpIcon,
    LightBulbIcon,
    AdjustmentsHorizontalIcon,
    ArrowPathIcon,
    ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import {
    calcAffordability,
    projectAffordability,
    proportionateTargets,
    type AffordabilityInputs,
    type BindingConstraint,
} from '@/lib/housing/affordability';
import { WAN } from '@/lib/housing/readiness';
import { Card } from '@/components/ui/Card';


/** Assumed annual raise when the user opts into the career-progression view. */
const RAISE_PCT = 4;

/**
 * Default annual return on financial assets while saving toward a home.
 * Matches the simulator's investmentReturnPct so the two panels start from the
 * same assumption.
 */
const DEFAULT_RETURN_PCT = 6;

interface Props {
    /** Live figures: assets from the dashboard, cash flow from real transactions. */
    inputs: AffordabilityInputs;
    /** Months of transaction history the income/expense averages are built from. */
    cashFlowBasisMonths: number;
}

/** Copy for the constraint that is holding the ceiling down — the actionable bit. */
function useBindingCopy(binding: BindingConstraint) {
    const { t } = useTranslation('common');
    switch (binding) {
        case 'cashFlow':
            return {
                label: t('housing.afford.bindingCashFlow', 'Your monthly budget is the limit'),
                hint: t(
                    'housing.afford.bindingCashFlowHint',
                    'Saving more will not raise this number — the mortgage has to fit your monthly income. A raise, or lower fixed spending, is what moves it.',
                ),
            };
        case 'liquid':
            return {
                label: t('housing.afford.bindingLiquid', 'Cash on hand is the limit'),
                hint: t(
                    'housing.afford.bindingLiquidHint',
                    'You have the income for a larger loan, but not yet the cash for the down payment. This one is pure time and saving.',
                ),
            };
        case 'cash':
        default:
            return {
                label: t('housing.afford.bindingCash', 'Your down payment is the limit'),
                hint: t(
                    'housing.afford.bindingCashHint',
                    'Keeping a safety buffer after buying is what caps this. Every bit you save lifts it — and by more than you save.',
                ),
            };
    }
}

function WanField({
    label, value, onChange, isValueVisible,
}: { label: string; value: number; onChange: (n: number) => void; isValueVisible: boolean }) {
    const { t } = useTranslation('common');
    return (
        <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400 block mb-0.5">{label}</label>
            <div className="flex items-center gap-1">
                {isValueVisible ? (
                    <input
                        type="number" min={0} step={10} value={Math.round(value / WAN)}
                        inputMode="decimal"
                        onWheel={(e) => e.currentTarget.blur()}
                        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)) * WAN)}
                        className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-emerald-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                        aria-label={label}
                    />
                ) : (
                    <span className="w-full text-right tabular-nums text-gray-400 dark:text-gray-500 text-sm">•••</span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">{t('housing.unitWan')}</span>
            </div>
        </div>
    );
}

function RawField({
    label, value, onChange, isValueVisible,
}: { label: string; value: number; onChange: (n: number) => void; isValueVisible: boolean }) {
    return (
        <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400 block mb-0.5">{label}</label>
            {isValueVisible ? (
                <input
                    type="number" min={0} step={1000} value={Math.round(value)}
                    inputMode="decimal"
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                    className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-emerald-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                    aria-label={label}
                />
            ) : (
                <span className="w-full block text-right tabular-nums text-gray-400 dark:text-gray-500 text-sm">•••</span>
            )}
        </div>
    );
}

function Slider({
    label, value, min, max, step, suffix, onChange,
}: {
    label: string; value: number; min: number; max: number; step: number;
    suffix: string;
    /** Receives the slider's own `step`, so callers never restate it. */
    onChange: (v: number, step: number) => void;
}) {
    return (
        <div>
            <div className="flex items-baseline justify-between mb-1">
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</label>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-300 tabular-nums">
                    {value}{suffix}
                </span>
            </div>
            <input
                type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(parseFloat(e.target.value), step)}
                className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                aria-label={label}
            />
        </div>
    );
}

/**
 * Collapsible sub-section. Everything on this panel folds away except the
 * headline price, so the first thing a user sees is the single number they came
 * for — the supporting detail is there when they go looking for it.
 */
function Fold({
    title, icon, defaultOpen = false, children,
}: {
    title: string;
    icon: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {icon}
                    {title}
                </span>
                <ChevronDownIcon
                    className={cn('w-4 h-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')}
                />
            </button>
            {open && <div className="mt-2">{children}</div>}
        </div>
    );
}

/** One row of the "three ceilings, take the lowest" breakdown. */
function LimitRow({
    label, value, binds, hide, bindsLabel,
}: { label: string; value: number; binds: boolean; hide: boolean; bindsLabel: string }) {
    return (
        <div
            className={cn(
                'flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5',
                binds && 'bg-emerald-50 dark:bg-emerald-900/25',
            )}
        >
            <span className={cn(
                'text-sm leading-tight',
                binds ? 'font-semibold text-emerald-800 dark:text-emerald-200' : 'text-gray-500 dark:text-gray-400',
            )}>
                {label}
                {binds && (
                    <span className="ml-1 text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                        {bindsLabel}
                    </span>
                )}
            </span>
            <span className={cn(
                'text-xs tabular-nums shrink-0',
                binds ? 'font-bold text-emerald-700 dark:text-emerald-200' : 'text-gray-500 dark:text-gray-400',
            )}>
                {hide ? '••••' : Number.isFinite(value) ? formatTWDCompact(value) : '—'}
            </span>
        </div>
    );
}

export function AffordabilityPanel({ inputs, cashFlowBasisMonths }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();
    const [withRaises, setWithRaises] = useState(false);
    // Assets are invested, so the pot compounds while you save toward the deposit.
    // Only affects the projection — today's ceiling is measured on assets you
    // already hold.
    const [returnPct, setReturnPct] = useState(DEFAULT_RETURN_PCT);

    // Overrides are per FIELD, not a snapshot of the whole shape. Deriving the
    // effective inputs during render — rather than mirroring `inputs` into state via
    // an effect — means a dashboard refetch flows straight through while untouched,
    // and can never clobber edits in progress, with no cascading re-render.
    //
    // Per-field matters beyond tidiness: the loan terms arrive from the simulator
    // below, and a whole-object snapshot froze them the moment any unrelated field
    // was touched. Editing "monthly income" here would quietly stop the headline
    // following the mortgage rate the user was dragging — the two-answers-on-one-
    // screen bug, back through a side door.
    const [ov, setOv] = useState<Partial<AffordabilityInputs>>({});
    const draft = useMemo(() => ({ ...inputs, ...ov }), [inputs, ov]);
    const dirty = Object.keys(ov).length > 0;

    // `step` is the precision the field offers, and both sides are compared at it:
    // a 萬 field rounds a 12,000,417 balance to "1200", so typing 1200 back means
    // "leave it as my account has it" even though 12,000,000 is not that number.
    const set = <K extends keyof AffordabilityInputs>(k: K, v: AffordabilityInputs[K], step = 1) =>
        setOv((p) => {
            // Back to the live value ⇒ the field follows the page again.
            if (Math.round(Number(v) / step) === Math.round(Number(inputs[k]) / step)) {
                const { [k]: _dropped, ...rest } = p;
                return rest;
            }
            return { ...p, [k]: v };
        });
    const reset = () => setOv({});

    const today = useMemo(() => calcAffordability(draft), [draft]);
    const projection = useMemo(
        () => projectAffordability(draft, {
            annualReturnPct: returnPct,
            annualIncomeGrowthPct: withRaises ? RAISE_PCT : 0,
        }),
        [draft, withRaises, returnPct],
    );
    const targets = useMemo(
        () => proportionateTargets(draft.monthlyIncome, draft.monthlyExpenses),
        [draft.monthlyIncome, draft.monthlyExpenses],
    );

    const binding = useBindingCopy(today.binding);
    const hide = !isValueVisible;
    const money = (v: number) => (hide ? '••••' : formatTWDCompact(v));
    // The ceiling is income-driven: with no income on record it is 0 by
    // construction, which is "unknown", not "you can afford nothing".
    const noIncome = !(draft.monthlyIncome > 0);
    const bindsLabel = t('housing.afford.binds', 'sets the limit');

    // Monthly cash actually available for housing — the numerator of limit ③.
    const housingBudget = Math.max(0, draft.monthlyIncome - draft.monthlyExpenses - targets.monthlyCashFlowMin);

    const plateaus =
        !withRaises &&
        projection.milestones.length > 1 &&
        projection.milestones[projection.milestones.length - 1].maxPrice <=
            projection.milestones[Math.floor(projection.milestones.length / 2)].maxPrice + 1;

    return (
        <Card padding="md" clip>
            <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-3">
                <div className="h-px bg-gradient-to-r from-emerald-400/60 via-primary-400/60 to-indigo-400/60" />
            </div>

            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <BanknotesIcon className="w-4 h-4 text-emerald-500" />
                        {t('housing.afford.title', 'What can you afford right now?')}
                    </h3>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                        {dirty
                            ? t('housing.afford.subtitleAdjusted', 'Showing an adjusted scenario — not your live figures.')
                            : cashFlowBasisMonths > 0
                              ? t('housing.afford.subtitleReal', {
                                    defaultValue: 'From your own income and spending ({{basis}}-mo average) — not a guess.',
                                    basis: cashFlowBasisMonths,
                                })
                              : t('housing.afford.subtitleNoData', 'Add a few months of transactions to base this on your real habits.')}
                    </p>
                </div>
                {dirty && (
                    <button
                        type="button"
                        onClick={reset}
                        className="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-300 rounded-md px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <ArrowPathIcon className="w-3.5 h-3.5" />
                        {t('housing.afford.reset', 'Reset to my data')}
                    </button>
                )}
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* ── Left: the answer ─────────────────────────────────────── */}
                <div className="lg:col-span-3 space-y-3">
                    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 p-4">
                        <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                            {t('housing.afford.todayLabel', 'Comfortable price today')}
                        </div>
                        {noIncome ? (
                            // No income measured ⇒ the cash-flow ceiling is zero by
                            // construction. Say so instead of a confident NT$0.
                            <div className="mt-1" role="status">
                                <div className="text-lg font-semibold text-emerald-800 dark:text-emerald-100">
                                    {t('housing.afford.noIncomeTitle', 'Not enough income data yet')}
                                </div>
                                <p className="mt-1 text-sm leading-relaxed text-emerald-800/80 dark:text-emerald-200/70">
                                    {t('housing.afford.noIncomeHint')}
                                </p>
                            </div>
                        ) : (
                        <>
                        <div className="mt-1 text-3xl font-bold text-emerald-700 dark:text-emerald-200 tabular-nums">
                            {money(today.maxPrice)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-emerald-800/80 dark:text-emerald-200/70">
                            <span>
                                {t('housing.afford.upfront', 'Cash at closing')}:{' '}
                                <strong className="tabular-nums">{money(today.upfrontCash)}</strong>
                            </span>
                            <span>
                                {t('housing.afford.monthly', 'Monthly housing')}:{' '}
                                <strong className="tabular-nums">{money(today.monthlyHousingCost)}</strong>
                            </span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/40">
                            <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">{binding.label}</div>
                            <p className="mt-0.5 text-sm leading-relaxed text-emerald-800/80 dark:text-emerald-200/70">
                                {binding.hint}
                            </p>
                        </div>
                        </>
                        )}
                    </div>

                    {projection.priceUnlockedPerSaved > 1 && (
                        <Fold
                            title={t('housing.afford.leverageTitle', 'Why saving pays off double')}
                            icon={<LightBulbIcon className="w-3.5 h-3.5 text-amber-500" />}
                        >
                            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                                <LightBulbIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                                    {t('housing.afford.leverage', {
                                        defaultValue:
                                            'Every {{saved}} you put aside raises what you can afford by about {{unlocked}} — a down payment is leverage.',
                                        saved: hide ? '••••' : formatTWDCompact(100_000),
                                        unlocked: hide ? '••••' : formatTWDCompact(100_000 * projection.priceUnlockedPerSaved),
                                    })}
                                </p>
                            </div>
                        </Fold>
                    )}

                    <Fold
                        title={t('housing.afford.pathTitle', 'If you keep going')}
                        icon={<ArrowTrendingUpIcon className="w-3.5 h-3.5 text-indigo-500" />}
                    >
                        <label className="flex items-center gap-1.5 mb-2 text-sm text-gray-500 dark:text-gray-400 cursor-pointer w-fit">
                            <input
                                type="checkbox"
                                checked={withRaises}
                                onChange={(e) => setWithRaises(e.target.checked)}
                                className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            />
                            {t('housing.afford.withRaises', { defaultValue: 'with {{pct}}%/yr raises', pct: RAISE_PCT })}
                        </label>

                        {projection.canGrow ? (
                            <>
                                <div className="grid grid-cols-4 gap-2">
                                    {projection.milestones.map((m) => (
                                        <div key={m.year} className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-2.5 text-center">
                                            <div className="text-xs text-gray-400 dark:text-gray-500">
                                                {t('housing.afford.inYears', { defaultValue: '+{{n}}y', n: m.year })}
                                            </div>
                                            <div className="mt-0.5 text-sm font-bold text-gray-800 dark:text-gray-100 tabular-nums">
                                                {money(m.maxPrice)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {plateaus && (
                                    <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                                        {t(
                                            'housing.afford.plateauNote',
                                            'This levels off because your income — not your savings — becomes the limit. Tick the box above to see what steady raises would do.',
                                        )}
                                    </p>
                                )}
                            </>
                        ) : (
                            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                                    {t(
                                        'housing.afford.noSurplus',
                                        'Your spending currently matches or exceeds your income, so this ceiling will not rise on its own. Freeing up even a small monthly amount starts moving it — and thanks to the down-payment leverage above, it moves faster than you might expect.',
                                    )}
                                </p>
                            </div>
                        )}
                    </Fold>
                </div>

                {/* ── Right: the working, and the dials ────────────────────── */}
                {/* self-start so the box hugs its content — with both folds closed it
                    would otherwise stretch to the left column's height and read as a
                    large empty panel. */}
                <div className="lg:col-span-2 self-start rounded-xl bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 p-3.5 space-y-3">
                    <Fold
                        title={t('housing.afford.adjustTitle', 'Try a different situation')}
                        icon={<AdjustmentsHorizontalIcon className="w-3.5 h-3.5 text-emerald-500" />}
                    >
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                        {t('housing.afford.adjustHint', 'Change anything below to see how the ceiling moves.')}
                    </p>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        <RawField
                            label={t('housing.afford.fieldIncome', 'Monthly income')}
                            value={draft.monthlyIncome}
                            onChange={(v) => set('monthlyIncome', v)}
                            isValueVisible={isValueVisible}
                        />
                        <RawField
                            label={t('housing.afford.fieldExpenses', 'Monthly spending')}
                            value={draft.monthlyExpenses}
                            onChange={(v) => set('monthlyExpenses', v)}
                            isValueVisible={isValueVisible}
                        />
                        <WanField
                            label={t('housing.afford.fieldAssets', 'Financial assets')}
                            value={draft.financialAssets}
                            onChange={(v) => set('financialAssets', v, WAN)}
                            isValueVisible={isValueVisible}
                        />
                        <WanField
                            label={t('housing.afford.fieldLiquid', 'Usable cash')}
                            value={draft.liquidFunds}
                            onChange={(v) => set('liquidFunds', v, WAN)}
                            isValueVisible={isValueVisible}
                        />
                    </div>

                    {/* Sits with the asset fields above, not the loan terms below —
                        it describes what the pot does, not what the mortgage costs. */}
                    <div className="pt-2">
                        <Slider
                            label={t('housing.afford.returnPct', 'Return on financial assets')}
                            value={returnPct} min={0} max={12} step={0.5} suffix="%/yr"
                            onChange={(v) => setReturnPct(v)}
                        />
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                            {t('housing.afford.returnHint', 'Affects the projection only — today’s ceiling uses what you already hold.')}
                        </p>
                    </div>

                    <div className="space-y-2.5 pt-1 border-t border-gray-200 dark:border-gray-600">
                        <Slider
                            label={t('housing.afford.downPct', 'Down payment')}
                            value={draft.downPaymentPct} min={10} max={60} step={1} suffix="%"
                            onChange={(v, step) => set('downPaymentPct', v, step)}
                        />
                        <Slider
                            label={t('housing.afford.ratePct', 'Mortgage rate')}
                            value={draft.mortgageRatePct} min={1} max={6} step={0.05} suffix="%"
                            onChange={(v, step) => set('mortgageRatePct', v, step)}
                        />
                        <Slider
                            label={t('housing.afford.termYears', 'Loan term')}
                            value={draft.mortgageTermYears} min={10} max={40} step={1} suffix="y"
                            onChange={(v, step) => set('mortgageTermYears', v, step)}
                        />
                    </div>
                    </Fold>

                    {/* The working — three ceilings, lowest wins. */}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
                        <Fold
                            title={t('housing.afford.breakdownTitle', 'Three limits — the lowest wins')}
                            icon={<BanknotesIcon className="w-3.5 h-3.5 text-gray-400" />}
                        >
                        <div className="space-y-0.5">
                            <LimitRow
                                label={t('housing.afford.limitCash', {
                                    defaultValue: 'Down payment, keeping a {{buffer}} buffer',
                                    buffer: hide ? '••••' : formatTWDCompact(targets.bufferMin),
                                })}
                                value={today.cashCeiling}
                                binds={today.binding === 'cash'}
                                hide={hide}
                                bindsLabel={bindsLabel}
                            />
                            <LimitRow
                                label={t('housing.afford.limitLiquid', 'Cash you can actually hand over')}
                                value={today.liquidCeiling}
                                binds={today.binding === 'liquid'}
                                hide={hide}
                                bindsLabel={bindsLabel}
                            />
                            <LimitRow
                                label={t('housing.afford.limitCashFlow', {
                                    defaultValue: 'Monthly budget ({{budget}}/mo free for housing)',
                                    budget: hide ? '••••' : formatTWDCompact(housingBudget),
                                })}
                                value={today.cashFlowCeiling}
                                binds={today.binding === 'cashFlow'}
                                hide={hide}
                                bindsLabel={bindsLabel}
                            />
                        </div>
                        </Fold>
                    </div>
                </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
                {t(
                    'housing.afford.disclaimer',
                    'Assumes a safety buffer of six months of your own expenses after buying, and that you keep at least a tenth of your income spare each month. Projections hold your spending flat and are an estimate, not advice.',
                )}
            </p>
        </Card>
    );
}
