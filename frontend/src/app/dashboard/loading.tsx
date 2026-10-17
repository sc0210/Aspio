import { ComprehensiveDashboardSkeleton } from '@/components/ui/DashboardSkeleton';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

/**
 * Streaming loading UI for the /dashboard route segment.
 *
 * Next.js shows this file automatically while the page chunk is being fetched
 * and while any server components in the segment are suspended. Using a
 * skeleton keeps CLS low because the layout dimensions are already in place
 * before the real content arrives.
 */
export default function DashboardLoading() {
  return (
    <DashboardLayout>
      <ComprehensiveDashboardSkeleton />
    </DashboardLayout>
  );
}
