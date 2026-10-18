'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useDemo } from '@/contexts/DemoContext';
import { useTranslation } from 'react-i18next';

export function DemoBanner() {
  const { isDemoMode, disableDemo } = useDemo();
  const router = useRouter();
  const { t } = useTranslation(['common', 'auth']);

  if (!isDemoMode) return null;

  const handleExit = () => {
    disableDemo();
    router.push('/');
  };

  return (
    <div
      role="banner"
      className="bg-primary-50 border-b border-primary-200 dark:bg-primary-900/20 dark:border-primary-800 px-4 py-2"
    >
      <div className="flex items-start sm:items-center justify-between max-w-7xl mx-auto gap-2 sm:gap-3">
        <div className="flex items-start sm:items-center gap-2 flex-1 min-w-0">
          <div className="flex-shrink-0 mt-1.5 sm:mt-0" aria-hidden="true">
            <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
          </div>
          {/* The sign-up link must be a sibling of the prose, never inside it.
              It previously sat within the `truncate` paragraph, and truncate's
              overflow:hidden clipped the link outright — below ~400px the only
              route from demo to a real account was invisible. Prose wraps on
              phones and truncates only once there is a single row to spare. */}
          <div className="min-w-0 text-sm text-primary-700 dark:text-primary-300 sm:flex sm:items-center sm:gap-2">
            <p className="sm:truncate">
              <span className="font-semibold">{t('auth:demo.title')}:</span>{' '}
              {t('auth:demo.description')}
            </p>
            <a
              href="/auth/signup"
              className="inline-flex items-center min-h-[44px] sm:min-h-0 sm:flex-shrink-0 font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded"
            >
              {t('auth:signUp.title')}
            </a>
          </div>
        </div>
        <button
          onClick={handleExit}
          className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-primary-400 hover:text-primary-600 dark:hover:text-primary-200 transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          aria-label={t('auth:demo.exitDemo')}
        >
          <XMarkIcon className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
