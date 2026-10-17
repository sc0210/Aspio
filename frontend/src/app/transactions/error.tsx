'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

/** Error boundary UI for the /transactions route segment. */
export default function TransactionsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback {...props} segment="transactions" />;
}
