import { RebalancingSkeleton } from '@/components/dashboard/RebalancingSkeleton';

/** Streaming loading UI for the /rebalancing route segment (paints during navigation). */
export default function RebalancingLoading() {
  return <RebalancingSkeleton />;
}
