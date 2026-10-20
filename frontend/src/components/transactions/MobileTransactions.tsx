'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { CameraIcon, PlusIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { useTransactions } from '@/hooks/useTransactions';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { getCategoryIcon } from '@/utils/categoryIcon';
import { formatTWD, formatTWDCompact, toTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { Transaction } from '@/shared/types';
import { Card } from '@/components/ui/Card';
import { isWalletTransfer } from '@/utils/expenseGroups';
import { useEditHref } from '@/lib/transactions/returnTo';


function startOfMonth(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
}

export function MobileTransactions() {
    // Edit links carry the list view they were opened from, so saving comes back to it.
    const editHref = useEditHref();
    const { t, i18n } = useTranslation(['transactions', 'dashboard', 'common']);
    const { transactions, isLoading } = useTransactions();
    const { isValueVisible } = usePrivacy();

    const rows = (transactions ?? []) as Transaction[];

    const model = useMemo(() => {
        const monthStart = startOfMonth();
        let income = 0;
        let expense = 0;
        for (const tx of rows) {
            // Not `type === 'transfer'`: create_transfer writes the two legs as an
            // ordinary expense and income, so that test never matched and a wallet
            // top-up counted as both earning and spending on this hero.
            if (isWalletTransfer(tx)) continue;
            const d = typeof tx.date === 'string' ? new Date(tx.date) : tx.date;
            if (!(d >= monthStart)) continue;
            const twd = toTWD(tx.amount || 0, tx.currency || 'TWD');
            if (tx.type === 'income') income += twd;
            else if (tx.type === 'expense') expense += twd;
        }
        const net = income - expense;
        const total = income + expense;
        const expenseShare = total > 0 ? (expense / total) * 100 : 0;

        // Most-recent first, grouped by day for a scannable list.
        const sorted = [...rows].sort((a, b) => {
            const da = new Date(typeof a.date === 'string' ? a.date : a.date).getTime();
            const db = new Date(typeof b.date === 'string' ? b.date : b.date).getTime();
            return db - da;
        });
        const groups = new Map<string, Transaction[]>();
        for (const tx of sorted.slice(0, 40)) {
            const d = typeof tx.date === 'string' ? new Date(tx.date) : tx.date;
            const key = d.toISOString().slice(0, 10);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(tx);
        }
        return { income, expense, net, expenseShare, groups: Array.from(groups.entries()) };
    }, [rows]);

    if (isLoading && rows.length === 0) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner size="lg" /></div>
            </DashboardLayout>
        );
    }

    const netUp = model.net >= 0;
    const hidden = '••••';

    const dayLabel = (iso: string) => {
        const d = new Date(iso);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const that = new Date(d); that.setHours(0, 0, 0, 0);
        const diff = Math.round((today.getTime() - that.getTime()) / 86400000);
        if (diff === 0) return t('dashboard:mobile.today', 'Today');
        if (diff === 1) return t('dashboard:mobile.yesterday', 'Yesterday');
        return d.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', weekday: 'short' });
    };

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <div className="flex items-center justify-between pt-1">
                    <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('transactions:title', 'Transactions')}</h1>
                    <div className="flex items-center gap-2">
                        {/* The phone is where a receipt gets photographed; the desktop toolbar was its only link. */}
                        <Link href="/transactions/scan" aria-label={t('transactions:scan.title', 'Scan Receipt')}
                            className="grid place-items-center w-11 h-11 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                            <CameraIcon className="w-5 h-5" />
                        </Link>
                        <Link href="/transactions/add" aria-label={t('transactions:add', 'Add transaction')}
                            className="grid place-items-center w-11 h-11 rounded-full bg-primary-700 hover:bg-primary-800 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                            <PlusIcon className="w-5 h-5" />
                        </Link>
                    </div>
                </div>

                <BiggerScreenHint />

                {/* HERO — spent vs income this month */}
                <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                    <p className="text-xs font-bold tracking-wide text-gray-500 dark:text-gray-500">
                        {t('dashboard:mobile.cashFlow', 'Cash flow this month')}
                    </p>
                    <p className={cn('mt-1.5 text-[34px] leading-none font-extrabold tracking-tight tabular-nums', netUp ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-500')}>
                        {netUp ? '+' : '−'}{isValueVisible ? formatTWD(Math.abs(model.net)) : hidden}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-gray-500 dark:text-gray-500">
                        {t('dashboard:mobile.netThisMonth', 'net this month')}
                    </p>

                    <div className="mt-4 h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
                        <span className="h-full bg-error-400" style={{ width: `${model.expenseShare}%` }} />
                        <span className="h-full bg-prosperity-500" style={{ width: `${100 - model.expenseShare}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm bg-prosperity-500 flex-shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-500 dark:text-gray-500">{t('dashboard:mobile.income', 'Income')}</p>
                                <p className="text-[15px] font-extrabold tabular-nums text-gray-900 dark:text-white">{isValueVisible ? formatTWDCompact(model.income) : '•••'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm bg-error-400 flex-shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-500 dark:text-gray-500">{t('dashboard:mobile.expense', 'Spent')}</p>
                                <p className="text-[15px] font-extrabold tabular-nums text-gray-900 dark:text-white">{isValueVisible ? formatTWDCompact(model.expense) : '•••'}</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Recent transactions — grouped by day */}
                <section>
                    <p className="px-1 mb-2.5 text-[13px] font-extrabold tracking-tight text-gray-900 dark:text-white">{t('transactions:recent', 'Recent')}</p>
                    {model.groups.length === 0 ? (
                        <Card padding="xl" shadow="none" className="text-center">
                            <p className="text-sm text-gray-500 dark:text-gray-500">{t('transactions:empty.title', 'No transactions yet')}</p>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {model.groups.map(([iso, txs]) => (
                                <div key={iso}>
                                    <p className="px-1 mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500">{dayLabel(iso)}</p>
                                    <Card padding="none" shadow="none" clip className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {txs.map((tx) => {
                                            const isIncome = tx.type === 'income';
                                            const isTransfer = tx.type === 'transfer';
                                            return (
                                                <Link key={tx.id} href={editHref(tx.id)} className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700/40 focus-visible:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-gray-700/40">
                                                    <span className="grid place-items-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 text-[17px] flex-shrink-0" aria-hidden="true">
                                                        {getCategoryIcon(tx.category)}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{tx.description || tx.category}</p>
                                                        <p className="text-xs font-medium text-gray-500 dark:text-gray-500 truncate">{tx.category}</p>
                                                    </div>
                                                    <p className={cn('text-[14.5px] font-extrabold tabular-nums flex-shrink-0',
                                                        isTransfer ? 'text-gray-500 dark:text-gray-400' : isIncome ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-gray-900 dark:text-white')}>
                                                        {isTransfer ? '' : isIncome ? '+' : '−'}{isValueVisible ? formatTWDCompact(toTWD(tx.amount || 0, tx.currency || 'TWD')) : '•••'}
                                                    </p>
                                                </Link>
                                            );
                                        })}
                                    </Card>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-500">
                    {t('dashboard:mobile.fullTransactions', 'Filters, search, heatmap & bulk import')}
                    <br />
                    <span className="text-primary-700 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
