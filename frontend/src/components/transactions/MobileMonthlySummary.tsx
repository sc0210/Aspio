'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { ArrowLeftIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { businessToday } from '@/lib/portfolio/businessDate';
import { SUMMARY_BUCKETS, spendingOf, type MonthlySummaryRow, type SummaryBucketKey } from './monthlySummaryBuckets';

export type { MonthlySummaryRow as MobileMonthRow } from './monthlySummaryBuckets';

interface MobileMonthlySummaryProps {
    year: number;
    yearOptions: number[];
    onYearChange: (year: number) => void;
    months: MonthlySummaryRow[];
    income: number;
    /** Every outflow, transfer legs included, as the desktop table totals it. */
    expenses: number;
    totals: Record<SummaryBucketKey, number>;
}

/**
 * Phones get one question answered: did I keep money this year? The year's net is
 * the hero, income against spending one bar under it, then where the spending
 * went and a month list that opens to its buckets — no chart library and no
 * eight-column table that scrolls sideways.
 */
export function MobileMonthlySummary({ year, yearOptions, onYearChange, months, income, expenses, totals }: MobileMonthlySummaryProps) {
    const { t, i18n } = useTranslation(['transactions', 'dashboard']);
    const { isValueVisible } = usePrivacy();
    const hide = (s: string) => (isValueVisible ? s : '•••••');
    const label = (key: string) => t(`transactions:monthlySummaryPage.${key}`);

    // "Did I keep money" is a spending question; a move between the user's own
    // wallets gets its own line instead (see spendingOf).
    const moved = totals.transfer || 0;
    const spending = spendingOf({ total: expenses, transfer: moved });
    const net = income - spending;
    const saved = income > 0 ? (net / income) * 100 : null;
    const spentShare = income > 0 ? Math.min(100, (spending / income) * 100) : spending > 0 ? 100 : 0;
    const buckets = SUMMARY_BUCKETS.filter((b) => b.key !== 'transfer' && (totals[b.key] || 0) > 0);
    const bucketSum = buckets.reduce((s, b) => s + totals[b.key], 0);
    // The API returns all twelve months, zeros included; the months still ahead
    // would otherwise head a newest-first list as empty rows.
    const thisMonth = businessToday().slice(0, 7);
    const newestFirst = months
        .filter((m) => m.month <= thisMonth)
        .sort((a, b) => b.month.localeCompare(a.month));
    // Twelve zero months is "no data", not a year that broke even.
    const hasData = months.some((m) => (m.income || 0) !== 0 || (m.total || 0) !== 0);
    const monthName = (m: string) => {
        const [y, mo] = m.split('-').map(Number);
        return new Date(y, mo - 1, 1).toLocaleDateString(i18n.language, { month: 'long' });
    };

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <div className="flex items-center gap-2 pt-1">
                    <Link href="/transactions" aria-label={label('back')}
                        className="grid place-items-center w-11 h-11 -ml-2 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="flex-1 text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{label('title')}</h1>
                    <select
                        aria-label={t('transactions:fields.year', 'Year')}
                        value={year}
                        onChange={(e) => onYearChange(Number(e.target.value))}
                        className="h-10 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm font-bold text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>

                <BiggerScreenHint />

                {!hasData ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center space-y-2">
                        <p className="text-4xl" aria-hidden="true">📭</p>
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('transactions:monthlySummaryPage.noDataForYear', { year })}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{label('noDataHint')}</p>
                    </div>
                ) : (
                    <>
                        {/* HERO — what the year left over */}
                        <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">
                                {t('transactions:monthlySummaryPage.netRemaining', { year })}
                            </p>
                            <p className={cn('mt-1 text-[32px] leading-none font-extrabold tracking-tight tabular-nums',
                                net >= 0 ? 'text-income-700 dark:text-income-400' : 'text-expense-700 dark:text-expense-400')}>
                                {hide(formatTWD(net))}
                            </p>
                            {saved !== null && (
                                <p className="mt-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">
                                    {t('dashboard:mobile.summary.savedRate', { pct: saved.toFixed(0), defaultValue: 'Kept {{pct}}% of income' })}
                                </p>
                            )}
                            <div className="mt-4 h-2.5 rounded-full bg-income-100 dark:bg-income-900/30 overflow-hidden" role="img"
                                aria-label={`${label('expenses')} ${spentShare.toFixed(0)}%`}>
                                <div className="h-full rounded-full bg-expense-500" style={{ width: `${spentShare}%` }} />
                            </div>
                            <div className="mt-2 flex justify-between text-[12.5px] font-bold tabular-nums">
                                <span className="text-expense-700 dark:text-expense-400">{label('expenses')} {hide(formatTWD(spending))}</span>
                                <span className="text-income-700 dark:text-income-400">{label('income')} {hide(formatTWD(income))}</span>
                            </div>
                            {moved > 0 && (
                                <p className="mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    {t('transactions:monthlySummaryPage.movedBetweenWallets', {
                                        amount: hide(formatTWD(moved)),
                                        defaultValue: 'Moved between your wallets: {{amount}} (not spending)',
                                    })}
                                </p>
                            )}
                        </section>

                        {/* Where the spending went */}
                        {buckets.length > 0 && (
                            <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                                <h2 className="text-base font-extrabold text-gray-900 dark:text-white">{label('categoryBreakdown')}</h2>
                                <div className="mt-3 flex h-3 rounded-full overflow-hidden" role="img" aria-label={label('categoryBreakdown')}>
                                    {buckets.map((b) => (
                                        <div key={b.key} style={{ width: `${(totals[b.key] / bucketSum) * 100}%`, backgroundColor: b.color }} />
                                    ))}
                                </div>
                                <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                                    {buckets.map((b) => (
                                        <li key={b.key} className="min-w-0">
                                            <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                                                {label(b.name.toLowerCase())} · {((totals[b.key] / bucketSum) * 100).toFixed(0)}%
                                            </p>
                                            <p className="text-sm font-extrabold tabular-nums text-gray-900 dark:text-white truncate">
                                                {hide(formatTWD(totals[b.key]))}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Month by month, newest first; each opens to its buckets */}
                        <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm px-5 py-2">
                            <h2 className="pt-3 pb-1 text-base font-extrabold text-gray-900 dark:text-white">{label('monthlyBreakdown')}</h2>
                            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                                {newestFirst.map((m) => {
                                    const spent = spendingOf(m);
                                    const remaining = (m.income || 0) - spent;
                                    const share = m.income > 0 ? Math.min(100, (spent / m.income) * 100) : spent > 0 ? 100 : 0;
                                    return (
                                        <li key={m.month}>
                                            <details className="group">
                                                <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span className="text-sm font-bold text-gray-900 dark:text-white">{monthName(m.month)}</span>
                                                            <span className={cn('text-sm font-extrabold tabular-nums',
                                                                remaining >= 0 ? 'text-income-700 dark:text-income-400' : 'text-expense-700 dark:text-expense-400')}>
                                                                {remaining > 0 ? '+' : ''}{hide(formatTWD(remaining))}
                                                            </span>
                                                        </div>
                                                        <div className="mt-1.5 h-1.5 rounded-full bg-income-100 dark:bg-income-900/30 overflow-hidden">
                                                            <div className="h-full rounded-full bg-expense-400" style={{ width: `${share}%` }} />
                                                        </div>
                                                    </div>
                                                    <ChevronDownIcon className="w-4 h-4 shrink-0 text-gray-500 dark:text-gray-400 transition-transform group-open:rotate-180" />
                                                </summary>
                                                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 pb-3 text-[12.5px]">
                                                    <div className="col-span-2 flex justify-between font-bold">
                                                        <dt className="text-gray-500 dark:text-gray-400">{label('income')}</dt>
                                                        <dd className="tabular-nums text-income-700 dark:text-income-400">{hide(formatTWD(m.income || 0))}</dd>
                                                    </div>
                                                    {SUMMARY_BUCKETS.filter((b) => (m[b.key] || 0) > 0).map((b) => (
                                                        <div key={b.key} className="flex justify-between gap-2">
                                                            <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                                                                {label(b.name.toLowerCase())}
                                                            </dt>
                                                            <dd className="tabular-nums font-semibold text-gray-900 dark:text-white">{hide(formatTWD(m[b.key] || 0))}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                            </details>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-500">
                    {t('dashboard:mobile.fullMonthlySummary', 'Trend charts & the full table')}
                    <br />
                    <span className="text-primary-700 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
