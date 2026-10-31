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
import { TRANSACTION_TYPES, CATEGORIES, PAYMENT_METHODS, CashFields, TagsField, validateCashFields, FormPageHeader, StickySubmitBar } from '@/components/transactions/TransactionFormFields';
import { cn } from '@/utils/cn';
import { transactionService } from '@/services/transactionService';
import { Transaction } from '@/shared/types';
import { useDemo } from '@/contexts/DemoContext';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
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
  const [transferCurrency, setTransferCurrency] = useState('TWD');

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
              setTransferCurrency(transfer.currency || defaultCurrency);
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

            // Fallback: Map old categories to major categories or keep original
            let categoryValue = matchedCategory || txn.category;

            // Map deprecated categories to existing ones for better UX
            const categoryMappings: Record<string, string> = {
              'Education': 'Others',
              'Insurance': 'Others',
              'Other Expense': 'Others',
              'Other Income': 'Others',
              'Food & Dining': 'Dining',
              'Travel': 'Entertainment',
              'Personal Care': 'Healthcare',
              'Business Income': 'Others',
              'Rental Income': 'Others',
              'Gift': 'Others',
              'Refund': 'Others',
            };

            if (!matchedCategory && categoryMappings[txn.category]) {
              categoryValue = categoryMappings[txn.category];
            }

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
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (isDemo) {
      toast.success('Demo: changes simulated — sign up to save real data');
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
          currency: transferCurrency,
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
          paymentMethod: formData.paymentMethod || undefined,
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
              toast.success('Transaction and portfolio holding updated');
            } else if (matches.length > 1) {
              // Multiple lots for this symbol — we can't tell which lot this
              // transaction maps to, so don't silently overwrite the wrong one.
              toast('Transaction updated. This symbol has multiple lots — edit the specific lot on the Portfolio page to update its chart.', { icon: 'ℹ️' });
            } else {
              toast.success('Transaction updated. Holding not found — it may have been removed from Portfolio.');
            }
          } catch {
            toast.success('Transaction updated. Could not sync portfolio holding — update it manually.');
          }
        } else {
          toast.success(t('transactions:toast.updated'));
        }

        router.push(returnTo);
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      {/* Same frame as /transactions/add: the layout's own padding is the gutter. */}
      <div className="max-w-4xl mx-auto py-2 sm:py-4">
        <FormPageHeader backHref={returnTo} title={t('transactions:edit', 'Edit Transaction')} />

        <Card padding="none" radius="xl" shadow="none" className="p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            {/* Transaction Type - Compact Toggle (hidden in invest mode) */}
            {!isInvestMode && (
              <div>
                <div id="txe-group-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('transactions:form.typeLabel', 'Transaction Type')}
                </div>
                <div role="group" aria-labelledby="txe-group-type" className="flex gap-1.5 sm:gap-2">
                  {TRANSACTION_TYPES.filter((type) => type.value !== 'investment').map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      aria-pressed={formData.type === type.value}
                      onClick={() => {
                        handleInputChange('type', type.value);
                        handleInputChange('category', '');
                      }}
                      className={cn(
                        'flex-1 min-w-0 py-2 px-1 sm:py-2.5 sm:px-3 rounded-lg font-medium transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 text-xs sm:text-sm touch-manipulation',
                        formData.type === type.value
                          ? type.color === 'red'
                            ? 'bg-expense-700 dark:bg-expense-500 text-white shadow-md'
                            : type.color === 'green'
                              ? 'bg-income-700 dark:bg-income-500 text-white shadow-md'
                              : 'bg-blue-700 dark:bg-blue-500 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      )}
                    >
                      <span className="text-lg leading-none" aria-hidden="true">{type.icon}</span>
                      <span className="truncate max-w-full">{t(`transactions:form.types.${type.value}`, type.label)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Investment Purchase Section */}
            {isInvestMode && (
              <div className="space-y-4 border border-purple-200 dark:border-purple-800 rounded-lg p-4 bg-purple-50 dark:bg-purple-900/20">
                <div className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-1">
                  📈 Investment Purchase — Edit Asset Details
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mb-3">
                  Changes here update the transaction record. To update the portfolio holding, visit the Portfolio page.
                </p>

                {/* Symbol + Currency row */}
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <label htmlFor="page-symbol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Symbol <span className="text-error-700 dark:text-error-500">*</span>
                    </label>
                    <input
                      aria-invalid={!!errors.investSymbol}
                      aria-describedby={errors.investSymbol ? "page-symbol-error" : undefined}
                      id="page-symbol"
                      type="text"
                      value={investSymbol}
                      onChange={e => setInvestSymbol(e.target.value.toUpperCase())}
                      placeholder="e.g. 0050, AAPL"
                      className={cn(
                        'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500 font-mono uppercase',
                        errors.investSymbol && 'border-error-400'
                      )}
                    />
                    {errors.investSymbol && <p id="page-symbol-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investSymbol}</p>}
                  </div>
                  <div className="w-28">
                    <label htmlFor="page-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label>
                    <select
                      id="page-currency"
                      value={investCurrency}
                      onChange={e => setInvestCurrency(e.target.value)}
                      className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2.5 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
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
                    <label htmlFor="page-quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Quantity <span className="text-error-700 dark:text-error-500">*</span>
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
                        'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500',
                        errors.investQty && 'border-error-400'
                      )}
                    />
                    {errors.investQty && <p id="page-quantity-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investQty}</p>}
                  </div>
                  <div>
                    <label htmlFor="page-price-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Price/Unit <span className="text-error-700 dark:text-error-500">*</span>
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
                        'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500',
                        errors.investPrice && 'border-error-400'
                      )}
                    />
                    {errors.investPrice && <p id="page-price-unit-error" role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.investPrice}</p>}
                  </div>
                </div>

                {/* Auto-calculated total */}
                <div className="flex items-center justify-between rounded-lg bg-purple-100 dark:bg-purple-900/40 px-4 py-3">
                  <span className="text-sm text-purple-700 dark:text-purple-300">Total (auto)</span>
                  <span className="text-lg font-bold text-purple-900 dark:text-purple-100">
                    {investCurrency} {investTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Date (still editable in invest mode) */}
                <div className="w-full sm:w-36">
                  <label htmlFor="page-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
                  <input
                    id="page-date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleInputChange('date', e.target.value)}
                    className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2.5 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
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
                activeLoans={activeLoans}
              />
            )}

            <TagsField idPrefix="txe" tags={formData.tags} onChange={(tags) => setFormData(prev => ({ ...prev, tags }))} />

            <StickySubmitBar>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                leftIcon={<CheckIcon className="w-5 h-5" />}
              >
                {isSubmitting ? 'Updating...' : isInvestMode ? 'Update Investment Transaction' : 'Update Transaction'}
              </Button>
            </StickySubmitBar>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}
