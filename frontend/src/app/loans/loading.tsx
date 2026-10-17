import { LoansSkeleton } from '@/components/loans/LoansSkeleton';

/** Streaming loading UI for the /loans route segment (paints during navigation). */
export default function LoansLoading() {
  return <LoansSkeleton />;
}
