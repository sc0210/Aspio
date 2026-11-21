'use client';

import { useTranslation } from 'react-i18next';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { cn } from '@/utils/cn';

interface QueryErrorCardProps {
  /** Re-runs the failed query. */
  onRetry: () => void;
  /** Overrides the generic "Couldn't load this". */
  title?: string;
  className?: string;
}

/**
 * Shown in place of data that failed to load.
 *
 * Without it, pages fell through to their empty state — "Add your first loan",
 * "All settled up", NT$0 net worth — so a network error read as a real, and
 * wrong, answer. A failed query must render this, never the empty state.
 */
export function QueryErrorCard({ onRetry, title, className }: QueryErrorCardProps) {
  const { t } = useTranslation('common');
  return (
    <Card padding="none" className={cn('p-4', className)}>
      <div role="alert" className="flex items-start gap-3">
        <ExclamationTriangleIcon className="w-5 h-5 text-error-600 dark:text-error-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{title ?? t('errorState.loadFailed')}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{t('errorState.loadFailedHint')}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-sm px-4 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 touch-manipulation"
        >
          {t('errorState.tryAgain')}
        </button>
      </div>
    </Card>
  );
}
