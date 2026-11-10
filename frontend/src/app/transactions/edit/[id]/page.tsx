'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { CheckIcon, DocumentDuplicateIcon, InformationCircleIcon, TrashIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/transactions/returnTo';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  CATEGORIES, CURRENCIES, PAYMENT_METHODS, TYPE_TONE, CashFields, TagsField, TypeToggle, DateRow, validateCashFields, StickySubmitBar, revealFirstError,
  ENTRY_PANEL, ENTRY_SECTION, ENTRY_CAPTION, ENTRY_INPUT, ENTRY_INPUT_INVALID, ERROR_TEXT, NOTE, ROW_LIST, SEGMENTED, SEGMENT, SEGMENT_ON,
} from '@/components/transactions/TransactionFormFields';
import { cn } from '@/utils/cn';
import { transactionService } from '@/services/transactionService';
import { Transaction } from '@/shared/types';
import { useDemo } from '@/contexts/DemoContext';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDeleteTransaction } from '@/hooks/api-hooks';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { portfolioService } from '@/services/portfolioService';
import { loanService } from '@/services/loanService';
import { parseInvestDescription, buildInvestDescription } from '@/utils/investmentUtils';
import { log } from '@/utils/logger';
import { formatCurrency, localDateString, toDateInputValue } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import SplitExpenseModal, { canSplit } from '@/components/transactions/SplitExpenseModal';

const INVESTMENT_PURCHASE = 'Investment Purchase';
const INVESTMENT_SALE = 'Investment Sale';

/**
 * How an Investment Purchase row may be edited, decided once on load from the
 * backend's own rule (holding_sole_purchase: the rule the holding update uses to
 * decide whether it rewrites this leg), never from parsing the description.
 * - `holding`: this row is its lot's only purchase leg. Edited as the lot (its
 *   current quantity and cost), saved through the holding, which rewrites this leg.
 * - `lot`: the lot holds other buys, or cash withdrawn against it. Writing this
 *   buy's figures onto the lot would be wrong, and the API refuses changing the
 *   leg's money alone, so quantity, price and date are read-only here.
 * - `unlinked`: an older row with no holding link.
 */
type InvestLink = 'holding' | 'lot' | 'unlinked';

/** What the row was when loaded: delete and duplicate describe this, not unsaved edits. */
interface LoadedRow {
  type: string;
  amount: number;
  currency: string;
  description: string;
  category: string;
  walletType: string;
  paymentMethod: string;
  date: string;
  tags: string[];
  transferGroupId?: string;
  loanId?: string;
  holdingId?: string;
  peerSplitShareId?: string;
}

/** Where a split is changed, withdrawn or cancelled. */
const SPLITS_HREF = '/savings?tab=splits';

const SECONDARY_ACTION =
  'inline-flex items-center gap-1.5 rounded-lg px-2 min-h-11 lg:min-h-0 lg:py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

export default function EditTransactionPage() {
  const router = useRouter();
  // The filtered list this edit was opened from. Checked, not trusted: a returnTo is
  // a user-supplied string that becomes a navigation.
  const returnTo = safeReturnTo(useSearchParams().get(RETURN_TO_PARAM));
  const params = useParams();
  const transactionId = params.id as string;
  const queryClient = useQueryClient();
  const { demoTransactions, updateDemoTransaction, updateDemoTransfer } = useDemo();
  const { isDemo } = useModeAwareUI();
  const { t } = useTranslation(['transactions']);
  const { data: currentUser } = useCurrentUser();
  const deleteTransaction = useDeleteTransaction();
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
  const [loaded, setLoaded] = useState<LoadedRow | null>(null);
  const [activeLoans, setActiveLoans] = useState<{ id: string; name: string; current_balance: number; currency: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Split with a partner from here: the phone list has no row menu, so this page is its way in.
  const [splitting, setSplitting] = useState(false);
  // Bumped after a split so the row reloads as it now is (split, whole until accepted).
  const [reloadKey, setReloadKey] = useState(0);
  // The form exactly as the load filled it (after its own clean-ups: payment method
  // spelling, the default wallet), so "unsaved" means an edit, not a normalisation.
  const [baseline, setBaseline] = useState<typeof formData | null>(null);

  // Investment mode state (populated when category === 'Investment Purchase')
  const [isInvestMode, setIsInvestMode] = useState(false);
  const [investLink, setInvestLink] = useState<InvestLink>('unlinked');
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [investSymbol, setInvestSymbol] = useState('');
  const [investQty, setInvestQty] = useState('');
  const [investPrice, setInvestPrice] = useState('');
  const [investCurrency, setInvestCurrency] = useState('TWD');
  // The buy's figures as loaded: a holding save sends only what the user changed.
  const [loadedInvest, setLoadedInvest] = useState<{ qty: string; price: string } | null>(null);
  // Sale proceeds: the amount, day and wallet follow the sale, so only the
  // description and tags are this form's to change.
  const [isSaleMode, setIsSaleMode] = useState(false);

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
        // Per load: moving between two edit pages keeps this page mounted.
        setTransferUnlinked(false);
        setIsInvestMode(false);
        setIsSaleMode(false);
        setLoaded(null);
        setBaseline(null);
        setHoldingId(null);
        setInvestLink('unlinked');
        let txn: Transaction | null | undefined = null;

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
          const day = toDateInputValue(txn.date);
          const txnLoanId = (txn as Transaction & { loan_id?: string | null }).loan_id ?? txn.loanId ?? undefined;
          setLoaded({
            type: txType,
            amount: Number(txn.amount),
            currency: txn.currency || defaultCurrency,
            description: txn.description,
            category: txn.category,
            walletType: txn.walletType || 'life',
            paymentMethod: txn.paymentMethod || '',
            date: day,
            tags: txn.tags || [],
            transferGroupId: txn.transferGroupId,
            loanId: txnLoanId || undefined,
            holdingId: txn.holdingId,
            peerSplitShareId: txn.peerSplitShareId,
          });

          // Investment Purchase: special investment mode
          if (txn.category === INVESTMENT_PURCHASE) {
            const parsed = parseInvestDescription(txn.description);
            setIsInvestMode(true);
            let qty = parsed?.qty || '';
            let price = parsed?.price || '';
            let currency = parsed?.currency || defaultCurrency;

            let link: InvestLink = 'unlinked';
            setHoldingId(txn.holdingId ?? null);
            if (txn.holdingId && !isDemo) {
              link = 'lot';
              if (txn.holdingSolePurchase) {
                // The lot is what gets edited, so show the lot as it stands: the
                // description rounds the price, and a later Portfolio edit or a
                // sale may have moved the figures since.
                try {
                  const holdingResp = await portfolioService.getHolding(txn.holdingId);
                  const h = holdingResp.success ? holdingResp.data : null;
                  if (h) {
                    link = 'holding';
                    qty = String(Number(h.quantity));
                    price = String(Number(h.averageCost));
                    currency = h.currency || currency;
                  }
                } catch (error) {
                  // Without the lot's own figures, nothing safe to send it: read-only.
                  log.error('Failed to load the linked holding:', error);
                }
              }
            }
            setInvestLink(link);
            setInvestSymbol(parsed?.symbol || '');
            setInvestQty(qty);
            setInvestPrice(price);
            setInvestCurrency(currency);
            setLoadedInvest({ qty, price });

            setFormData({
              type: 'expense',
              amount: txn.amount.toString(),
              currency: parsed?.currency || defaultCurrency,
              description: txn.description,
              category: INVESTMENT_PURCHASE,
              paymentMethod: txn.paymentMethod || 'bank_transfer',
              walletType: txn.walletType || 'life',
              fromWallet: 'life',
              toWallet: 'emergency',
              date: day,
              tags: txn.tags || [],
              loanId: '',
            });
          } else if (txn.category === INVESTMENT_SALE) {
            setIsSaleMode(true);
            setFormData((prev) => ({
              ...prev,
              type: 'income',
              amount: txn.amount.toString(),
              currency: txn.currency || defaultCurrency,
              description: txn.description,
              category: INVESTMENT_SALE,
              walletType: txn.walletType || 'life',
              date: day,
              tags: txn.tags || [],
              loanId: '',
            }));
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
                date: toDateInputValue(transfer.date),
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
              // A demo pair: the expense leg left the From wallet, the income leg
              // reached the To wallet, whichever of the two was clicked.
              const pair = isDemo && txn.transferGroupId
                ? demoTransactions.filter((d) => d.transferGroupId === txn!.transferGroupId)
                : [];
              const outLeg = pair.find((d) => d.type === 'expense');
              const from = (outLeg?.walletType ?? (txn.type === 'income' ? (txn.walletType === 'emergency' ? 'life' : 'emergency') : txn.walletType)) || 'life';
              setFormData({
                type: 'transfer',
                amount: txn.amount.toString(),
                currency: txn.currency || defaultCurrency,
                description: txn.description,
                category: '', // Not used for transfers
                paymentMethod: '',
                walletType: from,
                fromWallet: from, // Source wallet
                toWallet: from === 'emergency' ? 'life' : 'emergency',
                date: day,
                tags: txn.tags || [],
                loanId: '',
              });
            }
          } else {
            // Regular income/expense transaction
            const categoryList = CATEGORIES[txType as 'expense' | 'income'] || CATEGORIES.expense;

            // Try to find exact match first, then case-insensitive match
            let matchedCategory = categoryList.find(c => c.value === txn!.category)?.value;
            if (!matchedCategory) {
              matchedCategory = categoryList.find(
                c => c.value.toLowerCase() === txn!.category.toLowerCase()
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

            const initial = {
              type: txType,
              amount: txn.amount.toString(),
              currency: txn.currency || defaultCurrency,
              description: txn.description,
              category: categoryValue,
              paymentMethod: paymentMethodValue,
              walletType: txn.walletType || 'life',
              fromWallet: 'life',
              toWallet: 'emergency',
              date: day,
              tags: txn.tags || [],
              // Pre-fill the loan link if this expense is tied to a loan.
              loanId: txnLoanId ?? '',
            };
            setFormData(initial);
            setBaseline(initial);
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
  }, [transactionId, router, isDemo, demoTransactions, t, reloadKey]);

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

  // Quantity and price are this form's to change only when the lot is this buy,
  // or when nothing links them (then only the cash entry changes).
  const investAmountEditable = investLink !== 'lot';

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (isSaleMode) {
      // Nothing required: the description and tags may be anything, even empty.
    } else if (isInvestMode) {
      if (investAmountEditable) {
        if (!investSymbol.trim()) newErrors.investSymbol = t('transactions:form.invest.errSymbol', 'Enter a symbol');
        if (!investQty || parseFloat(investQty) <= 0) newErrors.investQty = t('transactions:form.invest.errQty', 'Enter quantity');
        if (!investPrice || parseFloat(investPrice) <= 0) newErrors.investPrice = t('transactions:form.invest.errPrice', 'Enter price per unit');
      }
    } else {
      Object.assign(newErrors, validateCashFields(formData, t));
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const tagsChanged = () => JSON.stringify(formData.tags) !== JSON.stringify(loaded?.tags ?? []);

  const saveDemo = () => {
    if (isSaleMode) {
      updateDemoTransaction(transactionId, { description: formData.description, tags: formData.tags });
    } else if (isInvestMode) {
      // Demo has no holdings, so a demo buy is always edited as its cash entry.
      const qty = parseFloat(investQty);
      const price = parseFloat(investPrice);
      updateDemoTransaction(transactionId, {
        amount: qty * price,
        currency: investCurrency,
        description: buildInvestDescription(investSymbol.trim().toUpperCase(), qty, price, investCurrency),
        date: formData.date,
        tags: formData.tags,
      });
    } else if (formData.type === 'transfer') {
      const amount = parseFloat(formData.amount);
      const from = formData.fromWallet as 'life' | 'emergency';
      const to = formData.toWallet as 'life' | 'emergency';
      if (loaded?.transferGroupId) {
        updateDemoTransfer(loaded.transferGroupId, { fromWallet: from, toWallet: to, amount, currency: formData.currency, date: formData.date, description: formData.description });
      } else {
        // One unpaired row: it keeps its side. The income leg is the money arriving.
        const ownWallet = loaded?.type === 'income' ? to : from;
        updateDemoTransaction(transactionId, { amount, currency: formData.currency, date: formData.date, description: formData.description, walletType: ownWallet });
      }
    } else {
      updateDemoTransaction(transactionId, {
        type: formData.type as 'income' | 'expense',
        amount: parseFloat(formData.amount),
        currency: formData.currency,
        description: formData.description,
        date: formData.date,
        category: formData.category,
        paymentMethod: formData.paymentMethod || undefined,
        walletType: formData.walletType as 'life' | 'emergency',
        tags: formData.tags,
      });
    }
    toast.success(t('transactions:toast.demoSaved', 'Demo: saved for this session — sign up to keep real data'));
    router.push(returnTo);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm()) {
      revealFirstError(e.currentTarget);
      return;
    }

    if (isDemo) {
      saveDemo();
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

      // A buy whose lot is exactly this buy: through the holding. Its update
      // rewrites this Life Wallet leg (amount, description, day), so the cash spent
      // and the cost basis cannot disagree afterwards. Only what the user changed
      // is sent: the description rounds the price to 2 dp, and resending it would
      // restate an untouched lot's cost and its cash leg (at today's FX rate).
      if (isInvestMode && investLink === 'holding' && holdingId) {
        const qty = parseFloat(investQty);
        const price = parseFloat(investPrice);
        const changes = {
          ...(loadedInvest && qty === parseFloat(loadedInvest.qty) ? {} : { quantity: qty }),
          ...(loadedInvest && price === parseFloat(loadedInvest.price) ? {} : { averageCost: price }),
          ...(formData.date && formData.date !== loaded?.date ? { purchaseDate: new Date(formData.date).toISOString() } : {}),
        };
        if (Object.keys(changes).length > 0) {
          const holdingResp = await portfolioService.updateHolding({ id: holdingId, ...changes });
          if (!holdingResp.success) {
            toast.error(holdingResp.message || t('transactions:toast.updateFailed'));
            return;
          }
        }
        // The holding (and its cash leg) may have changed already: refresh before
        // anything else can fail, so the lists never show the old figures.
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
        invalidateDashboardData(queryClient);
        // Tags live on the transaction only.
        if (tagsChanged()) {
          const tagsResp = await transactionService.updateTransaction(transactionId, { tags: formData.tags });
          if (!tagsResp.success) {
            toast.error(t('transactions:toast.investTagsFailed', 'The holding was saved, but the tags were not. Try saving again.'));
            return;
          }
        }
        toast.success(t('transactions:toast.investSynced', 'Transaction and portfolio holding updated'));
        router.push(returnTo);
        return;
      }

      let updateData: Partial<Transaction> & { loan_id?: string | null };

      if (isSaleMode || (isInvestMode && investLink === 'lot')) {
        // Only what is this row's own: the money and the day follow the holding.
        updateData = isSaleMode
          ? { description: formData.description, tags: formData.tags }
          : { tags: formData.tags };
      } else if (isInvestMode) {
        // Unlinked, older row: there is no holding to keep in step, so this
        // changes the cash entry alone (the page says so).
        const qty = parseFloat(investQty);
        const price = parseFloat(investPrice);
        const sym = investSymbol.trim().toUpperCase();
        updateData = {
          type: 'expense',
          amount: qty * price,
          currency: investCurrency,
          description: buildInvestDescription(sym, qty, price, investCurrency),
          date: formData.date,
          category: INVESTMENT_PURCHASE,
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
        toast.success(t('transactions:toast.updated'));
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

  // ── Delete ────────────────────────────────────────────────────────────────
  // An investment row is the cash side of a holding: deleting it alone would
  // leave the holding (or the realized P/L) with no money behind it, which is
  // the double count the Life -> Portfolio bridge exists to prevent.
  // Keyed on the link too, not only the category: any cash leg of a holding.
  const canDelete = !!loaded && !isInvestMode && !isSaleMode && !loaded.holdingId;
  const isTransferRow = formData.type === 'transfer';
  const walletName = (w: string) => t(`transactions:form.wallets.${w}`, w === 'emergency' ? 'Emergency Wallet' : 'Life Wallet');
  const deleteMessage = (() => {
    if (!loaded) return '';
    const amount = formatCurrency(loaded.amount, loaded.currency);
    if (isTransferRow) {
      if (transferUnlinked) {
        return t('transactions:form.deleteUnlinkedTransfer', "This removes only this side of an older transfer. Its other half isn't linked, so check the other wallet afterwards.");
      }
      return t('transactions:form.deleteTransfer', {
        amount,
        from: walletName(formData.fromWallet),
        to: walletName(formData.toWallet),
        defaultValue: 'This removes both sides of the transfer: {{amount}} from {{from}} to {{to}}.',
      });
    }
    const loan = loaded.loanId ? activeLoans.find((l) => l.id === loaded.loanId) : undefined;
    if (loaded.loanId) {
      return t('transactions:form.deleteLoanLinked', {
        amount,
        loan: loan?.name ?? t('transactions:form.deleteLoanFallback', 'its loan'),
        defaultValue: '{{amount}} goes back onto {{loan}}.',
      });
    }
    return t('transactions:form.deletePlain', {
      what: loaded.type === 'income' ? t('transactions:form.submitIncomeNoun', 'income') : t('transactions:form.submitExpenseNoun', 'expense'),
      amount,
      date: loaded.date,
      defaultValue: 'Delete this {{what}} of {{amount}} on {{date}}?',
    });
  })();

  const handleDelete = async () => {
    setConfirmingDelete(false);
    try {
      await deleteTransaction.mutateAsync(transactionId);
      toast.success(isDemo ? t('common:demoAlert.changesSimulated') : t('transactions:toast.deleted'));
      router.push(returnTo);
    } catch (error) {
      log.error('Error deleting transaction:', error);
      toast.error(t('transactions:toast.deleteFailed', 'Could not delete the transaction'));
    }
  };

  // The saved row as the split API sees it. Not in demo: a split asks a real partner.
  const savedRow = loaded ? ({
    id: transactionId, type: loaded.type, amount: loaded.amount, currency: loaded.currency,
    description: loaded.description, category: loaded.category, date: loaded.date,
    peerSplitShareId: loaded.peerSplitShareId, holdingId: loaded.holdingId,
    transferGroupId: loaded.transferGroupId, loanId: loaded.loanId,
    walletType: loaded.walletType, paymentMethod: loaded.paymentMethod, tags: loaded.tags,
  } as Transaction) : null;
  const canSplitHere = !isDemo && !!savedRow && canSplit(savedRow);
  // A split takes the saved amount and reloads the row, so unsaved edits would be split wrong, then lost.
  // Every field the form saves, against the form as loaded; text compared as '' when missing.
  const same = (a?: string | null, b?: string | null) => (a ?? '') === (b ?? '');
  const unsaved = !!baseline && (
    !same(formData.amount, baseline.amount) || !same(formData.description, baseline.description)
    || !same(formData.category, baseline.category) || !same(formData.currency, baseline.currency)
    || formData.type !== baseline.type || formData.date !== baseline.date
    || !same(formData.loanId, baseline.loanId) || !same(formData.paymentMethod, baseline.paymentMethod)
    || !same(formData.walletType, baseline.walletType)
    || (formData.tags ?? []).join('\u0000') !== (baseline.tags ?? []).join('\u0000')
  );

  // "Duplicate": the add form, started from this row's saved values, dated today.
  const duplicateHref = (() => {
    if (!loaded || isTransferRow || isInvestMode || isSaleMode) return null;
    if (loaded.type !== 'expense' && loaded.type !== 'income') return null;
    const q = new URLSearchParams({
      type: loaded.type,
      amount: String(loaded.amount),
      currency: loaded.currency,
      description: loaded.description,
      category: loaded.category,
      walletType: loaded.walletType,
    });
    if (loaded.paymentMethod) q.set('paymentMethod', loaded.paymentMethod);
    if (returnTo !== '/transactions') q.set(RETURN_TO_PARAM, returnTo);
    return `/transactions/add?${q.toString()}`;
  })();

  // The page's frame: the same as /transactions/add, and drawn while the row
  // loads too, so the header is there from the first paint instead of fading in
  // (half-transparent) after a bare spinner.
  const frame = (body: React.ReactNode, after?: React.ReactNode) => (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto py-2 sm:py-4">
        {/* Phone title + back; on desktop the top bar's title and breadcrumb cover both. */}
        <PageHeader
          title={t('transactions:edit', 'Edit Transaction')}
          backHref={returnTo}
          backLabel={t('transactions:form.backToList', 'Back to Transactions')}
          className="mb-3 animate-none"
        />
        <Card padding="none" radius="xl" shadow="none" className="p-4 sm:p-6">
          {body}
        </Card>
      </div>
      {/* After the Card, not in it: a Card can carry a transform, which would
          anchor the dialog's fixed overlay to the card instead of the viewport. */}
      {after}
    </DashboardLayout>
  );

  if (isLoading) {
    return frame(
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const deleteButton = (className?: string) => (
    <button
      type="button"
      onClick={() => setConfirmingDelete(true)}
      disabled={deleteTransaction.isPending}
      className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 min-h-11 lg:min-h-0 lg:py-1.5 text-sm font-medium text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500 disabled:opacity-50', className)}
    >
      <TrashIcon className="w-4 h-4" aria-hidden="true" />
      {t('transactions:form.deleteTransaction', 'Delete transaction')}
    </button>
  );

  return frame(
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            {/* Transaction type. A transfer's type is locked: saving one leg as an
                expense or income would orphan its pair and throw both wallets off.
                Nor can an expense or income become a transfer here: there is no pair
                to edit, so it could only fail at submit. */}
            {!isInvestMode && !isSaleMode && formData.type === 'transfer' && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Shown as the add form's chosen segment, but not a control. */}
                <span className={SEGMENTED}>
                  <span className={cn(SEGMENT, SEGMENT_ON, TYPE_TONE.transfer.text, 'px-4')}>
                    {t('transactions:form.types.transfer', 'Transfer')}
                  </span>
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('transactions:form.transferTypeLocked', 'A transfer stays a transfer. To change it, delete it and add a new one.')}
                </span>
              </div>
            )}
            {!isInvestMode && !isSaleMode && formData.type !== 'transfer' && (
              <TypeToggle
                idPrefix="txe"
                types={['expense', 'income']}
                value={formData.type}
                onPick={(type) => {
                  handleInputChange('type', type);
                  handleInputChange('category', '');
                  // A loan link is an expense's; an income would keep it otherwise.
                  if (type !== 'expense') handleInputChange('loanId', '');
                }}
              />
            )}

            {transferUnlinked && (
              <div id="txe-transfer-unlinked" role="status" className="space-y-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                <p>{t('transactions:form.transferUnlinked', "This older transfer isn't linked to its other half, so it can't be edited here. Delete it and add the transfer again.")}</p>
                {/* The way forward the message names, right where it names it. */}
                {deleteButton('-ml-2')}
              </div>
            )}

            {/* Sale proceeds: shown, not edited — they follow the sale. The same
                entry panel as a cash entry, its figures read-only. */}
            {isSaleMode && (
              <>
                <p className={NOTE}>
                  <InformationCircleIcon className="w-5 h-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold text-gray-900 dark:text-white">{t('transactions:form.saleEdit.title', 'Sale proceeds')}</strong>{' · '}
                    {t('transactions:form.saleEdit.note', 'The amount, date and wallet follow the sale. To change them, edit or reverse the sale on Portfolio.')}{' '}
                    <Link href="/portfolio" className="font-medium text-primary-700 dark:text-primary-400 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                      {t('transactions:form.goToPortfolio', 'Go to Portfolio')}
                    </Link>
                  </span>
                </p>
                <div className={ENTRY_PANEL}>
                  <dl className={cn(ENTRY_SECTION, 'grid grid-cols-3 gap-3 py-3.5 sm:py-4')}>
                    <div className="min-w-0">
                      <dt className={ENTRY_CAPTION}>{t('transactions:fields.amount', 'Amount')}</dt>
                      <dd className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                        <span aria-hidden="true" className={TYPE_TONE.income.text}>{TYPE_TONE.income.sign}</span>{formatCurrency(Number(formData.amount), formData.currency)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className={ENTRY_CAPTION}>{t('transactions:fields.date', 'Date')}</dt>
                      <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{formData.date}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className={ENTRY_CAPTION}>{t('transactions:form.walletTypeLabel', 'Wallet Type')}</dt>
                      <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{walletName(formData.walletType)}</dd>
                    </div>
                  </dl>
                  <div className={cn(ENTRY_SECTION, 'pt-2.5 pb-1.5')}>
                    <label htmlFor="txe-description" className={ENTRY_CAPTION}>{t('transactions:fields.description', 'Description')}</label>
                    <input
                      id="txe-description"
                      type="text"
                      value={formData.description}
                      onChange={(e) => handleInputChange('description', e.target.value)}
                      className={ENTRY_INPUT}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Investment Purchase: the add form's buy panel, read-only where the
                holding owns the figures. */}
            {isInvestMode && (
              <>
                <p className={NOTE}>
                  <InformationCircleIcon className="w-5 h-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
                  <span>
                    <strong className={cn('font-semibold', TYPE_TONE.investment.text)}>{t('transactions:form.investEdit.title', 'Investment purchase')}</strong>{' · '}
                    {investLink === 'holding'
                      ? t('transactions:form.investEdit.noteHolding', 'Saving updates the holding and this Life Wallet entry together.')
                      : investLink === 'lot'
                        ? t('transactions:form.investEdit.noteLot', 'This buy shares its holding with other entries, so its amount and date are changed on Portfolio. Tags can be changed here.')
                        : t('transactions:form.investEdit.noteUnlinked', "This older entry isn't linked to a holding. Saving also updates a holding of this symbol bought that day, if there is one; check it on Portfolio.")}
                    {investLink !== 'holding' && (
                      <>
                        {' '}
                        <Link href="/portfolio" className="font-medium text-primary-700 dark:text-primary-400 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                          {t('transactions:form.goToPortfolio', 'Go to Portfolio')}
                        </Link>
                      </>
                    )}
                  </span>
                </p>

                <div>
                  <div className={cn(ENTRY_PANEL, (errors.investSymbol || errors.investQty || errors.investPrice) && 'border-error-300 dark:border-error-700')}>
                    {/* Symbol + Currency. Both belong to the holding once linked. */}
                    <div className={cn(ENTRY_SECTION, 'flex gap-4')}>
                      <div className="flex-1 min-w-0">
                        <label htmlFor="page-symbol" className={ENTRY_CAPTION}>
                          {t('transactions:form.invest.symbol', 'Symbol')} <span className="text-error-700 dark:text-error-400" aria-hidden="true">*</span>
                        </label>
                        <input
                          aria-invalid={!!errors.investSymbol}
                          aria-describedby={errors.investSymbol ? "page-symbol-error" : undefined}
                          id="page-symbol"
                          aria-required={investLink === 'unlinked'}
                          type="text"
                          value={investSymbol}
                          readOnly={investLink !== 'unlinked'}
                          onChange={e => setInvestSymbol(e.target.value.toUpperCase())}
                          placeholder={t('transactions:form.invest.symbolPlaceholder', 'e.g. 006208, AAPL, BTC')}
                          className={cn(
                            ENTRY_INPUT, 'text-lg sm:text-lg font-mono font-semibold uppercase placeholder:normal-case placeholder:font-sans placeholder:text-base read-only:text-gray-600 dark:read-only:text-gray-300',
                            errors.investSymbol && ENTRY_INPUT_INVALID
                          )}
                        />
                      </div>
                      <div className="w-28 shrink-0">
                        <label htmlFor="page-currency" className={ENTRY_CAPTION}>{t('transactions:form.currency', 'Currency')}</label>
                        <select
                          id="page-currency"
                          value={investCurrency}
                          disabled={investLink !== 'unlinked'}
                          onChange={e => setInvestCurrency(e.target.value)}
                          className={cn(ENTRY_INPUT, 'font-semibold disabled:text-gray-600 dark:disabled:text-gray-300 disabled:opacity-100')}
                        >
                          {CURRENCIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Quantity × Price */}
                    <div className={cn(ENTRY_SECTION, 'grid grid-cols-2 gap-x-4 sm:gap-x-5')}>
                      <div>
                        <label htmlFor="page-quantity" className={ENTRY_CAPTION}>
                          {t('transactions:form.invest.quantity', 'Quantity')} <span className="text-error-700 dark:text-error-400" aria-hidden="true">*</span>
                        </label>
                        <input
                          aria-invalid={!!errors.investQty}
                          aria-describedby={errors.investQty ? "page-quantity-error" : undefined}
                          id="page-quantity"
                          aria-required={investAmountEditable}
                          type="number"
                          inputMode="decimal"
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          step="any"
                          value={investQty}
                          readOnly={!investAmountEditable}
                          onChange={e => setInvestQty(e.target.value)}
                          placeholder="100"
                          className={cn(
                            ENTRY_INPUT, 'font-semibold tabular-nums read-only:text-gray-600 dark:read-only:text-gray-300',
                            errors.investQty && ENTRY_INPUT_INVALID
                          )}
                        />
                      </div>
                      <div>
                        <label htmlFor="page-price-unit" className={ENTRY_CAPTION}>
                          {t('transactions:form.invest.pricePerUnit', 'Price / Unit')} <span className="text-error-700 dark:text-error-400" aria-hidden="true">*</span>
                        </label>
                        <input
                          aria-invalid={!!errors.investPrice}
                          aria-describedby={errors.investPrice ? "page-price-unit-error" : undefined}
                          id="page-price-unit"
                          aria-required={investAmountEditable}
                          type="number"
                          inputMode="decimal"
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          step="any"
                          value={investPrice}
                          readOnly={!investAmountEditable}
                          onChange={e => setInvestPrice(e.target.value)}
                          placeholder="100.00"
                          className={cn(
                            ENTRY_INPUT, 'font-semibold tabular-nums read-only:text-gray-600 dark:read-only:text-gray-300',
                            errors.investPrice && ENTRY_INPUT_INVALID
                          )}
                        />
                      </div>
                    </div>

                    {/* The total: worked out, not typed. */}
                    <div className={cn(ENTRY_SECTION, 'pb-3.5 sm:pb-4')}>
                      <div className={ENTRY_CAPTION}>{t('transactions:form.invest.totalCost', 'Total Cost')}</div>
                      <div className="mt-0.5 flex items-baseline gap-2">
                        <span aria-hidden="true" className={cn('text-3xl font-semibold leading-none', TYPE_TONE.investment.text)}>{TYPE_TONE.investment.sign}</span>
                        <span className="text-3xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">
                          {investCurrency} {investTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {errors.investSymbol && <p id="page-symbol-error" role="alert" className={ERROR_TEXT}>{errors.investSymbol}</p>}
                  {errors.investQty && <p id="page-quantity-error" role="alert" className={ERROR_TEXT}>{errors.investQty}</p>}
                  {errors.investPrice && <p id="page-price-unit-error" role="alert" className={ERROR_TEXT}>{errors.investPrice}</p>}
                </div>

                {/* Date: the holding's purchase day once linked to a lot of one buy. */}
                <div className={ROW_LIST}>
                  <DateRow id="page-date" value={formData.date} readOnly={!investAmountEditable} onChange={(day) => handleInputChange('date', day)} />
                </div>
              </>
            )}

            {!isInvestMode && !isSaleMode && (
              <CashFields
                idPrefix="txe"
                formData={formData}
                errors={errors}
                onChange={handleInputChange}
                onTagsChange={(tags) => setFormData(prev => ({ ...prev, tags }))}
                activeLoans={activeLoans}
              />
            )}

            {/* The cash form carries tags under More options; an investment or sale edit has no such section. */}
            {(isInvestMode || isSaleMode) && (
              <TagsField idPrefix="txe" tags={formData.tags} onChange={(tags) => setFormData(prev => ({ ...prev, tags }))} />
            )}

            {/* Quiet secondary actions at the end of the form, outside the sticky
                bar, so a thumb reaching for Update cannot land on Delete. */}
            {(canDelete && !transferUnlinked) || duplicateHref || canSplitHere || loaded?.peerSplitShareId ? (
              <div className="space-y-1 -my-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="-ml-2 flex flex-wrap items-center gap-1">
                {duplicateHref && (
                  <Link
                    href={duplicateHref}
                    className={SECONDARY_ACTION}
                  >
                    <DocumentDuplicateIcon className="w-4 h-4" aria-hidden="true" />
                    {t('transactions:form.duplicate', 'Duplicate')}
                  </Link>
                )}
                {canSplitHere && (
                  <button type="button" onClick={() => setSplitting(true)} disabled={unsaved}
                    aria-describedby={unsaved ? 'txe-split-unsaved' : undefined}
                    className={cn(SECONDARY_ACTION, 'disabled:opacity-50 disabled:cursor-not-allowed')}>
                    <UsersIcon className="w-4 h-4" aria-hidden="true" />
                    {t('transactions:list.split', 'Split with partner')}
                  </button>
                )}
                {loaded?.peerSplitShareId && (
                  <Link href={SPLITS_HREF} className={SECONDARY_ACTION}>
                    <UsersIcon className="w-4 h-4" aria-hidden="true" />
                    {t('transactions:list.manageSplit', 'Manage split')} →
                  </Link>
                )}
                </div>
                {canDelete && !transferUnlinked && deleteButton('-mr-2')}
              </div>
              {canSplitHere && unsaved && (
                <p id="txe-split-unsaved" className="text-xs text-gray-600 dark:text-gray-400">
                  {t('transactions:form.splitSaveFirst', 'Save your changes first, then split.')}
                </p>
              )}
              </div>
            ) : null}

            <StickySubmitBar>
              <div className="flex md:justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={isSubmitting}
                  disabled={transferUnlinked}
                  aria-describedby={transferUnlinked ? 'txe-transfer-unlinked' : undefined}
                  leftIcon={<CheckIcon className="w-5 h-5" />}
                  className="md:w-auto md:min-w-[16rem] lg:min-h-12"
                >
                  {isSubmitting
                    ? t('transactions:form.updating', 'Updating…')
                    : isInvestMode
                      ? t('transactions:form.updateInvestment', 'Update Investment Transaction')
                      : t('transactions:form.update', 'Update Transaction')}
                </Button>
              </div>
            </StickySubmitBar>
          </form>,
    <>
    <ConfirmDialog
      isOpen={confirmingDelete}
      onCancel={() => setConfirmingDelete(false)}
      onConfirm={handleDelete}
      title={t('transactions:list.confirmDeleteTitle', 'Delete transaction')}
      message={deleteMessage}
    />
    <SplitExpenseModal
      transaction={splitting ? savedRow : null}
      onClose={() => setSplitting(false)}
      onSuccess={() => {
        setSplitting(false);
        toast.success(t('transactions:toast.splitSent', 'Sent to your partner'));
        setReloadKey((k) => k + 1);
      }}
    />
    </>,
  );
}
