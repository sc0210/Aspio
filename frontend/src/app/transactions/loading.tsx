import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';

/**
 * Streaming loading UI for the /transactions route segment.
 */
export default function TransactionsLoading() {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="h-px bg-gray-200 dark:bg-gray-700" />
          <div className="px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded-lg" />
              <div className="h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
          </div>
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} padding="sm" radius="xl" shadow="none">
              <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
              <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
            </Card>
          ))}
        </div>

        {/* Transaction list skeleton */}
        <Card padding="none" radius="xl" shadow="none" className="divide-y divide-gray-200 dark:divide-gray-700">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
              <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </Card>
      </div>
    </DashboardLayout>
  );
}
