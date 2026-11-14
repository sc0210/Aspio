'use client';

import React, { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Fragment } from 'react';
import { useAddContribution, useReleaseFromGoal, useLifeCash, ContributeData } from '@/hooks/useGoals';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';

interface ContributeModalProps {
    isOpen: boolean;
    onClose: () => void;
    goalId: string;
    goalTitle: string;
    currentAmount: number;
    targetAmount: number;
    currency: string;
    /** Life Wallet cash this goal holds now (what a release can hand back). */
    reservedAmount?: number;
}

type Mode = 'reserve' | 'release';

const emptyForm = (): ContributeData => ({ amount: 0, contribution_date: localDateString(), notes: '' });

/**
 * Reserve Life Wallet cash for a goal, or release it back. Nothing moves
 * between wallets: the money stays in Life and only its free figure changes.
 */
export function ContributeModal({
    isOpen,
    onClose,
    goalId,
    goalTitle,
    currentAmount: currentRaw,
    targetAmount: targetRaw,
    currency,
    reservedAmount: reservedRaw = 0,
}: ContributeModalProps) {
    // Decimal amounts arrive from the API as strings: `+` would concatenate.
    const currentAmount = Number(currentRaw) || 0;
    const targetAmount = Number(targetRaw) || 0;
    const reservedAmount = Number(reservedRaw) || 0;
    const { t } = useTranslation(['goals']);
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const reserve = useAddContribution();
    const release = useReleaseFromGoal();
    const { data: lifeCash } = useLifeCash();
    const { isValueVisible } = usePrivacy();
    const [mode, setMode] = useState<Mode>('reserve');
    const [formData, setFormData] = useState<ContributeData>(emptyForm);

    const money = (n: number) => (isValueVisible ? formatCurrency(n, currency) : '•••••');
    const mutation = mode === 'reserve' ? reserve : release;
    const remainingAmount = Math.max(0, targetAmount - currentAmount);
    // What this action can move at most: free Life cash, or what the goal holds.
    // Demo mode has no ledger (lifeCash is null), so there is no ceiling to show.
    const ceiling = mode === 'reserve'
        ? (lifeCash ? Math.max(0, lifeCash.available) : null)
        : Math.max(0, reservedAmount);
    const overCeiling = ceiling !== null && formData.amount > ceiling + 0.001;
    const newTotal = currentAmount + (mode === 'reserve' ? formData.amount : -formData.amount);
    const willComplete = mode === 'reserve' && newTotal >= targetAmount && currentAmount < targetAmount;

    const switchMode = (next: Mode) => {
        setMode(next);
        setFormData((prev) => ({ ...prev, amount: 0 }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await mutation.mutateAsync({ goalId, data: formData });
        onClose();
        setFormData(emptyForm());
        setMode('reserve');
    };

    const handleQuickAmount = (percentage: number) => {
        const base = mode === 'reserve' ? remainingAmount : Math.max(0, reservedAmount);
        let amount = Math.round(((base * percentage) / 100) * 100) / 100;
        if (ceiling !== null) amount = Math.min(amount, ceiling);
        setFormData((prev) => ({ ...prev, amount }));
    };

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <TransitionChild
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/50" />
                </TransitionChild>

                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
                        <TransitionChild
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 scale-95"
                            enterTo="opacity-100 scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 scale-100"
                            leaveTo="opacity-0 scale-95"
                        >
                            <DialogPanel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl transition-all">
                                <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                    {mode === 'reserve' ? t('goals:reserve.titleReserve') : t('goals:reserve.titleRelease')}
                                </DialogTitle>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                    {goalTitle}
                                </p>

                                {/* Reserve | Release */}
                                <div role="tablist" className="grid grid-cols-2 gap-1 p-1 mb-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                                    {(['reserve', 'release'] as const).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            role="tab"
                                            aria-selected={mode === m}
                                            disabled={m === 'release' && reservedAmount <= 0}
                                            onClick={() => switchMode(m)}
                                            className={cn(
                                                'min-h-[40px] rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary-500',
                                                mode === m
                                                    ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                                                    : 'text-gray-600 dark:text-gray-300',
                                            )}
                                        >
                                            {m === 'reserve' ? t('goals:reserve.tabReserve') : t('goals:reserve.tabRelease')}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                                    {mode === 'reserve' ? t('goals:reserve.explainReserve') : t('goals:reserve.explainRelease')}
                                </p>

                                {/* Current Status */}
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6 space-y-2">
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('goals:reserve.current')}</span>
                                        <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {money(currentAmount)} <span className="text-sm font-normal text-gray-500">/ {money(targetAmount)}</span>
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('goals:reserve.reservedHere')}</span>
                                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{money(reservedAmount)}</span>
                                    </div>
                                    {lifeCash && (
                                        <div className="flex justify-between items-baseline pt-2 border-t border-gray-200 dark:border-gray-600">
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('goals:reserve.available')}</span>
                                            <span className={cn(
                                                'text-lg font-bold',
                                                lifeCash.available < 0 ? 'text-red-600 dark:text-red-400' : 'text-primary-700 dark:text-primary-400',
                                            )}>
                                                {money(lifeCash.available)}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <form onSubmit={handleSubmit} className="space-y-5">
                                    {/* Quick Amount Buttons */}
                                    <div>
                                        <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:reserve.quick')}
                                        </p>
                                        <div className="grid grid-cols-4 gap-2">
                                            {[25, 50, 75, 100].map((percentage) => (
                                                <button
                                                    key={percentage}
                                                    type="button"
                                                    onClick={() => handleQuickAmount(percentage)}
                                                    aria-label={mode === 'reserve'
                                                        ? t('goals:reserve.quickAriaReserve', { pct: percentage })
                                                        : t('goals:reserve.quickAriaRelease', { pct: percentage })}
                                                    className="px-3 py-2.5 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                                >
                                                    {percentage}%
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Amount */}
                                    <div>
                                        <label htmlFor="contribute-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:reserve.amount')} *
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                                                {currency}
                                            </span>
                                            <input
                                                id="contribute-amount"
                                                type="number"
                                                onWheel={(e) => e.currentTarget.blur()}
                                                required
                                                aria-required="true"
                                                aria-invalid={overCeiling}
                                                min="0.01"
                                                step="0.01"
                                                value={formData.amount}
                                                inputMode="decimal"
                                                onChange={(e) =>
                                                    setFormData((prev) => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))
                                                }
                                                placeholder="0.00"
                                                className="w-full pl-14 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>
                                        {overCeiling && ceiling !== null && (
                                            <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                                                {mode === 'reserve'
                                                    ? t('goals:reserve.overAvailable', { amount: money(ceiling) })
                                                    : t('goals:reserve.overReserved', { amount: money(ceiling) })}
                                            </p>
                                        )}
                                        {willComplete && !overCeiling && (
                                            <p className="mt-2 text-sm text-success-700 dark:text-success-400">
                                                {t('goals:reserve.willComplete')}
                                            </p>
                                        )}
                                    </div>

                                    {/* Date */}
                                    <div>
                                        <label htmlFor="contribute-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:reserve.date')}
                                        </label>
                                        <input
                                            id="contribute-date"
                                            type="date"
                                            value={formData.contribution_date}
                                            onChange={(e) =>
                                                setFormData((prev) => ({ ...prev, contribution_date: e.target.value }))
                                            }
                                            className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                        />
                                    </div>

                                    {/* Notes */}
                                    <div>
                                        <label htmlFor="contribute-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:reserve.notes')}
                                        </label>
                                        <textarea
                                            id="contribute-notes"
                                            value={formData.notes}
                                            onChange={(e) =>
                                                setFormData((prev) => ({ ...prev, notes: e.target.value }))
                                            }
                                            placeholder={t('goals:contributions.notePlaceholder')}
                                            rows={2}
                                            className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent resize-none"
                                        />
                                    </div>

                                    {/* New Total Preview */}
                                    {formData.amount > 0 && !overCeiling && targetAmount > 0 && (
                                        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-4">
                                            <div className="flex justify-between items-baseline">
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                    {t('goals:reserve.newTotal')}
                                                </span>
                                                <span className="text-xl font-bold text-primary-700 dark:text-primary-400">
                                                    {money(newTotal)}
                                                </span>
                                            </div>
                                            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                                                {t('goals:reserve.ofGoal', { pct: ((newTotal / targetAmount) * 100).toFixed(1) })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="px-4 py-2.5 min-h-[44px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium"
                                        >
                                            {t('goals:reserve.cancel')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={mutation.isPending || formData.amount <= 0 || overCeiling}
                                            className="px-6 py-2.5 min-h-[44px] bg-primary-700 hover:bg-primary-800 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {mutation.isPending
                                                ? t('goals:reserve.working')
                                                : mode === 'reserve' ? t('goals:reserve.submitReserve') : t('goals:reserve.submitRelease')}
                                        </button>
                                    </div>
                                </form>
                            </DialogPanel>
                        </TransitionChild>
                    </div>
                </div>
            </Dialog>
        </Transition>
    );
}
