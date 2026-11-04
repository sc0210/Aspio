'use client';

import React, { Suspense, useState, useEffect, useRef } from 'react';
import { CheckIcon, InformationCircleIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useRouter, useSearchParams } from 'next/navigation';
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/transactions/returnTo';
import { readPrefill } from '@/lib/transactions/prefill';
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
import { formatCurrency, localDateString } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import {
  TRANSACTION_TYPES, TYPE_TONE, CURRENCIES, CashFields, TypeToggle, DateRow, validateCashFields, StickySubmitBar, revealFirstError,
  FIELD_LABEL, CHIP_ROW, CHIP, CHIP_ON, CHIP_OFF, SEGMENT, SEGMENT_ON, SEGMENT_OFF, revealSelected,
  ENTRY_PANEL, ENTRY_SECTION, ENTRY_CAPTION, ENTRY_INPUT, ENTRY_INPUT_INVALID, ERROR_TEXT, NOTE,
  ROW, ROW_LIST, ROW_LABEL, ROW_SEGMENTED, ROW_SEGMENT,
} from '@/components/transactions/TransactionFormFields';

// useSearchParams needs a Suspense boundary on a statically rendered route.
export default function AddTransactionPage() {
  return (
    <Suspense>
      <AddTransactionForm />
    </Suspense>
  );
}

function AddTransactionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The (filtered) list this add was started from; checked, as on edit.
  const returnTo = safeReturnTo(searchParams.get(RETURN_TO_PARAM));
  // Read once: a prefill is where the form starts, not something it follows.
  const [prefill] = useState(() => readPrefill(searchParams));
  const queryClient = useQueryClient();
  const { isDemo } = useModeAwareUI();
  const { addDemoTransaction } = useDemo();
  const { t } = useTranslation(['transactions']);
  const { data: currentUser } = useCurrentUser();

  const [formData, setFormData] = useState({
    type: (prefill?.type ?? 'expense') as string,
    amount: prefill?.amount ?? '',
    description: prefill?.description ?? '',
    category: prefill?.category ?? '',
    paymentMethod: prefill?.paymentMethod ?? '',
    walletType: prefill?.walletType ?? 'life',
    fromWallet: 'life',
    toWallet: 'emergency',
    date: prefill?.date ?? localDateString(),
    tags: [] as string[],
    currency: prefill?.currency ?? 'TWD',
    loanId: '',
  });

  // Investment sub-form state
  const [investSide, setInvestSide]         = useState<'buy' | 'sell'>('buy');
  const [investAssetType, setInvestAssetType] = useState<'stock' | 'etf' | 'crypto' | 'bond'>('stock');
  const [investSymbol, setInvestSymbol]     = useState('');
  const [investName, setInvestName]         = useState('');
  const [investQty, setInvestQty]           = useState('');
  const [investPrice, setInvestPrice]       = useState('');
  // Its own state: sharing the buy price meant a price typed on Buy was sent as
  // an explicit sell price after switching to Sell, and realized P/L with it.
  const [investSellPrice, setInvestSellPrice] = useState('');
  const [investCurrency, setInvestCurrency] = useState('TWD');
  // Sell side: pick a holding (the backend draws down all lots of its symbol,
  // oldest-first/FIFO) and a quantity; price is optional (defaults to market).
  const [investHoldingId, setInvestHoldingId] = useState('');
  const [investSellQty, setInvestSellQty]   = useState('');

  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set by the "Save & add another" button just before it submits the form.
  const addAnotherRef = useRef(false);

  // After a save, either back to the list, or (add another) a fresh entry that
  // keeps what a run of entries shares: type, date, wallet, currency, payment
  // method. A transfer starts over at Life -> Emergency.
  const finishCashSave = (message: string) => {
    if (!addAnotherRef.current) {
      toast.success(message);
      router.push(returnTo);
      return;
    }
    if (formData.loanId) setLoansReload(n => n + 1);
    setFormData(prev => ({
      ...prev,
      amount: '',
      description: '',
      category: '',
      tags: [],
      loanId: '',
      fromWallet: 'life',
      toWallet: 'emergency',
    }));
    setErrors({});
    toast.success(t('transactions:toast.savedAddNext', 'Saved. Add the next one.'));
    requestAnimationFrame(() => document.getElementById('tx-amount')?.focus());
  };

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

  // Bumped after "add another" on a loan payment, so the next entry sees the new balance.
  const [loansReload, setLoansReload] = useState(0);
  const [activeLoans, setActiveLoans] = useState<{ id: string; name: string; current_balance: number; currency: string }[]>([]);
  useEffect(() => {
    if (isDemo) return;
    loanService.getLoans()
      .then(res => {
        if (res.success && res.data) {
          const loans = res.data
            .filter(l => l.status === 'active')
            // Decimal money arrives as a string; formatCurrency needs a number.
            .map(l => ({ id: l.id, name: l.name, current_balance: Number(l.current_balance) || 0, currency: l.currency }));
          setActiveLoans(loans);
        }
      })
      .catch(() => {});
  }, [isDemo, loansReload]);

  // Default the currency selectors to the user's account preference (falls
  // back to 'TWD' if unset/unauthenticated) instead of always starting on
  // TWD. Only applies once, before the user picks a currency themselves —
  // the refs guard against a late-arriving profile fetch stomping a manual
  // selection.
  // A prefilled currency was chosen by whoever built the link: keep it.
  const hasUserSetCurrencyRef = useRef(!!prefill?.currency);
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
    // Which button submitted: read from the event, so Enter in a field is a plain save.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    addAnotherRef.current = submitter?.dataset.addAnother === 'true' && formData.type !== 'investment';
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
        finishCashSave(t('common:demoAlert.changesSimulated'));
        return;
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
        finishCashSave(t('transactions:toast.demoAdded', 'Demo transaction added — sign up to save real data'));
        return;
      }
      router.push(returnTo);
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
          finishCashSave(t('transactions:toast.transferCreated'));
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
            router.push(returnTo);
          } else {
            toast.error(holdingResponse.message || t('transactions:toast.createFailed'));
          }
        } else {
          // Sell: real FIFO sell via the portfolio endpoint — draws down the
          // holding's lots (oldest first), records realized P/L, and credits net
          // proceeds to the Life Wallet. (Previously this only logged a fake
          // income and left the holding untouched — double-counting.)
          const priceNum = parseFloat(investSellPrice);
          const response = await portfolioService.sellHolding({
            holdingId: investHoldingId,
            quantity: parseFloat(investSellQty),
            price: investSellPrice && !isNaN(priceNum) && priceNum > 0 ? priceNum : undefined,
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
            router.push(returnTo);
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
          finishCashSave(t('transactions:toast.created'));
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

  // The sticky bar is the last thing read before saving, so it says what will be
  // saved: "Add expense · NT$120", "Transfer NT$5,000 → Emergency".
  const amountNum = parseFloat(formData.amount);
  // Whole amounts without decimals: on a phone the label shares the bar with "+ Next".
  const amountText = amountNum > 0
    ? formatCurrency(amountNum, formData.currency, Number.isInteger(amountNum) ? { precision: 0 } : {})
    : '';
  const cashLabel = (() => {
    if (formData.type === 'transfer') {
      const to = t(`transactions:form.wallets.${formData.toWallet}`, formData.toWallet === 'life' ? 'Life Wallet' : 'Emergency Wallet');
      return amountText
        ? t('transactions:form.submitTransfer', { amount: amountText, to, defaultValue: 'Transfer {{amount}} → {{to}}' })
        : t('transactions:form.submitTransferPlain', 'Add transfer');
    }
    const plain = formData.type === 'income'
      ? t('transactions:form.submitIncome', 'Add income')
      : t('transactions:form.submitExpense', 'Add expense');
    return amountText ? `${plain} · ${amountText}` : plain;
  })();
  const submitLabel =
    formData.type === 'investment'
      ? investSide === 'buy'
        ? t('transactions:form.buySubmit', 'Buy & Add to Portfolio')
        : t('transactions:form.sellSubmit', 'Record Sale')
      : cashLabel;

  return (
    <DashboardLayout>
      {/* A form reads best at a form's width: 3xl keeps the settings rows' labels
          and controls within one glance on a laptop. */}
      <div className="max-w-3xl mx-auto py-2 sm:py-4">
        {/* Phone title + back; on desktop the top bar's title and breadcrumb cover both. */}
        <PageHeader
          title={t('transactions:add', 'Add Transaction')}
          backHref={returnTo}
          backLabel={t('transactions:form.backToList', 'Back to Transactions')}
          className="mb-3 animate-none"
        />

        <Card padding="none" radius="xl" shadow="none" className="p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">

            <TypeToggle
              idPrefix="tx"
              types={TRANSACTION_TYPES.map((type) => type.value)}
              value={formData.type}
              onPick={(type) => {
                handleInputChange('type', type);
                handleInputChange('category', '');
                // A loan link is an expense's; it must not ride along to another type.
                if (type !== 'expense') handleInputChange('loanId', '');
              }}
            />

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
              const required = <span className="text-error-700 dark:text-error-400" aria-hidden="true">*</span>;

              return (
                <>
                  {/* Buy / Sell: a choice of two, so a segmented control, laid out as a settings row */}
                  <div className={cn(ROW, 'py-0')}>
                    <span id="tx-group-invest-side" className={ROW_LABEL}>{t('transactions:form.invest.action', 'Action')}</span>
                    <div role="group" aria-labelledby="tx-group-invest-side" className={ROW_SEGMENTED}>
                      {(['buy', 'sell'] as const).map((side) => (
                        <button
                          aria-pressed={investSide === side}
                          key={side}
                          type="button"
                          onClick={() => {
                            setInvestSide(side);
                            // The other side's messages would point at fields no longer shown.
                            setErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith('invest'))));
                          }}
                          className={cn(SEGMENT, ROW_SEGMENT, 'px-4', investSide === side ? SEGMENT_ON : SEGMENT_OFF)}
                        >
                          {side === 'buy' ? t('transactions:form.invest.buyAsset', 'Buy Asset') : t('transactions:form.invest.sellAsset', 'Sell Asset')}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── BUY fields: the same entry panel as a cash entry, its total the hero ── */}
                  {investSide === 'buy' && (
                    <>
                      <div>
                        <div className={cn(ENTRY_PANEL, (errors.investSymbol || errors.investQty || errors.investPrice) && 'border-error-300 dark:border-error-700')}>
                          {/* Symbol + Name */}
                          <div className={cn(ENTRY_SECTION, 'grid grid-cols-1 gap-x-5 sm:grid-cols-2')}>
                            <div>
                              <label htmlFor="tx-invest-symbol" className={ENTRY_CAPTION}>
                                {t('transactions:form.invest.symbol', 'Symbol')} {required}
                              </label>
                              <input
                                aria-invalid={!!errors.investSymbol}
                                aria-describedby={errors.investSymbol ? "tx-invest-symbol-error" : undefined}
                                id="tx-invest-symbol"
                                aria-required="true"
                                type="text"
                                value={investSymbol}
                                onChange={(e) => setInvestSymbol(e.target.value.toUpperCase())}
                                placeholder={t('transactions:form.invest.symbolPlaceholder', 'e.g. 006208, AAPL, BTC')}
                                className={cn(ENTRY_INPUT, 'text-lg sm:text-lg font-mono font-semibold uppercase placeholder:normal-case placeholder:font-sans placeholder:font-normal placeholder:text-base', errors.investSymbol && ENTRY_INPUT_INVALID)}
                              />
                            </div>
                            <div>
                              <label htmlFor="tx-invest-name" className={ENTRY_CAPTION}>
                                {t('transactions:form.invest.name', 'Name')} <span className="font-normal">{t('transactions:form.optional', '(optional)')}</span>
                              </label>
                              <input
                                id="tx-invest-name"
                                type="text"
                                value={investName}
                                onChange={(e) => setInvestName(e.target.value)}
                                placeholder={t('transactions:form.invest.namePlaceholder', 'e.g. 富邦台灣50')}
                                className={ENTRY_INPUT}
                              />
                            </div>
                          </div>

                          {/* Quantity × Price: stacked on a phone, where the price shares its line with the currency */}
                          <div className={cn(ENTRY_SECTION, 'grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-5')}>
                            <div>
                              <label htmlFor="tx-invest-quantity" className={ENTRY_CAPTION}>
                                {t('transactions:form.invest.quantity', 'Quantity')} {required}
                              </label>
                              <input
                                aria-invalid={!!errors.investQty}
                                aria-describedby={errors.investQty ? "tx-invest-quantity-error" : undefined}
                                id="tx-invest-quantity"
                                aria-required="true"
                                type="number"
                                inputMode="decimal"
                                onWheel={(e) => e.currentTarget.blur()}
                                step="any"
                                min="0"
                                value={investQty}
                                onChange={(e) => setInvestQty(e.target.value)}
                                placeholder={t('transactions:form.invest.quantityPlaceholder', 'e.g. 100')}
                                className={cn(ENTRY_INPUT, 'font-semibold tabular-nums', errors.investQty && ENTRY_INPUT_INVALID)}
                              />
                            </div>
                            <div>
                              <label htmlFor="tx-invest-priceperunit" className={ENTRY_CAPTION}>
                                {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} {required}
                              </label>
                              <div className="flex items-center gap-1.5">
                                <select
                                  aria-label={t('transactions:form.currency', 'Currency')}
                                  value={investCurrency}
                                  onChange={(e) => { hasUserSetInvestCurrencyRef.current = true; setInvestCurrency(e.target.value); }}
                                  className="shrink-0 min-h-11 lg:min-h-0 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-2 pr-7 py-1 text-base sm:text-sm font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                >
                                  {CURRENCIES.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                                <input
                                  aria-invalid={!!errors.investPrice}
                                  aria-describedby={errors.investPrice ? "tx-invest-priceperunit-error" : undefined}
                                  id="tx-invest-priceperunit"
                                aria-required="true"
                                  type="number"
                                  inputMode="decimal"
                                  onWheel={(e) => e.currentTarget.blur()}
                                  step="any"
                                  min="0"
                                  value={investPrice}
                                  onChange={(e) => setInvestPrice(e.target.value)}
                                  placeholder="0.00"
                                  className={cn(ENTRY_INPUT, 'flex-1 font-semibold tabular-nums', errors.investPrice && ENTRY_INPUT_INVALID)}
                                />
                              </div>
                            </div>
                          </div>

                          {/* The total: worked out, not typed, so it reads as the result. */}
                          <div className={cn(ENTRY_SECTION, 'flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3.5 sm:pb-4')}>
                            <div className="min-w-0">
                              <div className={ENTRY_CAPTION}>{t('transactions:form.invest.totalCost', 'Total Cost')}</div>
                              <div className="mt-0.5 flex items-baseline gap-2">
                                <span aria-hidden="true" className={cn('text-3xl font-semibold leading-none', TYPE_TONE.investment.text)}>{TYPE_TONE.investment.sign}</span>
                                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{investCurrency}</span>
                                <span className="text-4xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">{fmtTotal}</span>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-right">
                              {qty > 0 && price > 0 ? `${qty} × ${price} · ` : ''}<strong className="font-semibold text-gray-700 dark:text-gray-300">{t('transactions:form.wallets.life', 'Life Wallet')}</strong> {t('transactions:form.invest.buyFlowSuffix', 'outflow → Portfolio')}
                            </p>
                          </div>
                        </div>
                        {errors.investSymbol && <p id="tx-invest-symbol-error" role="alert" className={ERROR_TEXT}>{errors.investSymbol}</p>}
                        {errors.investQty && <p id="tx-invest-quantity-error" role="alert" className={ERROR_TEXT}>{errors.investQty}</p>}
                        {errors.investPrice && <p id="tx-invest-priceperunit-error" role="alert" className={ERROR_TEXT}>{errors.investPrice}</p>}
                      </div>

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
                              {investAssetType === opt.value && <CheckIcon className="w-4 h-4 shrink-0" aria-hidden="true" />}
                              {t(`transactions:form.invest.types.${opt.value}`, opt.label)}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className={ROW_LIST}>
                        <DateRow id="tx-invest-date" value={formData.date} onChange={(day) => handleInputChange('date', day)} />
                      </div>
                    </>
                  )}

                  {/* ── SELL fields ── */}
                  {investSide === 'sell' && (
                    <>
                      <p className={NOTE}>
                        <InformationCircleIcon className="w-5 h-5 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                        <span>{t('transactions:form.invest.sellHintPrefix', 'Sells units from your portfolio (oldest lots first), records the realized gain/loss, and returns the net proceeds to your')} <strong>{t('transactions:form.wallets.life', 'Life Wallet')}</strong>.</span>
                      </p>

                      {holdingsLoading ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">{t('transactions:form.invest.loadingHoldings', 'Loading holdings…')}</p>
                      ) : holdingsError ? (
                        <div role="alert" className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
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
                        <div className="text-center text-sm text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl py-6 px-4">
                          {t('transactions:form.invest.noHoldingsPrefix', 'No holdings to sell yet. Use')} <strong>{t('transactions:form.invest.buyAsset', 'Buy Asset')}</strong> {t('transactions:form.invest.noHoldingsSuffix', '(or the Portfolio page) to add one first.')}
                        </div>
                      ) : (
                        <>
                          {/* Holding picker (required) */}
                          <div>
                            <div id="tx-group-holding" className={FIELD_LABEL}>
                              {t('transactions:form.invest.selectHolding', 'Select Holding')} {required}
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
                                  {investHoldingId === h.id && <CheckIcon className="w-4 h-4 shrink-0" aria-hidden="true" />}
                                  <span className="font-mono font-bold">{h.symbol}</span>
                                  <span className="font-normal opacity-70">{h.quantity} {t('transactions:form.invest.units', 'units')}</span>
                                </button>
                              ))}
                            </div>
                            {errors.investHolding && <p id="tx-invest-holding-error" role="alert" className={ERROR_TEXT}>{errors.investHolding}</p>}
                          </div>

                          {/* Quantity + optional price, in the entry panel */}
                          <div>
                            <div className={cn(ENTRY_PANEL, errors.investSellQty && 'border-error-300 dark:border-error-700')}>
                              <div className={cn(ENTRY_SECTION, 'grid grid-cols-2 gap-x-4 sm:gap-x-5')}>
                                <div>
                                  <label htmlFor="tx-invest-quantitytosell" className={ENTRY_CAPTION}>
                                    {t('transactions:form.invest.quantityToSell', 'Quantity to Sell')} {required}
                                  </label>
                                  <input
                                    aria-invalid={!!errors.investSellQty}
                                    aria-describedby={errors.investSellQty ? 'tx-invest-sellqty-error' : undefined}
                                    id="tx-invest-quantitytosell"
                                aria-required="true"
                                    type="number"
                                    inputMode="decimal"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    step="any"
                                    min="0"
                                    value={investSellQty}
                                    onChange={(e) => setInvestSellQty(e.target.value)}
                                    placeholder={t('transactions:form.invest.units', 'units')}
                                    className={cn(ENTRY_INPUT, 'text-2xl sm:text-2xl font-bold tabular-nums', errors.investSellQty && ENTRY_INPUT_INVALID)}
                                  />
                                  {selectedHolding && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('transactions:form.invest.availablePrefix', 'Available:')} <strong>{selectedHolding.quantity}</strong> {t('transactions:form.invest.units', 'units')}</p>
                                  )}
                                </div>
                                <div>
                                  <label htmlFor="tx-invest-sell-price" className={ENTRY_CAPTION}>
                                    {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="font-normal">{t('transactions:form.optional', '(optional)')}</span>
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{investCurrency}</span>
                                    <input
                                      id="tx-invest-sell-price"
                                      type="number"
                                      inputMode="decimal"
                                      onWheel={(e) => e.currentTarget.blur()}
                                      step="any"
                                      min="0"
                                      value={investSellPrice}
                                      onChange={(e) => setInvestSellPrice(e.target.value)}
                                      placeholder={t('transactions:form.invest.marketPricePlaceholder', 'market price')}
                                      className={cn(ENTRY_INPUT, 'flex-1 font-semibold tabular-nums')}
                                    />
                                  </div>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('transactions:form.invest.leaveBlankMarket', 'Leave blank to use the current market price.')}</p>
                                </div>
                              </div>
                            </div>
                            {/* Both lines: the error used to replace "Available" and so never showed once a holding was picked. */}
                            {errors.investSellQty && <p id="tx-invest-sellqty-error" role="alert" className={ERROR_TEXT}>{errors.investSellQty}</p>}
                          </div>

                          <div className={ROW_LIST}>
                            <DateRow id="tx-invest-sell-date" value={formData.date} onChange={(day) => handleInputChange('date', day)} />
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
              {/* The primary save comes first in the markup: Enter in a field submits
                  through the first submit button, and that must be a plain save. The
                  row reverses so "+" still sits on the left. From md the pair sits at
                  the end of the form, the save no wider than its label needs. */}
              <div className="flex flex-row-reverse gap-2 md:justify-start">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={isSubmitting}
                  leftIcon={<CheckIcon className="w-5 h-5 max-sm:hidden" />}
                  className="min-w-0 flex-1 md:flex-none md:w-auto md:min-w-[16rem] lg:min-h-12"
                >
                  <span className="truncate">{isSubmitting ? t('transactions:form.saving', 'Saving…') : submitLabel}</span>
                </Button>
                {/* Not for an investment: a buy or sale goes back to the list to show the holding's change.
                    Just "+" on a phone (named for screen readers), so the save button keeps room to name the amount.
                    Outlined in the brand colour: a real second action, not a disabled-looking grey. */}
                {formData.type !== 'investment' && (
                  <Button
                    type="submit"
                    data-add-another="true"
                    variant="outline"
                    size="lg"
                    disabled={isSubmitting}
                    aria-label={t('transactions:form.saveAndAddAnother', 'Save & add another')}
                    leftIcon={<PlusIcon className="w-5 h-5" aria-hidden="true" />}
                    className="shrink-0 px-3 sm:px-4 max-sm:gap-0 lg:min-h-12 border-primary-300 text-primary-700 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-300 dark:hover:bg-primary-900/30"
                  >
                    <span className="max-sm:hidden">{t('transactions:form.saveAndAddAnother', 'Save & add another')}</span>
                  </Button>
                )}
              </div>
            </StickySubmitBar>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}
