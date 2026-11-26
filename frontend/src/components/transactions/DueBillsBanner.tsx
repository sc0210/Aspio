'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { BellAlertIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useDueBills } from '@/hooks/useRecurringBills';
import { localDateString } from '@/utils/formatters';

/**
 * "2 bills due": the reminders waiting to be recorded or skipped (due today or
 * earlier). Nothing when none are, in demo mode, or while loading.
 */
export function DueBillsBanner() {
  const { t } = useTranslation('transactions');
  const { data } = useDueBills();
  const today = localDateString();
  const count = (data ?? []).filter((b) => b.nextOccurrence <= today).length;
  if (count === 0) return null;
  return (
    <Link
      href="/transactions/recurring"
      className="flex items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
    >
      <BellAlertIcon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1">{t('bills.banner', { count })}</span>
      <span className="flex items-center gap-0.5 text-xs font-bold">
        {t('bills.bannerAction', 'Review')}
        <ChevronRightIcon className="w-4 h-4" aria-hidden="true" />
      </span>
    </Link>
  );
}
