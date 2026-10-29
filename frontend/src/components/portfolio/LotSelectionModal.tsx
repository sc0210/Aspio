'use client';

import { useState, useMemo } from 'react';
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import { calculateCostBasis, CostBasisMethod, formatCostBasisMethod, Lot } from '@/utils/costBasis';
import { useDialog } from '@/hooks/useDialog';

interface LotSelectionModalProps {
  symbol: string;
  lots: Array<{
    id: string;
    purchaseDate: string;
    quantity: number;
    averageCost: number;
  }>;
  quantityToSell: number;
  currentPrice: number;
  currency: string;
  onConfirm: (selectedLotIds: string[], method: CostBasisMethod) => void;
  onCancel: () => void;
}

export function LotSelectionModal({
  symbol,
  lots,
  quantityToSell,
  currentPrice,
  currency,
  onConfirm,
  onCancel
}: LotSelectionModalProps) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onCancel });
  const [method, setMethod] = useState<CostBasisMethod>('FIFO');
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([]);

  // Convert lots to format expected by cost basis calculator
  const formattedLots: Lot[] = useMemo(() => {
    return lots.map(lot => ({
      id: lot.id,
      purchaseDate: new Date(lot.purchaseDate),
      quantity: lot.quantity,
      costPerShare: lot.averageCost,
      totalCost: lot.quantity * lot.averageCost
    }));
  }, [lots]);

  // Calculate cost basis preview
  const costBasisPreview = useMemo(() => {
    try {
      const result = calculateCostBasis(
        formattedLots,
        quantityToSell,
        method,
        method === 'SPECIFIC' ? selectedLotIds : undefined
      );

      const proceeds = currentPrice * quantityToSell;
      const gainLoss = proceeds - result.totalCostBasis;
      const gainLossPercentage = result.totalCostBasis > 0
        ? (gainLoss / result.totalCostBasis) * 100
        : 0;

      return {
        ...result,
        proceeds,
        gainLoss,
        gainLossPercentage
      };
    } catch (error: unknown) {
      return {
        saleLots: [],
        totalCostBasis: 0,
        remainingLots: [],
        proceeds: 0,
        gainLoss: 0,
        gainLossPercentage: 0,
        error: (error as Error).message
      };
    }
  }, [formattedLots, quantityToSell, method, selectedLotIds, currentPrice]);

  const toggleLotSelection = (lotId: string) => {
    setSelectedLotIds(prev =>
      prev.includes(lotId)
        ? prev.filter(id => id !== lotId)
        : [...prev, lotId]
    );
  };

  const handleConfirm = () => {
    if (method === 'SPECIFIC' && selectedLotIds.length === 0) {
      alert('Please select at least one lot for specific lot identification');
      return;
    }
    onConfirm(selectedLotIds, method);
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="lot-selection-title"
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 id="lot-selection-title" className="text-xl font-bold text-gray-900 dark:text-white">
              Select Tax Lots - {symbol}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Selling {quantityToSell.toLocaleString()} shares at {formatCurrency(currentPrice, currency)}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Cost Basis Method Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Cost Basis Method
            </label>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(['FIFO', 'LIFO', 'AVERAGE', 'SPECIFIC'] as CostBasisMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                    method === m
                      ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              {formatCostBasisMethod(method)}
            </p>
          </div>

          {/* Lot Selection (only for SPECIFIC method) */}
          {method === 'SPECIFIC' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Select Lots to Sell
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {lots.map((lot) => {
                  const isSelected = selectedLotIds.includes(lot.id);
                  const gainLoss = (currentPrice - lot.averageCost) * lot.quantity;
                  const gainLossPercent = ((currentPrice - lot.averageCost) / lot.averageCost) * 100;

                  return (
                    <button
                      key={lot.id}
                      onClick={() => toggleLotSelection(lot.id)}
                      className={cn(
                        "w-full p-4 rounded-xl border-2 text-left transition-all",
                        isSelected
                          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {new Date(lot.purchaseDate).toLocaleDateString()}
                            </span>
                            {isSelected && (
                              <CheckIcon className="w-4 h-4 text-primary-700 dark:text-primary-400" />
                            )}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {lot.quantity.toLocaleString()} shares @ {formatCurrency(lot.averageCost, currency)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={cn(
                            "text-sm font-semibold",
                            gainLoss >= 0 ? "text-success-700 dark:text-success-400" : "text-error-700 dark:text-error-400"
                          )}>
                            {gainLoss >= 0 ? '+' : ''}{formatCurrency(gainLoss, currency)}
                          </div>
                          <div className={cn(
                            "text-xs",
                            gainLoss >= 0 ? "text-success-700 dark:text-success-400" : "text-error-700 dark:text-error-400"
                          )}>
                            {gainLossPercent >= 0 ? '+' : ''}{gainLossPercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cost Basis Preview */}
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Transaction Preview
            </h3>

            {costBasisPreview.error ? (
              <div className="text-sm text-error-700 dark:text-error-400">
                {costBasisPreview.error}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Sale Proceeds:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(costBasisPreview.proceeds, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Cost Basis:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(costBasisPreview.totalCostBasis, currency)}
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-300 dark:border-gray-600">
                  <div className="flex justify-between">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Gain/Loss:
                    </span>
                    <div className="text-right">
                      <div className={cn(
                        "font-bold",
                        costBasisPreview.gainLoss >= 0
                          ? "text-success-700 dark:text-success-400"
                          : "text-error-700 dark:text-error-400"
                      )}>
                        {costBasisPreview.gainLoss >= 0 ? '+' : ''}
                        {formatCurrency(costBasisPreview.gainLoss, currency)}
                      </div>
                      <div className={cn(
                        "text-sm",
                        costBasisPreview.gainLoss >= 0
                          ? "text-success-700 dark:text-success-400"
                          : "text-error-700 dark:text-error-400"
                      )}>
                        {costBasisPreview.gainLossPercentage >= 0 ? '+' : ''}
                        {costBasisPreview.gainLossPercentage.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lots to be sold */}
                {costBasisPreview.saleLots.length > 0 && (
                  <div className="pt-3 mt-3 border-t border-gray-300 dark:border-gray-600">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Lots to be Sold:
                    </div>
                    <div className="space-y-1">
                      {costBasisPreview.saleLots.map((sale, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                          <span>{new Date(sale.purchaseDate).toLocaleDateString()}</span>
                          <span>{sale.quantitySold.toLocaleString()} shares - {formatCurrency(sale.costBasis, currency)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!!costBasisPreview.error}
            className={cn(
              "px-6 py-2 text-sm font-medium text-white rounded-lg transition-colors",
              costBasisPreview.error
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-primary-600 hover:bg-primary-700"
            )}
          >
            Confirm Sale
          </button>
        </div>
      </div>
    </div>
  );
}
