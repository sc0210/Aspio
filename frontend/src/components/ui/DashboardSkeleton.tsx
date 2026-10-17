'use client';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';

interface SkeletonProps {
  className?: string;
}

const Skeleton = ({ className }: SkeletonProps) => (
  <div className={cn('animate-pulse rounded-md bg-gray-200 dark:bg-gray-700', className)} />
);
export function ComprehensiveDashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6 lg:space-y-8">
      {/* Header card */}
      <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
        <div className="px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <Skeleton className="h-7 w-48 mb-1.5" />
              <Skeleton className="h-3.5 w-36" />
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-9 rounded-lg" />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-28 rounded-lg" />
            ))}
          </div>
        </div>
      </div>

      {/* Wallet Overview — 2:1 grid */}
      <div>
        <Skeleton className="h-6 w-36 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <Card padding="md" className="md:col-span-2 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-64 sm:h-80 md:h-96 w-full rounded-xl" />
            <div className="flex gap-4">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          </Card>
          <Card padding="md" className="hidden md:block space-y-4">
            <Skeleton className="h-52 w-52 rounded-full mx-auto" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </Card>
        </div>
      </div>

      {/* Main 3-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-8">
        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-5 sm:space-y-6 lg:space-y-8">
          {/* Portfolio */}
          <div>
            <Skeleton className="h-6 w-24 mb-3" />
            <Card padding="md">
              <div className="flex justify-end mb-4 gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
              <Skeleton className="h-[520px] w-full rounded-xl" />
            </Card>
          </div>
          {/* Goals */}
          <div>
            <Skeleton className="h-6 w-32 mb-3" />
            <Card padding="none" clip>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="p-5 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* Right 1/3 */}
        <div className="space-y-5 sm:space-y-6 lg:space-y-8">
          {/* Cash Flow */}
          <div>
            <Skeleton className="h-6 w-24 mb-3" />
            <Card padding="md" className="space-y-4">
              <Skeleton className="h-4 w-20 ml-auto" />
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
              <Skeleton className="h-16 w-full rounded-xl" />
            </Card>
          </div>
          {/* Recent Activity */}
          <div>
            <Skeleton className="h-6 w-32 mb-3" />
            <Card padding="md">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-14" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                      <div>
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}