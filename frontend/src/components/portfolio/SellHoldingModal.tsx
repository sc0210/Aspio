'use client';

import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon, CurrencyDollarIcon, BanknotesIcon, MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import type { PortfolioHolding } from '@/shared/types';
import { formatCurrency } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { useScrollLock } from '@/hooks/useScrollLock';

interface SellHoldingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSell: (params: {
        holdingId: string;
        quantity: number;
        price?: number;
        fees?: number;
        taxes?: number;
        notes?: string;
    }) => Promise<void>;
    existingHoldings?: Array<{
        id: string;
        symbol: string;
        name: string;
        quantity: number;
        averageCost: number;
        currentPrice: number;
        totalCost: number;
        totalValue: number;
        currency: string;
        type?: string;
    }>;
    preSelectedHolding?: {
        id: string;
        symbol: string;
        name: string;
        quantity: number;
        averageCost: number;
        currentPrice: number;
        totalCost: number;
        currency: string;
    } | null;
    cashWalletBalance?: number;
}

export function SellHoldingModal({
    isOpen,
    onClose,
    onSell,
    existingHoldings = [],
    preSelectedHolding = null,
    cashWalletBalance = 0,
}: SellHoldingModalProps) {
    const { t } = useTranslation('portfolio');
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const [step, setStep] = useState<'select' | 'details'>('select');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedHolding, setSelectedHolding] = useState<PortfolioHolding | null>(null);
    const [quantity, setQuantity] = useState<string>('');
    const [price, setPrice] = useState<string>('');
    const [fees, setFees] = useState<string>('0');
    const [taxes, setTaxes] = useState<string>('0');
    const [notes, setNotes] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // If preselected, skip to details step
    useEffect(() => {
        if (preSelectedHolding && isOpen) {
            setSelectedHolding(preSelectedHolding as unknown as PortfolioHolding);
            setPrice(preSelectedHolding.currentPrice.toString());
            setStep('details');
        }
    }, [preSelectedHolding, isOpen]);

    // Filter holdings by search query
    const filteredHoldings = existingHoldings.filter(h =>
        h.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const holding = selectedHolding;
    const quantityNum = parseFloat(quantity) || 0;
    const priceNum = parseFloat(price) || (holding?.currentPrice || 0);
    const feesNum = parseFloat(fees) || 0;
    const taxesNum = parseFloat(taxes) || 0;

    const totalProceeds = quantityNum * priceNum;
    const netProceeds = totalProceeds - feesNum - taxesNum;
    const costBasis = holding ? quantityNum * holding.averageCost : 0;
    const estimatedGainLoss = totalProceeds - costBasis - feesNum - taxesNum;
    const estimatedGainLossPct = costBasis > 0 ? (estimatedGainLoss / costBasis) * 100 : 0;
    const newCashBalance = cashWalletBalance + netProceeds;

    const isValidQuantity = holding && quantityNum > 0 && quantityNum <= holding.quantity;
    const isValidPrice = priceNum > 0;
    const canSubmit = isValidQuantity && isValidPrice && !isSubmitting;

    const handleSelectHolding = (h: PortfolioHolding) => {
        setSelectedHolding(h);
        setPrice(h.currentPrice.toString());
        setStep('details');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!canSubmit || !holding) return;

        setIsSubmitting(true);
        try {
            // Aggregated positions have a synthetic "aggregated-…" id; the backend
            // needs a real lot id (it then sells FIFO across all lots of that symbol).
            const lotIds = holding.metadata?.lotIds as string[] | undefined;
            const holdingId =
                holding.id.startsWith('aggregated-') && lotIds?.length
                    ? lotIds[0]
                    : holding.id;

            await onSell({
                holdingId,
                quantity: quantityNum,
                price: priceNum !== holding.currentPrice ? priceNum : undefined,
                fees: feesNum > 0 ? feesNum : undefined,
                taxes: taxesNum > 0 ? taxesNum : undefined,
                notes: notes.trim() || undefined,
            });

            // Reset form and close
            handleReset();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to sell holding');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSetMaxQuantity = () => {
        if (holding) {
            setQuantity(holding.quantity.toString());
        }
    };

    const handleReset = () => {
        setStep('select');
        setSearchQuery('');
        setSelectedHolding(null);
        setQuantity('');
        setPrice('');
        setFees('0');
        setTaxes('0');
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
                <DialogPanel className="mx-auto max-w-2xl w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl">
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                        <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                            {step === 'select' ? t('sell.title') : t('sell.titleFor', { symbol: holding?.symbol || '' })}
                        </DialogTitle>
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Close dialog"
                            className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                        >
                            <XMarkIcon className="w-6 h-6" aria-hidden="true" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 max-h-[calc(100vh-12rem)] overflow-y-auto">{step === 'select' ? (
                        <div className="space-y-6">
                            {/* Search Bar */}
                            <div>
                                <label htmlFor="sellholdin-field" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('sell.searchLabel')}
                                </label>
                                <div className="relative">
                                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        id="sellholdin-field"
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={t('sell.searchPlaceholder')}
                                        className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {/* Holdings List */}
                            {filteredHoldings.length > 0 ? (
                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        {t('sell.pickHolding', { count: filteredHoldings.length })}
                                    </h3>
                                    <div className="space-y-2 max-h-96 overflow-y-auto">
                                        {filteredHoldings.map((h) => {
                                            const gainLoss = h.totalValue - h.totalCost;
                                            const gainLossPct = h.totalCost > 0 ? (gainLoss / h.totalCost) * 100 : 0;
                                            const isProfit = gainLoss >= 0;

                                            return (
                                                <button
                                                    key={h.id}
                                                    onClick={() => handleSelectHolding(h as unknown as PortfolioHolding)}
                                                    className="w-full p-4 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors text-left"
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="font-bold text-gray-900 dark:text-white text-lg">
                                                                    {h.symbol}
                                                                </span>
                                                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
                                                                    {h.type || 'Stock'}
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                                                                {h.name}
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-3 text-sm">
                                                                <div>
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('sell.field.quantity')}</div>
                                                                    <div className="font-semibold text-gray-900 dark:text-white">
                                                                        {h.quantity}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('sell.field.currentPrice')}</div>
                                                                    <div className="font-semibold text-gray-900 dark:text-white">
                                                                        {formatCurrency(h.currentPrice, h.currency)}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('sell.field.marketValue')}</div>
                                                                    <div className="font-semibold text-gray-900 dark:text-white">
                                                                        {formatCurrency(h.totalValue, h.currency)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right ml-4">
                                                            <div className={cn(
                                                                'text-sm font-bold mb-1',
                                                                isProfit ? 'text-prosperity-600 dark:text-prosperity-400' : 'text-error-600 dark:text-error-400'
                                                            )}>
                                                                {isProfit ? '+' : ''}{formatCurrency(gainLoss, h.currency)}
                                                            </div>
                                                            <div className={cn(
                                                                'text-xs font-semibold',
                                                                isProfit ? 'text-prosperity-600 dark:text-prosperity-400' : 'text-error-600 dark:text-error-400'
                                                            )}>
                                                                {gainLossPct >= 0 ? '+' : ''}{gainLossPct.toFixed(2)}%
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <p className="text-gray-500 dark:text-gray-400">
                                        {existingHoldings.length === 0 ? t('sell.emptyNoHoldings') : t('sell.emptyNoMatch')}
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : (

                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Current Position */}
                            {holding && (
                                <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/50 dark:to-gray-800/50 rounded-xl p-4 space-y-2 border border-gray-200 dark:border-gray-700">
                                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                        <span className="w-1 h-4 bg-gradient-to-b from-primary-500 to-primary-600 rounded-full"></span>
                                        {t('sell.holdingInfo')}
                                    </h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.quantity')}</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {holding.quantity}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.avgCost')}</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {formatCurrency(holding.averageCost, holding.currency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.currentPrice')}</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {formatCurrency(holding.currentPrice, holding.currency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.cashBalance')}</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {formatCurrency(cashWalletBalance, holding.currency)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Quantity Input */}
                            <div>
                                <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('sell.field.sellQuantity')}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        onWheel={(e) => e.currentTarget.blur()}
                                        id="quantity"
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        min="0"
                                        max={holding?.quantity || 0}
                                        step="0.01"
                                        placeholder="0"
                                        required
                                        className={cn(
                                            "flex-1 px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-semibold",
                                            "focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent",
                                            !isValidQuantity && quantity !== '' ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                                        )}
                                        autoFocus
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleSetMaxQuantity}
                                        className="whitespace-nowrap"
                                    >
                                        {t('sell.all', { count: holding?.quantity || 0 })}
                                    </Button>
                                </div>
                                {!isValidQuantity && quantity !== '' && holding && (
                                    <p className="mt-1 text-sm text-error-600 dark:text-error-400">
                                        {t('sell.quantityRange', { max: holding.quantity })}
                                    </p>
                                )}
                            </div>

                            {/* Price Input */}
                            <div>
                                <label htmlFor="price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('sell.field.price')}
                                </label>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    id="price"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    min="0"
                                    step="0.01"
                                    placeholder={holding?.currentPrice.toString() || '0'}
                                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {t('sell.useCurrentPrice', { price: holding ? formatCurrency(holding.currentPrice, holding.currency) : '' })}
                                </p>
                            </div>

                            {/* Fees and Taxes */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="fees" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {t('sell.field.brokerage')}
                                    </label>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        onWheel={(e) => e.currentTarget.blur()}
                                        id="fees"
                                        value={fees}
                                        onChange={(e) => setFees(e.target.value)}
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="taxes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {t('sell.field.tax')}
                                    </label>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        onWheel={(e) => e.currentTarget.blur()}
                                        id="taxes"
                                        value={taxes}
                                        onChange={(e) => setTaxes(e.target.value)}
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent"
                                    />
                                </div>
                            </div>

                            {/* Notes */}
                            <div>
                                <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('sell.field.notes')}
                                </label>
                                <textarea
                                    id="notes"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={2}
                                    maxLength={500}
                                    placeholder={t('sell.notesPlaceholder')}
                                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent resize-none"
                                />
                            </div>

                            {/* Transaction Summary */}
                            {quantityNum > 0 && holding && (
                                <div className="bg-gradient-to-br from-prosperity-50 to-prosperity-50/80 dark:from-prosperity-900/20 dark:to-prosperity-900/20 rounded-xl p-4 space-y-2 border-2 border-prosperity-200 dark:border-prosperity-800">
                                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                        <CurrencyDollarIcon className="h-5 w-5 text-prosperity-600 dark:text-prosperity-400" />
                                        {t('sell.summary')}
                                    </h4>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.grossProceeds')}</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {formatCurrency(totalProceeds, holding.currency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.feesAndTax')}</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                -{formatCurrency(feesNum + taxesNum, holding.currency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between pt-2 border-t border-prosperity-200 dark:border-prosperity-800">
                                            <span className="font-bold text-gray-900 dark:text-white">{t('sell.label.netProceeds')}</span>
                                            <span className="font-bold text-xl text-prosperity-600 dark:text-prosperity-400">
                                                {formatCurrency(netProceeds, holding.currency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between pt-2 border-t border-prosperity-200 dark:border-prosperity-800">
                                            <span className="text-gray-600 dark:text-gray-400">{t('sell.label.estimatedPnl')}</span>
                                            <span className={cn(
                                                "font-bold text-base",
                                                estimatedGainLoss >= 0 ? "text-prosperity-600 dark:text-prosperity-400" : "text-error-600 dark:text-error-400"
                                            )}>
                                                {estimatedGainLoss >= 0 ? '+' : ''}{formatCurrency(estimatedGainLoss, holding.currency)}
                                                {' '}({estimatedGainLossPct >= 0 ? '+' : ''}{estimatedGainLossPct.toFixed(2)}%)
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-prosperity-200 dark:border-prosperity-800">
                                            <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                                                <BanknotesIcon className="h-4 w-4" />
                                                {t('sell.label.newCashBalance')}
                                            </span>
                                            <span className="font-bold text-primary-600 dark:text-primary-400">
                                                {formatCurrency(newCashBalance, holding.currency)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Error Message */}
                            {error && (
                                <div className="bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg p-3">
                                    <p className="text-sm text-error-600 dark:text-error-400">{error}</p>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setStep('select')}
                                    disabled={isSubmitting}
                                    className="flex-1"
                                >
                                    {t('sell.back')}
                                </Button>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={!canSubmit}
                                    className="flex-1 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                            {t('sell.processing')}
                                        </>
                                    ) : (
                                        quantityNum > 0 ? t('sell.confirmWithQuantity', { count: quantityNum }) : t('sell.confirm')
                                    )}
                                </Button>
                            </div>
                        </form>
                    )}
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
