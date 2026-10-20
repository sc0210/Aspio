'use client';

import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import {
  ArrowUpIcon,
  ArrowDownIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/utils/cn';
import { isNearTarget, isOffTarget } from '@/lib/portfolio/rebalanceThreshold';
import { Card } from '@/components/ui/Card';
import { chartTooltipStyle } from '@/lib/charts/tooltipStyle';

const ALLOCATION_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

interface AssetAllocation {
  asset: string;
  currency: string;
  currentValue: number;
  currentPct: number;
  targetPct: number;
  targetValue: number;
  delta: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  suggestedAmount: number;
  assetName?: string;
  assetType?: string;
}

interface AssetAllocationCardProps {
  allocations: AssetAllocation[];
  totalAssets: number;
  availableFunds: number;
  lastUpdated?: Date;
  onTargetUpdate?: (updates: { asset: string; targetPct: number }[]) => Promise<void>;
  isDemo?: boolean;
}

export function AssetAllocationCard({
  allocations,
  totalAssets,
  availableFunds,
  lastUpdated,
  onTargetUpdate,
  isDemo = false
}: AssetAllocationCardProps) {
  const { t } = useTranslation('dashboard');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTargets, setEditedTargets] = useState<{ [key: string]: number }>({});
  const [editedAssets, setEditedAssets] = useState<{ [key: string]: { name: string; type: string } }>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newAsset, setNewAsset] = useState({ symbol: '', name: '', type: 'etf', targetPct: 0 });

  // Initialize edited targets and asset info from allocations
  useEffect(() => {
    const initialTargets: { [key: string]: number } = {};
    const initialAssets: { [key: string]: { name: string; type: string } } = {};
    allocations.forEach(a => {
      initialTargets[a.asset] = a.targetPct; // Already in percentage format from backend
      initialAssets[a.asset] = {
        name: a.assetName || a.asset,
        type: a.assetType || 'unknown'
      };
    });
    setEditedTargets(initialTargets);
    setEditedAssets(initialAssets);
  }, [allocations]);

  const formatCurrency = (value: number) =>
    formatCurrencyUtil(value, 'TWD', value >= 100000 ? { compact: true } : { precision: 0 });

  const formatPct = (value: number) => `${value.toFixed(1)}%`; // Value already in percentage format from backend

  // "Off target" is measured in percentage points (|current% − target%|), the
  // same unit the backend rebalancing threshold and the What-If tab use.
  const deviationPoints = (currentPct: number, targetPct: number) =>
    Math.abs((currentPct || 0) - (targetPct || 0));

  const getDeviationColor = (currentPct: number, targetPct: number) => {
    const points = deviationPoints(currentPct, targetPct);
    if (isOffTarget(points)) return 'text-red-700 dark:text-red-400';
    if (isNearTarget(points)) return 'text-orange-700 dark:text-orange-400';
    return 'text-green-700 dark:text-green-400';
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'BUY':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            <ArrowUpIcon className="w-3 h-3 mr-1" />
            {t('allocation.action.buy')}
          </span>
        );
      case 'SELL':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
            <ArrowDownIcon className="w-3 h-3 mr-1" />
            {t('allocation.action.sell')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
            <CheckCircleIcon className="w-3 h-3 mr-1" />
            {t('allocation.action.hold')}
          </span>
        );
    }
  };

  const hasSignificantDeviation = allocations.some(
    a => Math.abs(a.delta / a.targetValue) >= 0.05
  );

  const handleTargetChange = (asset: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
      setEditedTargets(prev => ({ ...prev, [asset]: numValue }));
      setValidationError(null);
    }
  };

  const validateTotal = (): boolean => {
    const total = Object.values(editedTargets).reduce((sum, val) => sum + val, 0);
    const isValid = Math.abs(total - 100) < 0.01; // Allow tiny floating point errors
    if (!isValid) {
      setValidationError(t('allocation.error.mustTotal100', { total: total.toFixed(1) }));
    } else {
      setValidationError(null);
    }
    return isValid;
  };

  const handleSave = async () => {
    if (!validateTotal() || !onTargetUpdate) return;

    // Prevent save in demo mode
    if (isDemo) {
      setValidationError(t('allocation.error.demoReadOnly'));
      return;
    }

    setIsSaving(true);
    try {
      // Include asset name and type when saving
      const updates = Object.entries(editedTargets).map(([asset, targetPct]) => {
        const assetInfo = editedAssets[asset];
        return {
          asset,
          targetPct, // Already in percentage format (e.g., 45 for 45%)
          assetName: assetInfo?.name || asset,
          assetType: assetInfo?.type || 'unknown'
        };
      });
      await onTargetUpdate(updates);
      setIsEditMode(false);
      setValidationError(null);
    } catch (error: unknown) {
      console.error('Failed to save target allocations:', error);
      // Show more specific error message
      const errorMsg = error instanceof Error ? error.message : String(error) || t('allocation.error.saveFailed');
      if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('Not authenticated') || errorMsg.includes('Could not validate')) {
        setValidationError(t('allocation.error.sessionExpired'));
      } else {
        setValidationError(t('allocation.error.saveFailedWith', { message: errorMsg }));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original values
    const initialTargets: { [key: string]: number } = {};
    const initialAssets: { [key: string]: { name: string; type: string } } = {};
    allocations.forEach(a => {
      initialTargets[a.asset] = a.targetPct;
      initialAssets[a.asset] = {
        name: a.assetName || a.asset,
        type: a.assetType || 'unknown'
      };
    });
    setEditedTargets(initialTargets);
    setEditedAssets(initialAssets);
    setIsEditMode(false);
    setShowAddAsset(false);
    setValidationError(null);
  };

  const handleAddAsset = () => {
    if (!newAsset.symbol || !newAsset.name || newAsset.targetPct <= 0) {
      setValidationError(t('allocation.error.incompleteAsset'));
      return;
    }

    if (editedTargets[newAsset.symbol]) {
      setValidationError(t('allocation.error.duplicateSymbol'));
      return;
    }

    // Add new asset
    setEditedTargets(prev => ({ ...prev, [newAsset.symbol]: newAsset.targetPct }));
    setEditedAssets(prev => ({
      ...prev,
      [newAsset.symbol]: { name: newAsset.name, type: newAsset.type }
    }));

    // Reset form
    setNewAsset({ symbol: '', name: '', type: 'etf', targetPct: 0 });
    setShowAddAsset(false);
    setValidationError(null);
  };

  const handleDeleteAsset = (asset: string) => {
    const { [asset]: _removed, ...remainingTargets } = editedTargets;
    const { [asset]: _removedAsset, ...remainingAssets } = editedAssets;
    setEditedTargets(remainingTargets);
    setEditedAssets(remainingAssets);
  };

  return (
    <Card padding="lg" radius="xl" shadow="none">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('allocation.title')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('allocation.subtitle', { total: formatCurrency(totalAssets) })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasSignificantDeviation && !isEditMode && (
            <div className="flex items-center text-orange-700 dark:text-orange-400">
              <ExclamationTriangleIcon className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">{t('allocation.needsRebalancing')}</span>
            </div>
          )}
          {onTargetUpdate && !isEditMode && (
            <button
              onClick={() => setIsEditMode(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            >
              <PencilIcon className="w-4 h-4" />
              {t('allocation.editTargets')}
            </button>
          )}
          {isEditMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <XMarkIcon className="w-4 h-4" />
                {t('allocation.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !!validationError}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckIcon className="w-4 h-4" />
                {isSaving ? t('allocation.saving') : t('allocation.save')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Validation Error */}
      {validationError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
            <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{validationError}</span>
          </div>
        </div>
      )}

      {/* Allocation Donut Chart */}
      {allocations.length > 0 && (
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-52 w-52 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocations}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="currentPct"
                    nameKey="asset"
                    labelLine={false}
                    label={({ cx, cy, midAngle, outerRadius: or, name, percent }) => {
                      const RADIAN = Math.PI / 180;
                      const r = or + 18;
                      const x = cx + r * Math.cos(-midAngle * RADIAN);
                      const y = cy + r * Math.sin(-midAngle * RADIAN);
                      if ((percent || 0) < 0.06) return null;
                      return (
                        <text x={x} y={y} fill="#6b7280" fontSize={11} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
                          {name} {((percent || 0) * 100).toFixed(1)}%
                        </text>
                      );
                    }}
                  >
                    {allocations.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                    {...chartTooltipStyle(isDark)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 flex-1">
              {allocations.map((a, index) => (
                <div key={a.asset} className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{a.asset}</span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-white ml-auto">{a.currentPct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('allocation.availableFunds')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(availableFunds)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('allocation.fromOverweightSales')}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('allocation.deviation')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('allocation.itemCount', { count: allocations.filter(a => isOffTarget(deviationPoints(a.currentPct, a.targetPct))).length })}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('allocation.overThreshold')}
          </p>
        </div>
      </div>

      {/* Allocation Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('allocation.column.asset')}
              </th>
              <th className="text-right py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('allocation.column.currentValue')}
              </th>
              <th className="text-right py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('allocation.column.currentPct')}
              </th>
              <th className="text-right py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('allocation.column.targetPct')}
              </th>
              <th className="text-right py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('allocation.column.delta')}
              </th>
              <th className="text-center py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('allocation.column.action')}
              </th>
              {isEditMode && (
                <th className="text-center py-3 px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('allocation.column.manage')}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {/* Show all assets in edit mode (including newly added ones) */}
            {(isEditMode
              ? Object.keys(editedTargets).map(assetSymbol => {
                  const allocation = allocations.find(a => a.asset === assetSymbol);
                  const assetInfo = editedAssets[assetSymbol];
                  return {
                    asset: assetSymbol,
                    assetName: assetInfo?.name || assetSymbol,
                    assetType: assetInfo?.type || 'unknown',
                    currency: allocation?.currency || 'TWD',
                    currentValue: allocation?.currentValue || 0,
                    currentPct: allocation?.currentPct || 0,
                    targetPct: editedTargets[assetSymbol] || 0,
                    targetValue: allocation?.targetValue || 0,
                    delta: allocation?.delta || 0,
                    action: allocation?.action || 'BUY' as const,
                    suggestedAmount: allocation?.suggestedAmount || 0
                  };
                })
              : allocations
            ).map((allocation, index) => {
              const deviationPts = deviationPoints(allocation.currentPct, allocation.targetPct);
              const isSignificant = isOffTarget(deviationPts);

              return (
                <tr
                  key={index}
                  className={cn(
                    'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors',
                    isSignificant && 'bg-orange-50/50 dark:bg-orange-900/10'
                  )}
                >
                  <td className="py-3 px-2">
                    <div className="flex items-center">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {allocation.asset}
                        </span>
                        {allocation.assetName && allocation.assetName !== allocation.asset && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {allocation.assetName}
                          </div>
                        )}
                      </div>
                      {isSignificant && (
                        <ExclamationTriangleIcon className="w-4 h-4 ml-2 text-orange-500" />
                      )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {allocation.assetType ? `${allocation.assetType.toUpperCase()}` : allocation.currency}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(allocation.currentValue)}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <span className={cn(
                      'text-sm font-medium',
                      getDeviationColor(allocation.currentPct, allocation.targetPct)
                    )}>
                      {formatPct(allocation.currentPct)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right">
                    {isEditMode ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          aria-label={`Target allocation for ${allocation.asset}`}
                          type="number"
                          inputMode="decimal"
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          max="100"
                          step="0.1"
                          value={editedTargets[allocation.asset]?.toFixed(1) || '0.0'}
                          onChange={(e) => handleTargetChange(allocation.asset, e.target.value)}
                          className="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {formatPct(allocation.targetPct)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-right">
                    <div className={cn(
                      'text-sm font-medium',
                      allocation.delta > 0 ? 'text-blue-600 dark:text-blue-400' :
                      allocation.delta < 0 ? 'text-orange-700 dark:text-orange-400' :
                      'text-gray-600 dark:text-gray-400'
                    )}>
                      {allocation.delta > 0 ? '+' : ''}{formatCurrency(allocation.delta)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {deviationPts >= 0.1 && t('allocation.deviationPct', { pct: deviationPts.toFixed(1) })}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {getActionBadge(allocation.action)}
                  </td>
                  {isEditMode && (
                    <td className="py-3 px-2 text-center">
                      <button
                        onClick={() => handleDeleteAsset(allocation.asset)}
                        className="text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors"
                        title={t('allocation.deleteAsset')}
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Asset Button and Form */}
      {isEditMode && !showAddAsset && (
        <div className="mt-4">
          <button
            onClick={() => setShowAddAsset(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors border-2 border-dashed border-blue-300 dark:border-blue-700 w-full justify-center"
          >
            <span className="text-lg">+</span>
            {t('allocation.addAsset')}
          </button>
        </div>
      )}

      {/* Add Asset Form */}
      {isEditMode && showAddAsset && (
        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{t('allocation.addAsset')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label htmlFor="assetalloc-field" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('allocation.field.symbol')}
              </label>
              <input
                id="assetalloc-field"
                type="text"
                placeholder={t('allocation.placeholder.symbol')}
                value={newAsset.symbol}
                onChange={(e) => setNewAsset(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="assetalloc-field-2" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('allocation.field.name')}
              </label>
              <input
                id="assetalloc-field-2"
                type="text"
                placeholder={t('allocation.placeholder.name')}
                value={newAsset.name}
                onChange={(e) => setNewAsset(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="assetalloc-field-3" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('allocation.field.type')}
              </label>
              <select
                id="assetalloc-field-3"
                value={newAsset.type}
                onChange={(e) => setNewAsset(prev => ({ ...prev, type: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="etf">ETF</option>
                <option value="stock">{t('allocation.assetType.stock')}</option>
                <option value="crypto">{t('allocation.assetType.crypto')}</option>
                <option value="cash">{t('allocation.assetType.cash')}</option>
                <option value="bond">{t('allocation.assetType.bond')}</option>
                <option value="real_estate">{t('allocation.assetType.real_estate')}</option>
                <option value="commodity">{t('allocation.assetType.commodity')}</option>
                <option value="other">{t('allocation.assetType.other')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="assetalloc-field-4" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('allocation.field.targetPct')}
              </label>
              <input
                id="assetalloc-field-4"
                type="number"
                inputMode="decimal"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                max="100"
                step="0.1"
                placeholder="10.0"
                value={newAsset.targetPct || ''}
                onChange={(e) => setNewAsset(prev => ({ ...prev, targetPct: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setShowAddAsset(false);
                setNewAsset({ symbol: '', name: '', type: 'etf', targetPct: 0 });
              }}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {t('allocation.cancel')}
            </button>
            <button
              onClick={handleAddAsset}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              {t('allocation.confirmAdd')}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      {lastUpdated && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {t('allocation.lastUpdated', { at: new Date(lastUpdated).toLocaleString() })}
          </p>
        </div>
      )}
    </Card>
  );
}
