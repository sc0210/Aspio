'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeftIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { transactionService } from '@/services/transactionService';
import { portfolioService } from '@/services/portfolioService';
import { loanService } from '@/services/loanService';
import { Transaction, PortfolioHolding } from '@/shared/types';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDemo } from '@/contexts/DemoContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { localDateString, formatCurrency } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

const TRANSACTION_TYPES = [
  { value: 'expense',    label: 'Expense',    icon: '💸', color: 'red'    },
  { value: 'income',     label: 'Income',     icon: '💰', color: 'green'  },
  { value: 'transfer',   label: 'Transfer',   icon: '🔄', color: 'blue'   },
  { value: 'investment', label: 'Investment', icon: '📈', color: 'purple' },
];

const CATEGORIES = {
  expense: [
    { value: 'Dining',          label: 'Dining',     icon: '🍽️' },
    { value: 'Groceries',       label: 'Groceries',  icon: '🛒' },
    { value: 'Transportation',  label: 'Transport',  icon: '🚗' },
    { value: 'Shopping',        label: 'Shopping',   icon: '🛍️' },
    { value: 'Entertainment',   label: 'Fun',        icon: '🎬' },
    { value: 'Healthcare',      label: 'Health',     icon: '🏥' },
    { value: 'Housing',         label: 'Housing',    icon: '🏠' },
    { value: 'Utilities',       label: 'Utilities',  icon: '💡' },
    { value: 'Travel',          label: 'Travel',     icon: '✈️' },
    { value: 'Gift',            label: 'Gift',       icon: '🎁' },
    { value: 'Loan Payment',    label: 'Loan',       icon: '💳' },
    { value: 'Others',          label: 'Others',     icon: '📦' },
  ],
  income: [
    { value: 'Salary',             label: 'Salary',     icon: '💼' },
    { value: 'Freelance',          label: 'Freelance',  icon: '💻' },
    { value: 'Investment Returns', label: 'Investment', icon: '📈' },
    { value: 'Gift',               label: 'Gift',       icon: '🎁' },
    { value: 'Others',             label: 'Others',     icon: '💵' },
  ],
};

const PAYMENT_METHODS = [
  { value: 'cash',           label: 'Cash',          icon: '💵', color: 'bg-green-50 dark:bg-green-900/20'  },
  { value: 'credit_card',    label: 'Credit Card',   icon: '💳', color: 'bg-blue-50 dark:bg-blue-900/20'   },
  { value: 'bank_transfer',  label: 'Bank Transfer', icon: '🏦', color: 'bg-gray-50 dark:bg-gray-700'      },
  { value: 'digital_wallet', label: 'E-Wallet',      icon: '📱', color: 'bg-orange-50 dark:bg-orange-900/20' },
];

// Life and Emergency are the only cash wallets. The Portfolio wallet holds
// invested assets only — never cash — so it is not a valid wallet for income/
// expense entries OR transfers. To move cash into investments you buy a holding
// (which debits the Life Wallet).
const WALLET_TYPES = [
  { value: 'life',      label: 'Life Wallet',      icon: '💳', color: 'bg-blue-50 dark:bg-blue-900/20',     description: 'Daily income/expenses' },
  { value: 'emergency', label: 'Emergency Wallet', icon: '🚨', color: 'bg-orange-50 dark:bg-orange-900/20', description: 'Emergency fund'        },
];

const INCOME_EXPENSE_WALLET_TYPES = WALLET_TYPES;

export default function AddTransactionPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isDemo } = useModeAwareUI();
  const { addDemoTransaction } = useDemo();
  const { t } = useTranslation(['transactions']);
  const { data: currentUser } = useCurrentUser();

  const [formData, setFormData] = useState({
    type: 'expense',
    amount: '',
    description: '',
    category: '',
    paymentMethod: '',
    walletType: 'life',
    fromWallet: 'life',
    toWallet: 'emergency',
    date: localDateString(),
    tags: [] as string[],
    currency: 'TWD',
    loanId: '',
  });

  // Investment sub-form state
  const [investSide, setInvestSide]         = useState<'buy' | 'sell'>('buy');
  const [investAssetType, setInvestAssetType] = useState<'stock' | 'etf' | 'crypto' | 'bond'>('stock');
  const [investSymbol, setInvestSymbol]     = useState('');
  const [investName, setInvestName]         = useState('');
  const [investQty, setInvestQty]           = useState('');
  const [investPrice, setInvestPrice]       = useState('');
  const [investCurrency, setInvestCurrency] = useState('TWD');
  // Sell side: pick a holding (the backend draws down all lots of its symbol,
  // oldest-first/FIFO) and a quantity; price is optional (defaults to market).
  const [investHoldingId, setInvestHoldingId] = useState('');
  const [investSellQty, setInvestSellQty]   = useState('');

  const [tagInput, setTagInput]   = useState('');
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  useEffect(() => {
    if (formData.type !== 'investment' || investSide !== 'sell' || isDemo) return;
    setHoldingsLoading(true);
    portfolioService.getPortfolio()
      .then(res => {
        if (res.success && res.data) setPortfolioHoldings(res.data.holdings ?? []);
      })
      .catch(() => {})
      .finally(() => setHoldingsLoading(false));
  }, [formData.type, investSide, isDemo]);

  const [activeLoans, setActiveLoans] = useState<{ id: string; name: string; current_balance: number; currency: string }[]>([]);
  useEffect(() => {
    if (isDemo) return;
    loanService.getLoans()
      .then(res => {
        if (res.success && res.data) {
          setActiveLoans(
            res.data
              .filter(l => l.status === 'active')
              .map(l => ({ id: l.id, name: l.name, current_balance: l.current_balance, currency: l.currency }))
          );
        }
      })
      .catch(() => {});
  }, [isDemo]);

  // Default the currency selectors to the user's account preference (falls
  // back to 'TWD' if unset/unauthenticated) instead of always starting on
  // TWD. Only applies once, before the user picks a currency themselves —
  // the refs guard against a late-arriving profile fetch stomping a manual
  // selection.
  const hasUserSetCurrencyRef = useRef(false);
  const hasUserSetInvestCurrencyRef = useRef(false);
  useEffect(() => {
    const preferred = currentUser?.preferred_currency;
    if (!preferred) return;
    if (!hasUserSetCurrencyRef.current) {
      setFormData(prev => (prev.currency === preferred ? prev : { ...prev, currency: preferred }));
    }
    if (!hasUserSetInvestCurrencyRef.current) {
      setInvestCurrency(prev => (prev === preferred ? prev : preferred));
    }
  }, [currentUser?.preferred_currency]);

  const handleInputChange = (field: string, value: string) => {
    if (field === 'currency') hasUserSetCurrencyRef.current = true;
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (formData.type === 'investment') {
      if (investSide === 'buy') {
        if (!investSymbol.trim()) newErrors.investSymbol = t('transactions:form.invest.errSymbol', 'Enter a symbol');
        const qty = parseFloat(investQty);
        const price = parseFloat(investPrice);
        if (!investQty || isNaN(qty) || qty <= 0) newErrors.investQty = t('transactions:form.invest.errQty', 'Enter quantity');
        if (!investPrice || isNaN(price) || price <= 0) newErrors.investPrice = t('transactions:form.invest.errPrice', 'Enter price per unit');
      } else {
        if (!investHoldingId) newErrors.investHolding = t('transactions:form.invest.errHolding', 'Select a holding to sell');
        const sq = parseFloat(investSellQty);
        if (!investSellQty || isNaN(sq) || sq <= 0) newErrors.investSellQty = t('transactions:form.invest.errSellQty', 'Enter a quantity to sell');
      }
    } else if (formData.type !== 'transfer') {
      if (!formData.amount || parseFloat(formData.amount) <= 0) newErrors.amount = 'Enter amount';
      if (!formData.description.trim()) newErrors.description = 'Add description';
      if (!formData.category) newErrors.category = 'Select category';
    } else {
      if (!formData.amount || parseFloat(formData.amount) <= 0) newErrors.amount = 'Enter amount';
      if (!formData.description.trim()) newErrors.description = 'Add description';
      if (formData.fromWallet === formData.toWallet) {
        newErrors.transfer = 'Source and destination wallets must be different';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (isDemo) {
      if (formData.type === 'transfer') {
        // A transfer is two rows sharing a transfer_group_id — an expense leg out
        // of the source wallet and an income leg into the destination — exactly
        // as the backend writes it (and as the demo fixture pair is shaped).
        const transferGroupId = `demo-transfer-${crypto.randomUUID()}`;
        const leg = {
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          description: formData.description,
          date: formData.date,
          category: 'Transfer',
          tags: formData.tags,
          transferGroupId,
        };
        addDemoTransaction({ ...leg, type: 'income', walletType: formData.toWallet as 'life' | 'emergency' });
        addDemoTransaction({ ...leg, type: 'expense', walletType: formData.fromWallet as 'life' | 'emergency' });
        toast.success(t('common:demoAlert.changesSimulated'));
      } else if (formData.type === 'investment') {
        // Add-holding in demo is the portfolio flow's to simulate; nothing lands
        // in the demo portfolio yet.
        toast.success('Demo: action simulated — sign up to save real data');
      } else {
        addDemoTransaction({
          type: formData.type as 'income' | 'expense',
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          description: formData.description,
          date: formData.date,
          category: formData.category,
          paymentMethod: formData.paymentMethod || undefined,
          walletType: formData.walletType as 'life' | 'emergency' | undefined,
          tags: formData.tags,
        });
        toast.success('Demo transaction added — sign up to save real data');
      }
      router.push('/transactions');
      return;
    }

    setIsSubmitting(true);
    try {
      if (formData.type === 'transfer') {
        const response = await transactionService.createTransfer({
          fromWallet: formData.fromWallet as 'life' | 'emergency',
          toWallet: formData.toWallet as 'life' | 'emergency',
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          date: formData.date,
          notes: formData.description,
        });
        if (response.success) {
          await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
          invalidateDashboardData(queryClient);
          toast.success(t('transactions:toast.transferCreated'));
          router.push('/transactions');
        } else {
          toast.error(response.message || t('transactions:toast.transferFailed'));
        }

      } else if (formData.type === 'investment') {
        if (investSide === 'buy') {
          const sym = investSymbol.trim().toUpperCase();
          const qty = parseFloat(investQty);
          const price = parseFloat(investPrice);

          // Auto-detect exchange from symbol / type
          let exchange = 'NYSE';
          if (investAssetType === 'crypto') exchange = 'CRYPTO';
          else if (/^\d+$/.test(sym)) exchange = 'TWSE';

          // Convert YYYY-MM-DD to full ISO datetime (backend expects datetime, not date)
          const purchaseDateISO = formData.date
            ? new Date(formData.date).toISOString()
            : undefined;

          const holdingResponse = await portfolioService.addHolding({
            symbol: sym,
            name: investName.trim() || sym,
            type: investAssetType,
            quantity: qty,
            averageCost: price,
            exchange,
            currency: investCurrency,
            walletType: 'portfolio',
            purchaseDate: purchaseDateISO,
          }, { aggregate: true });

          if (holdingResponse.success) {
            await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
            await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
            invalidateDashboardData(queryClient);
            toast.success(`Bought ${sym} — holding & expense recorded`);
            router.push('/transactions');
          } else {
            toast.error(holdingResponse.message || t('transactions:toast.createFailed'));
          }
        } else {
          // Sell: real FIFO sell via the portfolio endpoint — draws down the
          // holding's lots (oldest first), records realized P/L, and credits net
          // proceeds to the Life Wallet. (Previously this only logged a fake
          // income and left the holding untouched — double-counting.)
          const priceNum = parseFloat(investPrice);
          const response = await portfolioService.sellHolding({
            holdingId: investHoldingId,
            quantity: parseFloat(investSellQty),
            price: investPrice && !isNaN(priceNum) && priceNum > 0 ? priceNum : undefined,
            transactionDate: formData.date ? new Date(formData.date).toISOString() : undefined,
          });
          if (response.success && response.data) {
            await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
            await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
            invalidateDashboardData(queryClient);
            const d = response.data;
            const pl = Math.round(d.realizedGainLoss);
            toast.success(
              `Sold ${d.quantitySold} ${d.symbol} · net ${Math.round(d.netProceeds).toLocaleString()} ${investCurrency} · P/L ${pl >= 0 ? '+' : ''}${pl.toLocaleString()}`
            );
            router.push('/transactions');
          } else {
            toast.error(response.message || t('transactions:toast.createFailed'));
          }
        }

      } else {
        const txData: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { loan_id?: string } = {
          type: formData.type as 'income' | 'expense',
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          description: formData.description,
          date: formData.date,
          category: formData.category,
          paymentMethod: formData.paymentMethod || undefined,
          walletType: formData.walletType as 'life' | 'emergency' | undefined,
          tags: formData.tags,
          ...(formData.type === 'expense' && formData.loanId ? { loan_id: formData.loanId } : {}),
        };
        const response = await transactionService.createTransaction(txData);
        if (response.success) {
          await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
          invalidateDashboardData(queryClient);
          if (formData.loanId) {
            await queryClient.invalidateQueries({ queryKey: ['loans'] });
          }
          toast.success(t('transactions:toast.created'));
          router.push('/transactions');
        } else {
          toast.error(response.message || t('transactions:toast.createFailed'));
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('transactions:toast.createFailed');
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().replace(/^#/, '');
    if (tag && !formData.tags.includes(tag)) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tagToRemove) }));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); }
    else if (e.key === 'Backspace' && tagInput === '' && formData.tags.length > 0) {
      handleRemoveTag(formData.tags[formData.tags.length - 1]);
    }
  };

  const currentCategories = formData.type === 'transfer' ? [] : CATEGORIES[formData.type as keyof typeof CATEGORIES] || [];

  // ─── type-button active colours ───────────────────────────────────────────
  const activeClass: Record<string, string> = {
    red:    'bg-expense-500 text-white shadow-md',
    green:  'bg-income-500 text-white shadow-md',
    blue:   'bg-blue-500 text-white shadow-md',
    purple: 'bg-violet-600 text-white shadow-md',
  };
  const inactiveClass = 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600';

  const submitLabel =
    formData.type === 'investment'
      ? investSide === 'buy' ? 'Buy & Add to Portfolio' : 'Record Sale'
      : 'Add Transaction';

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-2 sm:py-4">
        {/* Header */}
        <div className="flex items-center mb-4 sm:mb-6">
          <Link
            href="/transactions"
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors mr-4"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-2" />
            Back to Transactions
          </Link>
        </div>

        <Card padding="lg" radius="xl" shadow="none">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* ── Transaction Type ── */}
            <div>
              <div id="tx-group-type" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.typeLabel', 'Transaction Type')}</div>
              <div role="group" aria-labelledby="tx-group-type" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TRANSACTION_TYPES.map((type) => (
                  <button
                    aria-pressed={formData.type === type.value}
                    key={type.value}
                    type="button"
                    onClick={() => {
                      handleInputChange('type', type.value);
                      handleInputChange('category', '');
                    }}
                    className={cn(
                      'py-2.5 px-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 text-sm',
                      formData.type === type.value ? activeClass[type.color] : inactiveClass
                    )}
                  >
                    <span className="text-lg">{type.icon}</span>
                    <span>{t(`transactions:form.types.${type.value}`, type.label)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                INVESTMENT FORM
            ══════════════════════════════════════════════════════════════ */}
            {formData.type === 'investment' && (() => {
              const qty   = parseFloat(investQty)   || 0;
              const price = parseFloat(investPrice) || 0;
              const total = qty * price;
              const fmtTotal = total > 0
                ? total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                : '0';
              const sellableHoldings = portfolioHoldings.filter(
                (h) => (h.walletType === 'portfolio' || !h.walletType) && Number(h.quantity) > 0
              );
              const selectedHolding = sellableHoldings.find((h) => h.id === investHoldingId);

              return (
                <>
                  {/* Buy / Sell toggle */}
                  <div>
                    <div id="tx-group-invest-side" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.invest.action', 'Action')}</div>
                    <div role="group" aria-labelledby="tx-group-invest-side" className="flex gap-2">
                      {(['buy', 'sell'] as const).map((side) => (
                        <button
                          aria-pressed={investSide === side}
                          key={side}
                          type="button"
                          onClick={() => setInvestSide(side)}
                          className={cn(
                            'flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border-2 transition-all',
                            investSide === side
                              ? side === 'buy'
                                ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                                : 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                          )}
                        >
                          <span className="text-xl">{side === 'buy' ? '📥' : '📤'}</span>
                          {side === 'buy' ? t('transactions:form.invest.buyAsset', 'Buy Asset') : t('transactions:form.invest.sellAsset', 'Sell Asset')}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── BUY fields ── */}
                  {investSide === 'buy' && (
                    <>
                      {/* Asset Type */}
                      <div>
                        <div id="tx-group-asset-type" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.invest.assetType', 'Asset Type')}</div>
                        <div role="group" aria-labelledby="tx-group-asset-type" className="grid grid-cols-4 gap-2">
                          {([
                            { value: 'stock',  label: 'Stock',  icon: '📊' },
                            { value: 'etf',    label: 'ETF',    icon: '📦' },
                            { value: 'crypto', label: 'Crypto', icon: '₿'  },
                            { value: 'bond',   label: 'Bond',   icon: '📋' },
                          ] as const).map((opt) => (
                            <button
                              aria-pressed={investAssetType === opt.value}
                              key={opt.value}
                              type="button"
                              onClick={() => setInvestAssetType(opt.value)}
                              className={cn(
                                'py-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 border-2 transition-all',
                                investAssetType === opt.value
                                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-violet-300'
                              )}
                            >
                              <span className="text-base">{opt.icon}</span>
                              {t(`transactions:form.invest.types.${opt.value}`, opt.label)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Symbol + Name row */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <label htmlFor="tx-invest-symbol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('transactions:form.invest.symbol', 'Symbol')} <span className="text-error-500">*</span>
                          </label>
                          <input
                            aria-invalid={!!errors.investSymbol}
                            aria-describedby={errors.investSymbol ? "tx-invest-symbol-error" : undefined}
                            id="tx-invest-symbol"
                            type="text"
                            value={investSymbol}
                            onChange={(e) => setInvestSymbol(e.target.value.toUpperCase())}
                            placeholder={t('transactions:form.invest.symbolPlaceholder', 'e.g. 006208, AAPL, BTC')}
                            autoFocus
                            className={cn(
                              'w-full bg-transparent border rounded-lg px-3 py-2 text-sm font-mono font-semibold text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500 uppercase',
                              errors.investSymbol ? 'border-error-400' : 'border-gray-300 dark:border-gray-600'
                            )}
                          />
                          {errors.investSymbol && <p id="tx-invest-symbol-error" role="alert" className="text-xs text-error-500 mt-1">{errors.investSymbol}</p>}
                        </div>
                        <div className="flex-1">
                          <label htmlFor="tx-invest-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('transactions:form.invest.name', 'Name')} <span className="text-xs text-gray-400 font-normal italic">{t('transactions:form.optional', '(optional)')}</span>
                          </label>
                          <input
                            id="tx-invest-name"
                            type="text"
                            value={investName}
                            onChange={(e) => setInvestName(e.target.value)}
                            placeholder={t('transactions:form.invest.namePlaceholder', 'e.g. 富邦台灣50')}
                            className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500"
                          />
                        </div>
                      </div>

                      {/* Quantity + Price row */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <label htmlFor="tx-invest-quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('transactions:form.invest.quantity', 'Quantity')} <span className="text-error-500">*</span>
                          </label>
                          <input
                            aria-invalid={!!errors.investQty}
                            aria-describedby={errors.investQty ? "tx-invest-quantity-error" : undefined}
                            id="tx-invest-quantity"
                            type="number"
                            inputMode="decimal"
                            onWheel={(e) => e.currentTarget.blur()}
                            step="any"
                            min="0"
                            value={investQty}
                            onChange={(e) => setInvestQty(e.target.value)}
                            placeholder={t('transactions:form.invest.quantityPlaceholder', 'e.g. 100')}
                            className={cn(
                              'w-full bg-transparent border rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500',
                              errors.investQty ? 'border-error-400' : 'border-gray-300 dark:border-gray-600'
                            )}
                          />
                          {errors.investQty && <p id="tx-invest-quantity-error" role="alert" className="text-xs text-error-500 mt-1">{errors.investQty}</p>}
                        </div>
                        <div className="flex-1">
                          <label htmlFor="tx-invest-priceperunit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="text-error-500">*</span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={t('transactions:form.currency', 'Currency')}
                              value={investCurrency}
                              onChange={(e) => { hasUserSetInvestCurrencyRef.current = true; setInvestCurrency(e.target.value); }}
                              className="bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 focus-visible:ring-2 focus-visible:ring-violet-500"
                            >
                              {['TWD', 'USD', 'HKD', 'JPY', 'EUR', 'SGD'].map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <input
                              aria-invalid={!!errors.investPrice}
                              aria-describedby={errors.investPrice ? "tx-invest-priceperunit-error" : undefined}
                              id="tx-invest-priceperunit"
                              type="number"
                              inputMode="decimal"
                              onWheel={(e) => e.currentTarget.blur()}
                              step="any"
                              min="0"
                              value={investPrice}
                              onChange={(e) => setInvestPrice(e.target.value)}
                              placeholder="0.00"
                              className={cn(
                                'flex-1 bg-transparent border rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500',
                                errors.investPrice ? 'border-error-400' : 'border-gray-300 dark:border-gray-600'
                              )}
                            />
                          </div>
                          {errors.investPrice && <p id="tx-invest-priceperunit-error" role="alert" className="text-xs text-error-500 mt-1">{errors.investPrice}</p>}
                        </div>
                      </div>

                      {/* Auto-calculated total + Date */}
                      <div className="flex flex-col sm:flex-row gap-3 items-end">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.invest.totalCost', 'Total Cost')}</div>
                          <div className="flex items-center gap-2 border-2 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 rounded-xl px-4 py-3">
                            <span className="text-sm font-bold text-violet-600 dark:text-violet-400">{investCurrency}</span>
                            <span className="flex-1 text-2xl font-black text-violet-700 dark:text-violet-300 tabular-nums">{fmtTotal}</span>
                            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400">{t('transactions:form.invest.expenseBadge', 'EXPENSE')}</span>
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                            {qty > 0 && price > 0 ? `${qty} × ${price} = ` : ''}<strong>{t('transactions:form.wallets.life', 'Life Wallet')}</strong> {t('transactions:form.invest.buyFlowSuffix', 'outflow → Portfolio')}
                          </p>
                        </div>
                        <div className="w-full sm:w-36">
                          <label htmlFor="tx-invest-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.invest.date', 'Date')}</label>
                          <input
                            id="tx-invest-date"
                            type="date"
                            value={formData.date}
                            onChange={(e) => handleInputChange('date', e.target.value)}
                            className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-violet-500"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── SELL fields ── */}
                  {investSide === 'sell' && (
                    <>
                      <div className="flex items-start gap-3 p-3 rounded-lg text-sm bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
                        <span className="text-base mt-0.5">💡</span>
                        <span>{t('transactions:form.invest.sellHintPrefix', 'Sells units from your portfolio (oldest lots first), records the realized gain/loss, and returns the net proceeds to your')} <strong>{t('transactions:form.wallets.life', 'Life Wallet')}</strong>.</span>
                      </div>

                      {holdingsLoading ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">{t('transactions:form.invest.loadingHoldings', 'Loading holdings…')}</p>
                      ) : sellableHoldings.length === 0 ? (
                        <div className="text-center text-sm text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl py-6 px-4">
                          {t('transactions:form.invest.noHoldingsPrefix', 'No holdings to sell yet. Use')} <strong>{t('transactions:form.invest.buyAsset', 'Buy Asset')}</strong> {t('transactions:form.invest.noHoldingsSuffix', '(or the Portfolio page) to add one first.')}
                        </div>
                      ) : (
                        <>
                          {/* Holding picker (required) */}
                          <div>
                            <div id="tx-group-holding" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              {t('transactions:form.invest.selectHolding', 'Select Holding')} <span className="text-error-500">*</span>
                            </div>
                            <div role="group" aria-labelledby="tx-group-holding" className="flex gap-2 overflow-x-auto pb-1 snap-x">
                              {sellableHoldings.map((h) => (
                                <button
                                  aria-pressed={investHoldingId === h.id}
                                  key={h.id}
                                  type="button"
                                  onClick={() => {
                                    setInvestHoldingId(h.id);
                                    setInvestSymbol(h.symbol);
                                    setInvestName(h.name);
                                    setInvestCurrency(h.currency);
                                    setInvestSellQty(String(h.quantity));
                                  }}
                                  className={cn(
                                    'flex-shrink-0 snap-start flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border-2 text-left transition-all min-w-[100px]',
                                    investHoldingId === h.id
                                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30'
                                      : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-700 bg-white dark:bg-gray-800'
                                  )}
                                >
                                  <span className="text-xs font-bold font-mono text-gray-900 dark:text-white">{h.symbol}</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[88px]">{h.name}</span>
                                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{h.quantity} {t('transactions:form.invest.units', 'units')}</span>
                                </button>
                              ))}
                            </div>
                            {errors.investHolding && <p className="text-xs text-error-500 mt-1">{errors.investHolding}</p>}
                          </div>

                          {/* Quantity + optional price */}
                          <div className="flex flex-col sm:flex-row gap-3">
                            <div className="flex-1">
                              <label htmlFor="tx-invest-quantitytosell" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('transactions:form.invest.quantityToSell', 'Quantity to Sell')} <span className="text-error-500">*</span>
                              </label>
                              <input
                                id="tx-invest-quantitytosell"
                                type="number"
                                inputMode="decimal"
                                onWheel={(e) => e.currentTarget.blur()}
                                step="any"
                                min="0"
                                value={investSellQty}
                                onChange={(e) => setInvestSellQty(e.target.value)}
                                placeholder={t('transactions:form.invest.units', 'units')}
                                className={cn(
                                  'w-full bg-transparent border rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-500',
                                  errors.investSellQty ? 'border-error-400' : 'border-gray-300 dark:border-gray-600'
                                )}
                              />
                              {selectedHolding ? (
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('transactions:form.invest.availablePrefix', 'Available:')} <strong>{selectedHolding.quantity}</strong> {t('transactions:form.invest.units', 'units')}</p>
                              ) : errors.investSellQty ? (
                                <p className="text-xs text-error-500 mt-1">{errors.investSellQty}</p>
                              ) : null}
                            </div>
                            <div className="flex-1">
                              <label htmlFor="tx-invest-sell-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="text-xs text-gray-400 font-normal italic">{t('transactions:form.optional', '(optional)')}</span>
                              </label>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 px-1">{investCurrency}</span>
                                <input
                                  id="tx-invest-sell-price"
                                  type="number"
                                  inputMode="decimal"
                                  onWheel={(e) => e.currentTarget.blur()}
                                  step="any"
                                  min="0"
                                  value={investPrice}
                                  onChange={(e) => setInvestPrice(e.target.value)}
                                  placeholder={t('transactions:form.invest.marketPricePlaceholder', 'market price')}
                                  className="flex-1 bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-500"
                                />
                              </div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('transactions:form.invest.leaveBlankMarket', 'Leave blank to use the current market price.')}</p>
                            </div>
                          </div>

                          {/* Date */}
                          <div className="w-full sm:w-36">
                            <label htmlFor="tx-invest-sell-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.invest.date', 'Date')}</label>
                            <input
                              id="tx-invest-sell-date"
                              type="date"
                              value={formData.date}
                              onChange={(e) => handleInputChange('date', e.target.value)}
                              className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-emerald-500"
                            />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              );
            })()}

            {/* ══════════════════════════════════════════════════════════════
                STANDARD FORM — expense / income / transfer
            ══════════════════════════════════════════════════════════════ */}
            {formData.type !== 'investment' && (
              <>
                {/* Date + Description + Amount */}
                <div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="w-full sm:w-36">
                      <label htmlFor="tx-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:fields.date', 'Date')}</label>
                      <input
                        id="tx-date"
                        type="date"
                        value={formData.date}
                        onChange={(e) => handleInputChange('date', e.target.value)}
                        className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="tx-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:fields.description', 'Description')}</label>
                      <input
                        aria-invalid={!!errors.description}
                        aria-describedby={errors.description ? "tx-description-error" : undefined}
                        id="tx-description"
                        type="text"
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                        placeholder={t('transactions:form.descriptionPlaceholder', "What's this for?")}
                        className={cn(
                          'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500',
                          errors.description && 'border-error-400'
                        )}
                        autoFocus
                      />
                      {errors.description && <p id="tx-description-error" role="alert" className="text-xs text-error-500 mt-1">{errors.description}</p>}
                    </div>
                    <div className="w-full sm:w-40">
                      <label htmlFor="tx-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:fields.amount', 'Amount')}</label>
                      <div className="flex items-center gap-1 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2">
                        <select
                          value={formData.currency}
                          onChange={(e) => handleInputChange('currency', e.target.value)}
                          className="bg-transparent text-xs font-bold text-gray-600 dark:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded pr-1 border-r border-gray-200 dark:border-gray-600 mr-1"
                          aria-label={t('transactions:form.currency', 'Currency')}
                        >
                          {['TWD', 'USD', 'HKD', 'JPY', 'EUR', 'SGD'].map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <input
                          aria-invalid={!!errors.amount}
                          aria-describedby={errors.amount ? "tx-amount-error" : undefined}
                          id="tx-amount"
                          type="number"
                          inputMode="decimal"
                          onWheel={(e) => e.currentTarget.blur()}
                          step="0.01"
                          min="0"
                          value={formData.amount}
                          onChange={(e) => handleInputChange('amount', e.target.value)}
                          placeholder="0"
                          className={cn(
                            'flex-1 text-base font-semibold bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:ring-0',
                            errors.amount && 'text-error-500'
                          )}
                        />
                      </div>
                      {errors.amount && <p id="tx-amount-error" role="alert" className="text-xs text-error-500 mt-1">{errors.amount}</p>}
                    </div>
                  </div>
                </div>

                {/* Category (income / expense) */}
                {formData.type !== 'transfer' && (
                  <div>
                    <div id="tx-group-category" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('transactions:form.categoryLabel', 'Category')} {errors.category && <span className="text-error-500 text-xs">*</span>}
                    </div>
                    <div role="group" aria-labelledby="tx-group-category" className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {currentCategories.map((category) => {
                        const isSelected = formData.category === category.value;
                        return (
                          <button
                            aria-pressed={isSelected}
                            key={category.value}
                            type="button"
                            onClick={() => handleInputChange('category', category.value)}
                            className={cn(
                              'flex flex-col items-center gap-1 p-2 rounded-lg transition-all min-h-[72px] touch-manipulation border-2',
                              isSelected
                                ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-500 dark:border-primary-400 shadow-md scale-105'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500 active:scale-95'
                            )}
                          >
                            <span className="text-2xl">{category.icon}</span>
                            <span className={cn(
                              'text-xs font-medium text-center leading-tight',
                              isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'
                            )}>{t(`transactions:form.categories.${category.value}`, category.label)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {errors.category && <p className="text-sm text-error-500 mt-1">{errors.category}</p>}
                  </div>
                )}

                {/* Loan Link (expense only) */}
                {formData.type === 'expense' && activeLoans.length > 0 && (
                  <div>
                    <div id="tx-group-loan" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('transactions:form.linkToLoan', 'Link to Loan')} <span className="text-xs text-gray-400 font-normal italic">{t('transactions:form.linkToLoanHint', '(optional — reduces loan balance)')}</span>
                    </div>
                    <div role="group" aria-labelledby="tx-group-loan" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        aria-pressed={!formData.loanId}
                        type="button"
                        onClick={() => handleInputChange('loanId', '')}
                        className={cn(
                          'flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all duration-200',
                          !formData.loanId
                            ? 'border-gray-400 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                      >
                        <span>🚫</span> {t('transactions:form.loanNone', 'None')}
                      </button>
                      {activeLoans.map(loan => (
                        <button
                          aria-pressed={formData.loanId === loan.id}
                          key={loan.id}
                          type="button"
                          onClick={() => handleInputChange('loanId', loan.id)}
                          className={cn(
                            'flex flex-col items-start gap-0.5 p-3 rounded-xl border-2 text-sm transition-all duration-200',
                            formData.loanId === loan.id
                              ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 shadow-md'
                              : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                          )}
                        >
                          <span className={cn('font-semibold', formData.loanId === loan.id ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300')}>
                            💳 {loan.name}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {t('transactions:form.loanBalance', 'Balance')}: {formatCurrency(loan.current_balance, loan.currency, { precision: 0 })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transfer wallet selection */}
                {formData.type === 'transfer' && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs">
                      <span className="text-base">💡</span>
                      <span>{t('transactions:form.transferHint.use', 'Use')} <strong>{t('transactions:form.types.transfer', 'Transfer')}</strong> {t('transactions:form.transferHint.mid', 'to move cash between wallets. To buy or sell assets, use the')} <strong>{t('transactions:form.types.investment', 'Investment')}</strong> {t('transactions:form.transferHint.end', 'tab instead.')}</span>
                    </div>
                    <div>
                      <div id="tx-group-from-wallet" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.fromWallet', 'From Wallet')} <span className="text-error-500">*</span></div>
                      <div role="group" aria-labelledby="tx-group-from-wallet" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {WALLET_TYPES.map((wallet) => (
                          <button
                            aria-pressed={formData.fromWallet === wallet.value}
                            key={wallet.value}
                            type="button"
                            onClick={() => handleInputChange('fromWallet', wallet.value)}
                            className={cn(
                              'flex flex-col items-start gap-2 p-3 rounded-xl transition-all duration-200 border-2',
                              formData.fromWallet === wallet.value
                                ? 'border-expense-500 bg-expense-50 dark:bg-expense-900/30 shadow-md'
                                : 'border-gray-200 dark:border-gray-700 hover:border-expense-300 dark:hover:border-expense-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                            )}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-lg">{wallet.icon}</span>
                              <span className={cn('text-xs font-semibold', formData.fromWallet === wallet.value ? 'text-expense-700 dark:text-expense-300' : 'text-gray-700 dark:text-gray-300')}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-center"><div className="text-3xl text-blue-500">↓</div></div>
                    <div>
                      <div id="tx-group-to-wallet" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions:form.toWallet', 'To Wallet')} <span className="text-error-500">*</span></div>
                      <div role="group" aria-labelledby="tx-group-to-wallet" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {WALLET_TYPES.map((wallet) => (
                          <button
                            aria-pressed={formData.toWallet === wallet.value}
                            key={wallet.value}
                            type="button"
                            onClick={() => handleInputChange('toWallet', wallet.value)}
                            className={cn(
                              'flex flex-col items-start gap-2 p-3 rounded-xl transition-all duration-200 border-2',
                              formData.toWallet === wallet.value
                                ? 'border-income-500 bg-income-50 dark:bg-income-900/30 shadow-md'
                                : 'border-gray-200 dark:border-gray-700 hover:border-income-300 dark:hover:border-income-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                            )}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-lg">{wallet.icon}</span>
                              <span className={cn('text-xs font-semibold', formData.toWallet === wallet.value ? 'text-income-700 dark:text-income-300' : 'text-gray-700 dark:text-gray-300')}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {errors.transfer && <p className="text-sm text-error-500 text-center">{errors.transfer}</p>}
                  </div>
                )}

                {/* Payment Method (income / expense only) */}
                {formData.type !== 'transfer' && (
                  <div>
                    <div id="tx-group-payment" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('transactions:form.paymentMethodLabel', 'Payment Method')} <span className="text-xs text-gray-400 font-normal italic">{t('transactions:form.optional', '(optional)')}</span>
                    </div>
                    <div role="group" aria-labelledby="tx-group-payment" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {PAYMENT_METHODS.map((method) => (
                        <button
                          aria-pressed={formData.paymentMethod === method.value}
                          key={method.value}
                          type="button"
                          onClick={() => handleInputChange('paymentMethod', method.value)}
                          className={cn(
                            'flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all duration-200 min-h-[72px] touch-manipulation',
                            formData.paymentMethod === method.value
                              ? 'bg-primary-500 dark:bg-primary-600 ring-2 ring-primary-500 ring-offset-2 shadow-lg scale-105'
                              : method.color + ' hover:scale-105 hover:shadow-md active:scale-95'
                          )}
                        >
                          <span className={cn('text-2xl', formData.paymentMethod === method.value && 'scale-110')}>{method.icon}</span>
                          <span className={cn('text-xs font-medium text-center leading-tight', formData.paymentMethod === method.value ? 'text-white' : 'text-gray-700 dark:text-gray-300')}>{t(`transactions:form.paymentMethods.${method.value}`, method.label)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Wallet Type (income / expense only) */}
                {formData.type !== 'transfer' && (
                  <div>
                    <div id="tx-group-wallet-type" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('transactions:form.walletTypeLabel', 'Wallet Type')} <span className="text-error-500">*</span>
                    </div>
                    <div role="group" aria-labelledby="tx-group-wallet-type" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {INCOME_EXPENSE_WALLET_TYPES.map((wallet) => (
                        <button
                          aria-pressed={formData.walletType === wallet.value}
                          key={wallet.value}
                          type="button"
                          onClick={() => handleInputChange('walletType', wallet.value)}
                          className={cn(
                            'flex flex-col items-start gap-2 p-4 rounded-xl transition-all duration-200 border-2',
                            formData.walletType === wallet.value
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 shadow-md'
                              : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                          )}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <span className="text-xl">{wallet.icon}</span>
                            <span className={cn('text-sm font-semibold', formData.walletType === wallet.value ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300')}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                          </div>
                          <p className={cn('text-xs w-full text-left', formData.walletType === wallet.value ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400')}>{t(`transactions:form.walletDescriptions.${wallet.value}`, wallet.description)}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                <div>
                  <label htmlFor="tx-tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('transactions:fields.tags', 'Tags')} <span className="text-xs text-gray-400 font-normal italic">{t('transactions:form.optional', '(optional)')}</span>
                  </label>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">#</span>
                      <input
                        id="tx-tags"
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleTagInputKeyDown}
                        placeholder={t('transactions:form.tagPlaceholder', 'Add a tag (press Enter)')}
                        className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg pl-7 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddTag}
                      disabled={!tagInput.trim()}
                      className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', tagInput.trim() ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed')}
                    >{t('transactions:form.addTag', 'Add')}</button>
                  </div>
                  {formData.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.tags.map((tag) => (
                        <div key={tag} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-sm">
                          <span>#{tag}</span>
                          <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:text-primary-900 dark:hover:text-primary-100 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t('transactions:form.tagsHelp', 'Use tags to organize your transactions (e.g., #vacation, #business)')}</p>
                </div>
              </>
            )}

            {/* Submit */}
            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                leftIcon={<CheckIcon className="w-5 h-5" />}
              >
                {isSubmitting ? 'Saving…' : submitLabel}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}
