'use client';

import { ReactNode } from 'react';
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import { cn } from '@/utils/cn';

interface TransactionStatsProps {
  stats: {
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
    transactionCount: number;
  };
  /** Whether the totals currently leave wallet transfers out. */
  excludeTransfers?: boolean;
  /** Provided by the page; omit to hide the toggle entirely. */
  onToggleTransfers?: (next: boolean) => void;
  /** The stats request failed. The caller passes zeros in that case, so without
   *  this the cards would render a confident NT$0 — indistinguishable from a
   *  filter that genuinely matched nothing. Show an em dash and a retry instead. */
  error?: boolean;
  onRetry?: () => void;
}

export function TransactionStats({
  stats,
  error = false,
  onRetry,
  excludeTransfers = false,
  onToggleTransfers,
}: TransactionStatsProps) {
  const { t } = useTranslation(['common', 'transactions']);
  const { isValueVisible } = usePrivacy();

  // One helper for all three cards: an unavailable number must never look like a
  // real one, and privacy masking still wins over both.
  const amount = (value: number, sign = false) => {
    if (error) return '—';
    if (!isValueVisible) return '•••••';
    return `${sign && value >= 0 ? '+' : ''}${formatTWD(value)}`;
  };
  const amountTitle = (value: number) =>
    error || !isValueVisible ? undefined : formatTWD(value);

  // Net income drives its own card's colour; a failed load has no sign to show,
  // so fall back to the neutral treatment.
  const netIsPositive = !error && stats.netIncome >= 0;

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning-200/70 dark:border-warning-800/40 bg-warning-50 dark:bg-warning-900/20 px-3 py-2"
        >
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 text-warning-700 dark:text-warning-400" />
          <span className="text-xs font-medium text-warning-800 dark:text-warning-200">
            {t('transactions:stats.loadFailed')}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-semibold text-warning-900 dark:text-warning-100 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-500 rounded"
            >
              {t('common:errorState.tryAgain')}
            </button>
          )}
        </div>
      )}
      {onToggleTransfers && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            role="switch"
            aria-checked={excludeTransfers}
            onClick={() => onToggleTransfers(!excludeTransfers)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex h-4 w-7 items-center rounded-full transition-colors',
                excludeTransfers ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600',
              )}
            >
              <span
                className={cn(
                  'h-3 w-3 rounded-full bg-white transition-transform',
                  excludeTransfers ? 'translate-x-3.5' : 'translate-x-0.5',
                )}
              />
            </span>
            {t('transactions:stats.hideTransfers', 'Hide transfers')}
          </button>
        </div>
      )}
      {excludeTransfers && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
          {t(
            'transactions:stats.hideTransfersNote',
            'Moving money between your own wallets is left out. The list below still shows both legs, so these totals no longer match it.',
          )}
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          accent="green"
          icon={<ArrowTrendingUpIcon className="w-4 h-4 text-success-700 dark:text-success-500" />}
          label={t('transactions:stats.totalIncome')}
          value={amount(stats.totalIncome)}
          title={amountTitle(stats.totalIncome)}
          tone={error ? 'muted' : 'income'}
        />

        <StatCard
          accent="rose"
          icon={<ArrowTrendingDownIcon className="w-4 h-4 text-error-700 dark:text-error-500" />}
          label={t('transactions:stats.totalExpenses')}
          value={amount(stats.totalExpenses)}
          title={amountTitle(stats.totalExpenses)}
          tone={error ? 'muted' : 'expense'}
        />

        <StatCard
          className="col-span-2 lg:col-span-1"
          accent="blue"
          icon={<BanknotesIcon className="w-4 h-4 text-primary-500" />}
          label={t('transactions:stats.netIncome')}
          value={amount(stats.netIncome, true)}
          title={amountTitle(stats.netIncome)}
          // The accent stays put — it says which card this is, not how the month
          // went. The figure's own colour carries the sign.
          tone={error ? 'muted' : netIsPositive ? 'income' : 'expense'}
        />
      </div>
    </div>
  );
}

const TONES = {
  income: 'text-success-700 dark:text-success-400',
  expense: 'text-error-700 dark:text-error-400',
  muted: 'text-gray-500 dark:text-gray-400',
} as const;

/**
 * One summary figure, in the shape the loans page uses: icon and label on a
 * line, then the number.
 *
 * These used to be a gradient with a decorative blurred circle, an uppercase
 * `text-xs` label and a figure that only reached its full size at `lg`, so on
 * anything smaller the most important number on the page was set at 16px —
 * smaller than the same figure on /loans, and in a different visual language.
 */
function StatCard({
  accent,
  icon,
  label,
  value,
  title,
  tone,
  className,
}: {
  accent: 'green' | 'rose' | 'blue';
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
  tone: keyof typeof TONES;
  className?: string;
}) {
  return (
    <Card padding="sm" accent={accent} className={className}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{label}</p>
      </div>
      {/* Two steps, not three: the cards sit 2-up on a phone, where 24px would
          truncate a seven-figure amount. */}
      <p className={`text-xl sm:text-2xl font-bold truncate ${TONES[tone]}`} title={title}>
        {value}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">TWD</p>
    </Card>
  );
}