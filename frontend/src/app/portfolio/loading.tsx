import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PortfolioPageSkeleton } from '@/components/portfolio/PortfolioSkeleton';

/**
 * Streaming loading UI for the /portfolio route segment.
 */
export default function PortfolioLoading() {
  return (
    <DashboardLayout>
      <PortfolioPageSkeleton />
    </DashboardLayout>
  );
}
