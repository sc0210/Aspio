'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  TagIcon,
} from '@heroicons/react/24/outline';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { cn } from '@/utils/cn';
import { formatTWD } from '@/utils/formatters';
import { sumDayNet } from './dayTotals';
import { Transaction } from '@/shared/types';
import { useDeleteTransaction, useUpdateTransaction, useSetDayOrder } from '@/hooks/api-hooks';
import toast from 'react-hot-toast';
import { log } from '@/utils/logger';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useTranslation } from 'react-i18next';
import { TransactionRow } from './TransactionRow';
import { SortableDayGrid } from './SortableDayGrid';
import { apiDate, applyDayOrder } from './dayOrder';

const ALL_CATEGORIES = [
  { value: 'Dining', label: '🍽️ Dining' },
  { value: 'Groceries', label: '🛒 Groceries' },
  { value: 'Transportation', label: '🚗 Transportation' },
  { value: 'Shopping', label: '🛍️ Shopping' },
  { value: 'Entertainment', label: '🎬 Entertainment' },
  { value: 'Healthcare', label: '🏥 Healthcare' },
  { value: 'Housing', label: '🏠 Housing' },
  { value: 'Utilities', label: '💡 Utilities' },
  { value: 'Travel', label: '✈️ Travel' },
  { value: 'Gift', label: '🎁 Gift' },
  { value: 'Salary', label: '💼 Salary' },
  { value: 'Freelance', label: '💻 Freelance' },
  { value: 'Investment Returns', label: '📈 Investment Returns' },
  { value: 'Loan Payment', label: '💳 Loan Payment' },
  { value: 'Loan Receipt', label: '💳 Loan Receipt' },
  { value: 'Others', label: '📦 Others' },
];

interface TransactionListProps {
  transactions: Transaction[];
  isLoading?: boolean;
  isFetching?: boolean;
  isSearching?: boolean;
  searchQuery?: string;
  /**
   * Rows can be dragged into a new order within their day (#478). The page turns
   * this off while searching, filtering or sorting by anything but date, where the
   * order on screen is not the day's own order.
   */
  canReorder?: boolean;
  /** Demo mode reorders on screen only; nothing is saved. */
  isDemo?: boolean;
  /**
   * Per day key (`Date#toDateString`), the day's net across the whole filtered
   * set. A day split by a page break would otherwise total only its visible rows.
   */
  dayTotals?: Record<string, number>;
}

export function TransactionList({ transactions, isLoading, isFetching, isSearching = false, searchQuery, canReorder = false, isDemo = false, dayTotals }: TransactionListProps) {
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const deleteTransactionMutation = useDeleteTransaction();
  const updateTransactionMutation = useUpdateTransaction();
  const bulkDeleteCancelRef = useRef(false);
  const wasSearchingRef = useRef(isSearching);
  const { t } = useTranslation(['transactions']);
  const { isValueVisible } = usePrivacy();
  // mutateAsync is stable across renders; the object useMutation returns is not.
  const { mutateAsync: saveDayOrder } = useSetDayOrder();
  // Per day (the grouping key), the order a drop just produced. It bridges the gap
  // until the refetch brings the saved order back; demo mode keeps it, having no
  // server to refetch from.
  const [dayOrders, setDayOrders] = useState<Record<string, string[]>>({});

  // The latest drop per day. Two drops on one day can be in flight at once; only
  // the newer one may clear the on-screen order, or the first save finishing would
  // wipe the second drop's order while it is still saving.
  const latestDropRef = useRef<Record<string, number>>({});

  const handleReorderDay = useCallback(async (dayKey: string, date: string, orderedIds: string[]) => {
    const drop = (latestDropRef.current[dayKey] ?? 0) + 1;
    latestDropRef.current[dayKey] = drop;
    setDayOrders(prev => ({ ...prev, [dayKey]: orderedIds }));
    if (isDemo) return;
    const dropOverride = () => {
      if (latestDropRef.current[dayKey] !== drop) return; // a newer drop owns it
      setDayOrders(prev => {
        const { [dayKey]: _dropped, ...rest } = prev;
        return rest;
      });
    };
    try {
      // Resolves after the refetch, so the list never shows the old order in between.
      await saveDayOrder({ date, ids: orderedIds });
      dropOverride();
    } catch (error) {
      dropOverride();
      toast.error(t('transactions:list.reorderFailed', "Couldn't save the new order — it has been put back"));
      log.error('Reorder day error', error, 'TransactionList');
    }
  }, [isDemo, saveDayOrder, t]);

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    const absoluteDate = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
    if (diffInDays === 0) return `${t('transactions:date.today')} (${absoluteDate})`;
    if (diffInDays === 1) return `${t('transactions:date.yesterday')} (${absoluteDate})`;
    if (diffInDays < 7) return `${t('transactions:date.daysAgo', { count: diffInDays })} (${absoluteDate})`;
    return absoluteDate;
  };

  // useCallback, not a fresh closure per render: these are passed to every
  // memoised row, and a new function identity would re-render all of them on
  // any parent state change — exactly what the memo is there to prevent.
  const handleDeleteTransaction = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteTransactionMutation.mutateAsync(pendingDeleteId);
      toast.success(isDemo ? t('common:demoAlert.changesSimulated') : t('transactions:toast.deleted'));
    } catch (error) {
      toast.error(t('transactions:toast.deleteFailed'));
      log.error('Delete transaction error', error, 'TransactionList');
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleBulkDelete = () => {
    if (selectedTransactions.length === 0) return;

    const idsToDelete = [...selectedTransactions];
    bulkDeleteCancelRef.current = false;
    setSelectedTransactions([]);

    const toastId = toast(
      (toastInst) => (
        <div className="flex items-center gap-3">
          <span className="text-sm">{t('transactions:list.bulkDeletePending', { count: idsToDelete.length, defaultValue: 'Deleting {{count}} transactions in 5s…' })}</span>
          <button
            onClick={() => {
              bulkDeleteCancelRef.current = true;
              toast.dismiss(toastInst.id);
              setSelectedTransactions(idsToDelete);
              toast.success(t('transactions:list.bulkDeleteCancelled', 'Delete cancelled'));
            }}
            className="px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50"
          >
            {t('transactions:list.undo', 'Undo')}
          </button>
        </div>
      ),
      { duration: 5500, icon: '🗑️' },
    );

    setTimeout(async () => {
      if (bulkDeleteCancelRef.current) return;
      toast.dismiss(toastId);
      try {
        await Promise.all(idsToDelete.map(id => deleteTransactionMutation.mutateAsync(id)));
        toast.success(isDemo
          ? t('common:demoAlert.changesSimulated')
          : t('transactions:list.bulkDeleteDone', { count: idsToDelete.length, defaultValue: 'Deleted {{count}} transactions' }));
      } catch (error) {
        toast.error(t('transactions:toast.deleteFailed'));
        log.error('Bulk delete error', error, 'TransactionList');
      }
    }, 5000);
  };

  useEffect(() => {
    return () => { bulkDeleteCancelRef.current = true; };
  }, []);

  const handleBulkReassign = async (field: 'category' | 'walletType', value: string) => {
    if (!value || selectedTransactions.length === 0) return;
    const count = selectedTransactions.length;
    try {
      await Promise.all(
        selectedTransactions.map(id =>
          updateTransactionMutation.mutateAsync({ id, data: { [field]: value } })
        )
      );
      toast.success(`Updated ${field === 'category' ? 'category' : 'wallet'} for ${count} transactions`);
      setSelectedTransactions([]);
    } catch (error) {
      toast.error('Update failed');
      log.error('Bulk reassign error', error, 'TransactionList');
    }
  };

  const handleBulkExport = () => {
    if (selectedTransactions.length === 0) {
      return;
    }

    // Get selected transaction data
    const selectedData = transactions.filter(t => selectedTransactions.includes(t.id));

    const csvHeaders = [
      t('transactions:export.date', '日期'),
      t('transactions:export.description', '描述'),
      t('transactions:export.category', '分類'),
      t('transactions:export.type', '類型'),
      t('transactions:export.amount', '金額'),
      t('transactions:export.currency', '貨幣'),
      t('transactions:export.paymentMethod', '付款方式'),
    ];
    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csvRows = selectedData.map(tx => [
      new Date(tx.date).toLocaleDateString(),
      tx.description,
      tx.category,
      tx.type,
      tx.amount.toString(),
      tx.currency,
      tx.paymentMethod || '',
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(escapeCell).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(t('transactions:toast.exported', { count: selectedTransactions.length }));
  };

  const handleSelectTransaction = useCallback((id: string) => {
    setSelectedTransactions(prev =>
      prev.includes(id)
        ? prev.filter(tid => tid !== id)
        : [...prev, id]
    );
  }, []);

  // Membership is asked once per row on every render. As an array that is
  // O(n) a row and O(n²) for the list; as a Set it is O(1), and the row takes
  // a plain boolean so it only re-renders when its own selection changes.
  const selectedIds = useMemo(() => new Set(selectedTransactions), [selectedTransactions]);

  const handleSelectAll = () => {
    if (selectedTransactions.length === transactions.length) {
      setSelectedTransactions([]);
    } else {
      setSelectedTransactions(transactions.map(t => t.id));
    }
  };

  const toggleDayExpansion = (dateString: string) => {
    setExpandedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateString)) {
        newSet.delete(dateString);
      } else {
        newSet.add(dateString);
      }
      return newSet;
    });
  };

  // Defensive dedup by id. Several independent producers feed this list —
  // paginated fetch aggregation, optimistic create, demo mode, CSV import — and
  // any duplicate id would crash React with "two children with the same key".
  // This is the only layer that sees the fully-merged list, so dedup here as the
  // final safety net (keep first occurrence to preserve order).
  const uniqueTransactions = React.useMemo(() => {
    const seen = new Set<string>();
    return transactions.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [transactions]);

  // Group transactions by date
  const groupedTransactions = React.useMemo(() => {
    return uniqueTransactions.reduce((groups, transaction) => {
      const date = new Date(transaction.date).toDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(transaction);
      return groups;
    }, {} as Record<string, Transaction[]>);
  }, [uniqueTransactions]);

  // Auto-expand logic based on search state
  React.useEffect(() => {
    const wasSearching = wasSearchingRef.current;
    wasSearchingRef.current = isSearching;

    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();

    if (isSearching) {
      // Expand all days when searching (including when new data arrives)
      setExpandedDays(new Set(Object.keys(groupedTransactions)));
    } else if (wasSearching) {
      // Exiting search: reset to today/yesterday
      const auto = new Set<string>();
      if (groupedTransactions[today]) auto.add(today);
      if (groupedTransactions[yesterday]) auto.add(yesterday);
      setExpandedDays(auto);
    } else {
      // Not searching (initial load or background refetch): only add new days, preserve user state
      setExpandedDays(prev => {
        const next = new Set(prev);
        if (groupedTransactions[today]) next.add(today);
        if (groupedTransactions[yesterday]) next.add(yesterday);
        return next.size === prev.size ? prev : next;
      });
    }
  }, [isSearching, groupedTransactions]);

  if (isLoading) {
    return (
      <div className="card">
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/6"></div>
                </div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">📄</span>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {t('transactions:list.noResults')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          {t('transactions:list.adjustSearch')}
        </p>
      </div>
    );
  }

  return (
    <div className="relative space-y-4 [&>*:last-child]:mb-0">
      {/* Refetch overlay */}
      {isFetching && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 px-2 py-1 bg-white/80 dark:bg-gray-900/80 rounded-bl-lg text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
          <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span>{t('transactions:list.updating', 'Updating…')}</span>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedTransactions.length > 0 && (
        <div className="card bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={selectedTransactions.length === transactions.length}
                onChange={handleSelectAll}
                className="h-4 w-4 text-primary-600 focus-visible:ring-primary-500 border-gray-300 rounded"
                aria-label="Select all transactions"
              />
              <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
                {t('transactions:list.selectedCount', { count: selectedTransactions.length })}
              </span>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleBulkExport}
                className="btn btn-sm bg-white dark:bg-gray-800 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30"
              >
                {t('transactions:list.export')}
              </button>
              <button
                onClick={handleBulkDelete}
                className="btn btn-sm bg-white dark:bg-gray-800 text-error-700 dark:text-error-400 hover:bg-error-100 dark:hover:bg-error-900/30"
              >
                {t('transactions:list.delete')}
              </button>
            </div>
          </div>

          {/* Bulk reassignment row */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-primary-200 dark:border-primary-700">
            <div className="flex items-center gap-1.5 text-xs text-primary-700 dark:text-primary-300 font-medium">
              <TagIcon className="w-3.5 h-3.5" />
              <span>{t('transactions:list.reassign', 'Reassign:')}</span>
            </div>
            <select
              defaultValue=""
              aria-label={t('transactions:list.categoryPlaceholder', 'Reassign category')}
              onChange={e => { handleBulkReassign('category', e.target.value); e.target.value = ''; }}
              className="text-xs px-2 py-1.5 rounded-lg border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              disabled={updateTransactionMutation.isPending}
            >
              <option value="" disabled>{t('transactions:list.categoryPlaceholder', 'Category…')}</option>
              {ALL_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
            <select
              defaultValue=""
              aria-label={t('transactions:list.walletPlaceholder', 'Reassign wallet')}
              onChange={e => { handleBulkReassign('walletType', e.target.value); e.target.value = ''; }}
              className="text-xs px-2 py-1.5 rounded-lg border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              disabled={updateTransactionMutation.isPending}
            >
              <option value="" disabled>{t('transactions:list.walletPlaceholder', 'Wallet…')}</option>
              <option value="life">💳 {t('transactions:wallet.life', 'Life Wallet')}</option>
              <option value="emergency">🚨 {t('transactions:wallet.emergency', 'Emergency Wallet')}</option>
            </select>
            {updateTransactionMutation.isPending && (
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </div>
      )}

      {/* Single delete confirmation modal — Headless UI Dialog gives a focus
          trap, Escape-to-close, and focus return for free. */}
      <Dialog
        open={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center px-4">
          <DialogPanel className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-6 space-y-4">
            <DialogTitle className="text-base font-semibold text-gray-900 dark:text-white">
              {t('transactions:list.confirmDeleteTitle')}
            </DialogTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('transactions:deleteConfirmation')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors"
              >
                {t('transactions:list.confirmDeleteCancel')}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteTransactionMutation.isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-error-600 text-white hover:bg-error-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleteTransactionMutation.isPending
                  ? t('transactions:list.deleting')
                  : t('transactions:list.confirmDeleteAction')}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Grouped Transactions */}
      {Object.entries(groupedTransactions)
        .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
        .map(([dateString, dayTransactions]) => {
          const date = new Date(dateString);
          const dayTotal = dayTotals?.[dateString] ?? sumDayNet(dayTransactions);
          const isExpanded = expandedDays.has(dateString);
          const transactionCount = dayTransactions.length;

          return (
            <div key={dateString} className="space-y-3">
              {/* Date Header - Enhanced with better visual hierarchy */}
              <button
                onClick={() => toggleDayExpansion(dateString)}
                className="group w-full flex items-center justify-between py-3 px-2 border-b-2 border-gray-200 dark:border-gray-700 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent dark:hover:from-gray-800 dark:hover:to-transparent transition-all duration-200 rounded-lg"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} transactions for ${formatDate(date)}`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-1 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30 transition-all duration-200">
                    {isExpanded ? (
                      <ChevronUpIcon className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400" />
                    ) : (
                      <ChevronDownIcon className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400" />
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                    {formatDate(date)}
                    <span className="hidden sm:inline ml-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300">
                      {date.toLocaleDateString(undefined, { weekday: 'long' })}
                    </span>
                    <span className="hidden sm:inline ml-2 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30 transition-all">
                      {t('transactions:list.transactionCount', { count: transactionCount })}
                    </span>
                  </h3>
                </div>
                <div className={cn(
                  'text-base font-bold px-3 py-1 rounded-lg transition-all duration-200',
                  dayTotal >= 0
                    ? 'text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-900/20'
                    : 'text-error-600 dark:text-error-400 bg-error-50 dark:bg-error-900/20'
                )}>
                  {isValueVisible ? `${dayTotal >= 0 ? '+' : ''}${formatTWD(dayTotal)}` : '•••••'}
                </div>
              </button>

              {/* Transactions for this date - Enhanced grid with stagger animation */}
              {isExpanded && (
                <SortableDayGrid
                  rows={applyDayOrder(dayTransactions, dayOrders[dateString])}
                  enabled={canReorder}
                  onReorder={(ids) => handleReorderDay(dateString, apiDate(dayTransactions[0].date), ids)}
                  renderRow={(transaction, index) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      index={index}
                      isSelected={selectedIds.has(transaction.id)}
                      isValueVisible={isValueVisible}
                      isDeleting={deleteTransactionMutation.isPending}
                      searchQuery={searchQuery}
                      onSelect={handleSelectTransaction}
                      onDelete={handleDeleteTransaction}
                    />
                  )}
                />
              )}
            </div>
          );
        })
      }
    </div>
  );
}
