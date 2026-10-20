'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { DebtAccount } from '@/services/loanService';
import {
    minimumsOnly,
    monthsFrom,
    payoffPlan,
    planInputs,
    type PayoffStrategy,
} from '@/lib/finance/payoffPlan';
import { formatCurrency } from '@/utils/formatters';

const PLAN = '#f43f5e'; // rose — the loans page's accent
const BASE = '#9ca3af'; // gray-400 — the do-nothing line

// Per-viewer conveniences only; the plan works without them.
const EXTRA_KEY = 'aspiro-payoff-extra';
const STRATEGY_KEY = 'aspiro-payoff-strategy';

function readStored(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}
function writeStored(key: string, value: string) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        /* private window — the plan still works for this visit */
    }
}

interface Props {
    /** Active loans; paid-off ones have nothing left to plan. */
    loans: DebtAccount[];
}

/**
 * When am I debt free, and what would extra money each month change?
 *
 * Runs entirely in the browser off each loan's balance, rate and minimum —
 * nothing is saved to the account. The baseline is minimums only; the plan
 * rolls a cleared loan's minimum into the next one and aims any extra by the
 * chosen strategy.
 */
export function PayoffPlanner({ loans }: Props) {
    const { t, i18n } = useTranslation('loans');
    const { isValueVisible } = usePrivacy();
    const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
    const [extraText, setExtraText] = useState('0');

    // Restore after mount: reading storage during render would differ from the server pass.
    useEffect(() => {
        const s = readStored(STRATEGY_KEY);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (s === 'avalanche' || s === 'snowball') setStrategy(s);
        const e = readStored(EXTRA_KEY);
        if (e && Number(e) >= 0) setExtraText(e);
    }, []);

    const extra = Math.max(0, Number(extraText) || 0);
    const { currency, loans: input, excluded } = useMemo(() => planInputs(loans), [loans]);

    const base = useMemo(() => minimumsOnly(input), [input]);
    const plan = useMemo(() => payoffPlan(input, strategy, extra), [input, strategy, extra]);

    const today = useMemo(() => new Date(), []);
    const fmt = (v: number) => (isValueVisible ? formatCurrency(v, currency, { precision: 0 }) : '••••');
    const fmtMonth = (months: number) =>
        monthsFrom(today, months).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' });
    const fmtSpan = (months: number) => {
        const y = Math.floor(months / 12);
        const m = months % 12;
        return [y ? t('planner.years', { count: y }) : '', m ? t('planner.months', { count: m }) : '']
            .filter(Boolean)
            .join(' ') || t('planner.months', { count: 0 });
    };

    const monthsSaved = plan.months !== null && base.months !== null ? base.months - plan.months : null;
    const interestSaved = base.totalInterest - plan.totalInterest;
    // Why a plan has no date: a minimum that loses to its own interest, or no
    // payment at all on a loan (zero minimum, no extra) — different fixes.
    const underwater = input.some((l) => l.balance > 0 && l.minimumPayment > 0 && l.minimumPayment <= l.balance * (l.annualRatePct / 100 / 12));

    // One point per month is fine for a few years; past 10 years, plot quarterly.
    const rows = useMemo(() => {
        const len = Math.max(plan.series.length, base.series.length);
        const step = len > 120 ? 3 : 1;
        const out: Array<{ m: number; plan: number | null; base: number | null }> = [];
        for (let i = 0; i < len; i += step) {
            out.push({ m: i, plan: plan.series[i] ?? null, base: base.series[i] ?? null });
        }
        if ((len - 1) % step !== 0) {
            out.push({ m: len - 1, plan: plan.series[len - 1] ?? null, base: base.series[len - 1] ?? null });
        }
        return out;
    }, [plan.series, base.series]);

    // Whole years only — left to itself Recharts lands on 0y/1y/3y/5y.
    const yearTicks = useMemo(() => {
        const years = Math.floor((rows[rows.length - 1]?.m ?? 0) / 12);
        // Under a year there is no whole year to label: let Recharts pick months.
        if (years < 1) return undefined;
        const step = Math.max(1, Math.ceil(years / 8));
        const out: number[] = [];
        for (let y = 0; y <= years; y += step) out.push(y * 12);
        return out;
    }, [rows]);

    if (input.length === 0) return null;

    const setStrategyStored = (s: PayoffStrategy) => {
        setStrategy(s);
        writeStored(STRATEGY_KEY, s);
    };

    return (
        <Card as="section" padding="md" accent="rose" className="animate-fade-in">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('planner.title')}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('planner.subtitle')}</p>
                </div>
                <div role="radiogroup" aria-label={t('planner.strategy')}
                    className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                    {(['avalanche', 'snowball'] as const).map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={strategy === s}
                            onClick={() => setStrategyStored(s)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
                                strategy === s
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                            {t(`planner.${s}`)}
                        </button>
                    ))}
                </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t(`planner.${strategy}Hint`)}</p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                <label className="block">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{t('planner.extra', { currency })}</span>
                    <input type="number" inputMode="numeric" min={0} step={500} value={extraText}
                        onChange={(e) => {
                            setExtraText(e.target.value);
                            writeStored(EXTRA_KEY, e.target.value);
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" />
                </label>

                <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('planner.debtFree')}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {plan.months === null ? t('planner.never') : fmtMonth(plan.months)}
                    </p>
                    {plan.months !== null && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('planner.in', { span: fmtSpan(plan.months) })}</p>
                    )}
                </div>

                <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('planner.interest')}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{fmt(plan.totalInterest)}</p>
                    {plan.months === null && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">{t('planner.interestCapped')}</p>
                    )}
                </div>

                <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('planner.vsMinimums')}</p>
                    {base.months === null && plan.months !== null ? (
                        <p className="text-sm font-semibold text-green-700 dark:text-green-400">{t('planner.minimumsNever')}</p>
                    ) : (monthsSaved ?? 0) > 0 || interestSaved >= 1 ? (
                        <>
                            <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                                {monthsSaved ? t('planner.sooner', { span: fmtSpan(monthsSaved) }) : '—'}
                            </p>
                            <p className="text-xs text-green-700 dark:text-green-300 tabular-nums">
                                {/* Neither clears: the saving only covers the 50-year window. */}
                                {t(plan.months === null ? 'planner.savesCapped' : 'planner.saves', { amount: fmt(interestSaved) })}
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('planner.sameAsMinimums')}</p>
                    )}
                </div>
            </div>

            {plan.months === null && (
                <p className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                    ⚠ {t(underwater ? 'planner.stalled' : 'planner.noPayment')}
                </p>
            )}

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 h-56" aria-label={t('planner.chartLabel')} role="img">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700" />
                            <XAxis dataKey="m" type="number" allowDecimals={false} domain={[0, 'dataMax']} ticks={yearTicks} tickFormatter={(m: number) => (yearTicks ? `${m / 12}y` : `${m}m`)}
                                tick={{ fontSize: 11 }} stroke="#9ca3af" />
                            <YAxis width={isValueVisible ? 64 : 8} tick={isValueVisible ? { fontSize: 11 } : false} stroke="#9ca3af"
                                tickFormatter={(v: number) => formatCurrency(v, currency, { precision: 0, compact: true })} />
                            <Tooltip
                                formatter={(v: number, key: string) => [fmt(v), key === 'plan' ? t('planner.plan') : t('planner.minimums')]}
                                labelFormatter={(m: number) => fmtMonth(m)} />
                            <Line type="monotone" dataKey="base" stroke={BASE} strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                            <Line type="monotone" dataKey="plan" stroke={PLAN} dot={false} strokeWidth={2.5} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{t('planner.order')}</p>
                    <ol className="space-y-2">
                        {plan.payoffOrder.map((p, i) => (
                            <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                                    <span className="text-gray-500 dark:text-gray-400 tabular-nums mr-1.5">{i + 1}.</span>{p.name}
                                </span>
                                <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{fmtMonth(p.month)}</span>
                            </li>
                        ))}
                    </ol>
                    <div className="mt-3 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: PLAN }} />{t('planner.plan')}</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed" style={{ borderColor: BASE }} />{t('planner.minimums')}</span>
                    </div>
                </div>
            </div>

            {excluded > 0 && (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('planner.excluded', { count: excluded, currency })}</p>
            )}
        </Card>
    );
}
