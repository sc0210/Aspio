'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/transactions/returnTo';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TRANSACTION_TYPES, CATEGORIES, PAYMENT_METHODS, CashFields, TagsField, validateCashFields, StickySubmitBar, revealFirstError, FIELD_LABEL, FIELD_INPUT } from '@/components/transactions/TransactionFormFields';
import { cn } from '@/utils/cn';
import { transactionService } from '@/services/transactionService';
import { Transaction } from '@/shared/types';
import { useDemo } from '@/contexts/DemoContext';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { portfolioService } from '@/services/portfolioService';
import { loanService } from '@/services/loanService';
import { parseInvestDescription, buildInvestDescription } from '@/utils/investmentUtils';
import { log } from '@/utils/logger';
import { localDateString } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

export default function EditTransactionPage() {
  const router = useRouter();
  // The filtered list this edit was opened from. Checked, not trusted: a returnTo is
  // a user-supplied string that becomes a navigation.
  const returnTo = safeReturnTo(useSearchParams().get(RETURN_TO_PARAM));
  const params = useParams();
  const transactionId = params.id as string;
  const queryClient = useQueryClient();
  const { demoTransactions } = useDemo();
  const { isDemo } = useModeAwareUI();
  const { t } = useTranslation(['transactions']);
  const { data: currentUser } = useCurrentUser();
  // Fallback only — a loaded transaction's own currency always wins. This
  // only matters for the rare row that somehow has no currency recorded.
  const defaultCurrency = currentUser?.preferred_currency || 'TWD';

  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({
    type: 'expense',
    amount: '',
    currency: 'TWD',
    description: '',
    category: '',
    paymentMethod: '',
    walletType: 'life',
    fromWallet: 'life', // For transfers
    toWallet: 'emergency', // For transfers
    date: localDateString(),
    tags: [] as string[],
    loanId: '',
  });
  const [activeLoans, setActiveLoans] = useState<{ id: string; name: string; current_balance: number; currency: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Investment mode state (populated when category === 'Investment Purchase')
  const [isInvestMode, setIsInvestMode] = useState(false);
  const [investSymbol, setInvestSymbol] = useState('');
  const [investQty, setInvestQty] = useState('');
  const [investPrice, setInvestPrice] = useState('');
  const [investCurrency, setInvestCurrency] = useState('TWD');

  const investTotal = useMemo(() => {
    const q = parseFloat(investQty);
    const p = parseFloat(investPrice);
    return isNaN(q) || isNaN(p) ? 0 : q * p;
  }, [investQty, investPrice]);

  // Transfer edit state — populated when the loaded transaction is one leg
  // of a wallet transfer (see transfer_group_id). When set, submitting
  // rewrites both legs atomically via transactionService.updateTransfer.
  // When the leg predates the transfer_group_id link (or the backfill
  // missed it), this stays null and submit falls back to the "not
  // supported" message rather than risk editing only one leg.
  const [transferGroupId, setTransferGroupId] = useState<string | null>(null);
  // A real (not demo) transfer leg with no link to its pair. It cannot be saved,
  // so the page says so up front instead of refusing after the user has edited it.
  const [transferUnlinked, setTransferUnlinked] = useState(false);

  // Load transaction data
  useEffect(() => {
    const loadTransaction = async () => {
      try {
        setIsLoading(true);
        let txn = null;

        if (isDemo) {
          txn = demoTransactions.find(t => t.id === transactionId);
        } else {
          const response = await transactionService.getTransactionById(transactionId);
          if (response.data) {
            txn = response.data;
          }
        }

        if (txn) {
          const txType = txn.type as 'expense' | 'income' | 'transfer';

          // Investment Purchase: special investment mode
          if (txn.category === 'Investment Purchase') {
            const parsed = parseInvestDescription(txn.description);
            setIsInvestMode(true);
            setInvestSymbol(parsed?.symbol || '');
            setInvestQty(parsed?.qty || '');
            setInvestPrice(parsed?.price || '');
            setInvestCurrency(parsed?.currency || defaultCurrency);
            setFormData({
              type: 'expense',
              amount: txn.amount.toString(),
              currency: parsed?.currency || defaultCurrency,
              description: txn.description,
              category: 'Investment Purchase',
              paymentMethod: txn.paymentMethod || 'bank_transfer',
              walletType: txn.walletType || 'life',
              fromWallet: 'life',
              toWallet: 'emergency',
              date: new Date(txn.date).toISOString().split('T')[0],
              tags: txn.tags || [],
              loanId: '',
            });
          } else if (txType === 'transfer' || !!txn.transferGroupId || txn.category === 'Transfer') {
            // A wallet transfer's two legs are persisted as separate
            // expense/income rows (type is never literally 'transfer' for
            // real data — txType === 'transfer' only ever fires for demo
            // fixtures). transferGroupId links them; when present, fetch
            // both legs and edit the transfer as a single unit.
            let transfer: Awaited<ReturnType<typeof transactionService.getTransfer>>['data'] | null = null;

            if (!isDemo && txn.transferGroupId) {
              const transferResp = await transactionService.getTransfer(txn.transferGroupId);
              if (transferResp.success && transferResp.data) {
                transfer = transferResp.data;
                setTransferGroupId(txn.transferGroupId);
              }
            }

            if (transfer) {
              setFormData({
                type: 'transfer',
                amount: String(transfer.amount),
                currency: transfer.currency || defaultCurrency,
                // txn.description is the user-facing text (defaults to
                // "Transfer to/from X Wallet" if they left it blank);
                // transfer.notes is the internal fixed-format pairing key
                // ("Transfer from X to Y") — only fall back to it if this
                // leg somehow has no description at all.
                description: txn.description || transfer.notes || '',
                category: '', // Not used for transfers
                paymentMethod: '',
                walletType: transfer.fromWallet,
                fromWallet: transfer.fromWallet,
                toWallet: transfer.toWallet,
                date: new Date(transfer.date).toISOString().split('T')[0],
                tags: txn.tags || [],
                loanId: '',
              });
            } else {
              // Demo mode, or a legacy/unlinked transfer leg (predates the
              // transfer_group_id backfill, or the pairing heuristic missed
              // it) — load what this single row has. Submit stays blocked
              // (see handleSubmit) rather than risk silently editing only
              // one leg of the pair.
              setTransferUnlinked(!isDemo);
              setFormData({
                type: 'transfer',
                amount: txn.amount.toString(),
                currency: txn.currency || defaultCurrency,
                description: txn.description,
                category: '', // Not used for transfers
                paymentMethod: '',
                walletType: txn.walletType || 'life',
                fromWallet: txn.walletType || 'life', // Source wallet
                toWallet: txn.walletType === 'emergency' ? 'life' : 'emergency',
                date: new Date(txn.date).toISOString().split('T')[0],
                tags: txn.tags || [],
                loanId: '',
              });
            }
          } else {
            // Regular income/expense transaction
            const categoryList = CATEGORIES[txType] || CATEGORIES.expense;

            // Try to find exact match first, then case-insensitive match
            let matchedCategory = categoryList.find(c => c.value === txn.category)?.value;
            if (!matchedCategory) {
              matchedCategory = categoryList.find(
                c => c.value.toLowerCase() === txn.category.toLowerCase()
              )?.value;
            }

            // A category the form does not list is kept as it is (the form shows it
            // as its own chip). It used to be mapped to a listed one here, so saving
            // any change, even the amount, quietly re-categorised the row.
            const categoryValue = matchedCategory || txn.category;

            // Match payment method to our format
            let paymentMethodValue = '';
            if (txn.paymentMethod) {
              const pmLower = txn.paymentMethod.toLowerCase();
              const matchedPM = PAYMENT_METHODS.find(
                pm => pm.value.toLowerCase() === pmLower || pm.label.toLowerCase() === pmLower
              );
              paymentMethodValue = matchedPM?.value || txn.paymentMethod;
            }

            setFormData({
              type: txType,
              amount: txn.amount.toString(),
              currency: txn.currency || defaultCurrency,
              description: txn.description,
              category: categoryValue,
              paymentMethod: paymentMethodValue,
              walletType: txn.walletType || 'life',
              fromWallet: 'life',
              toWallet: 'emergency',
              date: new Date(txn.date).toISOString().split('T')[0],
              tags: txn.tags || [],
              // Pre-fill the loan link if this expense is tied to a loan.
              loanId: (txn as Transaction & { loan_id?: string | null }).loan_id ?? '',
            });
          }
        } else {
          toast.error(t('transactions:toast.notFound'));
          router.push(returnTo);
        }
      } catch (error) {
        log.error('Failed to load transaction:', error);
        toast.error(t('transactions:toast.loadFailed'));
        router.push(returnTo);
      } finally {
        setIsLoading(false);
      }
    };

    if (transactionId) {
      loadTransaction();
    }
    // defaultCurrency intentionally excluded: it's only a fallback for the
    // rare row missing a currency, and re-running this whole load on every
    // profile-query resolution would blow away in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, router, isDemo, demoTransactions, t]);

  // Active loans for the "Link to Loan" selector (authed only — avoids a demo 401).
  useEffect(() => {
    if (isDemo) return;
    loanService.getLoans()
      .then((res) => {
        const loans = (res.data ?? []).filter((l) => l.status === 'active');
        setActiveLoans(loans.map((l) => ({
          id: l.id,
          name: l.name,
          current_balance: Number(l.current_balance) || 0,
          currency: l.currency,
        })));
      })
      .catch(() => setActiveLoans([]));
  }, [isDemo]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // The wallet pair shares one message, keyed `transfer`.
    const errorKey = field === 'fromWallet' || field === 'toWallet' ? 'transfer' : field;
    if (errors[errorKey]) {
      setErrors(prev => ({ ...prev, [errorKey]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (isInvestMode) {
      if (!investSymbol.trim()) newErrors.investSymbol = t('transactions:form.invest.errSymbol', 'Enter a symbol');
      if (!investQty || parseFloat(investQty) <= 0) newErrors.investQty = t('transactions:form.invest.errQty', 'Enter quantity');
      if (!investPrice || parseFloat(investPrice) <= 0) newErrors.investPrice = t('transactions:form.invest.errPrice', 'Enter price per unit');
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
      toast.success(t('transactions:toast.demoSimulated', 'Demo: changes simulated — sign up to save real data'));
      router.push(returnTo);
      return;
    }

    setIsSubmitting(true);
    try {
      if (formData.type === 'transfer') {
        if (!transferGroupId) {
          // Legacy/unlinked leg — editing it would only rewrite one side of
          // the pair and break the wallet balances, so refuse rather than
          // risk it.
          toast.error(t('transactions:toast.editTransferUnsupported'));
          return;
        }

        const response = await transactionService.updateTransfer(transferGroupId, {
          fromWallet: formData.fromWallet as 'life' | 'emergency',
          toWallet: formData.toWallet as 'life' | 'emergency',
          amount: parseFloat(formData.amount),
          // What the form shows; it used to send the loaded currency whatever was picked.
          currency: formData.currency,
          date: formData.date,
          notes: formData.description,
        });

        if (response.success) {
          await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
          invalidateDashboardData(queryClient);
          toast.success(t('transactions:toast.transferUpdated', 'Transfer updated successfully'));
          router.push(returnTo);
        } else {
          toast.error(response.message || t('transactions:toast.updateFailed'));
        }
        return;
      }

      let updateData: Partial<Transaction> & { loan_id?: string | null };

      if (isInvestMode) {
        const qty = parseFloat(investQty);
        const price = parseFloat(investPrice);
        const sym = investSymbol.trim().toUpperCase();
        const newAmount = qty * price;
        updateData = {
          type: 'expense',
          amount: newAmount,
          currency: investCurrency,
          description: buildInvestDescription(sym, qty, price, investCurrency),
          date: formData.date,
          category: 'Investment Purchase',
          paymentMethod: formData.paymentMethod || 'bank_transfer',
          walletType: 'life' as 'life' | 'emergency',
          tags: formData.tags,
        };
      } else {
        updateData = {
          type: formData.type as 'income' | 'expense',
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          description: formData.description,
          date: formData.date,
          category: formData.category,
          // null, not undefined: undefined is left out of the request, so a payment
          // method cleared in the form stayed saved.
          paymentMethod: (formData.paymentMethod || null) as string | undefined,
          walletType: formData.walletType as 'life' | 'emergency',
          tags: formData.tags,
          // Link/unlink the loan (expenses only). Sending null unlinks and
          // restores the loan balance; the backend re-syncs on any change.
          ...(formData.type === 'expense' ? { loan_id: formData.loanId || null } : {}),
        };
      }

      const response = await transactionService.updateTransaction(transactionId, updateData);

      if (response.success) {
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
        invalidateDashboardData(queryClient);
        // A loan link/unlink (or amount change on a linked expense) shifts a loan
        // balance backend-side — refresh the loans view.
        await queryClient.invalidateQueries({ queryKey: ['loans'] });

        // In invest mode: try to sync the portfolio holding as well
        if (isInvestMode) {
          const qty = parseFloat(investQty);
          const price = parseFloat(investPrice);
          const sym = investSymbol.trim().toUpperCase();
          try {
            const portfolioResp = await portfolioService.getPortfolio();
            const holdings = portfolioResp.data?.holdings ?? [];
            const matches = holdings.filter(h => h.symbol.toUpperCase() === sym);
            if (matches.length === 1) {
              // Exactly one lot — safe to sync qty/cost/date onto it.
              await portfolioService.updateHolding({
                id: matches[0].id,
                averageCost: price,
                quantity: qty,
                // Sync the purchase date too so the holding-detail buy markers
                // move when the transaction date is edited (previously omitted,
                // so editing the date left the markers stale).
                ...(formData.date ? { purchaseDate: new Date(formData.date).toISOString() } : {}),
              });
              await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
              toast.success(t('transactions:toast.investSynced', 'Transaction and portfolio holding updated'));
            } else if (matches.length > 1) {
              // Multiple lots for this symbol — we can't tell which lot this
              // transaction maps to, so don't silently overwrite the wrong one.
              toast(t('transactions:toast.investMultipleLots', 'Transaction updated. This symbol has multiple lots — edit the specific lot on the Portfolio page to update its chart.'), { icon: 'ℹ️' });
            } else {
              toast.success(t('transactions:toast.investHoldingMissing', 'Transaction updated. Holding not found — it may have been removed from Portfolio.'));
            }
          } catch {
            toast.success(t('transactions:toast.investSyncFailed', 'Transaction updated. Could not sync portfolio holding — update it manually.'));
          }
        } else {
          toast.success(t('transactions:toast.updated'));
        }

        router.push(returnTo);
      } else {
        // A rejected update used to end in silence: the spinner stopped, nothing said.
        toast.error(response.message || t('transactions:toast.updateFailed'));
      }
    } catch (error) {
      log.error('Error updating transaction:', error);
      toast.error(t('transactions:toast.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Same frame as /transactions/add: the layout's own padding is the gutter. */}
      <div className="max-w-4xl mx-auto py-2 sm:py-4">
        {/* Phone title + back; on desktop the top bar's title and breadcrumb cover both. */}
        <PageHeader
          title={t('transactions:edit', 'Edit Transaction')}
          backHref={returnTo}
          backLabel={t('transactions:form.backToList', 'Back to Transactions')}
          className="mb-3"
        />

        <Card padding="none" radius="xl" shadow="none" className="p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            {/* Transaction type. A transfer's type is locked: saving one leg as an
                expense or income would orphan its pair and throw both wallets off.
                Nor can an expense or income become a transfer here: there is no pair
                to edit, so it could only fail at submit. */}
            {!isInvestMode && formData.type === 'transfer' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-blue-700 dark:bg-blue-500 px-3 py-1.5 text-sm font-medium text-white">
                  {t('transactions:form.types.transfer', 'Transfer')}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('transactions:form.transferTypeLocked', 'A transfer stays a transfer. To change it, delete it and add a new one.')}
                </span>
              </div>
            )}
            {!isInvestMode && formData.type !== 'transfer' && (
              <div>
                {/* Named for screen readers only: the buttons say what they are. */}
                <div id="txe-group-type" className="sr-only">
                  {t('transactions:form.typeLabel', 'Transaction Type')}
                </div>
                <div role="group" aria-labelledby="txe-group-type" className="flex gap-1.5 sm:gap-2">
                  {TRANSACTION_TYPES.filter((type) => type.value === 'expense' || type.value === 'income').map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      aria-pressed={formData.type === type.value}
                      onClick={() => {
                        handleInputChange('type', type.value);
                        handleInputChange('category', '');
                        // A loan link is an expense's; an income would keep it otherwise.
                        if (type.value !== 'expense') handleInputChange('loanId', '');
                      }}
                      className={cn(
                        'flex-1 min-w-0 py-2.5 px-1 sm:px-3 min-h-11 lg:min-h-0 rounded-lg font-medium transition-all duration-200 motion-reduce:transition-none flex items-center justify-center text-xs sm:text-sm touch-manipulation',
                        formData.type === type.value
                          ? type.color === 'red'
                            ? 'bg-expense-700 dark:bg-expense-500 text-white shadow-md'
                            : 'bg-income-700 dark:bg-income-500 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      )}
                    >
                      <span className="truncate max-w-full">{t(`transactions:form.types.${type.value}`, type.label)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {transferUnlinked && (
              <div role="status" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                {t('transactions:form.transferUnlinked', "This older transfer isn't linked to its other half, so it can't be edited here. Delete it and add the transfer again.")}
              </div>
            )}

            {/* Investment Purchase Section */}
            {isInvestMode && (
              <div className="space-y-4 rounded-lg border border-purple-200 dark:border-purple-800 p-4 bg-purple-50 dark:bg-purple-900/20">
                <div>
                  <div className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                    {t('transactions:form.investEdit.title', 'Investment purchase')}
                  </div>
                  <p className="mt-1 text-xs text-purple-700 dark:text-purple-400">
                    {t('transactions:form.investEdit.note', 'Changes here update the transaction record. To update the portfolio holding, visit the Portfolio page.')}
                  </p>
                </div>

                {/* Symbol + Currency row */}
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <label htmlFor="page-symbol" className={FIELD_LABEL}>
                      {t('transactions:form.invest.symbol', 'Symbol')} <span className="text-error-700 dark:text-error-500">*</span>
                    </label>
                    <input
                      aria-invalid={!!errors.investSymbol}
                      aria-describedby={errors.investSymbol ? "page-symbol-error" : undefined}
                      id="page-symbol"
                      type="text"
                      value={investSymbol}
                      onChange={e => setInvestSymbol(e.target.value.toUpperCase())}
                      placeholder={t('transactions:form.invest.symbolPlaceholder', 'e.g. 006208, AAPL, BTC')}
                      className={cn(
                        FIELD_INPUT, 'font-mono uppercase placeholder:normal-case placeholder:font-sans',
                        errors.investSymbol && 'border-error-400'
                      )}
                    />
                    {errors.investSymbol && <p id="page-symbol-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investSymbol}</p>}
                  </div>
                  <div className="w-28">
                    <label htmlFor="page-currency" className={FIELD_LABEL}>{t('transactions:form.currency', 'Currency')}</label>
                    <select
                      id="page-currency"
                      value={investCurrency}
                      onChange={e => setInvestCurrency(e.target.value)}
                      className={cn(FIELD_INPUT, 'px-2')}
                    >
                      {['TWD', 'USD', 'HKD', 'JPY', 'SGD', 'EUR'].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Qty + Price row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="page-quantity" className={FIELD_LABEL}>
                      {t('transactions:form.invest.quantity', 'Quantity')} <span className="text-error-700 dark:text-error-500">*</span>
                    </label>
                    <input
                      aria-invalid={!!errors.investQty}
                      aria-describedby={errors.investQty ? "page-quantity-error" : undefined}
                      id="page-quantity"
                      type="number"
                      inputMode="decimal"
                      onWheel={(e) => e.currentTarget.blur()}
                      min="0"
                      step="any"
                      value={investQty}
                      onChange={e => setInvestQty(e.target.value)}
                      placeholder="100"
                      className={cn(
                        FIELD_INPUT,
                        errors.investQty && 'border-error-400'
                      )}
                    />
                    {errors.investQty && <p id="page-quantity-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investQty}</p>}
                  </div>
                  <div>
                    <label htmlFor="page-price-unit" className={FIELD_LABEL}>
                      {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="text-error-700 dark:text-error-500">*</span>
                    </label>
                    <input
                      aria-invalid={!!errors.investPrice}
                      aria-describedby={errors.investPrice ? "page-price-unit-error" : undefined}
                      id="page-price-unit"
                      type="number"
                      inputMode="decimal"
                      onWheel={(e) => e.currentTarget.blur()}
                      min="0"
                      step="any"
                      value={investPrice}
                      onChange={e => setInvestPrice(e.target.value)}
                      placeholder="100.00"
                      className={cn(
                        FIELD_INPUT,
                        errors.investPrice && 'border-error-400'
                      )}
                    />
                    {errors.investPrice && <p id="page-price-unit-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investPrice}</p>}
                  </div>
                </div>

                {/* Auto-calculated total */}
                <div className="flex items-center justify-between rounded-lg bg-purple-100 dark:bg-purple-900/40 px-4 py-3">
                  <span className="text-sm text-purple-700 dark:text-purple-300">{t('transactions:form.invest.totalCost', 'Total Cost')}</span>
                  <span className="text-lg font-bold text-purple-900 dark:text-purple-100">
                    {investCurrency} {investTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Date (still editable in invest mode) */}
                <div className="w-full sm:w-36">
                  <label htmlFor="page-date" className={FIELD_LABEL}>{t('transactions:form.invest.date', 'Date')}</label>
                  <input
                    id="page-date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleInputChange('date', e.target.value)}
                    className={cn(FIELD_INPUT, 'px-2')}
                  />
                </div>
              </div>
            )}

            {!isInvestMode && (
              <CashFields
                idPrefix="txe"
                formData={formData}
                errors={errors}
                onChange={handleInputChange}
                onTagsChange={(tags) => setFormData(prev => ({ ...prev, tags }))}
                activeLoans={activeLoans}
              />
            )}

            {/* The cash form carries tags under More options; an investment edit has no such section. */}
            {isInvestMode && (
              <TagsField idPrefix="txe" tags={formData.tags} onChange={(tags) => setFormData(prev => ({ ...prev, tags }))} />
            )}

            <StickySubmitBar>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                disabled={transferUnlinked}
                leftIcon={<CheckIcon className="w-5 h-5" />}
              >
                {isSubmitting
                  ? t('transactions:form.updating', 'Updating…')
                  : isInvestMode
                    ? t('transactions:form.updateInvestment', 'Update Investment Transaction')
                    : t('transactions:form.update', 'Update Transaction')}
              </Button>
            </StickySubmitBar>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}
