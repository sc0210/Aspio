'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline';
import { SimpleSparkline } from './MiniCharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useCashFlowCategories } from '@/hooks/useCashFlowCategories';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { PERIOD_FALLBACKS, periodLabelKey } from '@/lib/dashboard/periodLabels';
import { Card } from '@/components/ui/Card';

interface MonthlyInsightCardProps {
  stats: {
    monthlyIncome?: number;
    monthlyExpenses?: number;
    savingsRate?: number;
  };
  dateRange?: string;
  trendData?: Array<{ income: number; expenses: number; netWorth?: number; balance?: number; date: string }>;
}

export function MonthlyInsightCard({ stats, dateRange, trendData }: MonthlyInsightCardProps) {
  const { t, i18n } = useTranslation(['dashboard']);
  const { isValueVisible } = usePrivacy();
  const cashFlow = useCashFlowCategories(dateRange, 5);

  const income = stats.monthlyIncome || 0;
  const expenses = stats.monthlyExpenses || 0;
  const net = income - expenses;
  const computedSavingsRate = income > 0 ? ((net / income) * 100) : 0;
  const savingsRate = typeof stats.savingsRate === 'number' ? stats.savingsRate : computedSavingsRate;
  const expenseRatio = income > 0 ? (expenses / income) * 100 : 0;
  const maxValue = Math.max(income, expenses, 1);
  const incomeBarWidth = (income / maxValue) * 100;
  const expenseBarWidth = (expenses / maxValue) * 100;
  const savingsRateColor =
    savingsRate >= 20 ? 'text-prosperity-700 dark:text-prosperity-400' :
    savingsRate >= 0  ? 'text-amber-700 dark:text-amber-400' :
                        'text-error-700 dark:text-error-400';

  const periodLabel = useMemo(
    () => t(periodLabelKey(dateRange), PERIOD_FALLBACKS[dateRange ?? ''] ?? 'This Month'),
    [dateRange, t],
  );

  return (
    <Card padding="none" clip className="h-full flex flex-col">
      <div className="h-px bg-gradient-to-r from-amber-400/60 via-rose-400/60 to-violet-400/60" />
      <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('dashboard:sections.cashFlow', 'Cash Flow')}</h3>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
            {periodLabel}
          </span>
        </div>
        <Link
          href="/transactions/monthly-summary"
          className="text-xs text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
        >
          {t('dashboard:todayStrip.details', 'Details')}
        </Link>
      </div>

      <div className="space-y-4">
        {/* Income */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-prosperity-50 dark:bg-prosperity-900/20 rounded-lg">
                <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-prosperity-700 dark:text-prosperity-500" />
              </div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('dashboard:chart.income', 'Income')}
              </span>
            </div>
            <span className="text-sm font-bold text-prosperity-700 dark:text-prosperity-400">
              {isValueVisible ? `+${formatTWD(income)}` : '•••••'}
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              role="progressbar"
              aria-valuenow={Math.round(incomeBarWidth)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Income ${Math.round(incomeBarWidth)}% of max`}
              className={`h-full rounded-full transition-all duration-700 ease-out ${income > 0 ? 'bg-prosperity-400' : ''}`}
              style={{ width: `${incomeBarWidth}%` }}
            />
          </div>
        </div>

        {/* Expenses */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-error-50 dark:bg-error-900/20 rounded-lg">
                <ArrowTrendingDownIcon className="w-3.5 h-3.5 text-error-500" />
              </div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('dashboard:chart.expenses', 'Expenses')}
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-error-700 dark:text-error-400">
                {isValueVisible ? `-${formatTWD(expenses)}` : '•••••'}
              </span>
              {income > 0 && (
                <span className="ml-1.5 text-xs font-semibold text-error-500">
                  {expenseRatio.toFixed(0)}%
                </span>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              role="progressbar"
              aria-valuenow={Math.round(expenseBarWidth)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Expenses ${Math.round(expenseBarWidth)}% of max`}
              className={`h-full rounded-full transition-all duration-700 ease-out ${expenses > 0 ? 'bg-error-400' : ''}`}
              style={{ width: `${expenseBarWidth}%` }}
            />
          </div>
        </div>

        {/* Net */}
        <div className="pt-3 border-t border-dashed border-gray-200 dark:border-gray-700">
          <div className="flex items-stretch gap-3">
            <div className={cn(
              'flex-1 rounded-xl px-3 py-2.5',
              net >= 0 ? 'bg-prosperity-50 dark:bg-prosperity-900/20' : 'bg-error-50 dark:bg-error-900/20'
            )}>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">
                {t('dashboard:cashFlow.netSaved', 'Net Saved')}
              </p>
              <p className={`text-lg font-bold leading-tight ${net >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400'}`}>
                {isValueVisible ? `${net >= 0 ? '+' : ''}${formatTWD(net)}` : '•••••'}
              </p>
            </div>
            <div className={cn(
              'w-24 flex-shrink-0 rounded-xl px-3 py-2.5 flex flex-col items-center justify-center',
              savingsRate >= 20
                ? 'bg-prosperity-50 dark:bg-prosperity-900/20'
                : savingsRate >= 0
                  ? 'bg-amber-50 dark:bg-amber-900/20'
                  : 'bg-error-50 dark:bg-error-900/20'
            )}>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">
                {t('dashboard:cashFlow.savingsRate', 'Rate')}
              </p>
              <p className={`text-xl font-bold leading-tight ${savingsRateColor}`}>
                {isValueVisible ? `${savingsRate.toFixed(1)}%` : '•••%'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Top income / spending categories — fills the card's wider layout */}
      {cashFlow.hasData && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50 grid grid-cols-2 gap-x-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-prosperity-700 dark:text-prosperity-500 mb-1.5">
              {t('dashboard:cashFlow.topIncome', 'Top Income')}
            </p>
            <ul className="space-y-1">
              {cashFlow.topIncome.length > 0 ? cashFlow.topIncome.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-gray-600 dark:text-gray-300">{c.name}</span>
                  <span className="flex-shrink-0 font-semibold tabular-nums text-prosperity-700 dark:text-prosperity-400">
                    {isValueVisible ? `+${formatTWD(c.amount)}` : '•••'}
                  </span>
                </li>
              )) : (
                <li className="text-xs text-gray-500 dark:text-gray-500">—</li>
              )}
            </ul>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-error-500 mb-1.5">
              {t('dashboard:cashFlow.topSpending', 'Top Spending')}
            </p>
            <ul className="space-y-1">
              {cashFlow.topExpense.length > 0 ? cashFlow.topExpense.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-gray-600 dark:text-gray-300">{c.name}</span>
                  <span className="flex-shrink-0 font-semibold tabular-nums text-error-700 dark:text-error-400">
                    {isValueVisible ? `-${formatTWD(c.amount)}` : '•••'}
                  </span>
                </li>
              )) : (
                <li className="text-xs text-gray-500 dark:text-gray-500">—</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Sparklines */}
      {trendData && trendData.length >= 2 && (() => {
        const incomeData = trendData.map(d => d.income);
        const expenseData = trendData.map(d => d.expenses);
        const labels = trendData.map(d => {
          try { return new Date(d.date).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }); }
          catch { return ''; }
        });
        const incomeHasSpark = incomeData.some(v => v > 0);
        const expenseHasSpark = expenseData.some(v => v > 0);
        const incomeTrend: 'up' | 'down' | 'neutral' = incomeData[incomeData.length - 1] >= incomeData[0] ? 'up' : 'down';
        const expenseTrend: 'up' | 'down' | 'neutral' = expenseData[expenseData.length - 1] >= expenseData[0] ? 'up' : 'down';
        if (!incomeHasSpark && !expenseHasSpark) return null;
        return (
          <div className="-mx-5 mt-3 border-t border-gray-100 dark:border-gray-700/50 pt-2 px-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-1">{t('dashboard:chart.trend', 'Trend')}</p>
            <div className="grid grid-cols-2 gap-2">
              {incomeHasSpark && (
                <div>
                  <p className="text-xs text-emerald-500 dark:text-emerald-400 font-medium mb-0.5">{t('dashboard:chart.income', 'Income')}</p>
                  <SimpleSparkline data={incomeData} labels={labels} height={48} trend={incomeTrend} color="#10b981" showDot className="w-full" />
                </div>
              )}
              {expenseHasSpark && (
                <div>
                  <p className="text-xs text-rose-500 dark:text-rose-400 font-medium mb-0.5">{t('dashboard:chart.expenses', 'Expenses')}</p>
                  <SimpleSparkline data={expenseData} labels={labels} height={48} trend={expenseTrend} color="#f87171" showDot className="w-full" />
                </div>
              )}
            </div>
          </div>
        );
      })()}
      </div>
    </Card>
  );
}
