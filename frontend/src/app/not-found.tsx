'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

/** App-wide 404 page (rendered inside the root layout, so providers exist). */
export default function NotFound() {
  const { t } = useTranslation('common');

  return (
    <main className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center max-w-md px-4">
        <div className="text-6xl mb-4" role="img" aria-label={t('notFoundPage.iconLabel', 'Not found')}>🧭</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t('notFoundPage.title', 'Page not found')}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {t('notFoundPage.description', "The page you're looking for doesn't exist or has been moved.")}
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-700 rounded-lg hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 transition-colors"
        >
          {t('notFoundPage.goHome', 'Back to dashboard')}
        </Link>
      </div>
    </main>
  );
}
