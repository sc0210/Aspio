'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
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
import { PageHeader } from '@/components/layout/PageHeader';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { localDateString } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import {
  TRANSACTION_TYPES, CashFields, validateCashFields, StickySubmitBar, revealFirstError,
  FIELD_LABEL, FIELD_INPUT, CHIP_ROW, CHIP, CHIP_ON, CHIP_OFF, SEGMENTED, SEGMENT, SEGMENT_ON, SEGMENT_OFF, revealSelected,
} from '@/components/transactions/TransactionFormFields';

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

  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  // A failed load used to read as "No holdings to sell yet".
  const [holdingsError, setHoldingsError] = useState(false);
  const [holdingsReload, setHoldingsReload] = useState(0);

  useEffect(() => {
    if (formData.type !== 'investment' || investSide !== 'sell' || isDemo) return;
    setHoldingsLoading(true);
    setHoldingsError(false);
    portfolioService.getPortfolio()
      .then(res => {
        if (res.success && res.data) setPortfolioHoldings(res.data.holdings ?? []);
        else setHoldingsError(true);
      })
      .catch(() => setHoldingsError(true))
      .finally(() => setHoldingsLoading(false));
  }, [formData.type, investSide, isDemo, holdingsReload]);

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
    // The wallet pair shares one message, keyed `transfer`.
    const errorKey = field === 'fromWallet' || field === 'toWallet' ? 'transfer' : field;
    if (errors[errorKey]) setErrors(prev => ({ ...prev, [errorKey]: '' }));
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
        const held = Number(portfolioHoldings.find((h) => h.id === investHoldingId)?.quantity);
        if (!investSellQty || isNaN(sq) || sq <= 0) newErrors.investSellQty = t('transactions:form.invest.errSellQty', 'Enter a quantity to sell');
        // Caught here rather than as a server error after the round trip.
        else if (held > 0 && sq > held) newErrors.investSellQty = t('transactions:form.invest.errSellTooMany', { max: held, defaultValue: 'You hold only {{max}} units' });
      }
    } else {
      Object.assign(newErrors, validateCashFields(formData, t));
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm()) {
      revealFirstError(e.currentTarget);
      return;
    }

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
        toast.success(t('transactions:toast.demoSimulated', 'Demo: changes simulated — sign up to save real data'));
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
        toast.success(t('transactions:toast.demoAdded', 'Demo transaction added — sign up to save real data'));
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
            toast.success(t('transactions:toast.bought', { symbol: sym, defaultValue: 'Bought {{symbol}} — holding & expense recorded' }));
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
            toast.success(t('transactions:toast.sold', {
              qty: d.quantitySold,
              symbol: d.symbol,
              net: Math.round(d.netProceeds).toLocaleString(),
              currency: investCurrency,
              pl: `${pl >= 0 ? '+' : ''}${pl.toLocaleString()}`,
              defaultValue: 'Sold {{qty}} {{symbol}} · net {{net}} {{currency}} · P/L {{pl}}',
            }));
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

  // ─── type-button active colours ───────────────────────────────────────────
  const activeClass: Record<string, string> = {
    red:    'bg-expense-700 dark:bg-expense-500 text-white shadow-md',
    green:  'bg-income-700 dark:bg-income-500 text-white shadow-md',
    blue:   'bg-blue-700 dark:bg-blue-500 text-white shadow-md',
    purple: 'bg-violet-600 text-white shadow-md',
  };
  const inactiveClass = 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600';

  const submitLabel =
    formData.type === 'investment'
      ? investSide === 'buy'
        ? t('transactions:form.buySubmit', 'Buy & Add to Portfolio')
        : t('transactions:form.sellSubmit', 'Record Sale')
      : t('transactions:add', 'Add Transaction');

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-2 sm:py-4">
        {/* Phone title + back; on desktop the top bar's title and breadcrumb cover both. */}
        <PageHeader
          title={t('transactions:add', 'Add Transaction')}
          backHref="/transactions"
          backLabel={t('transactions:form.backToList', 'Back to Transactions')}
          className="mb-3"
        />

        <Card padding="none" radius="xl" shadow="none" className="p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">

            {/* ── Transaction Type ── */}
            <div>
              {/* Named for screen readers only: the four buttons say what they are. */}
              <div id="tx-group-type" className="sr-only">{t('transactions:form.typeLabel', 'Transaction Type')}</div>
              <div role="group" aria-labelledby="tx-group-type" className="grid grid-cols-4 gap-1.5 sm:gap-2">
                {TRANSACTION_TYPES.map((type) => (
                  <button
                    aria-pressed={formData.type === type.value}
                    key={type.value}
                    type="button"
                    onClick={() => {
                      handleInputChange('type', type.value);
                      handleInputChange('category', '');
                      // A loan link is an expense's; it must not ride along to another type.
                      if (type.value !== 'expense') handleInputChange('loanId', '');
                    }}
                    className={cn(
                      'py-2.5 px-1 sm:px-3 min-h-11 lg:min-h-0 rounded-lg font-medium transition-all duration-200 motion-reduce:transition-none flex items-center justify-center text-xs sm:text-sm touch-manipulation',
                      formData.type === type.value ? activeClass[type.color] : inactiveClass
                    )}
                  >
                    {/* A phone has ~55-80px per button: too narrow for "Investment". */}
                    {type.shortLabel && (
                      <span className="truncate max-w-full sm:hidden">{t(`transactions:form.typesShort.${type.value}`, type.shortLabel)}</span>
                    )}
                    <span className={cn('truncate max-w-full', type.shortLabel && 'max-sm:hidden')}>{t(`transactions:form.types.${type.value}`, type.label)}</span>
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
                  {/* Buy / Sell: a choice of two, so a segmented toggle */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span id="tx-group-invest-side" className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('transactions:form.invest.action', 'Action')}</span>
                    <div role="group" aria-labelledby="tx-group-invest-side" className={SEGMENTED}>
                      {(['buy', 'sell'] as const).map((side) => (
                        <button
                          aria-pressed={investSide === side}
                          key={side}
                          type="button"
                          onClick={() => setInvestSide(side)}
                          className={cn(SEGMENT, 'px-4', investSide === side ? SEGMENT_ON : SEGMENT_OFF)}
                        >
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
                        <div id="tx-group-asset-type" className={FIELD_LABEL}>{t('transactions:form.invest.assetType', 'Asset Type')}</div>
                        <div role="group" aria-labelledby="tx-group-asset-type" className={CHIP_ROW}>
                          {([
                            { value: 'stock',  label: 'Stock'  },
                            { value: 'etf',    label: 'ETF'    },
                            { value: 'crypto', label: 'Crypto' },
                            { value: 'bond',   label: 'Bond'   },
                          ] as const).map((opt) => (
                            <button
                              aria-pressed={investAssetType === opt.value}
                              key={opt.value}
                              type="button"
                              onClick={() => setInvestAssetType(opt.value)}
                              className={cn(CHIP, investAssetType === opt.value ? CHIP_ON : CHIP_OFF)}
                            >
                              {t(`transactions:form.invest.types.${opt.value}`, opt.label)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Symbol + Name row */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <label htmlFor="tx-invest-symbol" className={FIELD_LABEL}>
                            {t('transactions:form.invest.symbol', 'Symbol')} <span className="text-error-700 dark:text-error-500">*</span>
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
                            className={cn(FIELD_INPUT, 'font-mono font-semibold uppercase placeholder:normal-case placeholder:font-sans placeholder:font-normal', errors.investSymbol && 'border-error-400')}
                          />
                          {errors.investSymbol && <p id="tx-invest-symbol-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investSymbol}</p>}
                        </div>
                        <div className="flex-1">
                          <label htmlFor="tx-invest-name" className={FIELD_LABEL}>
                            {t('transactions:form.invest.name', 'Name')} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">{t('transactions:form.optional', '(optional)')}</span>
                          </label>
                          <input
                            id="tx-invest-name"
                            type="text"
                            value={investName}
                            onChange={(e) => setInvestName(e.target.value)}
                            placeholder={t('transactions:form.invest.namePlaceholder', 'e.g. 富邦台灣50')}
                            className={FIELD_INPUT}
                          />
                        </div>
                      </div>

                      {/* Quantity + Price row */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <label htmlFor="tx-invest-quantity" className={FIELD_LABEL}>
                            {t('transactions:form.invest.quantity', 'Quantity')} <span className="text-error-700 dark:text-error-500">*</span>
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
                            className={cn(FIELD_INPUT, 'font-semibold', errors.investQty && 'border-error-400')}
                          />
                          {errors.investQty && <p id="tx-invest-quantity-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investQty}</p>}
                        </div>
                        <div className="flex-1">
                          <label htmlFor="tx-invest-priceperunit" className={FIELD_LABEL}>
                            {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="text-error-700 dark:text-error-500">*</span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={t('transactions:form.currency', 'Currency')}
                              value={investCurrency}
                              onChange={(e) => { hasUserSetInvestCurrencyRef.current = true; setInvestCurrency(e.target.value); }}
                              className={cn(FIELD_INPUT, 'w-auto px-2 font-semibold')}
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
                              className={cn(FIELD_INPUT, 'flex-1 min-w-0 font-semibold', errors.investPrice && 'border-error-400')}
                            />
                          </div>
                          {errors.investPrice && <p id="tx-invest-priceperunit-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investPrice}</p>}
                        </div>
                      </div>

                      {/* Auto-calculated total + Date */}
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                        <div className="flex-1">
                          <div className={FIELD_LABEL}>{t('transactions:form.invest.totalCost', 'Total Cost')}</div>
                          <div className="flex items-center gap-2 border-2 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 rounded-xl px-4 py-3">
                            <span className="text-sm font-bold text-violet-600 dark:text-violet-400">{investCurrency}</span>
                            <span className="flex-1 text-2xl font-black text-violet-700 dark:text-violet-300 tabular-nums">{fmtTotal}</span>
                            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400">{t('transactions:form.invest.expenseBadge', 'EXPENSE')}</span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                            {qty > 0 && price > 0 ? `${qty} × ${price} = ` : ''}<strong>{t('transactions:form.wallets.life', 'Life Wallet')}</strong> {t('transactions:form.invest.buyFlowSuffix', 'outflow → Portfolio')}
                          </p>
                        </div>
                        <div className="w-full sm:w-40">
                          <label htmlFor="tx-invest-date" className={FIELD_LABEL}>{t('transactions:form.invest.date', 'Date')}</label>
                          <input
                            id="tx-invest-date"
                            type="date"
                            value={formData.date}
                            onChange={(e) => handleInputChange('date', e.target.value)}
                            className={cn(FIELD_INPUT, 'px-2 min-h-11 sm:min-h-0')}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── SELL fields ── */}
                  {investSide === 'sell' && (
                    <>
                      <p className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                        {t('transactions:form.invest.sellHintPrefix', 'Sells units from your portfolio (oldest lots first), records the realized gain/loss, and returns the net proceeds to your')} <strong>{t('transactions:form.wallets.life', 'Life Wallet')}</strong>.
                      </p>

                      {holdingsLoading ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">{t('transactions:form.invest.loadingHoldings', 'Loading holdings…')}</p>
                      ) : holdingsError ? (
                        <div role="alert" className="flex flex-wrap items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                          {t('transactions:form.invest.holdingsLoadFailed', "Couldn't load your holdings.")}
                          <button
                            type="button"
                            onClick={() => setHoldingsReload((n) => n + 1)}
                            className={cn(CHIP, CHIP_OFF)}
                          >
                            {t('transactions:form.invest.retry', 'Try again')}
                          </button>
                        </div>
                      ) : sellableHoldings.length === 0 ? (
                        <div className="text-center text-sm text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl py-6 px-4">
                          {t('transactions:form.invest.noHoldingsPrefix', 'No holdings to sell yet. Use')} <strong>{t('transactions:form.invest.buyAsset', 'Buy Asset')}</strong> {t('transactions:form.invest.noHoldingsSuffix', '(or the Portfolio page) to add one first.')}
                        </div>
                      ) : (
                        <>
                          {/* Holding picker (required) */}
                          <div>
                            <div id="tx-group-holding" className={FIELD_LABEL}>
                              {t('transactions:form.invest.selectHolding', 'Select Holding')} <span className="text-error-700 dark:text-error-500">*</span>
                            </div>
                            <div
                              role="group"
                              aria-labelledby="tx-group-holding"
                              aria-describedby={errors.investHolding ? 'tx-invest-holding-error' : undefined}
                              ref={revealSelected}
                              className={CHIP_ROW}
                            >
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
                                    if (errors.investHolding) setErrors(prev => ({ ...prev, investHolding: '' }));
                                  }}
                                  className={cn(CHIP, investHoldingId === h.id ? CHIP_ON : CHIP_OFF)}
                                >
                                  <span className="font-mono font-bold">{h.symbol}</span>
                                  <span className="font-normal opacity-70">{h.quantity} {t('transactions:form.invest.units', 'units')}</span>
                                </button>
                              ))}
                            </div>
                            {errors.investHolding && <p id="tx-invest-holding-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investHolding}</p>}
                          </div>

                          {/* Quantity + optional price */}
                          <div className="flex flex-col sm:flex-row gap-3">
                            <div className="flex-1">
                              <label htmlFor="tx-invest-quantitytosell" className={FIELD_LABEL}>
                                {t('transactions:form.invest.quantityToSell', 'Quantity to Sell')} <span className="text-error-700 dark:text-error-500">*</span>
                              </label>
                              <input
                                aria-invalid={!!errors.investSellQty}
                                aria-describedby={errors.investSellQty ? 'tx-invest-sellqty-error' : undefined}
                                id="tx-invest-quantitytosell"
                                type="number"
                                inputMode="decimal"
                                onWheel={(e) => e.currentTarget.blur()}
                                step="any"
                                min="0"
                                value={investSellQty}
                                onChange={(e) => setInvestSellQty(e.target.value)}
                                placeholder={t('transactions:form.invest.units', 'units')}
                                className={cn(FIELD_INPUT, 'font-semibold', errors.investSellQty && 'border-error-400')}
                              />
                              {/* Both lines: the error used to replace "Available" and so never showed once a holding was picked. */}
                              {errors.investSellQty && <p id="tx-invest-sellqty-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investSellQty}</p>}
                              {selectedHolding && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('transactions:form.invest.availablePrefix', 'Available:')} <strong>{selectedHolding.quantity}</strong> {t('transactions:form.invest.units', 'units')}</p>
                              )}
                            </div>
                            <div className="flex-1">
                              <label htmlFor="tx-invest-sell-price" className={FIELD_LABEL}>
                                {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">{t('transactions:form.optional', '(optional)')}</span>
                              </label>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-gray-600 dark:text-gray-300 px-1">{investCurrency}</span>
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
                                  className={cn(FIELD_INPUT, 'flex-1 min-w-0 font-semibold')}
                                />
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('transactions:form.invest.leaveBlankMarket', 'Leave blank to use the current market price.')}</p>
                            </div>
                          </div>

                          {/* Date */}
                          <div className="w-full sm:w-40">
                            <label htmlFor="tx-invest-sell-date" className={FIELD_LABEL}>{t('transactions:form.invest.date', 'Date')}</label>
                            <input
                              id="tx-invest-sell-date"
                              type="date"
                              value={formData.date}
                              onChange={(e) => handleInputChange('date', e.target.value)}
                              className={cn(FIELD_INPUT, 'px-2 min-h-11 sm:min-h-0')}
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
              <CashFields
                idPrefix="tx"
                formData={formData}
                errors={errors}
                onChange={handleInputChange}
                onTagsChange={(tags) => setFormData(prev => ({ ...prev, tags }))}
                activeLoans={activeLoans}
                showInvestmentHint
                autoFocusAmount
              />
            )}

            <StickySubmitBar>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                leftIcon={<CheckIcon className="w-5 h-5" />}
              >
                {isSubmitting ? t('transactions:form.saving', 'Saving…') : submitLabel}
              </Button>
            </StickySubmitBar>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}
