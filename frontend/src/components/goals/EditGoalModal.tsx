'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Fragment } from 'react';
import { useUpdateGoal, UpdateGoalData, Goal } from '@/hooks/useGoals';
import { useTranslation } from 'react-i18next';
import { DEFAULT_CURRENCY } from '@/utils/constants';
import { useScrollLock } from '@/hooks/useScrollLock';

// Format a number to a comma-separated string, e.g. 1000000 → "1,000,000"
const fmtAmt = (n: number): string =>
    n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '';

// targetDate may arrive as an ISO string (API) OR a Date object (demo fixtures) —
// normalize to a YYYY-MM-DD string for the <input type="date">. Calling .split on
// a Date threw "goal.targetDate.split is not a function" and crashed the Edit modal.
const toDateInput = (d: string | Date | null | undefined): string => {
    if (!d) return '';
    if (typeof d === 'string') return d.split('T')[0];
    const parsed = d instanceof Date ? d : new Date(d);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0];
};

// Strip commas and parse back to a number
const parseAmt = (s: string): number => parseFloat(s.replace(/,/g, '')) || 0;

// Add commas to integer part while preserving any in-progress decimal suffix (e.g. "100." or "100.5")
const liveFormat = (raw: string): string => {
    // Strip anything that isn't a digit or decimal point
    const clean = raw.replace(/[^0-9.]/g, '');
    const [intPart, ...rest] = clean.split('.');
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return rest.length ? `${formatted}.${rest.join('')}` : formatted;
};

interface EditGoalModalProps {
    isOpen: boolean;
    onClose: () => void;
    goal: Goal;
}

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

const STATUS_KEYS = ['active', 'paused', 'completed', 'cancelled'] as const;

export function EditGoalModal({ isOpen, onClose, goal }: EditGoalModalProps) {
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const { t } = useTranslation(['goals', 'common', 'portfolio']);
    const updateGoal = useUpdateGoal();
    const [formData, setFormData] = useState<UpdateGoalData>({
        title: goal.title,
        description: goal.description || '',
        category: goal.category,
        priority: goal.priority,
        status: goal.status,
        target_amount: Number(goal.targetAmount),
        current_amount: Number(goal.currentAmount),
        currency: goal.currency,
        target_date: toDateInput(goal.targetDate),
    });

    // Display strings for comma-formatted amount fields
    // Always show a value (including '0') since this is existing saved data
    const [targetDisplay, setTargetDisplay] = useState(() => fmtAmt(Number(goal.targetAmount) || 0));
    const [currentDisplay, setCurrentDisplay] = useState(() => {
        const n = Number(goal.currentAmount);
        return n > 0 ? fmtAmt(n) : '0';
    });

    // Sync form data when goal prop changes
    useEffect(() => {
        setFormData({
            title: goal.title,
            description: goal.description || '',
            category: goal.category,
            priority: goal.priority,
            status: goal.status,
            target_amount: Number(goal.targetAmount),
            current_amount: Number(goal.currentAmount),
            currency: goal.currency,
            target_date: toDateInput(goal.targetDate),
        });
        setTargetDisplay(fmtAmt(Number(goal.targetAmount) || 0));
        setCurrentDisplay(() => {
            const n = Number(goal.currentAmount);
            return n > 0 ? fmtAmt(n) : '0';
        });
    }, [goal]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Only send changed fields
        const changes: UpdateGoalData = {};
        if (formData.title !== goal.title) changes.title = formData.title;
        if (formData.description !== (goal.description || '')) changes.description = formData.description || undefined;
        if (formData.category !== goal.category) changes.category = formData.category;
        if (formData.priority !== goal.priority) changes.priority = formData.priority;
        if (formData.status !== goal.status) changes.status = formData.status;
        if (formData.target_amount !== goal.targetAmount) changes.target_amount = formData.target_amount;
        if (formData.current_amount !== goal.currentAmount) changes.current_amount = formData.current_amount;
        if (formData.currency !== goal.currency) changes.currency = formData.currency;

        const originalDate = toDateInput(goal.targetDate);
        if (formData.target_date !== originalDate) {
            changes.target_date = formData.target_date || undefined;
        }

        // If nothing changed, just close
        if (Object.keys(changes).length === 0) {
            onClose();
            return;
        }

        try {
            await updateGoal.mutateAsync({ id: goal.id, data: changes });
            onClose();
        } catch (error) {
            // Error is handled by mutation's onError callback (toast)
            console.error('[EditGoalModal] Failed to update goal:', error);
        }
    };

    const handleChange = (field: keyof UpdateGoalData, value: UpdateGoalData[keyof UpdateGoalData]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const progress = formData.target_amount && formData.target_amount > 0
        ? ((formData.current_amount || 0) / formData.target_amount) * 100
        : 0;

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
                                    {t('goals:edit')}
                                </DialogTitle>

                                <form onSubmit={handleSubmit} className="space-y-5">
                                    {/* Title */}
                                    <div>
                                        <label htmlFor="edit-goal-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:fields.title')} <span aria-hidden="true">*</span>
                                        </label>
                                        <input
                                            id="edit-goal-title"
                                            type="text"
                                            required
                                            value={formData.title || ''}
                                            onChange={(e) => handleChange('title', e.target.value)}
                                            className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                        />
                                    </div>

                                    {/* Description */}
                                    <div>
                                        <label htmlFor="edit-goal-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('goals:fields.description')}
                                        </label>
                                        <textarea
                                            id="edit-goal-description"
                                            value={formData.description || ''}
                                            onChange={(e) => handleChange('description', e.target.value)}
                                            rows={3}
                                            className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent resize-none"
                                        />
                                    </div>

                                    {/* Category and Priority */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label htmlFor="edit-goal-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.category')}
                                            </label>
                                            <select
                                                id="edit-goal-category"
                                                value={formData.category || 'savings'}
                                                onChange={(e) => handleChange('category', e.target.value)}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                {CATEGORY_KEYS.map((key) => (
                                                    <option key={key} value={key}>
                                                        {t(`goals:categories.${key}` as const)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label htmlFor="edit-goal-priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.priority')}
                                            </label>
                                            <select
                                                id="edit-goal-priority"
                                                value={formData.priority || 'medium'}
                                                onChange={(e) => handleChange('priority', e.target.value as 'high' | 'medium' | 'low')}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                {PRIORITY_KEYS.map((key) => (
                                                    <option key={key} value={key}>
                                                        {t(`goals:priorities.${key}` as const)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label htmlFor="edit-goal-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.status')}
                                            </label>
                                            <select
                                                id="edit-goal-status"
                                                value={formData.status || 'active'}
                                                onChange={(e) => handleChange('status', e.target.value as 'active' | 'completed' | 'paused' | 'cancelled')}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                {STATUS_KEYS.map((key) => (
                                                    <option key={key} value={key}>
                                                        {t(`goals:status.${key}` as const)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Target Amount and Current Amount */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="edit-goal-target-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.targetAmount')} <span aria-hidden="true">*</span>
                                            </label>
                                            <input
                                                id="edit-goal-target-amount"
                                                type="text"
                                                inputMode="decimal"
                                                required
                                                value={targetDisplay}
                                                onChange={(e) => {
                                                    const formatted = liveFormat(e.target.value);
                                                    setTargetDisplay(formatted);
                                                    handleChange('target_amount', parseAmt(formatted));
                                                }}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="edit-goal-current-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.currentAmount')}
                                            </label>
                                            <input
                                                id="edit-goal-current-amount"
                                                type="text"
                                                inputMode="decimal"
                                                value={currentDisplay}
                                                onChange={(e) => {
                                                    const formatted = liveFormat(e.target.value);
                                                    setCurrentDisplay(formatted);
                                                    handleChange('current_amount', parseAmt(formatted));
                                                }}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    {/* Progress Preview */}
                                    <div aria-hidden="true" className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                                        <div className="flex justify-between items-baseline mb-2">
                                            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('goals:progress.title')}</span>
                                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                                {progress.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="relative w-full h-2.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-primary-500 transition-all duration-300 rounded-full"
                                                style={{ width: `${Math.min(100, progress)}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Currency and Target Date */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="edit-goal-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('portfolio:fields.currency')}
                                            </label>
                                            <select
                                                id="edit-goal-currency"
                                                value={formData.currency || DEFAULT_CURRENCY}
                                                onChange={(e) => handleChange('currency', e.target.value)}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            >
                                                <option value="USD">{t('common:currency.USD')}</option>
                                                <option value="TWD">{t('common:currency.TWD')}</option>
                                                <option value="EUR">{t('common:currency.EUR')}</option>
                                                <option value="GBP">{t('common:currency.GBP')}</option>
                                                <option value="JPY">{t('common:currency.JPY')}</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label htmlFor="edit-goal-target-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('goals:fields.targetDate')}
                                            </label>
                                            <input
                                                id="edit-goal-target-date"
                                                type="date"
                                                value={formData.target_date || ''}
                                                onChange={(e) => handleChange('target_date', e.target.value)}
                                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="px-4 py-2.5 min-h-[44px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium"
                                        >
                                            {t('common:common.cancel')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={updateGoal.isPending}
                                            className="px-6 py-2.5 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {updateGoal.isPending ? t('goals:saving') : t('goals:saveChanges')}
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
