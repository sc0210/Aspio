'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeftIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/transactions/returnTo';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
import { localDateString, formatCurrency } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

const TRANSACTION_TYPES = [
  { value: 'expense', label: 'Expense', icon: '💸', color: 'red' },
  { value: 'income', label: 'Income', icon: '💰', color: 'green' },
  { value: 'transfer', label: 'Transfer', icon: '🔄', color: 'blue' },
];

const CATEGORIES = {
  expense: [
    { value: 'Dining', label: 'Dining', icon: '🍽️' },
    { value: 'Groceries', label: 'Groceries', icon: '🛒' },
    { value: 'Transportation', label: 'Transport', icon: '🚗' },
    { value: 'Shopping', label: 'Shopping', icon: '🛍️' },
    { value: 'Entertainment', label: 'Fun', icon: '🎬' },
    { value: 'Healthcare', label: 'Health', icon: '🏥' },
    { value: 'Housing', label: 'Housing', icon: '🏠' },
    { value: 'Utilities', label: 'Utilities', icon: '💡' },
    { value: 'Travel', label: 'Travel', icon: '✈️' },
    { value: 'Gift', label: 'Gift', icon: '🎁' },
    { value: 'Loan Payment', label: 'Loan', icon: '💳' },
    { value: 'Others', label: 'Others', icon: '📦' },
  ],
  income: [
    { value: 'Salary', label: 'Salary', icon: '💼' },
    { value: 'Freelance', label: 'Freelance', icon: '💻' },
    { value: 'Investment Returns', label: 'Investment', icon: '📈' },
    { value: 'Gift', label: 'Gift', icon: '🎁' },
    { value: 'Others', label: 'Others', icon: '💵' },
  ],
};

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: '💵', color: 'bg-green-50 dark:bg-green-900/20' },
  { value: 'credit_card', label: 'Credit Card', icon: '💳', color: 'bg-blue-50 dark:bg-blue-900/20' },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: '🏦', color: 'bg-gray-50 dark:bg-gray-700' },
  { value: 'digital_wallet', label: 'E-Wallet', icon: '📱', color: 'bg-orange-50 dark:bg-orange-900/20' },
];

// Life and Emergency are the only cash wallets. The Portfolio wallet holds
// invested assets only — never cash — so it is not a valid transfer target.
const WALLET_TYPES = [
  { value: 'life',      label: 'Life Wallet',      icon: '💳', color: 'bg-blue-50 dark:bg-blue-900/20',     description: 'Daily income/expenses' },
  { value: 'emergency', label: 'Emergency Wallet', icon: '🚨', color: 'bg-orange-50 dark:bg-orange-900/20', description: 'Emergency fund'        },
];

const INCOME_EXPENSE_WALLET_TYPES = WALLET_TYPES;

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
  const [tagInput, setTagInput] = useState('');
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
      if (!investSymbol.trim()) newErrors.investSymbol = 'Enter symbol';
      if (!investQty || parseFloat(investQty) <= 0) newErrors.investQty = 'Enter quantity';
      if (!investPrice || parseFloat(investPrice) <= 0) newErrors.investPrice = 'Enter price';
    } else {
      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        newErrors.amount = 'Enter amount';
      }
      if (!formData.description.trim()) {
        newErrors.description = 'Add description';
      }

      // Category is not required for transfers
      if (formData.type !== 'transfer' && !formData.category) {
        newErrors.category = 'Select category';
      }

      // For transfers, validate wallet selection
      if (formData.type === 'transfer') {
        if (formData.fromWallet === formData.toWallet) {
          newErrors.transfer = 'Source and destination wallets must be different';
        }
      }
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

  const handleAddTag = () => {
    const tag = tagInput.trim().replace(/^#/, ''); // Remove leading # if present
    if (tag && !formData.tags.includes(tag)) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Backspace' && tagInput === '' && formData.tags.length > 0) {
      // Remove last tag if backspace is pressed on empty input
      handleRemoveTag(formData.tags[formData.tags.length - 1]);
    }
  };

  const currentCategories = formData.type === 'transfer'
    ? []
    : CATEGORIES[formData.type as keyof typeof CATEGORIES] || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center mb-8">
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
            {/* Transaction Type - Compact Toggle (hidden in invest mode) */}
            {!isInvestMode && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('transactions:form.typeLabel', 'Transaction Type')}
                </label>
                <div className="flex gap-2">
                  {TRANSACTION_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      aria-pressed={formData.type === type.value}
                      onClick={() => {
                        handleInputChange('type', type.value);
                        handleInputChange('category', '');
                      }}
                      className={cn(
                        'flex-1 py-2.5 px-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 text-sm',
                        formData.type === type.value
                          ? type.color === 'red'
                            ? 'bg-expense-500 text-white shadow-md'
                            : type.color === 'green'
                              ? 'bg-income-500 text-white shadow-md'
                              : 'bg-blue-500 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      )}
                    >
                      <span className="text-lg">{type.icon}</span>
                      <span>{t(`transactions:form.types.${type.value}`, type.label)}</span>
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
                  <div className="flex-1">
                    <label htmlFor="page-symbol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Symbol <span className="text-error-500">*</span>
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
                        'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500 font-mono uppercase',
                        errors.investSymbol && 'border-error-400'
                      )}
                    />
                    {errors.investSymbol && <p id="page-symbol-error" role="alert" className="text-xs text-error-500 mt-1">{errors.investSymbol}</p>}
                  </div>
                  <div className="w-28">
                    <label htmlFor="page-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label>
                    <select
                      id="page-currency"
                      value={investCurrency}
                      onChange={e => setInvestCurrency(e.target.value)}
                      className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
                    >
                      {['TWD', 'USD', 'HKD', 'JPY', 'SGD', 'EUR'].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Qty + Price row */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="page-quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Quantity <span className="text-error-500">*</span>
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
                        'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500',
                        errors.investQty && 'border-error-400'
                      )}
                    />
                    {errors.investQty && <p id="page-quantity-error" role="alert" className="text-xs text-error-500 mt-1">{errors.investQty}</p>}
                  </div>
                  <div className="flex-1">
                    <label htmlFor="page-price-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Price/Unit <span className="text-error-500">*</span>
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
                        'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500',
                        errors.investPrice && 'border-error-400'
                      )}
                    />
                    {errors.investPrice && <p id="page-price-unit-error" role="alert" className="text-xs text-error-500 mt-1">{errors.investPrice}</p>}
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
                    className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
                  />
                </div>
              </div>
            )}

            {/* Transfer Wallet Selection - Only show when type is transfer */}
            {!isInvestMode && formData.type === 'transfer' && (
              <div className="space-y-4 border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50 dark:bg-blue-900/20">
                <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-3">
                  🔄 Transfer Between Wallets
                </div>

                {errors.transfer && (
                  <div role="alert" className="text-sm text-error-600 dark:text-error-400 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg p-3">
                    {errors.transfer}
                  </div>
                )}

                {/* From Wallet */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('transactions:form.fromWallet', 'From Wallet')} <span className="text-error-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {WALLET_TYPES.map((wallet) => (
                      <button
                        key={wallet.value}
                        type="button"
                        aria-pressed={formData.fromWallet === wallet.value}
                        onClick={() => handleInputChange('fromWallet', wallet.value)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-3 rounded-lg transition-all duration-200 border-2',
                          formData.fromWallet === wallet.value
                            ? 'border-expense-500 bg-expense-50 dark:bg-expense-900/30 shadow-md'
                            : 'border-gray-200 dark:border-gray-700 hover:border-expense-300 dark:hover:border-expense-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                      >
                        <span className="text-xl">{wallet.icon}</span>
                        <span className={cn(
                          'text-xs font-medium text-center',
                          formData.fromWallet === wallet.value
                            ? 'text-expense-700 dark:text-expense-300'
                            : 'text-gray-700 dark:text-gray-300'
                        )}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* To Wallet */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('transactions:form.toWallet', 'To Wallet')} <span className="text-income-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {WALLET_TYPES.map((wallet) => (
                      <button
                        key={wallet.value}
                        type="button"
                        aria-pressed={formData.toWallet === wallet.value}
                        onClick={() => handleInputChange('toWallet', wallet.value)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-3 rounded-lg transition-all duration-200 border-2',
                          formData.toWallet === wallet.value
                            ? 'border-income-500 bg-income-50 dark:bg-income-900/30 shadow-md'
                            : 'border-gray-200 dark:border-gray-700 hover:border-income-300 dark:hover:border-income-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                      >
                        <span className="text-xl">{wallet.icon}</span>
                        <span className={cn(
                          'text-xs font-medium text-center',
                          formData.toWallet === wallet.value
                            ? 'text-income-700 dark:text-income-300'
                            : 'text-gray-700 dark:text-gray-300'
                        )}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Date, Description, and Amount - Responsive Layout (hidden in invest mode) */}
            {!isInvestMode && <div>
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Date */}
                <div className="w-full sm:w-36">
                  <label htmlFor="page-date-2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Date</label>
                  <input
                    id="page-date-2"
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleInputChange('date', e.target.value)}
                    className="w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500"
                  />
                </div>

                {/* Description */}
                <div className="flex-1">
                  <label htmlFor="page-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
                  <input
                    aria-invalid={!!errors.description}
                    aria-describedby={errors.description ? "page-description-error" : undefined}
                    id="page-description"
                    type="text"
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    placeholder={t('transactions:form.descriptionPlaceholder', "What's this for?")}
                    className={cn(
                      "w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500",
                      errors.description && "border-error-400"
                    )}
                    autoFocus
                  />
                  {errors.description && <p id="page-description-error" role="alert" className="text-xs text-error-500 mt-1">{errors.description}</p>}
                </div>

                {/* Amount */}
                <div className="w-full sm:w-40">
                  <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Amount</div>
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
                      aria-label={t('transactions:fields.amount', 'Amount')}
                      aria-invalid={!!errors.amount}
                      aria-describedby={errors.amount ? 'page-amount-error' : undefined}
                      type="number"
                      inputMode="decimal"
                      onWheel={(e) => e.currentTarget.blur()}
                      step="0.01"
                      min="0"
                      value={formData.amount}
                      onChange={(e) => handleInputChange('amount', e.target.value)}
                      placeholder="0"
                      className={cn(
                        "flex-1 text-base font-semibold bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:ring-0",
                        errors.amount && "text-error-500"
                      )}
                    />
                  </div>
                  {errors.amount && <p id="page-amount-error" role="alert" className="text-xs text-error-500 mt-1">{errors.amount}</p>}
                </div>
              </div>
            </div>}

            {/* Category - Responsive Grid (hide for transfers and invest mode) */}
            {!isInvestMode && formData.type !== 'transfer' && (
              <div>
                <div id="txe-group-category" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('transactions:form.categoryLabel', 'Category')} {errors.category && <span className="text-error-500 text-xs">*</span>}
                </div>
                <div role="group" aria-labelledby="txe-group-category" className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {currentCategories.map((category) => {
                    const isSelected = formData.category === category.value;
                    return (
                      <button
                        key={category.value}
                        type="button"
                        onClick={() => {
                          handleInputChange('category', category.value);
                        }}
                        className={cn(
                          'flex flex-col items-center gap-1 p-2 rounded-lg transition-all min-h-[72px] touch-manipulation border-2',
                          isSelected
                            ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-500 dark:border-primary-400 shadow-md scale-105'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500 active:scale-95'
                        )}
                        aria-pressed={isSelected}
                        aria-label={`Select ${category.label} category`}
                      >
                        <span className="text-2xl" role="img" aria-hidden="true">{category.icon}</span>
                        <span className={cn(
                          "text-xs font-medium text-center leading-tight",
                          isSelected ? "text-primary-700 dark:text-primary-300" : "text-gray-700 dark:text-gray-300"
                        )}>{t(`transactions:form.categories.${category.value}`, category.label)}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.category && <p className="text-sm text-error-500 mt-1" role="alert">{errors.category}</p>}
              </div>
            )}

            {/* Link to Loan (expense only) — linking reduces the loan balance;
                unlinking restores it. Mirrors the Add-transaction form. */}
            {!isInvestMode && formData.type === 'expense' && activeLoans.length > 0 && (
              <div>
                <div id="txe-group-loan" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('transactions:form.linkToLoan', 'Link to Loan')} <span className="text-xs text-gray-400 font-normal italic">{t('transactions:form.linkToLoanHint', '(optional — reduces loan balance)')}</span>
                </div>
                <div role="group" aria-labelledby="txe-group-loan" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

            {/* Payment Method - Optional, Icon Style (hide for transfers and invest mode) */}
            {!isInvestMode && formData.type !== 'transfer' && (
              <div>
                <div id="txe-group-payment" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('transactions:form.paymentMethodLabel', 'Payment Method')} <span className="text-xs text-gray-400 dark:text-gray-500 font-normal italic">{t('transactions:form.optional', '(optional)')}</span>
                </div>
                <div role="group" aria-labelledby="txe-group-payment" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => handleInputChange('paymentMethod', method.value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all duration-200 min-h-[72px] touch-manipulation',
                        formData.paymentMethod === method.value
                          ? 'bg-primary-500 dark:bg-primary-600 ring-2 ring-primary-500 dark:ring-primary-400 ring-offset-2 shadow-lg scale-105'
                          : method.color + ' hover:scale-105 hover:shadow-md active:scale-95'
                      )}
                      aria-pressed={formData.paymentMethod === method.value}
                      aria-label={`Select ${method.label} payment method`}
                    >
                      <span
                        className={cn(
                          'text-2xl transition-transform',
                          formData.paymentMethod === method.value && 'scale-110'
                        )}
                        role="img"
                        aria-hidden="true"
                      >{method.icon}</span>
                      <span className={cn(
                        'text-xs font-medium text-center leading-tight',
                        formData.paymentMethod === method.value
                          ? 'text-white'
                          : 'text-gray-700 dark:text-gray-300'
                      )}>{t(`transactions:form.paymentMethods.${method.value}`, method.label)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Wallet Type - Required (hide for transfers and invest mode) */}
            {!isInvestMode && formData.type !== 'transfer' && (
              <div>
                <div id="txe-group-wallet-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('transactions:form.walletTypeLabel', 'Wallet Type')} <span className="text-error-500">*</span>
                </div>
                <div
                  role="group"
                  aria-labelledby="txe-group-wallet-type"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  {INCOME_EXPENSE_WALLET_TYPES.map((wallet) => (
                    <button
                      key={wallet.value}
                      type="button"
                      onClick={() => handleInputChange('walletType', wallet.value)}
                      className={cn(
                        'flex flex-col items-start gap-2 p-4 rounded-xl transition-all duration-200 border-2',
                        formData.walletType === wallet.value
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 shadow-md'
                          : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                      )}
                      aria-pressed={formData.walletType === wallet.value}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="text-xl" role="img" aria-hidden="true">{wallet.icon}</span>
                        <span className={cn(
                          'text-sm font-semibold',
                          formData.walletType === wallet.value
                            ? 'text-primary-700 dark:text-primary-300'
                            : 'text-gray-700 dark:text-gray-300'
                        )}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                      </div>
                      <p className={cn(
                        'text-xs w-full text-left',
                        formData.walletType === wallet.value
                          ? 'text-primary-600 dark:text-primary-400'
                          : 'text-gray-500 dark:text-gray-400'
                      )}>{t(`transactions:form.walletDescriptions.${wallet.value}`, wallet.description)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tags - Optional */}
            <div>
              <label htmlFor="page-tags-optional" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Tags <span className="text-xs text-gray-400 dark:text-gray-500 font-normal italic">(optional)</span>
              </label>

              {/* Tag Input */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">#</span>
                  <input
                    id="page-tags-optional"
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
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    tagInput.trim()
                      ? 'bg-primary-500 text-white hover:bg-primary-600'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  )}
                >
                  Add
                </button>
              </div>

              {/* Tag List */}
              {formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.tags.map((tag) => (
                    <div
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-sm"
                    >
                      <span>#{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-primary-900 dark:hover:text-primary-100 transition-colors"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Helper Text */}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Use tags to organize your transactions (e.g., #vacation, #business, #savings)
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
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
            </div>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}
