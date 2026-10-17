'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

/** Error boundary UI for the /loans route segment. */
export default function LoansError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback {...props} segment="loans" />;
}
