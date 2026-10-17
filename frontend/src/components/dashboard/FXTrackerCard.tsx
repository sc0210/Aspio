'use client';

import { useTranslation } from 'react-i18next';
import {
  CurrencyDollarIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

interface FXTrackerCardProps {
  fxAccumulationTwd: number;
  fxThreshold: number;
  lastFxRate: number;
  lastUpdated?: Date;
  readyToConvert?: boolean;
  onConvert?: () => void;
}

export function FXTrackerCard({
  fxAccumulationTwd,
  fxThreshold,
  lastFxRate,
  lastUpdated,
  readyToConvert = false,
  onConvert
}: FXTrackerCardProps) {
  const { t } = useTranslation('dashboard');

  const formatCurrency = (value: number) =>
    formatCurrencyUtil(value, 'TWD', value >= 100000 ? { compact: true } : { precision: 0 });

  const progressPct = Math.min((fxAccumulationTwd / fxThreshold) * 100, 100);
  const usdAmount = fxAccumulationTwd / lastFxRate;
  const estimatedFee = Math.max(usdAmount * 0.002, 100); // 0.2% or min $100 TWD

  return (
    <Card padding="lg" radius="xl" shadow="none">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
            <CurrencyDollarIcon className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" />
            {t('fx.title')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('fx.subtitle')}
          </p>
        </div>
        {readyToConvert && (
          <div className="flex items-center text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-5 h-5 mr-2" />
            <span className="text-sm font-medium">{t('fx.ready')}</span>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('fx.progress')}
          </span>
          <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
            {progressPct.toFixed(1)}%
          </span>
        </div>
        <div className="relative w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'absolute h-full rounded-full transition-all duration-500',
              readyToConvert
                ? 'bg-gradient-to-r from-green-500 to-green-600'
                : 'bg-gradient-to-r from-blue-500 to-blue-600'
            )}
            style={{ width: `${progressPct}%` }}
          />
          {readyToConvert && (
            <div className="absolute inset-0 flex items-center justify-center">
              <CheckCircleIcon className="w-4 h-4 text-white" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-gray-600 dark:text-gray-400">
          <span>{formatCurrency(fxAccumulationTwd)}</span>
          <span>{formatCurrency(fxThreshold)}</span>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <p className="text-sm text-blue-900 dark:text-blue-300 mb-1">{t('fx.accumulated')}</p>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
            {formatCurrency(fxAccumulationTwd)}
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
            {t('fx.approxUsd', { amount: usdAmount.toFixed(2) })}
          </p>
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">{t('fx.threshold')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(fxThreshold)}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('fx.stillNeeded', { amount: formatCurrency(Math.max(0, fxThreshold - fxAccumulationTwd)) })}
          </p>
        </div>
      </div>

      {/* Exchange Rate Info */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('fx.currentRate')}
          </span>
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            1 USD = NT${lastFxRate.toFixed(2)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-600 dark:text-gray-400">{t('fx.convertibleUsd')}</p>
            <p className="font-semibold text-gray-900 dark:text-white">
              ${usdAmount.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-gray-600 dark:text-gray-400">{t('fx.estimatedFee')}</p>
            <p className="font-semibold text-gray-900 dark:text-white">
              {formatCurrency(estimatedFee)}
            </p>
          </div>
        </div>
      </div>

      {/* Action Button */}
      {readyToConvert ? (
        <button
          onClick={onConvert}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center"
        >
          <ArrowPathIcon className="w-5 h-5 mr-2" />
          {t('fx.convertNow')}
        </button>
      ) : (
        <div className="text-center p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
          <ClockIcon className="w-8 h-8 mx-auto text-gray-400 dark:text-gray-500 mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('fx.accumulating')}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            {t('fx.convertWhenReady')}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{t('fx.lastUpdated', { at: lastUpdated ? new Date(lastUpdated).toLocaleString() : '---' })}</span>
          <span className="flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            {t('fx.liveRate')}
          </span>
        </div>
      </div>

      {/* Info Notice */}
      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <p className="text-xs text-blue-900 dark:text-blue-300">
          💡 <strong>{t('fx.noticeLabel')}</strong>{' '}
          {t('fx.notice', { threshold: formatCurrency(fxThreshold) })}
        </p>
      </div>
    </Card>
  );
}
