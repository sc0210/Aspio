'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';

/**
 * Loan-page-shaped loading skeleton. Rendered both by the /loans route segment
 * (loading.tsx) during navigation and by the page itself while the loans query
 * is in flight — so the page shell paints immediately instead of gating the
 * whole route behind a full-screen spinner (which produced a poor LCP).
 * Mirrors the real page layout (header, 3 stat cards, section, card grid) to
 * keep layout shift low when the data arrives.
 */
export function LoansSkeleton() {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-pulse" role="status" aria-label="Loading loans">
        {/* Page header — mobile only, mirrors the real page */}
        <div className="md:hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="h-px bg-gradient-to-r from-rose-400/60 via-red-400/60 to-orange-400/60" />
          <div className="px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
            <div className="h-9 w-24 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} padding="none" clip>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-7 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            </Card>
          ))}
        </div>

        {/* Section heading */}
        <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded" />

        {/* Loan cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-gray-200 dark:bg-gray-700" />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
