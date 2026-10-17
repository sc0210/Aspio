'use client';

import Link from 'next/link';
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CreditCardIcon
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import { Transaction } from '@/shared/types';
import { useTransactions } from '@/hooks/useTransactions';
import { getCategoryIcon } from '@/utils/categoryIcon';
import { Card } from '@/components/ui/Card';

function RecentTransactionsSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading transactions">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center justify-between py-2 px-2.5 rounded-lg">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-3.5 w-32 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
              <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
            </div>
          </div>
          <div className="flex-shrink-0 ml-3 h-4 w-16 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

interface RecentTransactionsProps {
  dateRange?: string;
}

function getDateFilter(range?: string): { start: Date; end: Date } | undefined {
  if (!range) return undefined;

  const today = new Date();
  const endDate = new Date(today);
  const startDate = new Date();

  switch (range) {
    case '7d':
      startDate.setDate(today.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    case '14d':
      startDate.setDate(today.getDate() - 14);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case '30d':
      startDate.setDate(today.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      break;
    case '90d':
      startDate.setDate(today.getDate() - 90);
      startDate.setHours(0, 0, 0, 0);
      break;
    case '6m':
      startDate.setMonth(today.getMonth() - 6);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'ytd':
      startDate.setMonth(0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case '1y':
      startDate.setFullYear(today.getFullYear() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      return undefined;
  }

  endDate.setHours(23, 59, 59, 999);
  return { start: startDate, end: endDate };
}

export function RecentTransactions({ dateRange }: RecentTransactionsProps) {
  const { t, i18n } = useTranslation(['dashboard', 'common']);

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return t('common:time.today', 'Today');
    if (diffInDays === 1) return t('common:time.yesterday', 'Yesterday');
    if (diffInDays < 7) return t('common:time.daysAgo', '{{count}}d ago', { count: diffInDays });

    return date.toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric',
    });
  };

  const dateRangeFilter = getDateFilter(dateRange);

  const { transactions: fetchedTransactions, isLoading } = useTransactions({
    limit: 5,
    sortBy: 'date',
    sortOrder: 'desc',
    dateRange: dateRangeFilter,
  });

  const transactions: Transaction[] = fetchedTransactions || [];

  return (
    <Card padding="none" clip className="h-full flex flex-col">
      <div className="h-px bg-gradient-to-r from-prosperity-400/60 via-primary-400/60 to-primary-300/60" aria-hidden="true" />
      <div className="p-5" aria-live="polite" aria-atomic="false">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('dashboard:recentTransactions.title', 'Recent Transactions')}
        </h3>
        <Link
          href="/transactions"
          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
        >
          {t('dashboard:recentTransactions.viewAll')}
        </Link>
      </div>

      {isLoading ? (
        <RecentTransactionsSkeleton />
      ) : transactions.length === 0 ? (
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-3">
            <CreditCardIcon className="w-6 h-6 text-gray-400" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{t('dashboard:recentTransactions.noTransactions')}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
            {t('dashboard:recentTransactions.addFirst')}
          </p>
          <Link
            href="/transactions/add"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 dark:focus-visible:ring-offset-gray-800"
          >
            {t('dashboard:recentTransactions.addTransaction')}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((transaction) => (
            <Link
              key={transaction.id}
              href="/transactions"
              className="flex items-center justify-between py-2 px-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
            >
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className="text-lg flex-shrink-0">
                  {getCategoryIcon(transaction.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {transaction.description}
                  </p>
                  <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    <span className="truncate">{transaction.category}</span>
                    <span className="flex-shrink-0">•</span>
                    <span className="flex-shrink-0">{formatDate(new Date(transaction.date))}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1 flex-shrink-0 ml-3">
                <div
                  className={cn(
                    'text-sm font-semibold whitespace-nowrap',
                    transaction.type === 'income'
                      ? 'text-success-600 dark:text-success-400'
                      : 'text-gray-900 dark:text-white'
                  )}
                >
                  {transaction.type === 'income' ? '+' : '-'}
                  {formatCurrency(transaction.amount, transaction.currency)}
                </div>

                {transaction.type === 'income' ? (
                  <ArrowTrendingUpIcon className="w-4 h-4 text-success-500 flex-shrink-0" aria-hidden="true" />
                ) : (
                  <ArrowTrendingDownIcon className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      </div>
    </Card>
  );
}