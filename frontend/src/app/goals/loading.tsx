import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';

/**
 * Streaming loading UI for the /goals route segment.
 *
 * Next.js shows this file automatically while the page chunk is being fetched
 * and while any server components in the segment are suspended. Using a
 * skeleton keeps CLS low because the layout dimensions are already in place
 * before the real content arrives.
 */
export default function GoalsLoading() {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-pulse">
        {/* Header skeleton — mobile only */}
        <div className="md:hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="h-px bg-gray-200 dark:bg-gray-700" />
          <div className="px-4 py-4 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-5 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-3 w-52 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
            <div className="h-9 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>
        </div>

        {/* Retirement tracker skeleton */}
        <Card padding="none" radius="xl" shadow="none" className="h-36" />

        {/* Filter row skeleton */}
        <div className="flex gap-3 bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="h-10 w-36 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-10 w-36 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>

        {/* Insight cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} padding="sm" shadow="none">
              <div className="h-3 w-28 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
              <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
              <div className="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
            </Card>
          ))}
        </div>

        {/* Goal cards skeleton */}
        <div>
          <div className="h-6 w-28 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} padding="md" radius="xl" shadow="none" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full" />
                <div className="flex justify-between">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
                <div className="flex gap-2 pt-2">
                  <div className="h-8 flex-1 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                  <div className="h-8 flex-1 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
