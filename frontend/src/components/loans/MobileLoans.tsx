'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoansSkeleton } from '@/components/loans/LoansSkeleton';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { Card } from '@/components/ui/Card';
import { AddLoanModal } from '@/components/loans/AddLoanModal';
import { RecordPaymentModal } from '@/components/loans/RecordPaymentModal';
import { UpcomingPayments } from '@/components/loans/UpcomingPayments';
import { useLoans } from '@/hooks/useLoans';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { DebtAccount } from '@/services/loanService';
import { formatCurrency } from '@/utils/formatters';
import { monthsFrom, payoffPlan, planInputs } from '@/lib/finance/payoffPlan';

const BAR = '#f43f5e'; // rose — the loans page's accent

function fmt(value: number, currency = 'TWD') {
    return formatCurrency(value, currency, { precision: 0 });
}

function fmtDate(dateStr: string | null, locale?: string) {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * Phones get one question answered: how much do I owe, and what is due next (#344).
 * Then each active loan with its progress and a Pay button — recording a payment is
 * the thing you do from a phone. Editing, deleting and paid-off history stay on the
 * full page.
 */
export function MobileLoans() {
    const { t, i18n } = useTranslation(['loans', 'dashboard']);
    const { loans, summary, isLoading } = useLoans();
    const { isValueVisible } = usePrivacy();
    const [showAdd, setShowAdd] = useState(false);
    const [paying, setPaying] = useState<DebtAccount | null>(null);

    // The planner's default (today's payments, a cleared loan's minimum rolled
    // into the next) — so this line and the desktop planner agree. Skipped when
    // loans in another currency were left out: a date that ignores some of the
    // debt in the hero above it would be wrong. Above the early return: hooks.
    const payoff = useMemo(() => {
        const active = loans.filter((l) => l.status === 'active');
        if (active.length === 0) return null;
        const { loans: input, excluded } = planInputs(active);
        if (excluded > 0) return null;
        const plan = payoffPlan(input, 'avalanche', 0);
        return {
            date: plan.months === null
                ? null
                : monthsFrom(new Date(), plan.months).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' }),
        };
    }, [loans, i18n.language]);

    if (isLoading) return <LoansSkeleton />;

    const active = loans.filter((l) => l.status === 'active');
    const hide = (s: string) => (isValueVisible ? s : '••••');
    const nextDate = fmtDate(summary?.next_payment_date ?? null, i18n.language);

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <div className="flex items-center justify-between pt-1">
                    <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('loans:title')}</h1>
                    <button type="button" onClick={() => setShowAdd(true)} aria-label={t('loans:addLoan')}
                        className="grid place-items-center w-11 h-11 rounded-full bg-primary-700 hover:bg-primary-800 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <PlusIcon className="w-5 h-5" />
                    </button>
                </div>

                <BiggerScreenHint />

                {active.length === 0 ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center space-y-3">
                        <p className="text-4xl" aria-hidden="true">🏦</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('loans:emptyState.title')}</p>
                        <button type="button" onClick={() => setShowAdd(true)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-700 hover:bg-primary-800 px-4 py-2.5 text-sm font-semibold text-white">
                            <PlusIcon className="w-4 h-4" /> {t('loans:addFirstLoan')}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* HERO — what I owe, and what is due next */}
                        <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-400">{t('loans:summary.totalDebt')}</p>
                            <p className="mt-1 text-[32px] leading-none font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">
                                {hide(fmt(summary?.total_debt ?? 0))}
                            </p>
                            <p className="mt-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">
                                {t('loans:summary.activeLoans')}: {active.length}
                            </p>
                            {payoff && (
                                <p className="mt-1 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">
                                    🏁 {payoff.date
                                        ? t('loans:planner.mobileDebtFree', { date: payoff.date })
                                        : t('loans:planner.mobileNever')}
                                </p>
                            )}
                            {summary?.next_payment_amount ? (
                                <div className="mt-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
                                    <span className="text-[12.5px] font-bold text-amber-800 dark:text-amber-200">
                                        🗓 {t('loans:summary.nextPayment')}{nextDate ? ` · ${nextDate}` : ''}
                                    </span>
                                    <span className="text-[15px] font-extrabold tabular-nums text-amber-900 dark:text-amber-100">
                                        {hide(fmt(summary.next_payment_amount))}
                                    </span>
                                </div>
                            ) : null}
                        </section>

                        {/* Every payment due in the next 30 days */}
                        <UpcomingPayments loans={active} />

                        {/* Each active loan — progress, and the one action a phone needs */}
                        <section className="space-y-2.5">
                            <p className="px-1 text-[13px] font-extrabold tracking-tight text-gray-900 dark:text-white">
                                {t('loans:sections.active', { count: active.length })}
                            </p>
                            {active.map((loan) => {
                                const p = Math.min(100, Math.max(0, loan.progress_pct ?? 0));
                                const next = fmtDate(loan.next_payment_date, i18n.language);
                                return (
                                    <Card key={loan.id} padding="sm" shadow="none">
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{loan.name}</p>
                                                <p className="text-xs font-medium text-gray-500 dark:text-gray-500 tabular-nums">
                                                    {t('loans:card.remaining', { amount: hide(fmt(loan.current_balance, loan.currency)) })}
                                                    {next ? ` · ${t('loans:card.next', { date: next })}` : ''}
                                                </p>
                                            </div>
                                            <button type="button" onClick={() => setPaying(loan)}
                                                className="flex-shrink-0 min-h-[44px] rounded-xl bg-primary-50 dark:bg-primary-900/30 px-3.5 text-[13px] font-bold text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                                                {t('loans:card.recordPayment')}
                                            </button>
                                        </div>
                                        <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden"
                                            role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}
                                            aria-label={t('loans:card.repaid', { progress: Math.round(p) })}>
                                            <div className="h-full rounded-full" style={{ width: `${p}%`, background: BAR }} />
                                        </div>
                                    </Card>
                                );
                            })}
                        </section>
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-500">
                    {t('dashboard:mobile.fullLoans', 'Edit, delete & paid-off history')}
                    <br />
                    <span className="text-primary-700 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>

            {showAdd && <AddLoanModal onClose={() => setShowAdd(false)} />}
            {paying && <RecordPaymentModal loan={paying} onClose={() => setPaying(null)} />}
        </DashboardLayout>
    );
}
