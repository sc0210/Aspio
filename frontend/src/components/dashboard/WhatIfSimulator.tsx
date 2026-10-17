'use client';

import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import {
  BeakerIcon,
  ArrowPathIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import { isOffTarget } from '@/lib/portfolio/rebalanceThreshold';

interface AssetInput {
  asset: string;
  currentValue: number;
  targetPct: number;
}

interface SimulationResult {
  asset: string;
  currentValue: number;
  newValue: number;
  currentPct: number;
  newPct: number;
  change: number;
}

interface WhatIfSimulatorProps {
  assets: AssetInput[];
  totalAssets: number;
}

export function WhatIfSimulator({ assets, totalAssets: initialTotal }: WhatIfSimulatorProps) {
  const { t } = useTranslation('dashboard');
  const [simulatedAssets, setSimulatedAssets] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    assets.forEach(a => {
      initial[a.asset] = a.currentValue;
    });
    return initial;
  });

  const [_fxRate, _setFxRate] = useState(32.0);
  const [showDetails, setShowDetails] = useState(false);

  const formatCurrency = (value: number) =>
    formatCurrencyUtil(value, 'TWD', value >= 100000 ? { compact: true } : { precision: 0 });

  const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`;

  // Calculate simulation results
  const simulationResults: SimulationResult[] = useMemo(() => {
    const total = Object.values(simulatedAssets).reduce((sum, v) => sum + v, 0);

    return assets.map(asset => {
      const newValue = simulatedAssets[asset.asset] || 0;
      const currentPct = asset.currentValue / initialTotal;
      const newPct = total > 0 ? newValue / total : 0;

      return {
        asset: asset.asset,
        currentValue: asset.currentValue,
        newValue,
        currentPct,
        newPct,
        change: newValue - asset.currentValue
      };
    });
  }, [simulatedAssets, assets, initialTotal]);

  const totalChange = simulationResults.reduce((sum, r) => sum + r.change, 0);
  const newTotal = Object.values(simulatedAssets).reduce((sum, v) => sum + v, 0);

  const handleReset = () => {
    const reset: Record<string, number> = {};
    assets.forEach(a => {
      reset[a.asset] = a.currentValue;
    });
    setSimulatedAssets(reset);
  };

  const handleValueChange = (asset: string, value: number) => {
    setSimulatedAssets(prev => ({
      ...prev,
      [asset]: value
    }));
  };

  const handleQuickAdjust = (asset: string, percentage: number) => {
    const current = simulatedAssets[asset] || 0;
    const adjustment = current * (percentage / 100);
    handleValueChange(asset, current + adjustment);
  };

  return (
    <Card padding="lg" radius="xl" shadow="none">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
            <BeakerIcon className="w-6 h-6 mr-2 text-purple-600 dark:text-purple-400" />
            {t('whatIf.title')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('whatIf.subtitle')}
          </p>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowPathIcon className="w-4 h-4 mr-1" />
          {t('whatIf.reset')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('whatIf.originalTotal')}</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(initialTotal)}
          </p>
        </div>

        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
          <p className="text-sm text-purple-900 dark:text-purple-300 mb-1">{t('whatIf.simulatedTotal')}</p>
          <p className="text-xl font-bold text-purple-900 dark:text-purple-100">
            {formatCurrency(newTotal)}
          </p>
        </div>

        <div className={cn(
          'rounded-lg p-4',
          totalChange > 0 ? 'bg-green-50 dark:bg-green-900/20' :
          totalChange < 0 ? 'bg-red-50 dark:bg-red-900/20' :
          'bg-gray-50 dark:bg-gray-900/50'
        )}>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('whatIf.totalChange')}</p>
          <p className={cn(
            'text-xl font-bold',
            totalChange > 0 ? 'text-green-600 dark:text-green-400' :
            totalChange < 0 ? 'text-red-600 dark:text-red-400' :
            'text-gray-900 dark:text-white'
          )}>
            {totalChange > 0 ? '+' : ''}{formatCurrency(totalChange)}
          </p>
        </div>
      </div>

      {/* Asset Adjustments */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('whatIf.adjustAmounts')}
          </h4>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showDetails ? t('whatIf.hideDetails') : t('whatIf.showDetails')}
          </button>
        </div>

        {assets.map((asset) => {
          const currentValue = simulatedAssets[asset.asset] || 0;
          const result = simulationResults.find(r => r.asset === asset.asset);
          // targetPct is a percentage (0–100) from the backend; the simulator works
          // in fractions (0–1) internally, so convert before comparing/formatting.
          const targetFraction = asset.targetPct / 100;
          const deviation = result ? Math.abs(result.newPct - targetFraction) : 0;
          // Same off-target rule as the allocation card and the backend's trade plan.
          const isDeviated = isOffTarget(deviation * 100);

          return (
            <div
              key={asset.asset}
              className={cn(
                'border rounded-lg p-4',
                isDeviated ? 'border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/10' : 'border-gray-200 dark:border-gray-700'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {asset.asset}
                  </span>
                  {isDeviated && (
                    <span className="ml-2 text-xs text-orange-600 dark:text-orange-400">
                      {t('whatIf.deviation', { pct: (deviation * 100).toFixed(1) })}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleQuickAdjust(asset.asset, -10)}
                    className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded"
                  >
                    -10%
                  </button>
                  <button
                    onClick={() => handleQuickAdjust(asset.asset, -5)}
                    className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded"
                  >
                    -5%
                  </button>
                  <button
                    onClick={() => handleQuickAdjust(asset.asset, 5)}
                    className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 rounded"
                  >
                    +5%
                  </button>
                  <button
                    onClick={() => handleQuickAdjust(asset.asset, 10)}
                    className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 rounded"
                  >
                    +10%
                  </button>
                </div>
              </div>

              <input
                aria-label={t('whatIf.sliderLabel', { asset: asset.asset })}
                type="range"
                min="0"
                max={initialTotal * 1.5}
                step="1000"
                value={currentValue}
                onChange={(e) => handleValueChange(asset.asset, parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />

              <div className="flex items-center justify-between mt-2 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">{t('whatIf.amount')}</span>
                  <span className="font-semibold text-gray-900 dark:text-white ml-2">
                    {formatCurrency(currentValue)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">{t('whatIf.share')}</span>
                  <span className={cn(
                    'font-semibold ml-2',
                    isDeviated ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'
                  )}>
                    {formatPct(result?.newPct || 0)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 ml-1">
                    {t('whatIf.targetIs', { pct: formatPct(targetFraction) })}
                  </span>
                </div>
              </div>

              {showDetails && result && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('whatIf.originalAmount')}</span>
                    <span className="text-gray-900 dark:text-white">{formatCurrency(result.currentValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('whatIf.change')}</span>
                    <span className={cn(
                      'font-medium',
                      result.change > 0 ? 'text-green-600 dark:text-green-400' :
                      result.change < 0 ? 'text-red-600 dark:text-red-400' :
                      'text-gray-900 dark:text-white'
                    )}>
                      {result.change > 0 ? '+' : ''}{formatCurrency(result.change)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('whatIf.originalShare')}</span>
                    <span className="text-gray-900 dark:text-white">{formatPct(result.currentPct)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info Notice */}
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <div className="flex items-start">
          <InformationCircleIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900 dark:text-blue-300">
            <p className="font-medium mb-1">{t('whatIf.howToUse')}</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>{t('whatIf.tip1')}</li>
              <li>{t('whatIf.tip2')}</li>
              <li>{t('whatIf.tip3')}</li>
              <li>{t('whatIf.tip4')}</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
