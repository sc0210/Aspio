'use client';

import { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useDemo } from '@/contexts/DemoContext';
import { useTranslation } from 'react-i18next';

const HIDDEN_KEY = 'aspiro-demo-banner-hidden';

export function DemoBanner() {
  const { isDemoMode, exitDemo } = useDemo();
  const { t } = useTranslation(['common', 'auth']);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(HIDDEN_KEY) === '1');
    } catch {
      /* storage unavailable — keep showing */
    }
  }, []);

  if (!isDemoMode || hidden) return null;

  // The × only hides the banner. It used to exit demo, which a bare × doesn't
  // say, so leaving demo is its own labelled button.
  const hide = () => {
    try {
      sessionStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      /* non-fatal */
    }
    setHidden(true);
  };

  return (
    <div
      role="banner"
      className="bg-primary-50 border-b border-primary-200 dark:bg-primary-900/20 dark:border-primary-800 px-4 md:px-6 py-1 sm:py-2"
    >
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-shrink-0" aria-hidden="true">
            <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
          </div>
          {/* The sign-up link must be a sibling of the prose, never inside it:
              truncate's overflow:hidden once clipped it out entirely on phones.
              The description is desktop-only so the phone banner stays one row. */}
          <div className="min-w-0 flex items-center gap-2 text-sm text-primary-700 dark:text-primary-300">
            <p className="min-w-0 truncate">
              <span className="font-semibold">{t('auth:demo.title')}</span>
              <span className="hidden sm:inline">: {t('auth:demo.description')}</span>
            </p>
            <a
              href="/auth/signup"
              className="inline-flex flex-shrink-0 items-center min-h-[44px] sm:min-h-0 font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded"
            >
              {t('auth:signUp.title')}
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={exitDemo}
          className="flex-shrink-0 inline-flex items-center min-h-[44px] sm:min-h-0 px-2 text-sm font-medium text-primary-700 dark:text-primary-300 hover:text-primary-900 dark:hover:text-primary-100 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
        >
          {t('auth:demo.exitDemo')}
        </button>
        <button
          type="button"
          onClick={hide}
          className="flex-shrink-0 -mr-2 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-primary-500 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-200 transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          aria-label={t('auth:demo.hideBanner')}
        >
          <XMarkIcon className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
