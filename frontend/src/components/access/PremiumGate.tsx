'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAccessTier } from '@/hooks/useAccessTier';

/**
 * Renders a premium page only for a premium account.
 *
 * Mounted from the route's layout.tsx, so for a free account the page itself
 * never mounts and never fires the requests the backend would refuse. The nav
 * already hides these pages; this covers a bookmark or a typed URL.
 *
 * A failed profile request renders the page anyway, as LineBotGate does for
 * /features: the backend still enforces the tier, and a premium user must not
 * be told otherwise because of a hiccup.
 */
export function PremiumGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const { isPremium, isLoading, isError } = useAccessTier();

  if (isPremium || isError) return <>{children}</>;

  return (
    <DashboardLayout>
      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <EmptyState
          icon="✨"
          title={t('access.premiumTitle', 'This page needs Premium')}
          description={t(
            'access.premiumBody',
            'Your account is on the Free plan. Ask your admin to upgrade it to use this page.',
          )}
          action={
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {t('access.backToDashboard', 'Back to dashboard')}
            </Link>
          }
        />
      )}
    </DashboardLayout>
  );
}
