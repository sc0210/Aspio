'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

/** Error boundary UI for the /savings route segment. */
export default function SavingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback {...props} segment="savings" />;
}
