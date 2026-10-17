'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';

/**
 * Generic route-segment loading skeleton for pages without a bespoke one.
 * Mirrors the common page shape (header, stat cards, main panel, list rows)
 * to keep layout shift low.
 */
export function RouteLoading() {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-pulse" role="status" aria-label="Loading">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
          ))}
        </div>
        <div className="h-72 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
