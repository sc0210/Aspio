'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ShieldCheckIcon,
    PencilSquareIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import {
    evaluateReadiness,
    monthsToTarget,
    DEFAULT_TARGETS,
    WAN,
    type ConditionStatus,
    type ReadinessCondition,
} from '@/lib/housing';
import { Card } from '@/components/ui/Card';


export interface ReadinessSeed {
    debtBalance: number;
    liquidFunds: number;
    financialAssets: number;
    monthlyIncome: number;
    monthlyExpenses: number;
}

interface Props {
    seed: ReadinessSeed;
    /** Cash consumed at purchase (down payment + buying costs) — from the simulator. */
    cashNeededAtPurchase: number;
    /** Projected monthly housing cost after buying — from the simulator. */
    monthlyHousingCost: number;
    /** Months the income/expense seed averages over (0 = current-month fallback). */
    cashFlowBasisMonths?: number;
}

const STATUS_STYLES: Record<ConditionStatus, { bar: string; text: string; ring: string; dot: string }> = {
    clear: {
        bar: 'bg-prosperity-500',
        text: 'text-prosperity-700 dark:text-prosperity-300',
        ring: 'border-prosperity-200 dark:border-prosperity-700/50 bg-prosperity-50 dark:bg-prosperity-900/20',
        dot: '🟢',
    },
    close: {
        bar: 'bg-warning-500',
        text: 'text-warning-700 dark:text-warning-300',
        ring: 'border-warning-200 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20',
        dot: '🟡',
    },
    gap: {
        bar: 'bg-error-500',
        text: 'text-error-700 dark:text-error-300',
        ring: 'border-error-200 dark:border-error-700/50 bg-error-50 dark:bg-error-900/20',
        dot: '🔴',
    },
};

export function ReadinessScorecard({ seed, cashNeededAtPurchase, monthlyHousingCost, cashFlowBasisMonths = 0 }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    // Folded by default — only the affordability headline opens unprompted.
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [refinanced, setRefinanced] = useState(false);
    // Per-field overrides: an untouched field keeps following the live data, an
    // edited one stays pinned to what the user typed. Without a way back, a figure
    // edited once silently stopped tracking their account for the rest of the
    // session — hence `dirty` and the reset below.
    const [ov, setOv] = useState<Partial<ReadinessSeed>>({});
    const v = { ...seed, ...ov };
    // Typing the live figure back in un-pins the field rather than pinning it to a
    // value that merely matches today: otherwise it would quietly stop following the
    // account while the "edited" flag had nothing to show for it.
    //
    // `step` is the precision the field actually offers, and both sides are compared
    // at it: a 萬 field rounds a 3,000,417 balance to "300", so typing 300 back means
    // "leave it as my account has it" even though 3,000,000 is not that number.
    const setField = (k: keyof ReadinessSeed, val: number, step = 1) =>
        setOv((p) => {
            if (Math.round(val / step) === Math.round(seed[k] / step)) {
                const { [k]: _dropped, ...rest } = p;
                return rest;
            }
            return { ...p, [k]: val };
        });
    const editedFigures = Object.keys(ov).length > 0;
    const dirty = editedFigures || refinanced;
    // Reset unmounts its own button, so focus would land on <body>; hand it to the
    // adjust toggle beside it, which is always there while the card is open.
    const adjustRef = useRef<HTMLButtonElement>(null);
    const resetToLive = () => {
        setOv({});
        setRefinanced(false);
        adjustRef.current?.focus();
    };

    const readiness = useMemo(
        () => evaluateReadiness({
            debtBalance: v.debtBalance,
            refinancedLowRate: refinanced,
            liquidFunds: v.liquidFunds,
            financialAssets: v.financialAssets,
            cashNeededAtPurchase,
            monthlyIncome: v.monthlyIncome,
            monthlyExpenses: v.monthlyExpenses,
            monthlyHousingCost,
        }),
        [v.debtBalance, refinanced, v.liquidFunds, v.financialAssets, cashNeededAtPurchase, v.monthlyIncome, v.monthlyExpenses, monthlyHousingCost],
    );

    // ETA to close the liquid-funds gap at current net savings.
    const monthlySavings = Math.max(0, v.monthlyIncome - v.monthlyExpenses);
    const liquidCond = readiness.conditions.find((c) => c.key === 'liquidFunds')!;
    const eta = useMemo(
        () => monthsToTarget({ current: v.liquidFunds, target: DEFAULT_TARGETS.liquidFundsMin, monthlySavings, annualReturnPct: 6 }),
        [v.liquidFunds, monthlySavings],
    );

    const scoreColor = readiness.allClear
        ? 'text-prosperity-600 dark:text-prosperity-400'
        : readiness.score >= 60
            ? 'text-warning-600 dark:text-warning-400'
            : 'text-error-600 dark:text-error-400';

    const labelFor = (key: ReadinessCondition['key']) => ({
        debt: t('housing.ready.debt', '① Debt cleared / refinanced'),
        liquidFunds: t('housing.ready.liquid', '② Liquid funds ≥ 1,000萬'),
        buffer: t('housing.ready.buffer', '③ Buffer left after buying ≥ 400萬'),
        cashFlow: t('housing.ready.cashFlow', '④ Monthly surplus ≥ 3萬'),
    }[key]);

    return (
        <Card padding="md" clip>
            <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-3">
                <div className="h-px bg-gradient-to-r from-prosperity-400/60 via-primary-400/60 to-indigo-400/60" />
            </div>

            {/* Header — the title toggles the section; "Adjust" only shows when open
                (it cannot nest inside the toggle button). */}
            <div className={cn('flex items-center justify-between gap-2', open && 'mb-4')}>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    <h3 className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <ShieldCheckIcon className="w-4 h-4 shrink-0 text-prosperity-500" />
                        <span className="truncate">{t('housing.ready.title', 'Am I ready to buy?')}</span>
                    </h3>
                    <ChevronDownIcon className={cn('w-4 h-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
                </button>
                {open && dirty && (
                    <button
                        type="button"
                        onClick={resetToLive}
                        className="shrink-0 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-prosperity-600 dark:hover:text-prosperity-300 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <ArrowPathIcon className="w-3.5 h-3.5 shrink-0" />
                        {t('housing.ready.reset', 'Reset to my data')}
                    </button>
                )}
                {open && (
                    <button
                        type="button"
                        ref={adjustRef}
                        onClick={() => setEditing((e) => !e)}
                        aria-expanded={editing}
                        className="shrink-0 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <PencilSquareIcon className="w-3.5 h-3.5 shrink-0" />
                        {editing ? t('housing.ready.done', 'Done') : t('housing.ready.adjust', 'Adjust my numbers')}
                    </button>
                )}
            </div>

            {open && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
                {/* Score + verdict */}
                <div className="lg:col-span-1">
                    <div className={cn(
                        'rounded-xl border p-4 h-full flex flex-col items-center justify-center text-center',
                        readiness.allClear
                            ? 'border-prosperity-200 dark:border-prosperity-700/50 bg-prosperity-50 dark:bg-prosperity-900/20'
                            : 'border-gray-200 dark:border-gray-700',
                    )}>
                        <div className={cn('text-4xl font-bold tabular-nums', scoreColor)}>{readiness.score}</div>
                        <div className="text-sm text-gray-400 dark:text-gray-500 mb-2">{t('housing.ready.scoreLabel', 'readiness score')}</div>
                        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                            {t('housing.ready.metCount', '{{n}} of 4 conditions met', { n: readiness.metCount })}
                        </div>
                        {cashFlowBasisMonths > 0 && (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {t('housing.ready.basis', 'income/expense: {{n}}-mo average', { n: cashFlowBasisMonths })}
                            </p>
                        )}
                        {/* Both can be true at once, and the score reflects both. */}
                        {editedFigures && (
                            <p className="mt-1 text-xs font-medium text-warning-600 dark:text-warning-400">
                                {t('housing.ready.edited', 'using figures you edited')}
                            </p>
                        )}
                        {refinanced && (
                            <p className="mt-1 text-xs font-medium text-warning-600 dark:text-warning-400">
                                {t('housing.ready.assumingRefi', 'assuming the debt is refinanced')}
                            </p>
                        )}
                        {readiness.allClear ? (
                            <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-prosperity-100 dark:bg-prosperity-900/40 px-3 py-1 text-xs font-bold text-prosperity-700 dark:text-prosperity-300">
                                <CheckCircleIcon className="w-4 h-4" />
                                {t('housing.ready.goBanner', '可安心進場 · Ready')}
                            </div>
                        ) : readiness.biggestGap ? (
                            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                {t('housing.ready.biggestGap', 'Biggest gap:')}{' '}
                                <span className="font-semibold text-gray-700 dark:text-gray-200">
                                    {labelFor(readiness.biggestGap.key)}
                                </span>
                                {readiness.biggestGap.shortfall > 0 && (
                                    <>
                                        {' — '}
                                        <span className="text-error-600 dark:text-error-400 font-semibold">
                                            {isValueVisible ? formatTWDCompact(readiness.biggestGap.shortfall) : '•••'} {t('housing.ready.short', 'short')}
                                        </span>
                                    </>
                                )}
                            </p>
                        ) : null}

                        {/* ETA to close the liquid gap */}
                        {!liquidCond.met && (
                            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                                {eta.years !== null
                                    ? t('housing.ready.eta', 'At {{save}}/mo saved, you cross 1,000萬 in ~{{y}} yr ({{year}}).', {
                                        save: isValueVisible ? formatTWDCompact(monthlySavings) : '•••',
                                        y: eta.years,
                                        year: eta.targetYear,
                                    })
                                    : t('housing.ready.etaNone', 'Increase monthly savings to reach the liquid-funds target.')}
                            </p>
                        )}
                    </div>
                </div>

                {/* Gauges */}
                <div className="lg:col-span-2 space-y-2.5">
                    {readiness.conditions.map((c) => {
                        const s = STATUS_STYLES[c.status];
                        const showValue = c.key !== 'debt';
                        const pct = Math.round(c.progress * 100);
                        return (
                            <div key={c.key} className={cn('rounded-xl border p-3', s.ring)}>
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                                        <span aria-hidden="true">{s.dot}</span>
                                        {labelFor(c.key)}
                                    </span>
                                    <span className={cn('text-xs font-bold tabular-nums', s.text)}>
                                        {c.key === 'debt'
                                            ? (c.met
                                                ? (c.value <= 0 ? t('housing.ready.debtClear', 'cleared') : t('housing.ready.debtRefi', 'refinanced'))
                                                : `${isValueVisible ? formatTWDCompact(c.value) : '•••'} ${t('housing.ready.left', 'left')}`)
                                            : c.key === 'cashFlow'
                                                ? `${isValueVisible ? formatTWDCompact(c.value) : '•••'} / ${t('housing.ready.moShort', 'mo')}`
                                                : (isValueVisible ? formatTWDCompact(c.value) : '•••')}
                                    </span>
                                </div>
                                {showValue && (
                                    <div
                                        className="h-2 rounded-full bg-gray-200/70 dark:bg-gray-700/70 overflow-hidden"
                                        role="progressbar"
                                        aria-valuenow={Math.min(100, Math.max(0, pct))}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label={labelFor(c.key)}
                                    >
                                        <div className={cn('h-full rounded-full transition-all', s.bar)} style={{ width: `${pct}%` }} />
                                    </div>
                                )}
                                <div className="flex items-center justify-between mt-1">
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                        {c.key !== 'debt' && (
                                            <>{t('housing.ready.target', 'target')} {isValueVisible ? formatTWDCompact(c.target) : '•••'}</>
                                        )}
                                    </span>
                                    {!c.met && c.shortfall > 0 && c.key !== 'debt' && (
                                        <span className="text-xs text-error-500 font-medium">
                                            {isValueVisible ? formatTWDCompact(c.shortfall) : '•••'} {t('housing.ready.short', 'short')}
                                        </span>
                                    )}
                                    {c.met && (
                                        <span className="text-xs text-prosperity-600 dark:text-prosperity-400 font-medium">✓ {t('housing.ready.met', 'met')}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            )}

            {/* Editable seed numbers */}
            {open && editing && (
                <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <WanField label={t('housing.ready.fLiquid', 'Liquid funds (現金＋可變現)')} value={v.liquidFunds} onChange={(n) => setField('liquidFunds', n, WAN)} isValueVisible={isValueVisible} />
                    <WanField label={t('housing.ready.fAssets', 'Total financial assets')} value={v.financialAssets} onChange={(n) => setField('financialAssets', n, WAN)} isValueVisible={isValueVisible} />
                    <WanField label={t('housing.ready.fDebt', 'Personal-loan balance (信貸)')} value={v.debtBalance} onChange={(n) => setField('debtBalance', n, WAN)} isValueVisible={isValueVisible} />
                    <RawField label={t('housing.ready.fIncome', 'Monthly income')} value={v.monthlyIncome} onChange={(n) => setField('monthlyIncome', n)} isValueVisible={isValueVisible} />
                    <RawField label={t('housing.ready.fExpense', 'Monthly expenses')} value={v.monthlyExpenses} onChange={(n) => setField('monthlyExpenses', n)} isValueVisible={isValueVisible} />
                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 self-end pb-1">
                        <input type="checkbox" checked={refinanced} onChange={(e) => setRefinanced(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus-visible:ring-indigo-500 cursor-pointer" />
                        {t('housing.ready.refi', 'Debt refinanced to a low rate')}
                    </label>
                </div>
            )}
        </Card>
    );
}

function WanField({ label, value, onChange, isValueVisible }: { label: string; value: number; onChange: (n: number) => void; isValueVisible: boolean }) {
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
                        className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-indigo-500 focus-visible:outline-none px-1 py-0.5 text-sm"
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

function RawField({ label, value, onChange, isValueVisible }: { label: string; value: number; onChange: (n: number) => void; isValueVisible: boolean }) {
    return (
        <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400 block mb-0.5">{label}</label>
            {isValueVisible ? (
                <input
                    type="number" min={0} step={1000} value={Math.round(value)}
                    inputMode="decimal"
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                    className="w-full text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-indigo-500 focus-visible:outline-none px-1 py-0.5 text-sm"
                    aria-label={label}
                />
            ) : (
                <span className="w-full block text-right tabular-nums text-gray-400 dark:text-gray-500 text-sm">•••</span>
            )}
        </div>
    );
}
