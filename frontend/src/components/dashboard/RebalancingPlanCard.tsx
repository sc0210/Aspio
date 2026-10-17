'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShoppingCartIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

interface RebalancingAction {
  asset: string;
  action: 'BUY' | 'SELL';
  amount: number;
  shares?: number;
  currentPrice?: number;
  estimatedFee?: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

interface RebalancingPlanCardProps {
  actions: RebalancingAction[];
  availableFunds: number;
  totalDeficit: number;
  onExecute?: (action: RebalancingAction) => void;
}

export function RebalancingPlanCard({
  actions,
  availableFunds,
  totalDeficit,
  onExecute: _onExecute
}: RebalancingPlanCardProps) {
  const { t } = useTranslation('dashboard');
  const [selectedActions, setSelectedActions] = useState<Set<number>>(new Set());

  const formatCurrency = (value: number) =>
    formatCurrencyUtil(value, 'TWD', value >= 100000 ? { compact: true } : { precision: 0 });

  const buyActions = actions.filter(a => a.action === 'BUY');
  const sellActions = actions.filter(a => a.action === 'SELL');

  const totalBuyAmount = buyActions.reduce((sum, a) => sum + a.amount, 0);
  const totalSellAmount = sellActions.reduce((sum, a) => sum + a.amount, 0);
  const totalFees = actions.reduce((sum, a) => sum + (a.estimatedFee || 0), 0);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'medium':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high': return t('rebalancing.plan.priority.high');
      case 'medium': return t('rebalancing.plan.priority.medium');
      default: return t('rebalancing.plan.priority.low');
    }
  };

  const toggleAction = (index: number) => {
    const newSelected = new Set(selectedActions);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedActions(newSelected);
  };

  const selectedTotal = Array.from(selectedActions).reduce((sum, index) => {
    return sum + actions[index].amount;
  }, 0);

  return (
    <Card padding="lg" radius="xl" shadow="none">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('rebalancing.plan.title')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('rebalancing.plan.subtitle', { count: actions.length })}
          </p>
        </div>
        {availableFunds >= totalDeficit ? (
          <div className="flex items-center text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-5 h-5 mr-2" />
            <span className="text-sm font-medium">{t('rebalancing.plan.fundsSufficient')}</span>
          </div>
        ) : (
          <div className="flex items-center text-orange-600 dark:text-orange-400">
            <InformationCircleIcon className="w-5 h-5 mr-2" />
            <span className="text-sm font-medium">{t('rebalancing.plan.fundsShort')}</span>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <ShoppingCartIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2" />
            <p className="text-sm text-blue-900 dark:text-blue-300 font-medium">{t('rebalancing.plan.totalBuy')}</p>
          </div>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
            {formatCurrency(totalBuyAmount)}
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
            {t('rebalancing.plan.tradeCount', { count: buyActions.length })}
          </p>
        </div>

        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <BanknotesIcon className="w-5 h-5 text-orange-600 dark:text-orange-400 mr-2" />
            <p className="text-sm text-orange-900 dark:text-orange-300 font-medium">{t('rebalancing.plan.totalSell')}</p>
          </div>
          <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
            {formatCurrency(totalSellAmount)}
          </p>
          <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">
            {t('rebalancing.plan.tradeCount', { count: sellActions.length })}
          </p>
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <InformationCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400 mr-2" />
            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{t('rebalancing.estimatedFees')}</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(totalFees)}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('rebalancing.plan.feeBreakdown')}
          </p>
        </div>
      </div>

      {/* Actions List */}
      <div className="space-y-3">
        {/* Sell Actions First */}
        {sellActions.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center">
              <BanknotesIcon className="w-4 h-4 mr-2" />
              {t('rebalancing.plan.sellActions', { count: sellActions.length })}
            </h4>
            <div className="space-y-2">
              {sellActions.map((action, _index) => {
                const globalIndex = actions.indexOf(action);
                const isSelected = selectedActions.has(globalIndex);

                return (
                  <div
                    key={globalIndex}
                    className={cn(
                      'border rounded-lg p-4 cursor-pointer transition-all',
                      isSelected
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700'
                    )}
                    onClick={() => toggleAction(globalIndex)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {t('rebalancing.plan.sellAsset', { asset: action.asset })}
                          </span>
                          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', getPriorityColor(action.priority))}>
                            {getPriorityLabel(action.priority)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          {action.reason}
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-orange-600 dark:text-orange-400 font-medium">
                            {formatCurrency(action.amount)}
                          </span>
                          {action.shares != null && action.shares > 0 && action.currentPrice != null && action.currentPrice > 0 && (
                            <span className="text-gray-500 dark:text-gray-400">
                              {t('rebalancing.plan.shareEstimate', { shares: action.shares.toFixed(0), price: formatCurrency(action.currentPrice) })}
                            </span>
                          )}
                          {action.estimatedFee != null && action.estimatedFee > 0 && (
                            <span className="text-gray-500 dark:text-gray-400">
                              {t('rebalancing.plan.feeAmount', { amount: formatCurrency(action.estimatedFee) })}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRightIcon className={cn(
                        'w-5 h-5 transition-transform',
                        isSelected ? 'rotate-90 text-orange-600' : 'text-gray-400'
                      )} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Buy Actions */}
        {buyActions.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center">
              <ShoppingCartIcon className="w-4 h-4 mr-2" />
              {t('rebalancing.plan.buyActions', { count: buyActions.length })}
            </h4>
            <div className="space-y-2">
              {buyActions.map((action, _index) => {
                const globalIndex = actions.indexOf(action);
                const isSelected = selectedActions.has(globalIndex);

                return (
                  <div
                    key={globalIndex}
                    className={cn(
                      'border rounded-lg p-4 cursor-pointer transition-all',
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                    )}
                    onClick={() => toggleAction(globalIndex)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {t('rebalancing.plan.buyAsset', { asset: action.asset })}
                          </span>
                          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', getPriorityColor(action.priority))}>
                            {getPriorityLabel(action.priority)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          {action.reason}
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-blue-600 dark:text-blue-400 font-medium">
                            {formatCurrency(action.amount)}
                          </span>
                          {action.shares != null && action.shares > 0 && action.currentPrice != null && action.currentPrice > 0 && (
                            <span className="text-gray-500 dark:text-gray-400">
                              {t('rebalancing.plan.shareEstimate', { shares: action.shares.toFixed(0), price: formatCurrency(action.currentPrice) })}
                            </span>
                          )}
                          {action.estimatedFee != null && action.estimatedFee > 0 && (
                            <span className="text-gray-500 dark:text-gray-400">
                              {t('rebalancing.plan.feeAmount', { amount: formatCurrency(action.estimatedFee) })}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRightIcon className={cn(
                        'w-5 h-5 transition-transform',
                        isSelected ? 'rotate-90 text-blue-600' : 'text-gray-400'
                      )} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {actions.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('rebalancing.plan.selectedCount', { count: selectedActions.size })}
              </p>
              {selectedActions.size > 0 && (
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('rebalancing.plan.selectedTotal', { amount: formatCurrency(selectedTotal) })}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                onClick={() => setSelectedActions(new Set())}
              >
                {t('rebalancing.plan.clearSelection')}
              </button>
              <button
                className={cn(
                  'px-4 py-2 rounded-lg font-medium transition-colors',
                  selectedActions.size > 0
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                )}
                disabled={selectedActions.size === 0}
              >
                {t('rebalancing.plan.executeSelected')}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {t('rebalancing.plan.executeWarning')}
          </p>
        </div>
      )}

      {/* Empty State */}
      {actions.length === 0 && (
        <div className="text-center py-12">
          <CheckCircleIcon className="w-16 h-16 mx-auto text-green-500 dark:text-green-400 mb-4" />
          <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {t('rebalancing.balanced.title')}
          </h4>
          <p className="text-gray-600 dark:text-gray-400">
            {t('rebalancing.balanced.description')}
          </p>
        </div>
      )}
    </Card>
  );
}
