'use client';

import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { startTour, tourFor } from '@/lib/tour/tours';

/** Starts (or replays) this page's tour. Absent on pages without one. */
export function TourButton() {
  const { t } = useTranslation('common');
  const pathname = usePathname();
  if (!tourFor(pathname)) return null;
  return (
    <button type="button" onClick={startTour} data-tour="tour-button"
      aria-label={t('tour.button', 'Tour this page')} title={t('tour.button', 'Tour this page')}
      // Same box as the What's New and bell buttons beside it.
      className="relative p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-lg text-gray-600 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 flex items-center justify-center">
      <QuestionMarkCircleIcon className="w-6 h-6 md:w-5 md:h-5" />
    </button>
  );
}
