'use client';

import { useMemo, useState } from 'react';
import {
  XMarkIcon,
  CalendarIcon,
  CurrencyDollarIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon as CancelIcon,
  TrashIcon,
  ArrowTrendingDownIcon,
  AdjustmentsHorizontalIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { cn } from '@/utils/cn';
import { formatCurrency, localDateString } from '@/utils/formatters';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatSectorLabel } from '@/utils/holdingLabels';
import { LotSelectionModal } from './LotSelectionModal';
import type { CostBasisMethod } from '@/utils/costBasis';
import { useDialog } from '@/hooks/useDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Card } from '@/components/ui/Card';
import { editLotDraft, lotDraft, lotDraftErrors, type LotDraft, type LotDraftField } from '@/lib/portfolio/lotDraft';

interface HoldingLot {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  totalValue: number;
  totalCost: number;
  gainLoss: number;
  gainLossPercentage: number;
  currency: string;
  purchaseDate?: string;
  sector?: string;
  /** No feed prices this holding, so its current value is the user's to enter. */
  manuallyPriced?: boolean;
}

interface HoldingDetailModalProps {
  holdings: HoldingLot[];
  symbol: string;
  isValueVisible: boolean;
  onClose: () => void;
  onUpdateLot?: (lotId: string, updates: { purchaseDate?: string; quantity?: number; averageCost?: number; currentPrice?: number }) => Promise<void>;
  onSellLot?: (holding: HoldingLot) => void;
  onDeleteLot?: (lotId: string) => Promise<void>;
  onUpdateSymbol?: (symbol: string, updates: { name?: string; sector?: string }) => Promise<void>;
  onSellHolding?: (symbol: string, quantity: number, price: number, selectedLotIds: string[], method: CostBasisMethod) => Promise<void>;
}

export function HoldingDetailModal({
  holdings,
  symbol,
  isValueVisible,
  onClose,
  onUpdateLot,
  onSellLot,
  onDeleteLot,
  onUpdateSymbol,
  onSellHolding
}: HoldingDetailModalProps) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });
  const { t } = useTranslation(['portfolio']);
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [editingAggregate, setEditingAggregate] = useState(false);
  // `whole` deletes the investment's only lot and closes this modal with it.
  const [pendingDelete, setPendingDelete] = useState<{ lotId: string; whole: boolean; message: string } | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellQuantity, setSellQuantity] = useState(0);
  const [editPurchaseDate, setEditPurchaseDate] = useState('');
  // What the editor opened with, so Save can tell a date the user changed from one
  // it merely prefilled. See the Save handler for why that distinction matters.
  const [initialPurchaseDate, setInitialPurchaseDate] = useState('');
  const [draft, setDraft] = useState<LotDraft | null>(null);
  const editDraft = (field: LotDraftField, text: string) =>
    setDraft(prev => (prev ? editLotDraft(prev, field, text) : prev));
  // Text the draft kept but could not apply (a negative, a blank). Save is blocked
  // while any is present: it would send the old numbers and still say "updated".
  // Current value is only an input on a manually priced lot (quoted lots take the
  // market price), so only check it there.
  const editingLot = holdings.find(h => h.id === editingLotId);
  const draftErrors = draft
    ? lotDraftErrors(draft, editingLot?.manuallyPriced ? undefined : ['quantity', 'averageCost', 'totalCost'])
    : {};
  const draftHasErrors = Object.keys(draftErrors).length > 0;
  const fieldErrorText = (field: LotDraftField): string | null => {
    const error = draftErrors[field];
    if (!error) return null;
    if (error === 'negative') return t('portfolio:lotEdit.errors.negative', 'Must be 0 or more');
    if (error === 'noQuantity') return t('portfolio:lotEdit.errors.noQuantity', 'Enter a quantity first');
    return t('portfolio:lotEdit.errors.required', 'Enter a number');
  };
  // Error state for one draft input: red border, aria wiring, and the message.
  const lotInputClass = (field: LotDraftField, width: string) => cn(
    width,
    'px-2 py-1 text-sm text-right border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
    draftErrors[field]
      ? 'border-error-500 dark:border-error-400'
      : 'border-gray-300 dark:border-gray-600',
  );
  const lotInputError = (lotId: string, field: LotDraftField) => {
    const message = fieldErrorText(field);
    return message ? (
      <p id={`lot-${lotId}-${field}-error`} role="alert" className="mt-1 text-xs text-error-700 dark:text-error-400">
        {message}
      </p>
    ) : null;
  };
  const lotInputAria = (lotId: string, field: LotDraftField) =>
    draftErrors[field]
      ? { 'aria-invalid': true as const, 'aria-describedby': `lot-${lotId}-${field}-error` }
      : {};
  const [aggregateEditForm, setAggregateEditForm] = useState({
    name: '',
    sector: ''
  });
  // Calculate aggregated metrics
  const aggregatedMetrics = useMemo(() => {
    if (holdings.length === 0) return null;

    const totalQuantity = holdings.reduce((sum, lot) => sum + lot.quantity, 0);
    const totalCost = holdings.reduce((sum, lot) => sum + (lot.quantity * lot.averageCost), 0);
    const totalValue = holdings.reduce((sum, lot) => sum + lot.totalValue, 0);
    const weightedAvgCost = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    const currentPrice = holdings[0].currentPrice;
    const gainLoss = totalValue - totalCost;
    const gainLossPercentage = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
    const currency = holdings[0].currency;

    return {
      totalQuantity,
      weightedAvgCost,
      currentPrice,
      totalCost,
      totalValue,
      gainLoss,
      gainLossPercentage,
      currency,
      name: holdings[0].name,
      sector: holdings[0].sector,
    };
  }, [holdings]);

  if (!aggregatedMetrics) return null;

  // Handle aggregate edit
  const handleStartAggregateEdit = () => {
    setAggregateEditForm({
      name: aggregatedMetrics.name || '',
      sector: aggregatedMetrics.sector || ''
    });
    setEditingAggregate(true);
  };

  const handleSaveAggregateEdit = async () => {
    if (!onUpdateSymbol) return;

    try {
      await onUpdateSymbol(symbol, aggregateEditForm);
      setEditingAggregate(false);
      toast.success(t('portfolio:toast.holdingDetailsUpdated', { symbol }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('portfolio:toast.holdingDetailsUpdateFailed'));
    }
  };

  const handleCancelAggregateEdit = () => {
    setEditingAggregate(false);
    setAggregateEditForm({
      name: aggregatedMetrics.name || '',
      sector: aggregatedMetrics.sector || ''
    });
  };

  // Sort lots by purchase date (newest first), then by ID for stable sort
  const sortedLots = [...holdings].sort((a, b) => {
    if (!a.purchaseDate) return 1;
    if (!b.purchaseDate) return -1;

    const dateComparison = new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime();

    // If dates are the same, sort by ID to ensure stable ordering
    if (dateComparison === 0) {
      return a.id.localeCompare(b.id);
    }

    return dateComparison;
  });


  const confirmPendingDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target || !onDeleteLot) return;
    const { lotId, whole } = target;
    try {
      await onDeleteLot(lotId);
      if (whole) {
        toast.success(t('portfolio:toast.investmentDeleted'));
        onClose();
      } else {
        toast.success(t('portfolio:toast.lotDeleted'));
      }
    } catch (error) {
      console.error(whole ? 'Failed to delete investment:' : 'Failed to delete lot:', error);
      toast.error(t(whole ? 'portfolio:toast.investmentDeleteFailed' : 'portfolio:toast.lotDeleteFailed'));
    }
  };
  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          {...dialogProps}
          className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-7xl shadow-2xl border border-gray-200 dark:border-gray-700 animate-slide-up max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {symbol}
                  </h2>
                  <span className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-semibold rounded-full">
                    {holdings.length} {holdings.length === 1 ? 'Lot' : 'Lots'}
                  </span>
                  {onUpdateSymbol && !editingAggregate && (
                    <button
                      onClick={handleStartAggregateEdit}
                      className="p-1.5 text-gray-500 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-all"
                      title="Edit name and sector"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {editingAggregate ? (
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={aggregateEditForm.name}
                        onChange={(e) => setAggregateEditForm({ ...aggregateEditForm, name: e.target.value })}
                        placeholder={t('portfolio:fields.namePlaceholder', 'Investment Name')}
                        aria-label={t('portfolio:fields.namePlaceholder', 'Investment Name')}
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
                      />
                      <input
                        type="text"
                        value={aggregateEditForm.sector}
                        onChange={(e) => setAggregateEditForm({ ...aggregateEditForm, sector: e.target.value })}
                        placeholder={t('portfolio:fields.sectorPlaceholder', 'Sector')}
                        aria-label={t('portfolio:fields.sectorPlaceholder', 'Sector')}
                        className="w-40 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveAggregateEdit}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-success-700 hover:bg-success-800 rounded-lg transition-colors"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        onClick={handleCancelAggregateEdit}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                      >
                        <CancelIcon className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {aggregatedMetrics.name}
                    </p>
                    {aggregatedMetrics.sector && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {formatSectorLabel(aggregatedMetrics.sector, t)}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Sell Button - show when onSellHolding is available */}
                {onSellHolding && (
                  <button
                    onClick={() => {
                      setSellQuantity(aggregatedMetrics.totalQuantity);
                      setShowSellModal(true);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-orange-700 hover:bg-orange-800 dark:bg-orange-600 dark:hover:bg-orange-700 rounded-lg transition-all shadow-sm"
                    title="Sell shares"
                    aria-label="Sell shares"
                  >
                    <ArrowTrendingDownIcon className="w-4 h-4" />
                    <span>Sell</span>
                  </button>
                )}

                {/* Sell Button - New simplified sell flow */}
                {onSellLot && holdings.length > 0 && (
                  <button
                    onClick={() => {
                      // Use the first holding's data for the sell modal
                      // (or aggregate if needed)
                      onSellLot(holdings[0]);
                      onClose(); // Close detail modal before sell modal opens
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-green-700 hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700 rounded-lg transition-all shadow-sm"
                    title="Sell shares of this holding"
                    aria-label="Sell holding"
                  >
                    <CurrencyDollarIcon className="w-4 h-4" />
                    <span>Sell</span>
                  </button>
                )}

                {/* Delete Investment Button - always show when onDeleteLot is available */}
                {onDeleteLot && (
                  <button
                    onClick={async () => {
                      // For single lot: delete the entire investment
                      // For multiple lots: show warning that they need to delete individual lots
                      if (holdings.length === 1) {
                        setPendingDelete({
                          lotId: holdings[0].id,
                          whole: true,
                          message: t('portfolio:holdingDelete.investmentMessage', { name: aggregatedMetrics.name, symbol }),
                        });
                      } else {
                        // Multiple lots: inform user to delete individual lots from the table below
                        toast.error(t('portfolio:toast.investmentHasLots', { count: holdings.length }));
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-error-600 hover:bg-error-700 dark:bg-error-600 dark:hover:bg-error-700 rounded-lg transition-all shadow-sm"
                    title={holdings.length === 1 ? "Delete entire investment" : `Delete investment (${holdings.length} lots)`}
                    aria-label="Delete investment"
                  >
                    <TrashIcon className="w-4 h-4" />
                    <span>Delete Investment</span>
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="flex-shrink-0 p-2 text-gray-500 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all"
                  aria-label="Close"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="p-6 bg-gradient-to-br from-primary-50 to-blue-50 dark:from-primary-900/20 dark:to-blue-900/20 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 uppercase tracking-wide">
              Portfolio Summary
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card padding="sm" radius="xl">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">Total Quantity</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {isValueVisible ? aggregatedMetrics.totalQuantity.toLocaleString() : '•••'}
                </p>
              </Card>
              <Card padding="sm" radius="xl">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">Avg. Cost</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {isValueVisible
                    ? formatCurrency(aggregatedMetrics.weightedAvgCost, aggregatedMetrics.currency)
                    : '•••••••'
                  }
                </p>
              </Card>
              <Card padding="sm" radius="xl">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">Current Price</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {isValueVisible
                    ? formatCurrency(aggregatedMetrics.currentPrice, aggregatedMetrics.currency)
                    : '•••••••'
                  }
                </p>
              </Card>
              <Card padding="sm" radius="xl">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">Total Gain/Loss</p>
                <p className={cn(
                  'text-xl font-bold',
                  aggregatedMetrics.gainLoss >= 0
                    ? 'text-success-700 dark:text-success-400'
                    : 'text-error-700 dark:text-error-400'
                )}>
                  {isValueVisible
                    ? `${aggregatedMetrics.gainLoss >= 0 ? '+' : ''}${formatCurrency(aggregatedMetrics.gainLoss, aggregatedMetrics.currency)}`
                    : '•••••••'
                  }
                </p>
                <p className={cn(
                  'text-xs font-semibold mt-1',
                  aggregatedMetrics.gainLoss >= 0
                    ? 'text-success-700 dark:text-success-400'
                    : 'text-error-700 dark:text-error-400'
                )}>
                  {isValueVisible
                    ? `${aggregatedMetrics.gainLossPercentage >= 0 ? '+' : ''}${aggregatedMetrics.gainLossPercentage.toFixed(2)}%`
                    : '•••%'
                  }
                  {isValueVisible && (
                    <span className="ml-1 text-xs opacity-70">ROI</span>
                  )}
                </p>
              </Card>
            </div>
          </div>

          {/* Lots Table */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Purchase History
              </h3>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                {sortedLots.length} {sortedLots.length === 1 ? 'lot' : 'lots'}
              </span>
            </div>

            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Purchase Date
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Avg. Cost
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Total Cost
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Current Value
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Gain/Loss
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {sortedLots.map((lot, _index) => {
                    const isEditing = editingLotId === lot.id && draft !== null;
                    // While editing, the row reads the draft so gain/loss follows the typing.
                    const figures = isEditing ? draft : lot;
                    const lotCost = figures.quantity * figures.averageCost;
                    const lotValue = figures.quantity * figures.currentPrice;
                    const lotGainLoss = lotValue - lotCost;
                    const lotGainLossPercentage = lotCost > 0 ? (lotGainLoss / lotCost) * 100 : 0;

                    return (
                      <tr
                        key={lot.id}
                        className={cn(
                          "transition-colors",
                          isEditing ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        )}
                      >
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <input
                              aria-label={t('portfolio:fields.purchaseDate', 'Purchase date')}
                              type="date"
                              value={editPurchaseDate}
                              onChange={(e) => setEditPurchaseDate(e.target.value)}
                              max={localDateString()}
                              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <CalendarIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                              <span className="text-sm text-gray-900 dark:text-white">
                                {lot.purchaseDate
                                  ? new Date(lot.purchaseDate).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                  })
                                  : 'Not set'
                                }
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {isEditing ? (
                            <>
                            <input
                              aria-label={t('portfolio:fields.quantity', 'Quantity')}
                              type="number"
                              inputMode="decimal"
                              onWheel={(e) => e.currentTarget.blur()}
                              step="any"
                              min="0"
                              value={draft.text.quantity}
                              onChange={(e) => editDraft('quantity', e.target.value)}
                              {...lotInputAria(lot.id, 'quantity')}
                              className={lotInputClass('quantity', 'w-24')}
                            />
                            {lotInputError(lot.id, 'quantity')}
                            </>
                          ) : (
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {isValueVisible ? lot.quantity.toLocaleString() : '•••'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {isEditing ? (
                            <>
                            <input
                              aria-label={t('portfolio:fields.averageCost', 'Average cost')}
                              type="number"
                              inputMode="decimal"
                              onWheel={(e) => e.currentTarget.blur()}
                              step="any"
                              min="0"
                              value={draft.text.averageCost}
                              onChange={(e) => editDraft('averageCost', e.target.value)}
                              {...lotInputAria(lot.id, 'averageCost')}
                              className={lotInputClass('averageCost', 'w-24')}
                            />
                            {lotInputError(lot.id, 'averageCost')}
                            </>
                          ) : (
                            <span className="text-sm text-gray-900 dark:text-white">
                              {isValueVisible
                                ? formatCurrency(lot.averageCost, lot.currency)
                                : '•••••••'
                              }
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {isEditing ? (
                            <>
                            <input
                              aria-label={t('portfolio:fields.totalCost', 'Total cost')}
                              type="number"
                              inputMode="decimal"
                              onWheel={(e) => e.currentTarget.blur()}
                              step="any"
                              min="0"
                              value={draft.text.totalCost}
                              onChange={(e) => editDraft('totalCost', e.target.value)}
                              {...lotInputAria(lot.id, 'totalCost')}
                              className={lotInputClass('totalCost', 'w-28')}
                            />
                            {lotInputError(lot.id, 'totalCost')}
                            </>
                          ) : (
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {isValueVisible
                                ? formatCurrency(lotCost, lot.currency)
                                : '•••••••'
                              }
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {/* Only where no feed prices the holding: a typed value on a
                              quoted one would be overwritten by the next price refresh. */}
                          {isEditing && lot.manuallyPriced ? (
                            <>
                            <input
                              aria-label={t('portfolio:fields.currentValue', 'Current value')}
                              title={t('portfolio:fields.manualValueHint', 'No market price for this holding. Enter what it is worth now.')}
                              type="number"
                              inputMode="decimal"
                              onWheel={(e) => e.currentTarget.blur()}
                              step="any"
                              min="0"
                              value={draft.text.currentValue}
                              onChange={(e) => editDraft('currentValue', e.target.value)}
                              {...lotInputAria(lot.id, 'currentValue')}
                              className={lotInputClass('currentValue', 'w-28')}
                            />
                            {lotInputError(lot.id, 'currentValue')}
                            </>
                          ) : (
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {isValueVisible
                                ? formatCurrency(lotValue, lot.currency)
                                : '•••••••'
                              }
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex flex-col items-end">
                            <span className={cn(
                              'text-sm font-semibold',
                              lotGainLoss >= 0
                                ? 'text-success-700 dark:text-success-400'
                                : 'text-error-700 dark:text-error-400'
                            )}>
                              {isValueVisible
                                ? `${lotGainLoss >= 0 ? '+' : ''}${formatCurrency(lotGainLoss, lot.currency)}`
                                : '•••••••'
                              }
                            </span>
                            <span className={cn(
                              'text-xs font-medium',
                              lotGainLoss >= 0
                                ? 'text-success-700 dark:text-success-400'
                                : 'text-error-700 dark:text-error-400'
                            )}>
                              {isValueVisible
                                ? `${lotGainLossPercentage >= 0 ? '+' : ''}${lotGainLossPercentage.toFixed(2)}%`
                                : '•••%'
                              }
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          {(onUpdateLot || onDeleteLot) ? (
                            isEditing ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={async () => {
                                    // Never report success for an edit the draft did not apply.
                                    if (draftHasErrors) {
                                      toast.error(t('portfolio:toast.lotInvalid', 'Fix the highlighted fields before saving'));
                                      return;
                                    }
                                    try {
                                      await onUpdateLot?.(lot.id, {
                                        // Only when the user changed it. The date
                                        // input is prefilled from the stored instant
                                        // in the VIEWER's timezone, while the backend
                                        // reads a business day in Asia/Taipei — so off
                                        // a device at another offset, re-sending an
                                        // untouched date is itself a date change, and
                                        // it moves the linked Life Wallet expense. A
                                        // quantity edit from a UTC-8 laptop would have
                                        // pushed a purchase stamped 2026-08-31T20:00Z
                                        // (Sep 1 in Taipei) back into August. Sending
                                        // nothing is also what stops every save
                                        // rewriting the stored instant to 00:00Z.
                                        ...(editPurchaseDate !== initialPurchaseDate
                                          ? { purchaseDate: editPurchaseDate }
                                          : {}),
                                        quantity: draft.quantity,
                                        averageCost: draft.averageCost,
                                        // A price is sent only when the user may set one and did.
                                        ...(lot.manuallyPriced && draft.currentPrice !== lot.currentPrice
                                          ? { currentPrice: draft.currentPrice }
                                          : {}),
                                      });
                                      setEditingLotId(null);
                                      setDraft(null);
                                      toast.success(t('portfolio:toast.lotUpdated'));
                                    } catch (error: unknown) {
                                      console.error('Failed to update lot:', error);
                                      toast.error(error instanceof Error ? error.message : t('portfolio:toast.lotUpdateFailed'));
                                    }
                                  }}
                                  aria-disabled={draftHasErrors}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-700 hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700 rounded-lg transition-colors shadow-sm",
                                    draftHasErrors && "opacity-50 cursor-not-allowed"
                                  )}
                                  title="Save changes"
                                  aria-label="Save"
                                >
                                  <CheckIcon className="w-4 h-4" />
                                  <span>Save</span>
                                </button>
                                <button
                                  onClick={() => { setEditingLotId(null); setDraft(null); }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                  title="Cancel editing"
                                  aria-label="Cancel"
                                >
                                  <CancelIcon className="w-4 h-4" />
                                  <span>Cancel</span>
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                {onUpdateLot && (
                                  <button
                                    onClick={() => {
                                      setEditingLotId(lot.id);
                                      // localDateString, not toISOString: purchaseDate is a stored
                                      // instant, and its UTC day is a day earlier than its local
                                      // day for anything bought after 16:00 UTC in Taipei. The cell
                                      // this button sits beside renders the local day, so a UTC
                                      // prefill showed the user a different date than the row they
                                      // were editing. The `max` on this input already uses local.
                                      const prefill = lot.purchaseDate ? localDateString(new Date(lot.purchaseDate)) : '';
                                      setEditPurchaseDate(prefill);
                                      setInitialPurchaseDate(prefill);
                                      setDraft(lotDraft(lot));
                                    }}
                                    className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                    title="Edit lot"
                                    aria-label="Edit lot"
                                  >
                                    <PencilIcon className="w-4 h-4" />
                                  </button>
                                )}
                                {onUpdateLot && (
                                  // The full edit page is the only place a lot's wallet,
                                  // type, currency or exchange can be changed; the inline
                                  // editor covers quantity, cost, price and date.
                                  <Link
                                    href={`/portfolio/edit/${encodeURIComponent(lot.id)}`}
                                    className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                    title={t('portfolio:lotEdit.allDetails', 'Edit all details (wallet, type, currency)')}
                                    aria-label={t('portfolio:lotEdit.allDetails', 'Edit all details (wallet, type, currency)')}
                                  >
                                    <AdjustmentsHorizontalIcon className="w-4 h-4" />
                                  </Link>
                                )}
                                {onDeleteLot && holdings.length > 1 && (
                                  <button
                                    onClick={() => setPendingDelete({
                                      lotId: lot.id,
                                      whole: false,
                                      message: t('portfolio:holdingDelete.lotMessage', {
                                        quantity: lot.quantity,
                                        date: lot.purchaseDate ? new Date(lot.purchaseDate).toLocaleDateString() : t('portfolio:holdingDelete.unknownDate'),
                                      }),
                                    })}
                                    className="p-2 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                    title="Delete lot"
                                    aria-label="Delete lot"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-sm text-gray-500 dark:text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals Row */}
                <tfoot className="bg-gray-100 dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-600">
                  <tr className="font-semibold">
                    <td className="px-4 py-4 text-sm text-gray-900 dark:text-white">
                      <span className="font-bold">Total</span>
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-gray-900 dark:text-white">
                      {isValueVisible ? aggregatedMetrics.totalQuantity.toLocaleString() : '•••'}
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-gray-900 dark:text-white">
                      {isValueVisible
                        ? formatCurrency(aggregatedMetrics.weightedAvgCost, aggregatedMetrics.currency)
                        : '•••••••'
                      }
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-gray-900 dark:text-white">
                      {isValueVisible
                        ? formatCurrency(aggregatedMetrics.totalCost, aggregatedMetrics.currency)
                        : '•••••••'
                      }
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-gray-900 dark:text-white">
                      {isValueVisible
                        ? formatCurrency(aggregatedMetrics.totalValue, aggregatedMetrics.currency)
                        : '•••••••'
                      }
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <span className={cn(
                          'text-sm font-bold',
                          aggregatedMetrics.gainLoss >= 0
                            ? 'text-success-700 dark:text-success-400'
                            : 'text-error-700 dark:text-error-400'
                        )}>
                          {isValueVisible
                            ? `${aggregatedMetrics.gainLoss >= 0 ? '+' : ''}${formatCurrency(aggregatedMetrics.gainLoss, aggregatedMetrics.currency)}`
                            : '•••••••'
                          }
                        </span>
                        <span className={cn(
                          'text-xs font-semibold',
                          aggregatedMetrics.gainLoss >= 0
                            ? 'text-success-700 dark:text-success-400'
                            : 'text-error-700 dark:text-error-400'
                        )}>
                          {isValueVisible
                            ? `${aggregatedMetrics.gainLossPercentage >= 0 ? '+' : ''}${aggregatedMetrics.gainLossPercentage.toFixed(2)}%`
                            : '•••%'
                          }
                          {isValueVisible && (
                            <span className="ml-1 text-xs opacity-70">ROI</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Helper text */}
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                <span className="text-base mr-1">💡</span>
                <strong>Tip:</strong> The weighted average cost shows your true average purchase price across all lots.
                This is useful for tax reporting and understanding your overall investment performance.
              </p>
            </div>
          </div>
        </div>

        {/* Lot Selection Modal for Selling */}
        {showSellModal && (
          <LotSelectionModal
            symbol={symbol}
            // sortedLots, not the raw holdings prop: the lots table above is date
            // ordered, so handing the sell picker the API's value-desc order made the
            // same lots appear in a different order the moment you clicked Sell.
            // Cost-basis maths is unaffected either way — costBasis.ts sorts for
            // itself — but the list you pick SPECIFIC lots from should match the one
            // you were just reading.
            lots={sortedLots.map(h => ({
              id: h.id,
              purchaseDate: h.purchaseDate || new Date().toISOString(),
              quantity: h.quantity,
              averageCost: h.averageCost
            }))}
            quantityToSell={sellQuantity}
            currentPrice={aggregatedMetrics.currentPrice}
            currency={aggregatedMetrics.currency}
            onConfirm={async (selectedLotIds, method) => {
              if (!onSellHolding) return;
              try {
                await onSellHolding(symbol, sellQuantity, aggregatedMetrics.currentPrice, selectedLotIds, method);
                toast.success(t('portfolio:toast.sellTransactionCreated'));
                setShowSellModal(false);
                onClose();
              } catch (error: unknown) {
                toast.error(error instanceof Error ? error.message : t('portfolio:toast.sellTransactionFailed'));
              }
            }}
            onCancel={() => setShowSellModal(false)}
          />
        )}
      </div>
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={t(pendingDelete?.whole ? 'portfolio:holdingDelete.investmentTitle' : 'portfolio:holdingDelete.lotTitle')}
        message={pendingDelete?.message ?? ''}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmPendingDelete}
      />
    </>
  );
}
