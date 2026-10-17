'use client';

import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon, PlusCircleIcon, MinusCircleIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { useScrollLock } from '@/hooks/useScrollLock';

interface WalletManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeposit: (params: {
        walletType: string;
        amount: number;
        currency: string;
        date: string;
        notes?: string;
    }) => Promise<void>;
    onWithdraw: (params: {
        walletType: string;
        amount: number;
        currency: string;
        date: string;
        notes?: string;
    }) => Promise<void>;
}

// Keys, not strings: built at module load, where there is no `t`.
const WALLET_TYPES = [
    {
        value: 'portfolio',
        labelKey: 'walletManagement.wallet.portfolio.label',
        descriptionKey: 'walletManagement.wallet.portfolio.description',
        icon: '📈',
        color: 'from-blue-500 to-indigo-500',
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        borderColor: 'border-blue-500',
        textColor: 'text-blue-900 dark:text-blue-300'
    },
    {
        value: 'emergency',
        labelKey: 'walletManagement.wallet.emergency.label',
        descriptionKey: 'walletManagement.wallet.emergency.description',
        icon: '🚨',
        color: 'from-orange-500 to-red-500',
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        borderColor: 'border-orange-500',
        textColor: 'text-orange-900 dark:text-orange-300'
    },
];

const CURRENCIES = ['TWD', 'USD', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];

export function WalletManagementModal({
    isOpen,
    onClose,
    onDeposit,
    onWithdraw
}: WalletManagementModalProps) {
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const { t } = useTranslation('portfolio');
    const [action, setAction] = useState<'deposit' | 'withdraw'>('deposit');
    const [walletType, setWalletType] = useState('portfolio');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('TWD');
    const [date, setDate] = useState(localDateString());
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const amountNum = parseFloat(amount) || 0;
    const canSubmit = amountNum > 0 && !isSubmitting;

    const selectedWallet = WALLET_TYPES.find(w => w.value === walletType);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!canSubmit) {
            return;
        }

        setIsSubmitting(true);
        try {
            const params = {
                walletType,
                amount: amountNum,
                currency,
                date,
                notes: notes.trim() || undefined,
            };

            if (action === 'deposit') {
                await onDeposit(params);
            } else {
                await onWithdraw(params);
            }

            // Reset and close
            handleReset();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : `Failed to ${action} funds`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setAction('deposit');
        setWalletType('portfolio');
        setAmount('');
        setCurrency('TWD');
        setDate(localDateString());
        setNotes('');
        setError(null);
    };

    const handleClose = () => {
        handleReset();
        onClose();
    };

    return (
        <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel className="mx-auto max-w-lg w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                            {t('walletManagement.title')}
                        </DialogTitle>
                        <button
                            onClick={handleClose}
                            className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Content */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
                        {/* Action Selector */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                                {t('walletManagement.field.action')}
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setAction('deposit')}
                                    className={cn(
                                        'p-4 rounded-xl border-2 transition-all',
                                        action === 'deposit'
                                            ? 'border-green-500 bg-green-50 dark:bg-green-900/20 shadow-md'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    )}
                                >
                                    <PlusCircleIcon className={cn(
                                        'w-8 h-8 mx-auto mb-2',
                                        action === 'deposit' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
                                    )} />
                                    <div className={cn(
                                        'font-semibold text-sm',
                                        action === 'deposit' ? 'text-green-900 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'
                                    )}>
                                        {t('walletManagement.deposit')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {t('walletManagement.depositHint')}
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAction('withdraw')}
                                    className={cn(
                                        'p-4 rounded-xl border-2 transition-all',
                                        action === 'withdraw'
                                            ? 'border-red-500 bg-red-50 dark:bg-red-900/20 shadow-md'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    )}
                                >
                                    <MinusCircleIcon className={cn(
                                        'w-8 h-8 mx-auto mb-2',
                                        action === 'withdraw' ? 'text-red-600 dark:text-red-400' : 'text-gray-400'
                                    )} />
                                    <div className={cn(
                                        'font-semibold text-sm',
                                        action === 'withdraw' ? 'text-red-900 dark:text-red-300' : 'text-gray-600 dark:text-gray-400'
                                    )}>
                                        {t('walletManagement.withdraw')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {t('walletManagement.withdrawHint')}
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* Wallet Type Selector */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                                {t('walletManagement.field.wallet')}
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {WALLET_TYPES.map((wallet) => (
                                    <button
                                        key={wallet.value}
                                        type="button"
                                        onClick={() => setWalletType(wallet.value)}
                                        className={cn(
                                            'p-4 rounded-xl border-2 transition-all text-left',
                                            walletType === wallet.value
                                                ? `${wallet.borderColor} ${wallet.bgColor} shadow-md`
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        )}
                                    >
                                        <div className="text-2xl mb-2">{wallet.icon}</div>
                                        <div className={cn(
                                            'font-semibold text-sm mb-1',
                                            walletType === wallet.value ? wallet.textColor : 'text-gray-900 dark:text-white'
                                        )}>
                                            {t(wallet.labelKey)}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                            {t(wallet.descriptionKey)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Amount and Currency */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="walletmana-field" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('walletManagement.field.amount')}
                                </label>
                                <input
                                    id="walletmana-field"
                                    type="number"
                                    inputMode="decimal"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    step="any"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-semibold"
                                    placeholder="0.00"
                                    required
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label htmlFor="walletmana-field-2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('walletManagement.field.currency')}
                                </label>
                                <select
                                    id="walletmana-field-2"
                                    value={currency}
                                    onChange={(e) => setCurrency(e.target.value)}
                                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                >
                                    {CURRENCIES.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Date */}
                        <div>
                            <label htmlFor="walletmana-field-3" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('walletManagement.field.date')}
                            </label>
                            <input
                                id="walletmana-field-3"
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                max={localDateString()}
                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                required
                            />
                        </div>

                        {/* Notes */}
                        <div>
                            <label htmlFor="walletmana-field-4" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('walletManagement.field.notes')}
                            </label>
                            <textarea
                                id="walletmana-field-4"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                                placeholder={t('walletManagement.notesPlaceholder')}
                            />
                        </div>

                        {/* Summary */}
                        {amountNum > 0 && selectedWallet && (
                            <div className={cn(
                                'p-4 rounded-lg border-2',
                                action === 'deposit'
                                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                            )}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className={cn(
                                        'text-sm font-medium',
                                        action === 'deposit'
                                            ? 'text-green-900 dark:text-green-300'
                                            : 'text-red-900 dark:text-red-300'
                                    )}>
                                        {action === 'deposit' ? t('walletManagement.depositAmount') : t('walletManagement.withdrawAmount')}
                                    </span>
                                    <span className={cn(
                                        'text-xl font-bold',
                                        action === 'deposit'
                                            ? 'text-green-900 dark:text-green-300'
                                            : 'text-red-900 dark:text-red-300'
                                    )}>
                                        {action === 'deposit' ? '+' : '-'}{formatCurrency(amountNum, currency)}
                                    </span>
                                </div>
                                <div className={cn(
                                    'text-xs flex items-center gap-2',
                                    action === 'deposit'
                                        ? 'text-green-700 dark:text-green-400'
                                        : 'text-red-700 dark:text-red-400'
                                )}>
                                    <span>{selectedWallet.icon}</span>
                                    <span>{t(selectedWallet.labelKey)}</span>
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                                {error}
                            </div>
                        )}

                    </form>

                    {/* Actions - Sticky Footer */}
                    <div className="p-6 pt-0 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <div className="flex gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleClose}
                                disabled={isSubmitting}
                                className="flex-1"
                            >
                                {t('walletManagement.cancel')}
                            </Button>
                            <Button
                                type="submit"
                                disabled={!canSubmit}
                                variant={action === 'deposit' ? 'primary' : 'error'}
                                className="flex-1"
                                onClick={handleSubmit}
                            >
                                {isSubmitting ? t('walletManagement.processing') : action === 'deposit' ? t('walletManagement.confirmDeposit') : t('walletManagement.confirmWithdraw')}
                            </Button>
                        </div>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
