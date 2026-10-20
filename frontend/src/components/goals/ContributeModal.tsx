'use client';

import React, { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Fragment } from 'react';
import { useAddContribution, ContributeData } from '@/hooks/useGoals';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useTranslation } from 'react-i18next';

interface ContributeModalProps {
    isOpen: boolean;
    onClose: () => void;
    goalId: string;
    goalTitle: string;
    currentAmount: number;
    targetAmount: number;
    currency: string;
}

export function ContributeModal({
    isOpen,
    onClose,
    goalId,
    goalTitle,
    currentAmount,
    targetAmount,
    currency,
}: ContributeModalProps) {
    const { t } = useTranslation(['goals']);
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const addContribution = useAddContribution();
    const { isValueVisible } = usePrivacy();
    const [formData, setFormData] = useState<ContributeData>({
        amount: 0,
        contribution_date: localDateString(),
        notes: '',
    });

    const remainingAmount = Math.max(0, targetAmount - currentAmount);
    const newTotal = currentAmount + formData.amount;
    const willComplete = newTotal >= targetAmount;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        await addContribution.mutateAsync({ goalId, data: formData });
        onClose();

        // Reset form
        setFormData({
            amount: 0,
            contribution_date: localDateString(),
            notes: '',
        });
    };

    const handleQuickAmount = (percentage: number) => {
        const amount = (remainingAmount * percentage) / 100;
        setFormData((prev) => ({ ...prev, amount: Math.round(amount * 100) / 100 }));
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
                                    Add Contribution
                                </DialogTitle>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                                    {goalTitle}
                                </p>

                                {/* Current Status */}
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6">
                                    <div className="flex justify-between items-baseline mb-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Current</span>
                                        <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {isValueVisible ? formatCurrency(currentAmount, currency) : '•••••'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline mb-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Target</span>
                                        <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {isValueVisible ? formatCurrency(targetAmount, currency) : '•••••'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline pt-2 border-t border-gray-200 dark:border-gray-600">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Remaining</span>
                                        <span className="text-lg font-bold text-primary-700 dark:text-primary-400">
                                            {isValueVisible ? formatCurrency(remainingAmount, currency) : '•••••'}
                                        </span>
                                    </div>
                                </div>

                                <form onSubmit={handleSubmit} className="space-y-5">
                                    {/* Quick Amount Buttons */}
                                    <div>
                                        <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            Quick Amount
                                        </p>
                                        <div className="grid grid-cols-4 gap-2">
                                            {[25, 50, 75, 100].map((percentage) => (
                                                <button
                                                    key={percentage}
                                                    type="button"
                                                    onClick={() => handleQuickAmount(percentage)}
                                                    aria-label={`Set contribution to ${percentage}% of remaining amount`}
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
                                            Contribution Amount *
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                                                {currency === 'USD' ? '$' : currency}
                                            </span>
                                            <input
                                                id="contribute-amount"
                                                type="number"
                                                onWheel={(e) => e.currentTarget.blur()}
                                                required
                                                aria-required="true"
                                                min="0.01"
                                                step="0.01"
                                                value={formData.amount}
                                                inputMode="decimal"
                                                onChange={(e) =>
                                                    setFormData((prev) => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))
                                                }
                                                placeholder="0.00"
                                                className="w-full pl-12 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>
                                        {willComplete && (
                                            <p className="mt-2 text-sm text-success-700 dark:text-success-400 flex items-center gap-1">
                                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                                    <path
                                                        fillRule="evenodd"
                                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                                        clipRule="evenodd"
                                                    />
                                                </svg>
                                                This will complete your goal!
                                            </p>
                                        )}
                                    </div>

                                    {/* Date */}
                                    <div>
                                        <label htmlFor="contribute-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            Contribution Date
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
                                            Notes (Optional)
                                        </label>
                                        <textarea
                                            id="contribute-notes"
                                            value={formData.notes}
                                            onChange={(e) =>
                                                setFormData((prev) => ({ ...prev, notes: e.target.value }))
                                            }
                                            placeholder={t('goals:contributions.notePlaceholder', 'Add a note about this contribution...')}
                                            rows={3}
                                            className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent resize-none"
                                        />
                                    </div>

                                    {/* New Total Preview */}
                                    {formData.amount > 0 && (
                                        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-4">
                                            <div className="flex justify-between items-baseline">
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                    New Total
                                                </span>
                                                <span className="text-xl font-bold text-primary-700 dark:text-primary-400">
                                                    {isValueVisible ? formatCurrency(newTotal, currency) : '•••••'}
                                                </span>
                                            </div>
                                            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                                                {((newTotal / targetAmount) * 100).toFixed(1)}% of goal
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
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={addContribution.isPending || formData.amount <= 0}
                                            className="px-6 py-2.5 min-h-[44px] bg-primary-700 hover:bg-primary-800 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {addContribution.isPending ? 'Adding...' : 'Add Contribution'}
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
