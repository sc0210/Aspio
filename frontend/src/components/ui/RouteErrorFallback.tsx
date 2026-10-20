'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

interface RouteErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Segment name for the console log line, e.g. "goals". */
  segment: string;
}

/**
 * Shared UI for route-segment error.tsx boundaries. Renders inside the app
 * shell with localized copy and a reset (re-render) action.
 */
export function RouteErrorFallback({ error, reset, segment }: RouteErrorFallbackProps) {
  const { t } = useTranslation('common');

  useEffect(() => {
    // Log to an error reporting service in production
    console.error(`[${segment} error boundary]`, error);
  }, [error, segment]);

  return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div role="alert" className="text-center max-w-md px-4">
          <div className="text-5xl mb-4" role="img" aria-label={t('errorState.iconLabel', 'Error')}>⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('errorState.titleWithSegment', 'Failed to load {{segment}}', {
              segment: t(`navigation.${segment}`, segment),
            })}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {error.message || t('errorState.description', 'An unexpected error occurred while loading this page.')}
          </p>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-700 rounded-lg hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 transition-colors"
          >
            {t('errorState.tryAgain', 'Try again')}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
