'use client';

import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon, MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import symbolService from '@/services/symbolService';
import { useScrollLock } from '@/hooks/useScrollLock';

interface BuyHoldingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBuy: (params: {
        symbol: string;
        name: string;
        type: string;
        walletType: string;
        quantity: number;
        averageCost: number;
        currency: string;
        exchange: string;
        purchaseDate: string;
        notes?: string;
    }) => Promise<void>;
    existingHoldings?: Array<{ symbol: string; name: string; type: string; currency: string; exchange: string }>;
}

interface StockSearchResult {
    symbol?: string;
    ticker?: string;
    name?: string;
    shortName?: string;
    type?: string;
    quoteType?: string;
    currency?: string;
    exchange?: string;
    regularMarketPrice?: number;
}

// Keys, not strings: this array is built at module load, where there is no `t`.
const WALLET_TYPES = [
    { value: 'portfolio', labelKey: 'buy.wallet.portfolio.label', descriptionKey: 'buy.wallet.portfolio.description', icon: '📈', color: 'from-purple-500 to-pink-500' },
    { value: 'emergency', labelKey: 'buy.wallet.emergency.label', descriptionKey: 'buy.wallet.emergency.description', icon: '🚨', color: 'from-orange-500 to-red-500' },
];

const INVESTMENT_TYPES = [
    { value: 'stock', label: 'Stock' },
    { value: 'etf', label: 'ETF' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'cash', label: 'Cash' },
    { value: 'bond', label: 'Bond' },
];

const CURRENCIES = ['TWD', 'USD', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];

export function BuyHoldingModal({ isOpen, onClose, onBuy, existingHoldings = [] }: BuyHoldingModalProps) {
    const { t } = useTranslation('portfolio');
    // Headless UI locks the document element, but <main> is this app's scroll
    // container — lock that too or the page slides behind the dialog.
    useScrollLock(isOpen);
    const [step, setStep] = useState<'search' | 'details'>('search');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [_selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);

    // Form fields
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [type, setType] = useState('stock');
    const [walletType, setWalletType] = useState('portfolio');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [currency, setCurrency] = useState('TWD');
    const [exchange, setExchange] = useState('TWSE');
    const [purchaseDate, setPurchaseDate] = useState(localDateString());
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Search for stocks
    useEffect(() => {
        const searchStocks = async () => {
            if (!searchQuery || searchQuery.length < 2) {
                setSearchResults([]);
                return;
            }

            setIsSearching(true);
            try {
                const response = await symbolService.searchSymbol(searchQuery);
                if (response.success && response.data) {
                    setSearchResults(response.data.slice(0, 10));
                }
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                setIsSearching(false);
            }
        };

        const debounce = setTimeout(searchStocks, 300);
        return () => clearTimeout(debounce);
    }, [searchQuery]);

    const handleSelectStock = (stock: StockSearchResult) => {
        setSelectedStock(stock);
        setSymbol(stock.symbol || stock.ticker || '');
        setName(stock.name || stock.shortName || '');
        setType(stock.quoteType?.toLowerCase() === 'equity' ? 'stock' : 'etf');
        setCurrency(stock.currency || 'TWD');
        setExchange(stock.exchange || 'TWSE');
        setPrice(stock.regularMarketPrice?.toString() || '');
        setStep('details');
    };

    const handleSelectExisting = (holding: { symbol: string; name: string; type: string; currency: string; exchange: string }) => {
        setSymbol(holding.symbol);
        setName(holding.name);
        setType(holding.type);
        setCurrency(holding.currency);
        setExchange(holding.exchange);
        setStep('details');
    };

    const handleManualEntry = () => {
        setStep('details');
    };

    const quantityNum = parseFloat(quantity) || 0;
    const priceNum = parseFloat(price) || 0;
    const totalCost = quantityNum * priceNum;

    const canSubmit = symbol && name && quantityNum > 0 && priceNum > 0 && !isSubmitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!canSubmit) return;

        setIsSubmitting(true);
        try {
            await onBuy({
                symbol: symbol.toUpperCase(),
                name,
                type,
                walletType,
                quantity: quantityNum,
                averageCost: priceNum,
                currency,
                exchange,
                purchaseDate,
                notes: notes.trim() || undefined,
            });

            // Reset and close
            handleReset();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to add holding');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setStep('search');
        setSearchQuery('');
        setSearchResults([]);
        setSelectedStock(null);
        setSymbol('');
        setName('');
        setType('stock');
        setWalletType('portfolio');
        setQuantity('');
        setPrice('');
        setCurrency('TWD');
        setExchange('TWSE');
        setPurchaseDate(localDateString());
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
                            {step === 'search' ? t('buy.title') : t('buy.titleDetails')}
                        </DialogTitle>
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Close dialog"
                            className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                            <XMarkIcon className="w-6 h-6" aria-hidden="true" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 max-h-[calc(100vh-12rem)] overflow-y-auto">
                        {step === 'search' ? (
                            <div className="space-y-6">
                                {/* Search Bar */}
                                <div>
                                    <label htmlFor="buyholding-field" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {t('buy.searchLabel')}
                                    </label>
                                    <div className="relative">
                                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 dark:text-gray-400" />
                                        <input
                                            id="buyholding-field"
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={t('buy.searchPlaceholder')}
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            autoFocus
                                        />
                                        {isSearching && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Search Results */}
                                {searchResults.length > 0 && (
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('buy.searchResults')}</h3>
                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {searchResults.map((stock, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleSelectStock(stock)}
                                                    className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors text-left"
                                                >
                                                    <div className="flex-1">
                                                        <div className="font-medium text-gray-900 dark:text-white">
                                                            {stock.symbol || stock.ticker}
                                                        </div>
                                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                                            {stock.name || stock.shortName}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                            {stock.regularMarketPrice ? `$${stock.regularMarketPrice.toFixed(2)}` : ''}
                                                        </div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            {stock.exchange}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Existing Holdings */}
                                {existingHoldings.length > 0 && (
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('buy.addToExisting')}</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {existingHoldings.slice(0, 6).map((holding, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleSelectExisting(holding)}
                                                    className="p-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors text-left"
                                                >
                                                    <div className="font-medium text-blue-900 dark:text-blue-300 text-sm">
                                                        {holding.symbol}
                                                    </div>
                                                    <div className="text-xs text-blue-700 dark:text-blue-400 truncate">
                                                        {holding.name}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Manual Entry */}
                                <button
                                    onClick={handleManualEntry}
                                    className="w-full p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-500 dark:hover:border-primary-400 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 font-medium"
                                >
                                    {t('buy.manualEntry')}
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {/* Stock Info */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="buyholding-field-2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.symbol')}
                                        </label>
                                        <input
                                            id="buyholding-field-2"
                                            type="text"
                                            value={symbol}
                                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="buyholding-field-3" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.name')}
                                        </label>
                                        <input
                                            id="buyholding-field-3"
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            required
                                        />
                                    </div>
                                </div>

                                {/* Type and Currency */}
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label htmlFor="buyholding-field-4" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.type')}
                                        </label>
                                        <select
                                            id="buyholding-field-4"
                                            value={type}
                                            onChange={(e) => setType(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        >
                                            {INVESTMENT_TYPES.map(investmentType => (
                                                <option key={investmentType.value} value={investmentType.value}>{investmentType.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="buyholding-field-5" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.currency')}
                                        </label>
                                        <select
                                            id="buyholding-field-5"
                                            value={currency}
                                            onChange={(e) => setCurrency(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        >
                                            {CURRENCIES.map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="buyholding-field-6" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.exchange')}
                                        </label>
                                        <input
                                            id="buyholding-field-6"
                                            type="text"
                                            value={exchange}
                                            onChange={(e) => setExchange(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        />
                                    </div>
                                </div>

                                {/* Wallet Type */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                                        {t('buy.field.wallet')}
                                    </label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {WALLET_TYPES.map((wallet) => (
                                            <button
                                                key={wallet.value}
                                                type="button"
                                                onClick={() => setWalletType(wallet.value)}
                                                className={cn(
                                                    'p-4 rounded-xl border-2 transition-all text-left',
                                                    walletType === wallet.value
                                                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-md'
                                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                )}
                                            >
                                                <div className="text-2xl mb-1">{wallet.icon}</div>
                                                <div className="font-medium text-sm text-gray-900 dark:text-white">
                                                    {t(wallet.labelKey)}
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    {t(wallet.descriptionKey)}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Quantity and Price */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="buyholding-field-7" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.quantity')}
                                        </label>
                                        <input
                                            id="buyholding-field-7"
                                            type="number"
                                            inputMode="decimal"
                                            onWheel={(e) => e.currentTarget.blur()}
                                            step="any"
                                            value={quantity}
                                            onChange={(e) => setQuantity(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="buyholding-field-8" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t('buy.field.price')}
                                        </label>
                                        <input
                                            id="buyholding-field-8"
                                            type="number"
                                            inputMode="decimal"
                                            onWheel={(e) => e.currentTarget.blur()}
                                            step="any"
                                            value={price}
                                            onChange={(e) => setPrice(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            required
                                        />
                                    </div>
                                </div>

                                {/* Purchase Date */}
                                <div>
                                    <label htmlFor="buyholding-field-9" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {t('buy.field.date')}
                                    </label>
                                    <input
                                        id="buyholding-field-9"
                                        type="date"
                                        value={purchaseDate}
                                        onChange={(e) => setPurchaseDate(e.target.value)}
                                        max={localDateString()}
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        required
                                    />
                                </div>

                                {/* Notes */}
                                <div>
                                    <label htmlFor="buyholding-field-10" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {t('buy.field.notes')}
                                    </label>
                                    <textarea
                                        id="buyholding-field-10"
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={2}
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                                        placeholder={t('buy.notesPlaceholder')}
                                    />
                                </div>

                                {/* Total Cost Summary */}
                                {totalCost > 0 && (
                                    <div className="p-4 bg-prosperity-50 dark:bg-prosperity-900/20 rounded-lg border border-prosperity-200 dark:border-prosperity-800">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-prosperity-900 dark:text-prosperity-300">
                                                {t('buy.totalCost')}
                                            </span>
                                            <span className="text-xl font-bold text-prosperity-900 dark:text-prosperity-300">
                                                {formatCurrency(totalCost, currency)}
                                            </span>
                                        </div>
                                        <div className="text-xs text-prosperity-700 dark:text-prosperity-400 mt-1">
                                            {t('buy.sharesTimesPrice', { count: quantityNum, price: formatCurrency(priceNum, currency) })}
                                        </div>
                                    </div>
                                )}

                                {/* Error Message */}
                                {error && (
                                    <div className="p-3 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg text-sm text-error-700 dark:text-error-400">
                                        {error}
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setStep('search')}
                                        disabled={isSubmitting}
                                        className="flex-1"
                                    >
                                        {t('buy.back')}
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={!canSubmit}
                                        className="flex-1 flex items-center justify-center gap-2"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                                {t('buy.processing')}
                                            </>
                                        ) : (
                                            t('buy.confirm')
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
