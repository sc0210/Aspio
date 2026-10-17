'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Fragment } from 'react';
import { useCreateGoal, CreateGoalData } from '@/hooks/useGoals';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useScrollLock } from '@/hooks/useScrollLock';

// Format a number to a comma-separated string, e.g. 1000000 → "1,000,000"
const fmtAmt = (n: number): string =>
    n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '';

// Strip commas and parse back to a number
const parseAmt = (s: string): number => parseFloat(s.replace(/,/g, '')) || 0;

// Add commas to integer part while preserving any in-progress decimal suffix (e.g. "100." or "100.5")
const liveFormat = (raw: string): string => {
    const clean = raw.replace(/[^0-9.]/g, '');
    const [intPart, ...rest] = clean.split('.');
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return rest.length ? `${formatted}.${rest.join('')}` : formatted;
};

interface CreateGoalModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaults?: Partial<CreateGoalData>;
    /** Whether the modal was opened from the portfolio page (retirement flow) */
    returnToPortfolio?: boolean;
}

const getInitialFormData = (defaults?: Partial<CreateGoalData>): CreateGoalData => ({
    title: defaults?.title || '',
    description: defaults?.description || '',
    category: defaults?.category || 'savings',
    priority: defaults?.priority || 'medium',
    target_amount: defaults?.target_amount || 0,
    current_amount: defaults?.current_amount || 0,
    currency: defaults?.currency || 'TWD',
    target_date: defaults?.target_date || '',
});

const CATEGORY_KEYS = [
    'emergency_fund',
    'retirement',
    'house_down_payment',
    'education',
    'vacation',
    'car_purchase',
    'debt_payoff',
    'investment',
    'savings',
    'other',
] as const;

const PRIORITY_KEYS = ['high', 'medium', 'low'] as const;

export function CreateGoalModal({ isOpen, onClose, defaults, returnToPortfolio }: CreateGoalModalProps) {
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const createGoal = useCreateGoal();
    const router = useRouter();
    const { t } = useTranslation(['goals', 'common', 'portfolio']);
    const [formData, setFormData] = useState<CreateGoalData>(() => getInitialFormData(defaults));

    // Display strings for comma-formatted amount fields
    const [targetDisplay, setTargetDisplay] = useState(() => fmtAmt(defaults?.target_amount || 0));
    const [currentDisplay, setCurrentDisplay] = useState(() => fmtAmt(defaults?.current_amount || 0));

    // Re-populate the form whenever defaults change or the modal opens
    useEffect(() => {
        if (isOpen) {
            const data = getInitialFormData(defaults);
            setFormData(data);
            setTargetDisplay(fmtAmt(data.target_amount || 0));
            setCurrentDisplay(fmtAmt(data.current_amount || 0));
        }
    }, [isOpen, defaults]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Clean up data - remove empty strings
        const cleanData: CreateGoalData = {
            title: formData.title,
            category: formData.category,
            priority: formData.priority,
            target_amount: formData.target_amount,
            current_amount: formData.current_amount,
            currency: formData.currency,
        };

        // Only include optional fields if they have values
        if (formData.description?.trim()) {
            cleanData.description = formData.description;
        }
        if (formData.target_date) {
            cleanData.target_date = formData.target_date;
        }

        try {
            await createGoal.mutateAsync(cleanData);
            onClose();

            // Reset form
            setFormData(getInitialFormData(defaults));

            // If opened from portfolio page (retirement flow), navigate back
            if (returnToPortfolio) {
                router.push('/portfolio');
            }
        } catch {
            // Error handled by mutation's onError callback (toast)
        }
    };

    const handleChange = (field: keyof CreateGoalData, value: CreateGoalData[keyof CreateGoalData]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
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
                            <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl transition-all">
                                <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {t('goals:createNew')}
                                </DialogTitle>

                                <form onSubmit={handleSubmit} className="space-y-5" aria-label={t('goals:createNew')}>
                                    {/* Title */}
                                    <div>
                                        <label htmlFor="goal-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:fields.title')} <span aria-hidden="true">*</span>
                                            <span className="sr-only"> (required)</span>
                                        </label>
                                        <input
                                            id="goal-title"
                                            type="text"
                                            required
                                            aria-required="true"
                                            value={formData.title}
                                            onChange={(e) => handleChange('title', e.target.value)}
                                            placeholder={t('goals:categories.emergency_fund')}
                                            className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                        />
                                    </div>

                                    {/* Description */}
                                    <div>
                                        <label htmlFor="goal-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:fields.description')}
                                        </label>
                                        <textarea
                                            id="goal-description"
                                            value={formData.description}
                                            onChange={(e) => handleChange('description', e.target.value)}
                                            rows={3}
                                            className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent resize-none"
                                        />
                                    </div>

                                    {/* Category and Priority */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="goal-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.category')} <span aria-hidden="true">*</span>
                                            </label>
                                            <select
                                                id="goal-category"
                                                required
                                                aria-required="true"
                                                value={formData.category}
                                                onChange={(e) => handleChange('category', e.target.value)}
                                                className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                {CATEGORY_KEYS.map((key) => (
                                                    <option key={key} value={key}>
                                                        {t(`goals:categories.${key}` as const)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label htmlFor="goal-priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.priority')} <span aria-hidden="true">*</span>
                                            </label>
                                            <select
                                                id="goal-priority"
                                                required
                                                aria-required="true"
                                                value={formData.priority}
                                                onChange={(e) => handleChange('priority', e.target.value as 'high' | 'medium' | 'low')}
                                                className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                {PRIORITY_KEYS.map((key) => (
                                                    <option key={key} value={key}>
                                                        {t(`goals:priorities.${key}` as const)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Target Amount and Current Amount */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="goal-target-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.targetAmount')} <span aria-hidden="true">*</span>
                                            </label>
                                            <input
                                                id="goal-target-amount"
                                                type="text"
                                                inputMode="decimal"
                                                required
                                                aria-required="true"
                                                value={targetDisplay}
                                                onChange={(e) => {
                                                    const formatted = liveFormat(e.target.value);
                                                    setTargetDisplay(formatted);
                                                    handleChange('target_amount', parseAmt(formatted));
                                                }}
                                                onFocus={(e) => e.target.select()}
                                                placeholder="10,000,000"
                                                className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="goal-current-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.currentAmount')}
                                            </label>
                                            <input
                                                id="goal-current-amount"
                                                type="text"
                                                inputMode="decimal"
                                                value={currentDisplay}
                                                onChange={(e) => {
                                                    const formatted = liveFormat(e.target.value);
                                                    setCurrentDisplay(formatted);
                                                    handleChange('current_amount', parseAmt(formatted));
                                                }}
                                                onFocus={(e) => e.target.select()}
                                                placeholder="0"
                                                className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    {/* Currency and Target Date */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="goal-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('portfolio:fields.currency')}
                                            </label>
                                            <select
                                                id="goal-currency"
                                                value={formData.currency}
                                                onChange={(e) => handleChange('currency', e.target.value)}
                                                className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                <option value="USD">{t('common:currency.USD')}</option>
                                                <option value="TWD">{t('common:currency.TWD')}</option>
                                                <option value="EUR">{t('common:currency.EUR')}</option>
                                                <option value="GBP">{t('common:currency.GBP')}</option>
                                                <option value="JPY">{t('common:currency.JPY')}</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label htmlFor="goal-target-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.targetDate')}
                                            </label>
                                            <input
                                                id="goal-target-date"
                                                type="date"
                                                value={formData.target_date}
                                                onChange={(e) => handleChange('target_date', e.target.value)}
                                                className="w-full px-4 py-2.5 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="px-4 py-2.5 min-h-[44px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                                        >
                                            {t('common:common.cancel')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={createGoal.isPending}
                                            aria-disabled={createGoal.isPending}
                                            className="px-6 py-2.5 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                                        >
                                            {createGoal.isPending ? t('common:common.loading') : t('goals:create')}
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
