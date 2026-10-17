'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';

/**
 * Rebalancing-page-shaped loading skeleton. Rendered both by the /rebalancing
 * route segment (loading.tsx) during navigation and by the page itself while
 * the dashboard fetch is in flight — so the shell (header, tab bar, content
 * card, info panel) paints immediately instead of a centered spinner.
 * Mirrors the real layout to keep layout shift low when data arrives.
 */
export function RebalancingSkeleton() {
  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto animate-pulse" role="status" aria-label="Loading rebalancing data">
        {/* Header — mobile only, mirrors the real page */}
        <div className="md:hidden flex items-start gap-3 mb-6">
          <div className="mt-1 h-9 w-9 rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-2">
            <div className="h-7 w-56 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 w-72 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </div>

        {/* Tab navigation */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-4 -mb-px">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="py-3 px-3 sm:px-4">
                <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Main content card */}
        <div className="h-72 bg-gray-200 dark:bg-gray-700 rounded-xl" />

        {/* Info panel */}
        <div className="mt-8 h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      </div>
    </DashboardLayout>
  );
}
