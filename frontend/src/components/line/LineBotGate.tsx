'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useFeatures } from '@/hooks/useFeatures';

/**
 * Renders a LINE-only page only when this instance has the bot configured.
 *
 * The nav already hides these pages, but a bookmark or a stale LINE message can
 * still land on one, and without the bot every call it makes is a 404.
 * `standalone` pages (/link-line, /liff) render outside the app shell.
 */
export function LineBotGate({ children, standalone = false }: { children: ReactNode; standalone?: boolean }) {
  const { t } = useTranslation('common');
  const { lineBot, isLoading } = useFeatures();

  if (lineBot) return <>{children}</>;

  const body = isLoading ? (
    <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
  ) : (
    <EmptyState
      icon="💬"
      title={t('lineLink.unavailableTitle', 'LINE isn’t set up here')}
      description={t(
        'lineLink.unavailableBody',
        'This Aspiro instance has no LINE bot configured, so LINE linking and group splitting are off. The admin can enable them by adding a LINE channel.',
      )}
    />
  );

  if (standalone) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        {body}
      </main>
    );
  }
  return <DashboardLayout>{body}</DashboardLayout>;
}
