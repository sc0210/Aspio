'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

/** Error boundary UI for the /admin route segment. */
export default function AdminError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback {...props} segment="admin" />;
}
